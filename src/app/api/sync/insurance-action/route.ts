import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/prisma';
import { syncSecretOk, isOnline } from '@/server/sync/config';
import { isStoredMediaUrl } from '@/lib/upload-paths';
import {
  recordInsuranceDecision,
  executeDeskInsuranceRefund,
} from '@/server/services/insurance-refunds';
import { getInsuranceCheckoutForReception } from '@/server/services/insurance-reads';
import { DomainError } from '@/server/services/errors';
import { readJsonBounded, KIB } from '@/server/sync/http-core';
import { log, errFields } from '@/lib/log';

/**
 * POST /api/sync/insurance-action  (ONLINE receiver)
 *
 * The LOCAL reception desk proxies the two ONLINE-OWNED deposit mutations here
 * (docs/INSURANCE.md §8): the checkout decision and the desk (cash / InstaPay)
 * payout. Mirrors /api/sync/reception-booking exactly: the desk already
 * authenticated the acting staff locally; the shared WRITE-scoped secret
 * authorises the node-to-node call, and the staff id rides in the payload. A
 * DomainError comes back as HTTP 200 `{ ok:false, code }` so the desk renders
 * the same message it would for a direct call. Refused unless this deployment
 * is `online`. On success the response carries the FRESH checkout view so the
 * desk shows online's truth without waiting for the next pull.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STAFF_ID_RE = /^[a-z0-9-]{16,64}$/i; // cuid / uuid shape

const schema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('decide'),
    staffId: z.string().regex(STAFF_ID_RE),
    payload: z.object({
      bookingId: z.string().min(1).max(64),
      decision: z.enum(['REFUND', 'NO_REFUND']),
      reason: z.string().trim().max(500).optional().nullable(),
    }),
  }),
  z.object({
    op: z.literal('executeDesk'),
    staffId: z.string().regex(STAFF_ID_RE),
    payload: z.object({
      insuranceRefundId: z.string().min(1).max(64),
      method: z.enum(['CASH', 'INSTAPAY']),
      proofUrl: z
        .string()
        .trim()
        .max(2000)
        .refine(isStoredMediaUrl, { message: 'invalid_image_url' })
        .optional()
        .nullable(),
    }),
  }),
]);

export async function POST(request: Request) {
  if (!syncSecretOk(request, 'write')) {
    return NextResponse.json({ ok: false, code: 'unauthorized' }, { status: 401 });
  }
  if (!isOnline()) {
    return NextResponse.json({ ok: false, code: 'not_online_node' }, { status: 409 });
  }

  // A decision / payout payload is a few hundred bytes; 64 KiB caps it.
  const body = await readJsonBounded(request, 64 * KIB);
  if (!body.ok) {
    return NextResponse.json(
      { ok: false, code: body.reason },
      { status: body.reason === 'too_large' ? 413 : 400 },
    );
  }
  const parsed = schema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: 'invalid_input' }, { status: 400 });
  }
  const input = parsed.data;

  try {
    // The audit trail (AuditLog.actorUserId FK) + decidedById attribution need
    // the acting staff's User row. Staff originate on local and aren't synced
    // up, so ensure a minimal row exists — same convention as reception-booking
    // (a future staff-sync overwrites it).
    await prisma.user.createMany({ data: [{ id: input.staffId }], skipDuplicates: true });

    let bookingId: string;
    if (input.op === 'decide') {
      await recordInsuranceDecision({
        bookingId: input.payload.bookingId,
        staffId: input.staffId,
        decision: input.payload.decision,
        reason: input.payload.reason ?? undefined,
      });
      bookingId = input.payload.bookingId;
    } else {
      await executeDeskInsuranceRefund({
        insuranceRefundId: input.payload.insuranceRefundId,
        staffId: input.staffId,
        method: input.payload.method,
        proofUrl: input.payload.proofUrl ?? undefined,
      });
      const row = await prisma.insuranceRefund.findUnique({
        where: { id: input.payload.insuranceRefundId },
        select: { bookingInsurance: { select: { bookingId: true } } },
      });
      if (!row) {
        return NextResponse.json({ ok: false, code: 'insurance_not_found' }, { status: 200 });
      }
      bookingId = row.bookingInsurance.bookingId;
    }

    const view = await getInsuranceCheckoutForReception(bookingId);
    if (!view) {
      return NextResponse.json({ ok: false, code: 'insurance_not_found' }, { status: 200 });
    }
    return NextResponse.json({ ok: true, view }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ ok: false, code: err.code }, { status: 200 });
    }
    log.error('sync insurance-action failed', errFields(err));
    return NextResponse.json({ ok: false, code: 'unknown' }, { status: 500 });
  }
}

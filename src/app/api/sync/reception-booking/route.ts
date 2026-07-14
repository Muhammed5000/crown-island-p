import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/prisma';
import { syncSecretOk, isOnline } from '@/server/sync/config';
import { commitReceptionBooking } from '@/server/services/reception-commit';
import type { CreateReceptionBookingInput } from '@/server/services/reception';
import { DomainError } from '@/server/services/errors';
import { readJsonBounded, KIB } from '@/server/sync/http-core';
import { log, errFields } from '@/lib/log';

/**
 * POST /api/sync/reception-booking  (ONLINE receiver)
 *
 * The LOCAL reception desk proxies a walk-in booking here so the ONLINE node —
 * the sole writer of bookings + capacity — commits it. The desk already
 * authenticated the acting staff locally; the shared secret authorises the
 * node-to-node call, and the staff id rides in the payload. A DomainError comes
 * back as HTTP 200 `{ ok:false, code }` so the desk renders the same message it
 * would for a local commit. Refused unless this deployment is `online`.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!syncSecretOk(request, 'write')) {
    return NextResponse.json({ ok: false, code: 'unauthorized' }, { status: 401 });
  }
  if (!isOnline()) {
    return NextResponse.json({ ok: false, code: 'not_online_node' }, { status: 409 });
  }

  // A desk booking payload (identity + selections) is a few KB; 256 KiB caps it.
  const parsed = await readJsonBounded(request, 256 * KIB);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, code: parsed.reason },
      { status: parsed.reason === 'too_large' ? 413 : 400 },
    );
  }
  const input = parsed.body as CreateReceptionBookingInput;

  // Defense-in-depth on this node-to-node writer: reject a non-object body, and
  // constrain the client-supplied `staffId` to a real id shape before it can mint
  // a User row (never accept an arbitrary caller-chosen primary key). Deep field
  // validation stays in commitReceptionBooking (DomainError → 200 {ok:false}).
  if (input == null || typeof input !== 'object') {
    return NextResponse.json({ ok: false, code: 'invalid_input' }, { status: 400 });
  }
  const STAFF_ID_RE = /^[a-z0-9-]{16,64}$/i; // cuid / uuid shape
  if (input.staffId != null && (typeof input.staffId !== 'string' || !STAFF_ID_RE.test(input.staffId))) {
    return NextResponse.json({ ok: false, code: 'invalid_input' }, { status: 400 });
  }

  try {
    // The booking is attributed to the acting staff (booking.userId = staffId,
    // plus createdByStaffId / uploadedById / assignedById). Staff originate on
    // local and aren't synced to online, so ensure a minimal row exists to
    // satisfy those foreign keys — a future staff-sync overwrites it. (NOTE:
    // manual-discount bookings resolve the PIN AUTHORIZER as the owner and need
    // that user + their pinHash present on online, so that path isn't proxied
    // yet — the desk should not apply a manual discount on the local node.)
    if (typeof input.staffId === 'string' && input.staffId) {
      await prisma.user.createMany({ data: [{ id: input.staffId }], skipDuplicates: true });
    }

    const result = await commitReceptionBooking(input);
    return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ ok: false, code: err.code }, { status: 200 });
    }
    log.error('sync reception-booking commit failed', errFields(err));
    return NextResponse.json({ ok: false, code: 'unknown' }, { status: 500 });
  }
}

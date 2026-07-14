'use server';

import { z } from 'zod';
import { getSessionUser } from '@/server/auth/guards';
import { canAccessReception } from '@/server/auth/roles';
import { isStoredMediaUrl } from '@/lib/upload-paths';
import {
  getInsuranceCheckoutForReception,
  listPendingDeposits,
  type InsuranceCheckoutView,
  type PendingDepositRow,
} from '@/server/services/insurance-reads';
import {
  recordInsuranceDecision,
  executeDeskInsuranceRefund,
} from '@/server/services/insurance-refunds';
import {
  isLocal,
  onlineApiUrl,
  SYNC_SECRET_HEADER,
  syncScopeSecret,
  SYNC_TRANSFER_TIMEOUT_MS,
} from '@/server/sync/config';
import { pullAll } from '@/server/sync/pull';
import { prisma } from '@/server/db/prisma';
import { DomainError } from '@/server/services/errors';

/**
 * Reception deposit-checkout server actions (docs/INSURANCE.md §5).
 *
 * READS work on BOTH nodes — the local mirror holds the pulled insurance rows.
 * The two MUTATIONS (checkout decision + desk payout) are online-owned
 * (`assertNotLocalNode` inside the services), so on the LOCAL venue node they
 * PROXY to `POST /api/sync/insurance-action`, exactly like
 * `createReceptionBookingAction` proxies walk-in bookings: shared write-scoped
 * sync secret, transport failure → `offline`, and a best-effort `pullAll()`
 * after success so the local mirror shows the new state immediately.
 */

export type InsuranceCheckoutResult =
  | { ok: true; view: InsuranceCheckoutView }
  | { ok: false; code: string };

export type PendingDepositsResult =
  | { ok: true; rows: PendingDepositRow[] }
  | { ok: false; code: string };

const bookingIdSchema = z.object({ bookingId: z.string().min(1).max(64) });

/** Read the full checkout payload for one booking's deposit (both nodes). */
export async function getInsuranceCheckoutAction(input: unknown): Promise<InsuranceCheckoutResult> {
  const user = await getSessionUser();
  if (!user || !canAccessReception(user.role)) {
    return { ok: false, code: 'forbidden' };
  }
  const parsed = bookingIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };
  try {
    const view = await getInsuranceCheckoutForReception(parsed.data.bookingId);
    if (!view) return { ok: false, code: 'insurance_not_found' };
    return { ok: true, view };
  } catch {
    return { ok: false, code: 'unknown' };
  }
}

/** The desk's "forgotten deposits" worklist (both nodes, read-only). */
export async function listPendingDepositsAction(): Promise<PendingDepositsResult> {
  const user = await getSessionUser();
  if (!user || !canAccessReception(user.role)) {
    return { ok: false, code: 'forbidden' };
  }
  try {
    const rows = await listPendingDeposits();
    return { ok: true, rows };
  } catch {
    return { ok: false, code: 'unknown' };
  }
}

// ── Mutations (proxied on the local node) ────────────────────────────────────

type InsuranceSyncOp =
  | { op: 'decide'; payload: { bookingId: string; decision: 'REFUND' | 'NO_REFUND'; reason?: string | null } }
  | { op: 'executeDesk'; payload: { insuranceRefundId: string; method: 'CASH' | 'INSTAPAY'; proofUrl?: string | null } };

/**
 * Forward a mutating insurance op to the online master (LOCAL node only) —
 * mirrors the reception-booking proxy byte-for-byte: 2xx bodies (incl. a
 * DomainError as 200 `{ok:false,code}`) are authoritative; non-2xx statuses map
 * to the same deployment-problem codes; a transport failure means `offline`.
 */
async function proxyInsuranceAction(
  staffId: string,
  body: InsuranceSyncOp,
): Promise<InsuranceCheckoutResult> {
  const base = onlineApiUrl();
  if (!base) return { ok: false, code: 'sync_misconfig' };
  let resp: Response;
  try {
    resp = await fetch(`${base}/api/sync/insurance-action`, {
      signal: AbortSignal.timeout(SYNC_TRANSFER_TIMEOUT_MS), // SYNC-002
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SYNC_SECRET_HEADER]: syncScopeSecret('write') ?? '',
      },
      body: JSON.stringify({ ...body, staffId }),
    });
  } catch {
    // A genuine transport failure — the venue really can't reach online.
    return { ok: false, code: 'offline' };
  }
  const parsed = (await resp.json().catch(() => null)) as InsuranceCheckoutResult | null;
  if (resp.ok && parsed) {
    if (parsed.ok) {
      // Materialize the just-written insurance state on the local mirror NOW so
      // the desk (and the search badges) don't wait for the ~20s worker pull.
      // Best-effort: the returned view is already the online truth.
      await pullAll().catch(() => {});
    }
    return parsed;
  }
  if (resp.status === 404) return { ok: false, code: 'sync_not_deployed' };
  if (resp.status === 401) return { ok: false, code: 'sync_auth' };
  if (resp.status === 409) return { ok: false, code: 'sync_misconfig' };
  return { ok: false, code: 'unknown' };
}

const decideSchema = z.object({
  bookingId: z.string().min(1).max(64),
  decision: z.enum(['REFUND', 'NO_REFUND']),
  /** Mandatory for NO_REFUND — the server re-enforces (insurance_reason_required). */
  reason: z.string().trim().max(500).optional().nullable(),
});

/**
 * Checkout decision: refund the deposit (opens the workflow attempt) or retain
 * it with a mandatory reason. Returns the fresh checkout payload on success.
 */
export async function decideInsuranceAction(input: unknown): Promise<InsuranceCheckoutResult> {
  const user = await getSessionUser();
  if (!user || !canAccessReception(user.role)) {
    return { ok: false, code: 'forbidden' };
  }
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  if (isLocal()) {
    return proxyInsuranceAction(user.id, { op: 'decide', payload: parsed.data });
  }

  try {
    await recordInsuranceDecision({
      bookingId: parsed.data.bookingId,
      staffId: user.id,
      decision: parsed.data.decision,
      reason: parsed.data.reason ?? undefined,
    });
    const view = await getInsuranceCheckoutForReception(parsed.data.bookingId);
    if (!view) return { ok: false, code: 'insurance_not_found' };
    return { ok: true, view };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

const executeDeskSchema = z.object({
  insuranceRefundId: z.string().min(1).max(64),
  method: z.enum(['CASH', 'INSTAPAY']),
  /** InstaPay payout proof from POST /api/reception/upload (server re-validates). */
  proofUrl: z
    .string()
    .trim()
    .max(2000)
    .refine(isStoredMediaUrl, { message: 'invalid_image_url' })
    .optional()
    .nullable(),
});

/**
 * Execute a PENDING_DESK payout: CASH = this call IS the physical-handover
 * confirmation; INSTAPAY additionally requires the uploaded transfer proof.
 * Returns the fresh checkout payload on success.
 */
export async function executeDeskInsuranceRefundAction(
  input: unknown,
): Promise<InsuranceCheckoutResult> {
  const user = await getSessionUser();
  if (!user || !canAccessReception(user.role)) {
    return { ok: false, code: 'forbidden' };
  }
  const parsed = executeDeskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };
  // InstaPay proof is required (the service re-enforces with a typed code).
  if (parsed.data.method === 'INSTAPAY' && !parsed.data.proofUrl) {
    return { ok: false, code: 'insurance_proof_required' };
  }

  if (isLocal()) {
    return proxyInsuranceAction(user.id, { op: 'executeDesk', payload: parsed.data });
  }

  try {
    await executeDeskInsuranceRefund({
      insuranceRefundId: parsed.data.insuranceRefundId,
      staffId: user.id,
      method: parsed.data.method,
      proofUrl: parsed.data.proofUrl ?? undefined,
    });
    // Resolve the attempt back to its booking for the fresh view.
    const row = await prisma.insuranceRefund.findUnique({
      where: { id: parsed.data.insuranceRefundId },
      select: { bookingInsurance: { select: { bookingId: true } } },
    });
    const view = row
      ? await getInsuranceCheckoutForReception(row.bookingInsurance.bookingId)
      : null;
    if (!view) return { ok: false, code: 'insurance_not_found' };
    return { ok: true, view };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/auth/guards';
import {
  approveInsuranceRefund,
  rejectInsuranceRefund,
  retryInsuranceRefund,
  reopenInsuranceDecision,
  executeDeskInsuranceRefund,
} from '@/server/services/insurance-refunds';
import { DomainError } from '@/server/services/errors';
import { log, errFields } from '@/lib/log';

/**
 * Admin actions for the insurance-deposit refund queue
 * (`/admin/insurance-refunds`). Thin wrappers: auth → zod → domain service →
 * typed result. Amounts are NEVER accepted from the client — every payout
 * amount was frozen server-side when the attempt row was created.
 */

const MAX_NOTE = 500;

export type InsuranceAdminResult =
  | { ok: true; status?: 'COMPLETED' | 'FAILED' }
  | { ok: false; code: string };

function revalidateQueue(insuranceRefundId?: string) {
  revalidatePath('/admin/insurance-refunds');
  if (insuranceRefundId) revalidatePath(`/admin/insurance-refunds/${insuranceRefundId}`);
}

const idSchema = z.object({ insuranceRefundId: z.string().min(1) });

/** Approve + execute a PROVIDER (original card) refund through the gateway. */
export async function approveInsuranceRefundAction(
  input: unknown,
): Promise<InsuranceAdminResult> {
  const admin = await requireAdmin();
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };
  try {
    const res = await approveInsuranceRefund({
      insuranceRefundId: parsed.data.insuranceRefundId,
      adminUserId: admin.id,
    });
    revalidateQueue(parsed.data.insuranceRefundId);
    return { ok: true, status: res.status };
  } catch (err) {
    revalidateQueue(parsed.data.insuranceRefundId); // gateway failures still moved state
    if (err instanceof DomainError) return { ok: false, code: err.code };
    log.error('approveInsuranceRefundAction failed', errFields(err));
    return { ok: false, code: 'unknown' };
  }
}

const rejectSchema = idSchema.extend({ note: z.string().trim().min(1).max(MAX_NOTE) });

/** Reject an attempt (mandatory note) — the decision reopens for re-decision. */
export async function rejectInsuranceRefundAction(
  input: unknown,
): Promise<InsuranceAdminResult> {
  const admin = await requireAdmin();
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'insurance_reason_required' };
  try {
    await rejectInsuranceRefund({
      insuranceRefundId: parsed.data.insuranceRefundId,
      adminUserId: admin.id,
      note: parsed.data.note,
    });
    revalidateQueue(parsed.data.insuranceRefundId);
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    log.error('rejectInsuranceRefundAction failed', errFields(err));
    return { ok: false, code: 'unknown' };
  }
}

/** Requeue a FAILED / MANUAL_ATTENTION attempt back to AWAITING_ADMIN. */
export async function retryInsuranceRefundAction(
  input: unknown,
): Promise<InsuranceAdminResult> {
  const admin = await requireAdmin();
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };
  try {
    await retryInsuranceRefund({
      insuranceRefundId: parsed.data.insuranceRefundId,
      adminUserId: admin.id,
    });
    revalidateQueue(parsed.data.insuranceRefundId);
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    log.error('retryInsuranceRefundAction failed', errFields(err));
    return { ok: false, code: 'unknown' };
  }
}

const reopenSchema = z.object({
  bookingId: z.string().min(1),
  reason: z.string().trim().min(1).max(MAX_NOTE),
});

/** Admin correction: NO_REFUND → UNDECIDED (only while no completed/active payout). */
export async function reopenInsuranceDecisionAction(
  input: unknown,
): Promise<InsuranceAdminResult> {
  const admin = await requireAdmin();
  const parsed = reopenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'insurance_reason_required' };
  try {
    await reopenInsuranceDecision({
      bookingId: parsed.data.bookingId,
      adminUserId: admin.id,
      reason: parsed.data.reason,
    });
    revalidateQueue();
    revalidatePath(`/admin/bookings/${parsed.data.bookingId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    log.error('reopenInsuranceDecisionAction failed', errFields(err));
    return { ok: false, code: 'unknown' };
  }
}

const deskCompleteSchema = idSchema.extend({
  // Admin remote completion is INSTAPAY-with-proof ONLY: marking a CASH payout
  // done from the admin panel would fabricate a physical desk handover.
  proofUrl: z.string().min(1),
});

/**
 * Complete a stale PENDING_DESK payout by InstaPay from the admin panel (for
 * guests who can't return to the desk). The proof image is mandatory and must
 * be a `/api/secure-media` URL — `validateProofUrl` re-verifies it server-side.
 */
export async function completeDeskRefundByAdminAction(
  input: unknown,
): Promise<InsuranceAdminResult> {
  const admin = await requireAdmin();
  const parsed = deskCompleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'insurance_proof_required' };
  try {
    await executeDeskInsuranceRefund({
      insuranceRefundId: parsed.data.insuranceRefundId,
      staffId: admin.id,
      method: 'INSTAPAY',
      proofUrl: parsed.data.proofUrl,
    });
    revalidateQueue(parsed.data.insuranceRefundId);
    return { ok: true, status: 'COMPLETED' };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    log.error('completeDeskRefundByAdminAction failed', errFields(err));
    return { ok: false, code: 'unknown' };
  }
}

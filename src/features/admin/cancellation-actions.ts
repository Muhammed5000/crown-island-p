'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/auth/guards';
import {
  processCancellationRequest,
  MAX_REASON,
} from '@/server/services/cancellation-request';
import { DomainError } from '@/server/services/errors';
import { log, errFields } from '@/lib/log';

export type CancellationAdminResult =
  | { ok: true; refundedCents: number }
  | { ok: false; code: string };

const processSchema = z.object({
  requestId: z.string().min(1),
  decision: z.enum(['APPROVE', 'REJECT']),
  adminNote: z.string().trim().max(MAX_REASON).optional(),
});

/** Approve (refund the locked amount + cancel) or reject a cancellation request. */
export async function processCancellationRequestAction(
  input: unknown,
): Promise<CancellationAdminResult> {
  const admin = await requireAdmin();
  const parsed = processSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  try {
    const res = await processCancellationRequest({
      requestId: parsed.data.requestId,
      adminUserId: admin.id,
      decision: parsed.data.decision,
      adminNote: parsed.data.adminNote,
    });
    revalidatePath('/admin/cancellation-requests');
    revalidatePath(`/admin/cancellation-requests/${parsed.data.requestId}`);
    return { ok: true, refundedCents: res.refundedCents };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    log.error('processCancellationRequestAction failed', errFields(err));
    return { ok: false, code: 'unknown' };
  }
}

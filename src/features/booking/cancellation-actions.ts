'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/server/auth/guards';
import {
  requestCancellation,
  withdrawCancellationRequest,
  MAX_REASON,
} from '@/server/services/cancellation-request';
import { DomainError } from '@/server/services/errors';
import { log, errFields } from '@/lib/log';

export type CancellationResult = { ok: true } | { ok: false; code: string };

const requestSchema = z.object({
  bookingId: z.string().min(1),
  reason: z.string().trim().max(MAX_REASON).optional(),
});

/** Customer asks to cancel their own PAID booking (freezes the refund tier now). */
export async function requestCancellationAction(input: unknown): Promise<CancellationResult> {
  const user = await requireUser();
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  try {
    await requestCancellation({
      bookingId: parsed.data.bookingId,
      userId: user.id,
      reason: parsed.data.reason,
    });
    revalidatePath(`/bookings/${parsed.data.bookingId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    log.error('requestCancellationAction failed', errFields(err));
    return { ok: false, code: 'unknown' };
  }
}

const withdrawSchema = z.object({ bookingId: z.string().min(1) });

/** Customer pulls back a still-pending cancellation request. */
export async function withdrawCancellationAction(input: unknown): Promise<CancellationResult> {
  const user = await requireUser();
  const parsed = withdrawSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  try {
    await withdrawCancellationRequest({ bookingId: parsed.data.bookingId, userId: user.id });
    revalidatePath(`/bookings/${parsed.data.bookingId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    log.error('withdrawCancellationAction failed', errFields(err));
    return { ok: false, code: 'unknown' };
  }
}

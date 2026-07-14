'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/server/auth/guards';
import {
  adminCancelBookingPayment,
  adminRefundBooking,
} from '@/server/services/admin-bookings';
import { DomainError } from '@/server/services/errors';
import { isPaymentNotConfigured } from '@/server/payments/provider';

const refundSchema = z.object({
  bookingId: z.string().min(1),
  reason: z.string().max(500).optional(),
  /** Optional staff override of the policy-computed refund amount (in cents). */
  overrideAmountCents: z.number().int().min(0).optional(),
});

export type RefundResult =
  | { ok: true; refundId: string | null; refundedCents: number }
  | { ok: false; code: string };

export async function refundBooking(input: unknown): Promise<RefundResult> {
  const admin = await requireAdmin();
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  try {
    const result = await adminRefundBooking({
      bookingId: parsed.data.bookingId,
      adminUserId: admin.id,
      reason: parsed.data.reason,
      overrideAmountCents: parsed.data.overrideAmountCents,
    });
    // A refund cancels the booking + releases capacity, so every view of it must
    // refresh — not just the admin detail page (which is all this used to do,
    // leaving the bookings list, payments view, and the customer's own booking
    // views showing the stale CONFIRMED status). Mirror cancelBookingPayment and
    // also invalidate the customer-facing booking pages.
    revalidatePath(`/admin/bookings/${parsed.data.bookingId}`);
    revalidatePath('/admin/bookings');
    revalidatePath('/admin/payments');
    revalidatePath('/admin/reports');
    revalidatePath('/bookings/history');
    revalidatePath(`/bookings/${parsed.data.bookingId}`);
    return { ok: true, refundId: result.refundId, refundedCents: result.refundedCents };
  } catch (err) {
    if (isPaymentNotConfigured(err)) return { ok: false, code: 'payment_not_configured' };
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

const cancelPaymentSchema = z.object({
  bookingId: z.string().min(1),
  reason: z.string().max(500).optional(),
});

export type CancelPaymentResult =
  | { ok: true; alreadyCancelled: boolean }
  | { ok: false; code: string };

/**
 * Cancel a PENDING payment + its booking. Used by the admin UI on the
 * booking detail and payments-list pages. Refund is the right tool for
 * SUCCEEDED payments — this is for unpaid ones only.
 */
export async function cancelBookingPayment(input: unknown): Promise<CancelPaymentResult> {
  const admin = await requireAdmin();
  const parsed = cancelPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  try {
    const result = await adminCancelBookingPayment({
      bookingId: parsed.data.bookingId,
      adminUserId: admin.id,
      reason: parsed.data.reason,
    });
    // Both listings depend on the same row — invalidate both so the change
    // shows up whichever page the admin came from.
    revalidatePath(`/admin/bookings/${parsed.data.bookingId}`);
    revalidatePath('/admin/bookings');
    revalidatePath('/admin/payments');
    return { ok: true, alreadyCancelled: result.alreadyCancelled };
  } catch (err) {
    if (isPaymentNotConfigured(err)) return { ok: false, code: 'payment_not_configured' };
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

'use server';

import { z } from 'zod';
import { revalidatePath, revalidateTag } from 'next/cache';
import { requireAdmin } from '@/server/auth/guards';
import {
  moderateReview,
  setPublicReviewsEnabled,
  REVIEWS_TAG,
} from '@/server/services/review';
import { DomainError } from '@/server/services/errors';
import { log, errFields } from '@/lib/log';

export type ReviewAdminResult = { ok: true } | { ok: false; code: string };

const moderateSchema = z.object({
  reviewId: z.string().min(1),
  status: z.enum(['APPROVED', 'REJECTED']),
  adminNote: z.string().trim().max(500).optional(),
});

/** Approve or reject a review (with an optional note the customer is told). */
export async function moderateReviewAction(input: unknown): Promise<ReviewAdminResult> {
  const admin = await requireAdmin();
  const parsed = moderateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  try {
    const r = await moderateReview({
      reviewId: parsed.data.reviewId,
      adminUserId: admin.id,
      status: parsed.data.status,
      adminNote: parsed.data.adminNote,
    });
    revalidateTag(REVIEWS_TAG, 'max'); // refresh the cached public reads (Next 16 needs the 2nd arg)
    revalidatePath('/admin/guest-comments');
    revalidatePath(`/admin/guest-comments/${parsed.data.reviewId}`);
    revalidatePath(`/bookings/${r.bookingId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    log.error('moderateReviewAction failed', errFields(err));
    return { ok: false, code: 'unknown' };
  }
}

const toggleSchema = z.object({ enabled: z.boolean() });

/** Flip the master switch that shows/hides reviews on customer-facing pages. */
export async function setPublicReviewsEnabledAction(input: unknown): Promise<ReviewAdminResult> {
  const admin = await requireAdmin();
  const parsed = toggleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  try {
    await setPublicReviewsEnabled(parsed.data.enabled, admin.id);
    revalidateTag(REVIEWS_TAG, 'max'); // public pages must reflect the new visibility
    revalidatePath('/admin/guest-comments');
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    log.error('setPublicReviewsEnabledAction failed', errFields(err));
    return { ok: false, code: 'unknown' };
  }
}

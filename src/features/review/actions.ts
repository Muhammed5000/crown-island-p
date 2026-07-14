'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/server/auth/guards';
import { createReview } from '@/server/services/review';
import { DomainError } from '@/server/services/errors';
import { log, errFields } from '@/lib/log';

const submitSchema = z.object({
  bookingId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(1).max(500),
});

export type SubmitReviewResult =
  | { ok: true; reviewId: string }
  | { ok: false; code: string };

/**
 * Customer submits a post-visit review for THEIR OWN booking. The service
 * re-checks ownership, reviewability (visit over) and one-per-booking, so this
 * action just authenticates, validates shape, and maps the outcome.
 */
export async function submitReview(input: unknown): Promise<SubmitReviewResult> {
  const user = await requireUser();
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  try {
    const review = await createReview({
      bookingId: parsed.data.bookingId,
      userId: user.id,
      rating: parsed.data.rating,
      comment: parsed.data.comment,
    });
    revalidatePath(`/bookings/${parsed.data.bookingId}`);
    revalidatePath('/bookings');
    return { ok: true, reviewId: review.id };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    log.error('submitReview failed', errFields(err));
    return { ok: false, code: 'unknown' };
  }
}

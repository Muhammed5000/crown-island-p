/**
 * PURE guest-review rules — no `server-only`, no DB, no I/O — so they can be
 * unit-tested directly under `tsx --test`. The DB-aware orchestration (creating
 * rows, moderation, notifications, aggregates) lives in `review.ts`.
 */

export const MIN_RATING = 1;
export const MAX_RATING = 5;
export const MAX_COMMENT = 500;

/** A star rating is an integer 1–5. */
export function isValidRating(rating: unknown): rating is number {
  return typeof rating === 'number' && Number.isInteger(rating) && rating >= MIN_RATING && rating <= MAX_RATING;
}

/** A comment is 1–500 characters after trimming. */
export function isValidComment(comment: unknown): comment is string {
  if (typeof comment !== 'string') return false;
  const t = comment.trim();
  return t.length >= 1 && t.length <= MAX_COMMENT;
}

/** Normalise a comment for storage (trim; callers validate first). */
export function cleanComment(comment: string): string {
  return comment.trim();
}

export interface ReviewableBooking {
  status: string;
  /** The role of `booking.user` — only real CUSTOMER accounts can review. */
  userRole: string;
  /** Whether a review already exists for this booking. */
  hasReview: boolean;
}

/**
 * A booking becomes reviewable the moment it is CONFIRMED — the guest can rate
 * it from confirmation onward (no need to wait for the visit day). Requirements:
 * a real CUSTOMER account owns it (a walk-in reception booking is owned by staff,
 * so it is excluded), it is CONFIRMED or EXPIRED (a past confirmed booking is
 * still reviewable), and no review exists yet.
 */
export function isBookingReviewable(b: ReviewableBooking): boolean {
  if (b.userRole !== 'CUSTOMER') return false;
  if (b.hasReview) return false;
  return b.status === 'CONFIRMED' || b.status === 'EXPIRED';
}

/**
 * Public reviewer display name — first name + last initial for privacy
 * (e.g. "Ahmed Mohamed" → "Ahmed M."). Never exposes the full name or email.
 */
export function publicReviewerName(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Guest';
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.`;
}

/** Mean rating rounded to one decimal; 0 for an empty set. */
export function average(ratings: readonly number[]): number {
  if (ratings.length === 0) return 0;
  const sum = ratings.reduce((a, b) => a + b, 0);
  return Math.round((sum / ratings.length) * 10) / 10;
}

/**
 * Normalise raw {rating,count} rows into a fixed 5→1 distribution (zeros filled)
 * for the dashboard bar chart.
 */
export function buildDistribution(
  rows: ReadonlyArray<{ rating: number; count: number }>,
): Array<{ star: number; count: number }> {
  const byStar = new Map<number, number>();
  for (const r of rows) byStar.set(r.rating, (byStar.get(r.rating) ?? 0) + r.count);
  const out: Array<{ star: number; count: number }> = [];
  for (let star = MAX_RATING; star >= MIN_RATING; star--) {
    out.push({ star, count: byStar.get(star) ?? 0 });
  }
  return out;
}

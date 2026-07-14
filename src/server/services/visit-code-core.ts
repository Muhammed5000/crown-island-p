import crypto from 'node:crypto';

/**
 * Visit-code (daily root code) — PURE helpers shared by the server service and
 * unit tests. No prisma / server-only imports here.
 *
 * A visit code groups every booking one customer identity made for one visit
 * day. The IDENTITY RULE is the heart of the feature:
 *
 *   - Online booking (`createdByStaffId` null): the account holder books for
 *     themselves → `user:<userId>`.
 *   - Reception walk-in (`createdByStaffId` set): `userId` is the STAFF MEMBER
 *     who keyed the booking in, so grouping by it would merge every walk-in a
 *     staffer created that day into one pass. The real guest identity is the
 *     phone reception captures → `phone:<normalized digits>`.
 *   - Walk-in with no usable phone (defensive — reception validates phones):
 *     `booking:<id>` so it forms an isolated group and never merges strangers.
 *
 * Phone normalization strips everything but digits and any leading zeros, so
 * "+20 100 123 4567", "0100 123 4567" and "01001234567" are the same guest.
 */

/** Unambiguous alphabet (no 0/O/1/I) — same family as booking references. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Crypto-random opaque visit code, e.g. "V-3K9TQ2M8WXAB".
 * 12 chars of 32 → 32^12 ≈ 1.15e18 — unguessable; uniqueness is additionally
 * enforced by the DB constraint (callers retry on collision).
 */
export function generateVisitCodeString(): string {
  const bytes = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += ALPHABET[bytes[i]! % ALPHABET.length];
  return `V-${s}`;
}

/** A raw scanned value that LOOKS like a visit code (barcode / manual entry). */
export function looksLikeVisitCode(value: string): boolean {
  return /^V-[A-Z2-9]{12}$/.test(value.trim().toUpperCase());
}

export function normalizePhoneDigits(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '').replace(/^0+/, '');
}

export interface VisitIdentityInput {
  id: string;
  userId: string;
  createdByStaffId: string | null;
  guestPhone: string | null;
}

/** The grouping key — see the identity rule in the module doc. */
export function visitIdentityKey(b: VisitIdentityInput): string {
  if (!b.createdByStaffId) return `user:${b.userId}`;
  const digits = normalizePhoneDigits(b.guestPhone);
  if (digits.length >= 4) return `phone:${digits}`;
  return `booking:${b.id}`;
}

/**
 * The latest calendar day any booking of the group covers — drives the visit
 * token's expiry (multi-day bookings keep the pass alive to their end date).
 */
export function visitLastDay(bookings: { bookingDate: Date; endDate: Date | null }[]): Date {
  let max = 0;
  for (const b of bookings) {
    const end = (b.endDate ?? b.bookingDate).getTime();
    if (end > max) max = end;
  }
  return new Date(max);
}

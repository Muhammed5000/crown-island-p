/**
 * Booking reference generator.
 * Format: CI-YYYYMMDD-XXXXXX where X is uppercase alphanumerics.
 * Uniqueness is also enforced by the DB constraint on `Booking.reference`.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // skip confusing chars

function randomSuffix(len = 6): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return s;
}

export function generateBookingReference(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `CI-${y}${m}${d}-${randomSuffix()}`;
}

/**
 * Housekeeping & maintenance ticket reference, e.g. "OPS-20260610-4XKQ".
 * Same alphabet/date shape as booking references; uniqueness is enforced by
 * the DB constraint on `OpsTicket.reference` (callers retry on collision).
 */
export function generateOpsReference(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `OPS-${y}${m}${d}-${randomSuffix(4)}`;
}

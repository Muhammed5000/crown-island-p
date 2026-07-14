/** Pure recovery rules for cancellation approvals (no Prisma / IO). */

export function isCancellationRefundComplete(input: {
  lockedRefundCents: number;
  matchedRefundCents: number;
  bookingStatus: string;
}): boolean {
  if (input.lockedRefundCents <= 0) return input.bookingStatus === 'CANCELLED';
  return (
    input.matchedRefundCents >= input.lockedRefundCents &&
    input.bookingStatus === 'CANCELLED'
  );
}

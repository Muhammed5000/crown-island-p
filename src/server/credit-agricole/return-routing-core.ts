import type { BookingStatus } from '@prisma/client';

/**
 * Pure post-verify routing decision (no server-only/Prisma deps → unit-testable).
 *
 * After a "verify-on-return" call (`verifyAndConfirmOrder`) re-reads a booking's
 * status, decide where the customer should go. Used by the payment page (which
 * turns this into a redirect) and, conceptually, any return surface:
 *   - CONFIRMED           → 'success' (the capture landed — never re-show the pay
 *                            form, which would let them pay twice)
 *   - FAILED / CANCELLED  → 'failed'  (declined, or captured-then-auto-refunded
 *                            because the booking could never confirm)
 *   - PENDING_PAYMENT/…   → 'stay'    (still resolving — render the pay form /
 *                            keep polling; the reconciler is the backstop)
 */
export type ReturnRoute = 'success' | 'failed' | 'stay';

export function routeAfterVerify(status: BookingStatus): ReturnRoute {
  switch (status) {
    case 'CONFIRMED':
      return 'success';
    case 'FAILED':
    case 'CANCELLED':
      return 'failed';
    default:
      // PENDING_PAYMENT and EXPIRED stay put (EXPIRED can't re-pay; the page
      // handles it), and any future status defaults to the safe "stay".
      return 'stay';
  }
}

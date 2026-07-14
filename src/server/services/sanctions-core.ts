import type { SanctionStatus } from '@prisma/client';

/**
 * Pure sanction rules — no Prisma, no IO — so the invariants that guard real
 * money are unit-testable (`npx tsx --test src/server/services/sanctions-core.test.ts`).
 * The DB-aware orchestration lives in `./sanctions.ts`.
 */

/** Hard ceiling on a single sanction: 1,000,000 EGP in piastres. */
export const SANCTION_MAX_CENTS = 100_000_000;

/**
 * How long a PENDING_PAYMENT booking may keep sanctions reserved. There is no
 * cleanup job for abandoned pending bookings, so without this window an
 * abandoned checkout would lock a sanction forever. 60 minutes comfortably
 * outlives a Paymob checkout session (~15-minute holds, ~1h payment links):
 * by the time a lock is stolen, the old payment link is dead.
 */
export const SANCTION_LOCK_STALE_MINUTES = 60;

/**
 * Allowed status transitions. ACTIVE is the only non-terminal state — settled
 * sanctions are history, corrections issue a NEW sanction. The single
 * exception, PAID → ACTIVE, exists ONLY for the refund path: when a booking's
 * payment is refunded in full, the sanctions it had settled come back to life.
 */
const TRANSITIONS: Record<SanctionStatus, readonly SanctionStatus[]> = {
  ACTIVE: ['PAID', 'WAIVED', 'CANCELLED'],
  PAID: ['ACTIVE'], // refund reactivation only — never via the admin status action
  WAIVED: [],
  CANCELLED: [],
};

export function canTransitionSanction(from: SanctionStatus, to: SanctionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Statuses an ADMIN may move an ACTIVE sanction to from the panel. */
export const ADMIN_SETTLE_STATUSES = ['PAID', 'WAIVED', 'CANCELLED'] as const satisfies
  readonly SanctionStatus[];

export interface PendingLockBooking {
  status: string;
  createdAt: Date;
}

/**
 * Is a sanction's pending-booking reservation still LIVE (i.e. the sanction is
 * spoken for and must not be claimed elsewhere or settled by hand)?
 *
 * A lock is live only while the reserving booking is still PENDING_PAYMENT and
 * young enough that its payment link could still be completed. A dead booking
 * (FAILED / CANCELLED / anything else) or a stale pending one releases the
 * sanction for the next claim.
 */
export function isPendingLockLive(
  pendingBooking: PendingLockBooking | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!pendingBooking) return false;
  if (pendingBooking.status !== 'PENDING_PAYMENT') return false;
  const ageMs = now.getTime() - pendingBooking.createdAt.getTime();
  return ageMs < SANCTION_LOCK_STALE_MINUTES * 60 * 1000;
}

export function sumSanctionCents(rows: ReadonlyArray<{ amountCents: number }>): number {
  return rows.reduce((sum, r) => sum + r.amountCents, 0);
}

/** Amount sanity shared by the create/update validators. */
export function isValidSanctionAmount(amountCents: number): boolean {
  return (
    Number.isInteger(amountCents) && amountCents > 0 && amountCents <= SANCTION_MAX_CENTS
  );
}

import { DomainError } from './errors';

/**
 * Pure promo-code logic — no `server-only`, no Prisma — so it's unit-testable
 * directly (mirrors the `booking-calc-core` ↔ `booking-calc` split). The
 * DB-bound redemption path lives in `./promo.ts`.
 */

/** Trim + upper-case so codes match case-insensitively (they're stored upper). */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * The per-customer uniqueness key for a promo redemption. Prefers the guest's
 * government-ID number (normalised: upper-cased, separators stripped) so the SAME
 * PERSON cannot reuse a once-per-customer code with a different phone number —
 * the exact loophole the phone-only key had. Falls back to the phone when no ID
 * number is available (e.g. a guest whose ID wasn't captured). Pure.
 */
export function promoRedemptionKey(
  guestIdNumber: string | null | undefined,
  phone: string,
): string {
  const id = (guestIdNumber ?? '').trim().toUpperCase().replace(/[\s\-()]/g, '');
  return id || phone;
}

/** Whole-percent discount on the subtotal, never exceeding it. Pure. */
export function computeDiscountCents(subtotalCents: number, percentOff: number): number {
  const pct = Math.max(0, Math.min(100, Math.trunc(percentOff)));
  const raw = Math.round((subtotalCents * pct) / 100);
  return Math.max(0, Math.min(subtotalCents, raw));
}

export interface UsablePromo {
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  redemptionCount: number;
}

/**
 * Throw a typed {@link DomainError} if the code can't be used at `now`. Pure
 * (no DB); the race-safe cap check still happens in the redeem path. `now` is
 * injected for testability.
 */
export function assertPromoUsable(promo: UsablePromo, now: Date): void {
  if (!promo.isActive) {
    throw new DomainError('This code is no longer active', 'promo_inactive', 409);
  }
  if (promo.startsAt && now.getTime() < promo.startsAt.getTime()) {
    throw new DomainError('This code is not active yet', 'promo_not_started', 409);
  }
  if (promo.endsAt && now.getTime() > promo.endsAt.getTime()) {
    throw new DomainError('This code has expired', 'promo_expired', 409);
  }
  if (promo.maxRedemptions != null && promo.redemptionCount >= promo.maxRedemptions) {
    throw new DomainError('This code has reached its usage limit', 'promo_cap_reached', 409);
  }
}

import 'server-only';
import type { Prisma } from '@prisma/client';
import { DomainError } from './errors';
import { assertPromoUsable, computeDiscountCents, normalizeCode, promoRedemptionKey } from './promo-core';

export { assertPromoUsable, computeDiscountCents, normalizeCode, promoRedemptionKey } from './promo-core';
export type { UsablePromo } from './promo-core';

/**
 * Promo-code redemption (reception/walk-in bookings only). Pure validation +
 * discount math live in `./promo-core`; this module adds the DB-bound path.
 *
 * The hot path is {@link redeemPromoForReception}, called INSIDE the reception
 * booking transaction so the discount, the redemption row and the booking
 * commit (or roll back) together.
 *
 * Concurrency model:
 *  - global cap: a conditional `updateMany(... redemptionCount < max ...)`
 *    increments atomically; 0 rows affected ⇒ the cap is full.
 *  - per-customer: when the code is `oncePerCustomer`, the redemption row's
 *    `uniqueCustomerPhone` is set to the phone, so the DB unique
 *    `[promoCodeId, uniqueCustomerPhone]` is the real one-per-customer guard (a
 *    pre-check just yields a friendlier error on the common path). When the code
 *    allows unlimited reuse, `uniqueCustomerPhone` is left NULL — Postgres treats
 *    NULLs as distinct, so repeat redemptions by the same phone never collide.
 */

export interface RedeemPromoInput {
  code: string;
  customerPhone: string;
  /**
   * The booking's primary guest government-ID number, when captured. The
   * once-per-customer guard keys on this (normalised) so the same PERSON can't
   * reuse a code with a different phone; falls back to the phone when absent.
   */
  guestIdNumber?: string | null;
  bookingId: string;
  subtotalCents: number;
  now?: Date;
}

export interface RedeemPromoResult {
  promoCodeId: string;
  code: string;
  percentOff: number;
  discountCents: number;
}

/**
 * Validate + redeem a code within an active booking transaction. Returns the
 * discount to apply, or throws a {@link DomainError} the caller surfaces. Any
 * throw rolls back the enclosing booking transaction (so a rejected code never
 * leaves a half-applied discount).
 */
export async function redeemPromoForReception(
  tx: Prisma.TransactionClient,
  input: RedeemPromoInput,
): Promise<RedeemPromoResult> {
  const now = input.now ?? new Date();
  const code = normalizeCode(input.code);
  if (!code) throw new DomainError('Enter a promo code', 'promo_invalid', 400);

  const promo = await tx.promoCode.findUnique({ where: { code } });
  if (!promo) throw new DomainError('Promo code not found', 'promo_not_found', 404);

  assertPromoUsable(promo, now);

  // Uniqueness key: the guest's ID number when captured (so the same person can't
  // reuse the code with a new phone), else the phone. This is what the unique
  // [promoCodeId, uniqueCustomerPhone] column stores for a once-per-customer code.
  const key = promoRedemptionKey(input.guestIdNumber, input.customerPhone);

  // One-per-customer pre-check (friendly error on the common path; the unique
  // constraint below is the actual race-safe guard). Skipped when the code allows
  // the same customer to redeem repeatedly.
  if (promo.oncePerCustomer) {
    const prior = await tx.promoRedemption.findFirst({
      where: { promoCodeId: promo.id, uniqueCustomerPhone: key },
    });
    if (prior) {
      throw new DomainError('This customer has already used this code', 'promo_already_used', 409);
    }
  }

  // Race-safe global cap: conditional increment. 0 rows ⇒ cap filled between
  // the check above and here.
  if (promo.maxRedemptions != null) {
    const bumped = await tx.promoCode.updateMany({
      where: { id: promo.id, redemptionCount: { lt: promo.maxRedemptions } },
      data: { redemptionCount: { increment: 1 } },
    });
    if (bumped.count === 0) {
      throw new DomainError('This code has reached its usage limit', 'promo_cap_reached', 409);
    }
  } else {
    await tx.promoCode.update({
      where: { id: promo.id },
      data: { redemptionCount: { increment: 1 } },
    });
  }

  const discountCents = computeDiscountCents(input.subtotalCents, promo.percentOff);

  // For a once-per-customer code, `uniqueCustomerPhone` holds the uniqueness KEY
  // (the guest's ID number, else phone) so the unique [promoCodeId,
  // uniqueCustomerPhone] is the atomic one-per-customer guard (a concurrent
  // duplicate throws P2002 → rolls back the whole booking). For an unlimited code
  // it is left NULL so repeat redemptions never collide.
  await tx.promoRedemption.create({
    data: {
      promoCodeId: promo.id,
      bookingId: input.bookingId,
      customerPhone: input.customerPhone,
      uniqueCustomerPhone: promo.oncePerCustomer ? key : null,
      discountCents,
    },
  });

  return { promoCodeId: promo.id, code: promo.code, percentOff: promo.percentOff, discountCents };
}

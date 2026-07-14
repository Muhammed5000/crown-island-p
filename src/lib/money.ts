/**
 * Money helpers.
 *
 * All monetary values in the codebase are stored as **integer minor units**
 * (piastres for EGP). Conversion to display strings happens only at the edges.
 */

const FRACTION_DIGITS = 2;

export function centsToMajor(cents: number): number {
  return cents / 100;
}

export function majorToCents(major: number): number {
  return Math.round(major * 100);
}

/**
 * Net revenue recognised for a paid invoice: its total minus everything that
 * has been refunded against it (the `RefundLine` rows). Revenue totals on the
 * admin dashboard must use this so refunded money stops counting. Clamped at 0
 * in case refunds ever exceed the original total.
 */
export function netRevenueCents(
  totalCents: number,
  refunds: ReadonlyArray<{ amountCents: number }>,
): number {
  const refundedCents = refunds.reduce((sum, r) => sum + r.amountCents, 0);
  return Math.max(0, totalCents - refundedCents);
}

/**
 * Format a piastres amount in the user's locale. Locale 'ar' uses Arabic-Indic digits.
 */
export function formatMoney(
  cents: number,
  opts: { locale?: 'ar' | 'en'; currency?: string } = {},
): string {
  const { locale = 'ar', currency = 'EGP' } = opts;
  const formatter = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: FRACTION_DIGITS,
  });
  return formatter.format(centsToMajor(cents));
}

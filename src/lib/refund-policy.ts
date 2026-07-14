/**
 * Tiered, time-based refund policy — PURE calculation.
 *
 * The resort refunds a percentage of what the guest paid based on how far ahead
 * of the visit they cancel. This module is intentionally dependency-free (no
 * `server-only`, no Prisma, no i18n) so it can be unit-tested and shared by both
 * server services (enforcement) and UI (display of the exact enforced numbers).
 *
 * TIME CONVENTION — matches the existing cancellation-cutoff math in
 * `cancelBooking` (bookings-read.ts): "hours before the visit" is measured from
 * `now` to `booking.bookingDate.getTime()`. `bookingDate` is the UTC-midnight
 * key of the resort-local civil first day (`Date.UTC(localY, localM, localD)`),
 * so this is a single, consistent time model across the codebase. A multi-day
 * booking is measured from its FIRST day (`bookingDate`), never `endDate`.
 *
 * SAFETY — `parseRefundTiers` never throws and never silently yields an all-100%
 * schedule: any malformed/missing config falls back to `DEFAULT_REFUND_TIERS`
 * (the canonical policy below). Below every configured threshold the refund is
 * 0% (covers < 24h, no-shows, and already-past bookings).
 *
 * Run tests:  npx tsx --test src/lib/refund-policy.test.ts
 */

/**
 * One band of the refund schedule.
 *
 * Declared as a `type` (not `interface`) on purpose: interfaces lack an implicit
 * index signature and are therefore NOT assignable to Prisma's `InputJsonValue`,
 * so storing them in the `Settings.refundTiers` JSON column would need a cast.
 */
export type RefundTier = {
  /**
   * Minimum whole hours remaining before the booking's first day for this tier
   * to apply. `168` = 7 days, `72` = 3 days, `24` = 1 day, `0` = the catch-all.
   */
  minHoursBeforeStart: number;
  /** Percentage (0–100) of the paid total refunded when this tier applies. */
  refundPercent: number;
};

/**
 * Canonical, resort-confirmed policy. Doubles as the safe fallback whenever the
 * admin-stored config is missing or invalid.
 *
 *   ≥ 168h (7 days)   → 100%
 *   72h – <168h       →  75%
 *   24h – <72h        →  50%
 *   < 24h / no-show   →   0%
 */
export const DEFAULT_REFUND_TIERS: readonly RefundTier[] = [
  { minHoursBeforeStart: 168, refundPercent: 100 },
  { minHoursBeforeStart: 72, refundPercent: 75 },
  { minHoursBeforeStart: 24, refundPercent: 50 },
  { minHoursBeforeStart: 0, refundPercent: 0 },
];

const HOUR_MS = 3_600_000;

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isValidTier(v: unknown): v is RefundTier {
  if (!isPlainRecord(v)) return false;
  const h = v.minHoursBeforeStart;
  const p = v.refundPercent;
  return (
    typeof h === 'number' &&
    Number.isInteger(h) &&
    h >= 0 &&
    Number.isFinite(h) &&
    typeof p === 'number' &&
    Number.isInteger(p) &&
    p >= 0 &&
    p <= 100
  );
}

/**
 * Coerce arbitrary stored JSON into a safe, sorted (descending) tier list.
 *
 * Rejects the WHOLE config to the default if any entry is malformed — a partial
 * accept could enforce a schedule the admin never intended. Guarantees a
 * `0`-hour catch-all exists so the schedule is self-describing for display
 * (below the lowest positive threshold the refund is 0% either way).
 */
export function parseRefundTiers(raw: unknown): RefundTier[] {
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isValidTier)) {
    return sortTiersDesc(DEFAULT_REFUND_TIERS);
  }
  const tiers = sortTiersDesc(raw as RefundTier[]);
  if (!tiers.some((t) => t.minHoursBeforeStart === 0)) {
    tiers.push({ minHoursBeforeStart: 0, refundPercent: 0 });
  }
  return tiers;
}

function sortTiersDesc(tiers: readonly RefundTier[]): RefundTier[] {
  return [...tiers]
    .map((t) => ({ minHoursBeforeStart: t.minHoursBeforeStart, refundPercent: t.refundPercent }))
    .sort((a, b) => b.minHoursBeforeStart - a.minHoursBeforeStart);
}

/**
 * Whole/fractional hours from `now` until the booking's first day begins.
 * Negative once the visit day has started or passed (→ 0% / no-show).
 */
export function hoursUntilBookingStart(bookingDate: Date, now: Date = new Date()): number {
  return (bookingDate.getTime() - now.getTime()) / HOUR_MS;
}

/**
 * Refund percentage for a given lead time. Order-independent and robust to a
 * mis-ordered/non-monotonic config: returns the MAX percent among every tier
 * whose threshold is satisfied (0 when none is).
 *
 * Safety guarantee: tier thresholds are always `>= 0`, so a NEGATIVE lead time
 * (the visit day has started or passed — i.e. a no-show) matches nothing and
 * resolves to 0%. The resort can never accidentally refund a no-show.
 */
export function refundPercentForHours(hoursUntilStart: number, tiers: readonly RefundTier[]): number {
  let percent = 0;
  for (const tier of tiers) {
    if (hoursUntilStart >= tier.minHoursBeforeStart) {
      percent = Math.max(percent, tier.refundPercent);
    }
  }
  return percent;
}

export interface TieredRefund {
  /** The applied tier percentage (0–100). */
  percent: number;
  /** Amount to refund, in cents; clamped to `[0, totalCents]`. */
  refundCents: number;
  /** Amount withheld (kept by the resort), in cents. */
  penaltyCents: number;
  /** Lead time used for the decision (hours; negative when past). */
  hoursUntilStart: number;
}

/**
 * Resolve the full refund breakdown for a booking against a tier schedule.
 * `totalCents` is the amount the guest actually paid (usually
 * `invoice.totalCents`, net of any prior refunds the caller has already
 * subtracted).
 */
export function computeTieredRefund(input: {
  bookingDate: Date;
  totalCents: number;
  tiers: readonly RefundTier[];
  now?: Date;
}): TieredRefund {
  const hoursUntilStart = hoursUntilBookingStart(input.bookingDate, input.now);
  const percent = refundPercentForHours(hoursUntilStart, input.tiers);
  const total = Math.max(0, Math.round(input.totalCents));
  const refundCents = Math.min(total, Math.max(0, Math.round((total * percent) / 100)));
  return {
    percent,
    refundCents,
    penaltyCents: total - refundCents,
    hoursUntilStart,
  };
}

/**
 * The base the refund TIER applies to: the SERVICE charge only, i.e. the invoice
 * total minus any settled sanction (fine) amount. A cancellation retains paid
 * fines in full — the tier percentage must never hand a slice of a penalty back.
 * Pure; both admin and self-cancellation refund paths feed their tier through it.
 */
export function refundableBaseCents(invoiceTotalCents: number, sanctionCents: number): number {
  return Math.max(0, Math.round(invoiceTotalCents) - Math.max(0, Math.round(sanctionCents)));
}

/** Render a lead-time threshold as a friendly "7 days" / "48 hours" label. */
function describeHours(hours: number, locale: 'ar' | 'en'): string {
  if (hours > 0 && hours % 24 === 0) {
    const days = hours / 24;
    return locale === 'ar' ? `${days} يوم` : `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  return locale === 'ar' ? `${hours} ساعة` : `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

/**
 * Human-readable schedule, generated FROM the enforced tiers so the numbers a
 * customer sees can never drift from what the system charges. One line per band,
 * highest lead time first.
 */
export function formatRefundTiers(tiers: readonly RefundTier[], locale: 'ar' | 'en' = 'en'): string[] {
  const sorted = sortTiersDesc(parseRefundTiers(tiers as unknown));
  return sorted.map((tier, i) => {
    const lower = tier.minHoursBeforeStart;
    const upperExclusive = i === 0 ? null : sorted[i - 1]!.minHoursBeforeStart;
    const pct = tier.refundPercent;
    if (locale === 'ar') {
      const refund = pct === 0 ? 'لا يوجد استرداد' : `استرداد ${pct}%`;
      if (upperExclusive === null) return `قبل الحجز بـ ${describeHours(lower, 'ar')} أو أكثر: ${refund}`;
      if (lower === 0) return `قبل الحجز بأقل من ${describeHours(upperExclusive, 'ar')} أو عدم الحضور: ${refund}`;
      return `قبل الحجز من ${describeHours(lower, 'ar')} إلى ${describeHours(upperExclusive, 'ar')}: ${refund}`;
    }
    const refund = pct === 0 ? 'no refund' : `${pct}% refund`;
    if (upperExclusive === null) return `${describeHours(lower, 'en')} or more before your visit: ${refund}`;
    if (lower === 0) return `Less than ${describeHours(upperExclusive, 'en')} before your visit, or no-show: ${refund}`;
    return `${describeHours(lower, 'en')} to ${describeHours(upperExclusive, 'en')} before your visit: ${refund}`;
  });
}

/**
 * Pure report math — no DB access, no `server-only` — so the trickiest report
 * logic (per-place revenue attribution, downtime clipping) stays unit-testable
 * and reusable by any report surface.
 */

import { splitInvoiceMoney } from './insurance-core';

/** The 1:1 `booking.insurance` fields report queries load (null = uninsured booking). */
export interface InvoiceInsuranceLite {
  amountCents: number;
  collectionStatus: 'PENDING' | 'COLLECTED' | 'VOIDED';
}

/**
 * Split one PAID invoice into the service pool and the deposit pool for
 * reporting. `Invoice.totalCents` INCLUDES the insurance deposit for insured
 * bookings, but the deposit is a LIABILITY while held — never service revenue —
 * so it is subtracted (only when actually COLLECTED) before netting SERVICE
 * refunds. Adapter over the canonical `splitInvoiceMoney` for the nullable
 * `booking.insurance` row reports load. Historical invoices (no insurance row,
 * all refunds kind SERVICE) yield exactly the legacy
 * `netRevenueCents(totalCents, refunds)` value.
 */
export function splitPaidInvoice(
  totalCents: number,
  refunds: readonly { amountCents: number; kind: 'SERVICE' | 'INSURANCE' }[],
  insurance: InvoiceInsuranceLite | null | undefined,
): { serviceGrossCents: number; serviceNetCents: number; insuranceRefundedCents: number } {
  return splitInvoiceMoney({
    totalCents,
    insuranceAmountCents:
      insurance?.collectionStatus === 'COLLECTED' ? insurance.amountCents : 0,
    refunds,
  });
}

export interface ReportRange {
  /** Inclusive start (UTC day boundary). */
  from: Date;
  /** Exclusive end (UTC day boundary). */
  toExclusive: Date;
}

/** Inclusive day count of a booking. `endDate` null or equal to start = 1 day. */
export function durationDays(bookingDate: Date, endDate: Date | null | undefined): number {
  if (!endDate) return 1;
  const diff = Math.round((endDate.getTime() - bookingDate.getTime()) / 86_400_000);
  return Math.max(1, diff + 1);
}

/**
 * Milliseconds of the span `[startsAt, endsAt)` that fall inside the range.
 * `endsAt` null means the span is still open — it is clipped at `now`.
 * Returns 0 for spans entirely outside the range (never negative).
 */
export function clipSpanMs(
  startsAt: Date,
  endsAt: Date | null,
  range: ReportRange,
  now: Date = new Date(),
): number {
  const end = endsAt ?? now;
  const lo = Math.max(startsAt.getTime(), range.from.getTime());
  const hi = Math.min(end.getTime(), range.toExclusive.getTime());
  return Math.max(0, hi - lo);
}

/**
 * Total milliseconds covered by a SET of spans inside the range, with
 * overlapping spans MERGED so concurrent outage windows never double-count
 * downtime. Open spans (`endsAt` null) are clipped at `now`.
 */
export function mergedSpansMs(
  spans: { startsAt: Date; endsAt: Date | null }[],
  range: ReportRange,
  now: Date = new Date(),
): number {
  const clipped = spans
    .map((s) => ({
      lo: Math.max(s.startsAt.getTime(), range.from.getTime()),
      hi: Math.min((s.endsAt ?? now).getTime(), range.toExclusive.getTime()),
    }))
    .filter((s) => s.hi > s.lo)
    .sort((a, b) => a.lo - b.lo);
  let total = 0;
  let curLo = -1;
  let curHi = -1;
  for (const s of clipped) {
    if (s.lo > curHi) {
      if (curHi > curLo) total += curHi - curLo;
      curLo = s.lo;
      curHi = s.hi;
    } else if (s.hi > curHi) {
      curHi = s.hi;
    }
  }
  if (curHi > curLo) total += curHi - curLo;
  return total;
}

/** Bucket key used for booking unit-days that have no place assigned yet. */
export const UNASSIGNED = 'unassigned';

/**
 * Proportionally attribute ONE booking's net invoice total across the places
 * its unit-days occupy, restricted to unit-days inside the report range.
 *
 *   share(place) = netCents × inRangeUnitDays(place) ÷ totalUnitDays(booking)
 *
 * This is a NEW reporting convention (nothing in the app prices per unit):
 * invoices are 1:1 with bookings, so a 2-cabana × 3-day booking spreads its
 * total evenly across the 6 unit-days. Unit-days with no place land in the
 * `UNASSIGNED` bucket so per-place sums never silently undercount. A booking
 * straddling the range edge contributes only its in-range share by design.
 *
 * Integer-cent rounding: each bucket is floored, then the remainder (vs the
 * rounded in-range total) goes to the buckets with the largest fractional
 * parts, so the attributed sum is exact and stable.
 */
export function allocateInvoiceToPlaces(
  units: { placeId: string | null; date: Date }[],
  netCents: number,
  range: ReportRange,
): Map<string, number> {
  const out = new Map<string, number>();
  const total = units.length;
  if (total === 0 || netCents <= 0) return out;

  const counts = new Map<string, number>();
  let inRangeCount = 0;
  for (const u of units) {
    const t = u.date.getTime();
    if (t < range.from.getTime() || t >= range.toExclusive.getTime()) continue;
    inRangeCount += 1;
    const key = u.placeId ?? UNASSIGNED;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (inRangeCount === 0) return out;

  const targetTotal = Math.round((netCents * inRangeCount) / total);
  let floorSum = 0;
  const fractions: { key: string; frac: number }[] = [];
  for (const [key, count] of counts) {
    const exact = (netCents * count) / total;
    const floored = Math.floor(exact);
    out.set(key, floored);
    floorSum += floored;
    fractions.push({ key, frac: exact - floored });
  }
  // Distribute the leftover piastres to the largest fractional buckets
  // (deterministic tie-break by key) so Σ shares === targetTotal exactly.
  fractions.sort((a, b) => b.frac - a.frac || (a.key < b.key ? -1 : 1));
  let remainder = targetTotal - floorSum;
  for (let i = 0; remainder > 0 && fractions.length > 0; i = (i + 1) % fractions.length) {
    const entry = fractions[i]!;
    out.set(entry.key, (out.get(entry.key) ?? 0) + 1);
    remainder -= 1;
  }
  return out;
}

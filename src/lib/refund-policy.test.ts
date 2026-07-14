/**
 * Unit tests for the tiered refund policy (refund-policy.ts).
 *
 * These guard the money math: a wrong boundary or rounding error over/under-pays
 * a real refund, and a malformed admin config must never silently refund 100%.
 *
 * Run:  npx tsx --test src/lib/refund-policy.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REFUND_TIERS,
  parseRefundTiers,
  hoursUntilBookingStart,
  refundPercentForHours,
  computeTieredRefund,
  refundableBaseCents,
  formatRefundTiers,
  type RefundTier,
} from './refund-policy';

// ── Tier boundaries (default schedule: 168→100, 72→75, 24→50, <24→0) ──────────
test('refundPercentForHours honours every boundary (inclusive lower edge)', () => {
  const pct = (h: number) => refundPercentForHours(h, DEFAULT_REFUND_TIERS);
  assert.equal(pct(200), 100);
  assert.equal(pct(168), 100); // exactly 7 days → still full
  assert.equal(pct(167), 75);
  assert.equal(pct(72), 75); // exactly 3 days → 75
  assert.equal(pct(71), 50);
  assert.equal(pct(24), 50); // exactly 24h → 50
  assert.equal(pct(23), 0);
  assert.equal(pct(0), 0);
  assert.equal(pct(-1), 0); // visit day started / past
  assert.equal(pct(-500), 0); // long-past no-show
});

test('refundPercentForHours is order-independent (max of matching tiers)', () => {
  const shuffled: RefundTier[] = [
    { minHoursBeforeStart: 24, refundPercent: 50 },
    { minHoursBeforeStart: 168, refundPercent: 100 },
    { minHoursBeforeStart: 72, refundPercent: 75 },
  ];
  assert.equal(refundPercentForHours(100, shuffled), 75);
  assert.equal(refundPercentForHours(500, shuffled), 100);
  assert.equal(refundPercentForHours(30, shuffled), 50);
  assert.equal(refundPercentForHours(1, shuffled), 0);
});

// ── refundableBaseCents (sanctions retained on cancellation) ──────────────────
test('refundableBaseCents excludes settled fines from the tier base', () => {
  assert.equal(refundableBaseCents(10_000, 2_000), 8_000); // service = total − fine
  assert.equal(refundableBaseCents(10_000, 0), 10_000); // no fine → whole total
  assert.equal(refundableBaseCents(3_000, 5_000), 0); // fine ≥ total → never negative
  assert.equal(refundableBaseCents(10_000, -50), 10_000); // negative fine treated as 0
  // A 75% tier now refunds 75% of the 8000 service (6000), not 75% of 10000 (7500).
  const base = refundableBaseCents(10_000, 2_000);
  assert.equal(Math.round((base * 75) / 100), 6_000);
});

// ── hoursUntilBookingStart ────────────────────────────────────────────────────
test('hoursUntilBookingStart measures now → bookingDate, negative when past', () => {
  const now = new Date('2026-07-01T00:00:00Z');
  const in48h = new Date('2026-07-03T00:00:00Z');
  const yesterday = new Date('2026-06-30T00:00:00Z');
  assert.equal(hoursUntilBookingStart(in48h, now), 48);
  assert.equal(hoursUntilBookingStart(yesterday, now), -24);
});

// ── computeTieredRefund: percent → cents, clamped, penalty = remainder ─────────
test('computeTieredRefund maps lead time to the right cents', () => {
  const now = new Date('2026-07-01T00:00:00Z');
  const at = (hoursFromNow: number) => new Date(now.getTime() + hoursFromNow * 3_600_000);
  const run = (h: number, totalCents = 100_000) =>
    computeTieredRefund({ bookingDate: at(h), totalCents, tiers: DEFAULT_REFUND_TIERS, now });

  assert.deepEqual(
    { p: run(200).percent, r: run(200).refundCents, k: run(200).penaltyCents },
    { p: 100, r: 100_000, k: 0 },
  );
  assert.deepEqual(
    { p: run(100).percent, r: run(100).refundCents, k: run(100).penaltyCents },
    { p: 75, r: 75_000, k: 25_000 },
  );
  assert.deepEqual(
    { p: run(30).percent, r: run(30).refundCents, k: run(30).penaltyCents },
    { p: 50, r: 50_000, k: 50_000 },
  );
  assert.deepEqual(
    { p: run(1).percent, r: run(1).refundCents, k: run(1).penaltyCents },
    { p: 0, r: 0, k: 100_000 },
  );
});

test('computeTieredRefund rounds and always sums refund + penalty to total', () => {
  const now = new Date('2026-07-01T00:00:00Z');
  const at = (h: number) => new Date(now.getTime() + h * 3_600_000);
  for (const totalCents of [101, 999, 12_345, 1]) {
    for (const h of [200, 100, 30, 1, -10]) {
      const res = computeTieredRefund({ bookingDate: at(h), totalCents, tiers: DEFAULT_REFUND_TIERS, now });
      assert.equal(res.refundCents + res.penaltyCents, totalCents, `total ${totalCents} @ ${h}h`);
      assert.ok(res.refundCents >= 0 && res.refundCents <= totalCents);
    }
  }
});

test('computeTieredRefund clamps a non-positive total to zero', () => {
  const now = new Date('2026-07-01T00:00:00Z');
  const far = new Date('2026-08-01T00:00:00Z');
  const res = computeTieredRefund({ bookingDate: far, totalCents: -500, tiers: DEFAULT_REFUND_TIERS, now });
  assert.equal(res.refundCents, 0);
  assert.equal(res.penaltyCents, 0);
});

// ── parseRefundTiers: robust fallback, never silently 100% ────────────────────
test('parseRefundTiers falls back to the canonical default on bad input', () => {
  const asPairs = (t: RefundTier[]) => t.map((x) => [x.minHoursBeforeStart, x.refundPercent]);
  const expected = asPairs(parseRefundTiers(DEFAULT_REFUND_TIERS as unknown));
  assert.deepEqual(asPairs(parseRefundTiers(null)), expected);
  assert.deepEqual(asPairs(parseRefundTiers(undefined)), expected);
  assert.deepEqual(asPairs(parseRefundTiers('nonsense')), expected);
  assert.deepEqual(asPairs(parseRefundTiers([])), expected);
  assert.deepEqual(asPairs(parseRefundTiers([{ minHoursBeforeStart: 5 }])), expected); // missing percent
  assert.deepEqual(asPairs(parseRefundTiers([{ minHoursBeforeStart: -1, refundPercent: 50 }])), expected);
  assert.deepEqual(asPairs(parseRefundTiers([{ minHoursBeforeStart: 10, refundPercent: 150 }])), expected);
  assert.deepEqual(asPairs(parseRefundTiers([{ minHoursBeforeStart: 1.5, refundPercent: 50 }])), expected);
});

test('parseRefundTiers accepts a valid config, sorts desc, and ensures a 0h catch-all', () => {
  const parsed = parseRefundTiers([
    { minHoursBeforeStart: 24, refundPercent: 40 },
    { minHoursBeforeStart: 240, refundPercent: 100 },
  ]);
  assert.deepEqual(
    parsed.map((t) => [t.minHoursBeforeStart, t.refundPercent]),
    [[240, 100], [24, 40], [0, 0]],
  );
});

test('parseRefundTiers does not override an admin-provided 0h tier', () => {
  const parsed = parseRefundTiers([
    { minHoursBeforeStart: 0, refundPercent: 20 },
    { minHoursBeforeStart: 48, refundPercent: 80 },
  ]);
  assert.deepEqual(
    parsed.map((t) => [t.minHoursBeforeStart, t.refundPercent]),
    [[48, 80], [0, 20]],
  );
  // The 0h tier covers the same-day-before-start window [0, 48)…
  assert.equal(refundPercentForHours(10, parsed), 20);
  assert.equal(refundPercentForHours(60, parsed), 80);
});

test('a no-show (negative lead time) always resolves to 0%, whatever the config', () => {
  // Safety guarantee: thresholds are >= 0, so once the visit has started/passed
  // nothing matches — the resort can never accidentally refund a no-show.
  const generous = parseRefundTiers([{ minHoursBeforeStart: 0, refundPercent: 90 }]);
  assert.equal(refundPercentForHours(-0.5, generous), 0);
  assert.equal(refundPercentForHours(-1000, DEFAULT_REFUND_TIERS), 0);
});

// ── formatRefundTiers: display generated from the enforced numbers ────────────
test('formatRefundTiers renders one readable line per band (en)', () => {
  const lines = formatRefundTiers(DEFAULT_REFUND_TIERS, 'en');
  assert.deepEqual(lines, [
    '7 days or more before your visit: 100% refund',
    '3 days to 7 days before your visit: 75% refund',
    '1 day to 3 days before your visit: 50% refund',
    'Less than 1 day before your visit, or no-show: no refund',
  ]);
});

test('formatRefundTiers repairs a malformed config before rendering (ar)', () => {
  const lines = formatRefundTiers('broken' as unknown as RefundTier[], 'ar');
  assert.equal(lines.length, 4);
  assert.ok(lines[0]!.includes('100%'));
  assert.ok(lines[3]!.includes('لا يوجد استرداد'));
});

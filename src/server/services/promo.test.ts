/**
 * Unit tests for the pure promo-code helpers (no DB). Run with:
 *   npx tsx --test src/server/services/promo.test.ts
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { normalizeCode, computeDiscountCents, assertPromoUsable, promoRedemptionKey } from './promo-core';
import { DomainError } from './errors';

/** Predicate for assert.throws: the thrown DomainError carries the given code. */
const withCode = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;

const base = {
  isActive: true,
  startsAt: null as Date | null,
  endsAt: null as Date | null,
  maxRedemptions: null as number | null,
  redemptionCount: 0,
};
const NOW = new Date('2026-06-08T12:00:00Z');

describe('normalizeCode', () => {
  it('trims and upper-cases', () => {
    assert.equal(normalizeCode('  summer20 '), 'SUMMER20');
  });
});

describe('promoRedemptionKey', () => {
  it('normalises the ID number (upper-cased, separators stripped)', () => {
    assert.equal(promoRedemptionKey('  ab-12 34 ', '+2010'), 'AB1234');
  });
  it('same ID with different phones yields the SAME key (blocks reuse via a new phone)', () => {
    assert.equal(promoRedemptionKey('29001011234567', '+201000000001'), promoRedemptionKey('29001011234567', '+201999999999'));
  });
  it('falls back to the phone when no ID number is captured', () => {
    assert.equal(promoRedemptionKey(null, '+20100'), '+20100');
    assert.equal(promoRedemptionKey('', '+20100'), '+20100');
    assert.equal(promoRedemptionKey('   ', '+20100'), '+20100');
  });
});

describe('computeDiscountCents', () => {
  it('takes whole percent of the subtotal', () => {
    assert.equal(computeDiscountCents(120000, 20), 24000);
  });
  it('rounds to the nearest piastre', () => {
    assert.equal(computeDiscountCents(1005, 10), 101); // 100.5 → 101
  });
  it('never exceeds the subtotal and floors at 0', () => {
    assert.equal(computeDiscountCents(5000, 100), 5000);
    assert.equal(computeDiscountCents(5000, 0), 0);
    assert.equal(computeDiscountCents(5000, 999), 5000); // clamped to 100%
  });
});

describe('assertPromoUsable', () => {
  it('passes an active, in-window, uncapped code', () => {
    assert.doesNotThrow(() => assertPromoUsable({ ...base }, NOW));
  });
  it('rejects an inactive code', () => {
    assert.throws(() => assertPromoUsable({ ...base, isActive: false }, NOW), withCode('promo_inactive'));
  });
  it('rejects before the start date', () => {
    assert.throws(
      () => assertPromoUsable({ ...base, startsAt: new Date('2026-07-01T00:00:00Z') }, NOW),
      withCode('promo_not_started'),
    );
  });
  it('rejects after the end date', () => {
    assert.throws(
      () => assertPromoUsable({ ...base, endsAt: new Date('2026-06-01T00:00:00Z') }, NOW),
      withCode('promo_expired'),
    );
  });
  it('rejects once the redemption cap is reached', () => {
    assert.throws(
      () => assertPromoUsable({ ...base, maxRedemptions: 5, redemptionCount: 5 }, NOW),
      withCode('promo_cap_reached'),
    );
  });
});

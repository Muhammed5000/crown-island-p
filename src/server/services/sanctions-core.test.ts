/**
 * Regression tests for the pure sanction rules.
 *
 * Run (repo convention, no test runner installed):
 *
 *   npx tsx --test src/server/services/sanctions-core.test.ts
 *
 * What we're guarding against:
 *  1. A settled (PAID / WAIVED / CANCELLED) sanction becoming chargeable or
 *     editable again through a loosened transition table — double-charging.
 *  2. The refund-only PAID → ACTIVE backdoor widening to other states.
 *  3. The stale-lock predicate regressing so an abandoned checkout locks a
 *     sanction forever (or, worse, a LIVE checkout's sanction gets stolen and
 *     charged twice).
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  ADMIN_SETTLE_STATUSES,
  SANCTION_LOCK_STALE_MINUTES,
  SANCTION_MAX_CENTS,
  canTransitionSanction,
  isPendingLockLive,
  isValidSanctionAmount,
  sumSanctionCents,
} from './sanctions-core';

describe('canTransitionSanction', () => {
  it('ACTIVE can settle to each admin status', () => {
    for (const to of ADMIN_SETTLE_STATUSES) {
      assert.equal(canTransitionSanction('ACTIVE', to), true, `ACTIVE → ${to}`);
    }
  });

  it('PAID can only return to ACTIVE (refund reactivation)', () => {
    assert.equal(canTransitionSanction('PAID', 'ACTIVE'), true);
    assert.equal(canTransitionSanction('PAID', 'WAIVED'), false);
    assert.equal(canTransitionSanction('PAID', 'CANCELLED'), false);
  });

  it('WAIVED and CANCELLED are terminal', () => {
    for (const from of ['WAIVED', 'CANCELLED'] as const) {
      for (const to of ['ACTIVE', 'PAID', 'WAIVED', 'CANCELLED'] as const) {
        if (from === to) continue;
        assert.equal(canTransitionSanction(from, to), false, `${from} → ${to} must be blocked`);
      }
    }
  });

  it('no state may transition to itself', () => {
    for (const s of ['ACTIVE', 'PAID', 'WAIVED', 'CANCELLED'] as const) {
      assert.equal(canTransitionSanction(s, s), false, `${s} → ${s}`);
    }
  });
});

describe('isPendingLockLive', () => {
  const now = new Date('2026-06-12T12:00:00Z');
  const minutes = (m: number) => new Date(now.getTime() - m * 60 * 1000);

  it('no pending booking → not locked', () => {
    assert.equal(isPendingLockLive(null, now), false);
    assert.equal(isPendingLockLive(undefined, now), false);
  });

  it('fresh PENDING_PAYMENT booking → locked (cannot be stolen / settled)', () => {
    assert.equal(
      isPendingLockLive({ status: 'PENDING_PAYMENT', createdAt: minutes(5) }, now),
      true,
    );
    assert.equal(
      isPendingLockLive(
        { status: 'PENDING_PAYMENT', createdAt: minutes(SANCTION_LOCK_STALE_MINUTES - 1) },
        now,
      ),
      true,
    );
  });

  it('stale PENDING_PAYMENT booking → released', () => {
    assert.equal(
      isPendingLockLive(
        { status: 'PENDING_PAYMENT', createdAt: minutes(SANCTION_LOCK_STALE_MINUTES) },
        now,
      ),
      false,
    );
    assert.equal(
      isPendingLockLive({ status: 'PENDING_PAYMENT', createdAt: minutes(600) }, now),
      false,
    );
  });

  it('dead bookings release the lock regardless of age', () => {
    for (const status of ['FAILED', 'CANCELLED', 'CONFIRMED', 'EXPIRED']) {
      assert.equal(
        isPendingLockLive({ status, createdAt: minutes(1) }, now),
        false,
        `${status} must not hold the lock`,
      );
    }
  });
});

describe('amount validation', () => {
  it('accepts positive integers up to the cap', () => {
    assert.equal(isValidSanctionAmount(1), true);
    assert.equal(isValidSanctionAmount(50_000), true);
    assert.equal(isValidSanctionAmount(SANCTION_MAX_CENTS), true);
  });

  it('rejects zero, negatives, floats, and over-cap values', () => {
    assert.equal(isValidSanctionAmount(0), false);
    assert.equal(isValidSanctionAmount(-100), false);
    assert.equal(isValidSanctionAmount(10.5), false);
    assert.equal(isValidSanctionAmount(SANCTION_MAX_CENTS + 1), false);
    assert.equal(isValidSanctionAmount(Number.NaN), false);
  });
});

describe('sumSanctionCents', () => {
  it('sums amounts and handles empty input', () => {
    assert.equal(sumSanctionCents([]), 0);
    assert.equal(
      sumSanctionCents([{ amountCents: 1500 }, { amountCents: 2500 }, { amountCents: 1 }]),
      4001,
    );
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideSanctionApply, isSettledSanction } from './sanction-merge-core';

// The whole point of this rule set: convergence must come from the domain state
// machine (ACTIVE → settled is one-way), NEVER from comparing wall clocks across
// two hosts — venue clock skew must not be able to drop a settlement.

test('isSettledSanction: ACTIVE with no stamp is unsettled; any other shape is settled', () => {
  assert.equal(isSettledSanction({ status: 'ACTIVE', settledAt: null }), false);
  assert.equal(isSettledSanction({ status: 'PAID', settledAt: null }), true);
  assert.equal(isSettledSanction({ status: 'WAIVED', settledAt: null }), true);
  assert.equal(isSettledSanction({ status: 'CANCELLED', settledAt: null }), true);
  // A settlement stamp alone settles it even if status looks ACTIVE (defensive).
  assert.equal(isSettledSanction({ status: 'ACTIVE', settledAt: new Date() }), true);
});

test('no stored row → apply (venue-issued fine lands as-is)', () => {
  assert.equal(decideSanctionApply(null, { status: 'ACTIVE' }), 'apply');
});

test('incoming settlement over stored ACTIVE → apply, clocks ignored', () => {
  // This is the dropped-settlement fix: even a snapshot whose updatedAt is OLDER
  // than the stored row (lagging venue clock) must still settle the fine.
  const current = { status: 'ACTIVE', settledAt: null };
  assert.equal(
    decideSanctionApply(current, { status: 'PAID', settledAt: '2026-01-01T00:00:00Z' }),
    'apply',
  );
  assert.equal(decideSanctionApply(current, { status: 'WAIVED', settledAt: null }), 'apply');
});

test('incoming ACTIVE over stored settled → skip (never un-settle via push)', () => {
  const current = { status: 'PAID', settledAt: new Date('2026-01-01T00:00:00Z') };
  assert.equal(decideSanctionApply(current, { status: 'ACTIVE', settledAt: null }), 'skip');
});

test('both settled → skip (terminal; online wins via the pull)', () => {
  const current = { status: 'WAIVED', settledAt: new Date('2026-01-01T00:00:00Z') };
  assert.equal(
    decideSanctionApply(current, { status: 'PAID', settledAt: '2026-01-02T00:00:00Z' }),
    'skip',
  );
});

test('both ACTIVE → guard (plain edits fall through to the updatedAt LWW)', () => {
  const current = { status: 'ACTIVE', settledAt: null };
  assert.equal(decideSanctionApply(current, { status: 'ACTIVE', settledAt: null }), 'guard');
});

test('a payload without status is treated as ACTIVE (defensive default)', () => {
  const current = { status: 'PAID', settledAt: new Date() };
  assert.equal(decideSanctionApply(current, { amountCents: 100 }), 'skip');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePayload } from './payload-sanitize-core';

// Pure DMMF metadata — no DB connection is made.

test('unknown keys are stripped (rollout skew) and reported, known scalars pass', () => {
  const r = sanitizePayload('GateScanEvent', {
    id: 'g1',
    result: 'ADMITTED',
    operatorId: 'staff1',
    people: 3,
    someFutureColumn: 'value-from-a-newer-local',
  });
  assert.ok(r.ok);
  assert.deepEqual(r.dropped, ['someFutureColumn']);
  assert.deepEqual(Object.keys(r.data).sort(), ['id', 'operatorId', 'people', 'result']);
  assert.equal(r.data.people, 3);
});

test('a relation-shaped object in a plain scalar is a hard reject (can never apply)', () => {
  const r = sanitizePayload('GateScanEvent', {
    id: 'g1',
    operatorId: { connect: { id: 'x' } },
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'bad_value');
    assert.equal(r.field, 'operatorId');
  }
});

test('an array in a non-list scalar is rejected too', () => {
  const r = sanitizePayload('GateScanEvent', { id: 'g1', reference: ['a', 'b'] });
  assert.equal(r.ok, false);
});

test('null is always allowed (nullability is a DB/retry concern, not structural)', () => {
  const r = sanitizePayload('GateScanEvent', { id: 'g1', bookingId: null, reason: null });
  assert.ok(r.ok);
  assert.equal(r.data.bookingId, null);
});

test('Json-typed columns accept objects and arrays', () => {
  // Settings.refundTiers is a Json column — sanitize is model-shape-only (the
  // pushable allow-list is applyChange's separate concern).
  const tiers = [{ hoursBefore: 48, percent: 50 }];
  const r = sanitizePayload('Settings', { id: 'default', refundTiers: tiers });
  assert.ok(r.ok);
  assert.deepEqual(r.data.refundTiers, tiers);
});

test('ISO date strings and enum strings pass through untouched (Prisma coerces them)', () => {
  const r = sanitizePayload('BookingLocalState', {
    id: 'b1',
    bookingId: 'b1',
    placementStatus: 'COMPLETE',
    checkedInAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
  });
  assert.ok(r.ok);
  assert.equal(r.data.placementStatus, 'COMPLETE');
  assert.equal(r.data.updatedAt, '2026-07-01T10:00:00.000Z');
});

test('an unknown model passes through untouched (the apply allow-list already rejected it)', () => {
  const payload = { id: 'x', whatever: { nested: true } };
  const r = sanitizePayload('NotARealModel', payload);
  assert.ok(r.ok);
  assert.deepEqual(r.data, payload);
  assert.deepEqual(r.dropped, []);
});

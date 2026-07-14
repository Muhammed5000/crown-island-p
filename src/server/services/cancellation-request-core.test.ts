import assert from 'node:assert/strict';
import test from 'node:test';
import { isCancellationRefundComplete } from './cancellation-request-core';

test('positive cancellation requires its full tagged refund and a cancelled booking', () => {
  assert.equal(isCancellationRefundComplete({ lockedRefundCents: 5_000, matchedRefundCents: 5_000, bookingStatus: 'CANCELLED' }), true);
  assert.equal(isCancellationRefundComplete({ lockedRefundCents: 5_000, matchedRefundCents: 4_999, bookingStatus: 'CANCELLED' }), false);
  assert.equal(isCancellationRefundComplete({ lockedRefundCents: 5_000, matchedRefundCents: 5_000, bookingStatus: 'CONFIRMED' }), false);
});

test('zero-refund cancellation completes from the terminal booking state', () => {
  assert.equal(isCancellationRefundComplete({ lockedRefundCents: 0, matchedRefundCents: 0, bookingStatus: 'CANCELLED' }), true);
  assert.equal(isCancellationRefundComplete({ lockedRefundCents: 0, matchedRefundCents: 0, bookingStatus: 'CONFIRMED' }), false);
});

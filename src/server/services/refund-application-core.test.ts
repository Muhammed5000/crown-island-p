import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentStatusAfterRefund, refundDisposition } from './refund-application-core';

test('tiered partial refund cancels the booking but keeps the retained balance refundable', () => {
  assert.deepEqual(
    refundDisposition({
      priorRefundedCents: 0,
      amountCents: 6_000,
      invoiceTotalCents: 10_000,
      cancelBooking: true,
    }),
    { isFull: false, shouldCancelBooking: true, paymentStatus: 'SUCCEEDED' },
  );
});

test('full cumulative refund is terminal regardless of the caller cancellation flag', () => {
  assert.deepEqual(
    refundDisposition({
      priorRefundedCents: 4_000,
      amountCents: 6_000,
      invoiceTotalCents: 10_000,
      cancelBooking: false,
    }),
    { isFull: true, shouldCancelBooking: true, paymentStatus: 'REFUNDED' },
  );
  assert.equal(paymentStatusAfterRefund(false), 'SUCCEEDED');
  assert.equal(paymentStatusAfterRefund(true), 'REFUNDED');
});

// Full (isFull, cancelBooking) → (shouldCancelBooking, paymentStatus) matrix. The
// wrapper (applyRefundToDb) mirrors these EXACTLY: shouldCancelBooking drives the
// booking-cancel + place-release, paymentStatus drives payment terminalization.
// Regression guard for the bug where the wrapper used isFull (not shouldCancelBooking)
// to cancel and force-flipped a partial to REFUNDED.
test('partial refund WITHOUT the cancel flag keeps the booking live and payment refundable', () => {
  assert.deepEqual(
    refundDisposition({
      priorRefundedCents: 0,
      amountCents: 3_000,
      invoiceTotalCents: 10_000,
      cancelBooking: false,
    }),
    { isFull: false, shouldCancelBooking: false, paymentStatus: 'SUCCEEDED' },
  );
});

test('a refund that exactly clears the remaining balance is full (inclusive boundary)', () => {
  assert.deepEqual(
    refundDisposition({
      priorRefundedCents: 2_500,
      amountCents: 7_500,
      invoiceTotalCents: 10_000,
      cancelBooking: true,
    }),
    { isFull: true, shouldCancelBooking: true, paymentStatus: 'REFUNDED' },
  );
});

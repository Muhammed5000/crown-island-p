import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMpgsOrder, resolveCapturedOutcome } from './order-status';

test('CAPTURED is success regardless of the result field', () => {
  assert.equal(classifyMpgsOrder('SUCCESS', 'CAPTURED'), 'success');
  // CAPTURED = funds taken; status is the source of truth, not `result`.
  assert.equal(classifyMpgsOrder('FAILURE', 'CAPTURED'), 'success');
  assert.equal(classifyMpgsOrder('', 'CAPTURED'), 'success');
});

test('SUCCESS result but not CAPTURED is NOT paid (the false-confirm bug)', () => {
  // result=SUCCESS only means the last gateway op (e.g. 3DS init) succeeded.
  assert.equal(classifyMpgsOrder('SUCCESS', 'AUTHENTICATION_INITIATED'), 'pending');
  assert.equal(classifyMpgsOrder('SUCCESS', 'AUTHENTICATION_SUCCESSFUL'), 'pending');
  assert.equal(classifyMpgsOrder('SUCCESS', 'AUTHORIZED'), 'pending');
  assert.equal(classifyMpgsOrder('SUCCESS', 'PENDING'), 'pending');
  assert.equal(classifyMpgsOrder('SUCCESS', ''), 'pending');
});

test('terminal order failure → failed (and wins over a FAILURE result)', () => {
  assert.equal(classifyMpgsOrder('SUCCESS', 'CANCELLED'), 'failed');
  assert.equal(classifyMpgsOrder('SUCCESS', 'EXPIRED'), 'failed');
  assert.equal(classifyMpgsOrder('SUCCESS', 'FAILED'), 'failed');
  assert.equal(classifyMpgsOrder('FAILURE', 'CANCELLED'), 'failed');
  assert.equal(classifyMpgsOrder('FAILURE', 'EXPIRED'), 'failed');
});

test('a plain transaction FAILURE (card decline) → declined, retryable', () => {
  assert.equal(classifyMpgsOrder('FAILURE', ''), 'declined');
  assert.equal(classifyMpgsOrder('FAILURE', 'AUTHENTICATION_INITIATED'), 'declined');
});

test('anything else still in flight → pending', () => {
  assert.equal(classifyMpgsOrder('', ''), 'pending');
  assert.equal(classifyMpgsOrder('UNKNOWN', ''), 'pending');
  assert.equal(classifyMpgsOrder('PENDING', 'PENDING'), 'pending');
});

test('captured + confirmed (or idempotent no-op) → success', () => {
  assert.equal(resolveCapturedOutcome({ }), 'success');
  assert.equal(resolveCapturedOutcome({ unconfirmable: undefined }), 'success');
});

test('captured but the confirm race lost every retry (no outcome) → success, never failed', () => {
  // The winning transaction / reconciler confirms it; reporting failure here
  // dumped a PAID customer on /booking/failed (the original race bug).
  assert.equal(resolveCapturedOutcome(null), 'success');
});

test('captured but UNCONFIRMABLE (auto-refunded) → refunded, never success', () => {
  assert.equal(resolveCapturedOutcome({ unconfirmable: 'capacity_full' }), 'refunded');
  assert.equal(resolveCapturedOutcome({ unconfirmable: 'amount_mismatch' }), 'refunded');
  assert.equal(resolveCapturedOutcome({ unconfirmable: 'booking_terminal' }), 'refunded');
  assert.equal(resolveCapturedOutcome({ unconfirmable: 'already_refunded' }), 'refunded');
});

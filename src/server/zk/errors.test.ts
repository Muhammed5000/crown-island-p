import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyZkError, ZkApiError, isZkApiError, zkErrorMessage } from './errors';

test('a -23 (card in use) is a recoverable card conflict', () => {
  const d = classifyZkError(new ZkApiError(-23, 'used', '/api/person/add'));
  assert.equal(d.kind, 'card_conflict');
  assert.equal(d.retryable, true);
  assert.equal(d.releaseCard, true);
  assert.equal(d.reason, 'card_in_use');
});

test('a -22 (person not found) is not_found, not retryable (idempotent delete)', () => {
  const d = classifyZkError(new ZkApiError(-22, 'gone', '/api/person/delete/1'));
  assert.equal(d.kind, 'not_found');
  assert.equal(d.retryable, false);
  assert.equal(d.releaseCard, false);
});

test('access-level / door config codes are admin-actionable and NOT retryable', () => {
  for (const code of [-24, -25, -40, -41, -42, -43, -44, -46, -47, -48]) {
    const d = classifyZkError(new ZkApiError(code, 'cfg', '/api/person/add'));
    assert.equal(d.kind, 'config', `code ${code}`);
    assert.equal(d.retryable, false, `code ${code}`);
    assert.equal(d.adminActionable, true, `code ${code}`);
    assert.equal(d.reason, `zk_config_${Math.abs(code)}`);
  }
});

test('a -1 program error is treated as transient (retryable)', () => {
  const d = classifyZkError(new ZkApiError(-1, 'oops'));
  assert.equal(d.kind, 'transient');
  assert.equal(d.retryable, true);
});

test('an unknown negative code is fatal (needs a human, no auto-retry)', () => {
  const d = classifyZkError(new ZkApiError(-999, 'weird'));
  assert.equal(d.kind, 'fatal');
  assert.equal(d.retryable, false);
  assert.equal(d.adminActionable, true);
  assert.equal(d.reason, 'zk_error_999');
});

test('a transport error (non-ZkApiError) is transient so the booking is retried', () => {
  const d = classifyZkError(new Error('zk_transport_error:TimeoutError'));
  assert.equal(d.kind, 'transient');
  assert.equal(d.retryable, true);
  assert.equal(d.reason, 'zk_unreachable');
});

test('isZkApiError narrows correctly', () => {
  assert.equal(isZkApiError(new ZkApiError(-1, 'x')), true);
  assert.equal(isZkApiError(new Error('x')), false);
  assert.equal(isZkApiError(null), false);
});

test('zkErrorMessage falls back to a generic label for unknown codes', () => {
  assert.equal(zkErrorMessage(-23), 'The card number has been used');
  assert.equal(zkErrorMessage(-424242), 'ZK error -424242');
  assert.equal(zkErrorMessage(-424242, 'from server'), 'from server');
});

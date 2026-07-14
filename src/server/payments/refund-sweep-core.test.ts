/**
 * Tests for the stale-REFUND_PENDING sweep decision logic.
 *
 *   npx tsx --test src/server/payments/refund-sweep-core.test.ts
 *
 * The sweep moves MONEY STATE — a wrong `finalize` marks an un-refunded payment
 * REFUNDED (customer keeps paying, booking dies); a wrong `release` re-opens a
 * refunded payment to a second gateway refund. These tests pin the conservative
 * decision rules to the gateway evidence.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { decideRefundPendingAction, extractRefundEvidence } from './refund-sweep-core';

const PAYMENT_ID = 'pay_123';
const PAYMENT_CENTS = 30_000; // 300.00

describe('extractRefundEvidence', () => {
  it('parses a realistic RETRIEVE_ORDER response with a refund leg', () => {
    const order = {
      result: 'SUCCESS',
      status: 'REFUNDED',
      amount: 300,
      currency: 'EGP',
      totalRefundedAmount: 300,
      transaction: [
        { result: 'SUCCESS', transaction: { id: '1', type: 'PAYMENT', amount: 300 } },
        { result: 'SUCCESS', transaction: { id: 'refund-abc123', type: 'REFUND', amount: 300 } },
      ],
    };
    const e = extractRefundEvidence(order);
    assert.equal(e.orderStatus, 'REFUNDED');
    assert.equal(e.totalRefundedCents, 30_000);
    assert.equal(e.refundLegId, 'refund-abc123');
    assert.equal(e.refundLegAmountCents, 30_000);
  });

  it('ignores failed refund legs and non-refund transactions', () => {
    const e = extractRefundEvidence({
      status: 'CAPTURED',
      transaction: [
        { result: 'SUCCESS', transaction: { id: '1', type: 'PAYMENT', amount: 300 } },
        { result: 'FAILURE', transaction: { id: 'refund-x', type: 'REFUND', amount: 300 } },
      ],
    });
    assert.equal(e.refundLegId, null);
    assert.equal(e.totalRefundedCents, null);
  });

  it('handles a partial refund reported only via totalRefundedAmount', () => {
    const e = extractRefundEvidence({ status: 'PARTIALLY_REFUNDED', totalRefundedAmount: 150.5 });
    assert.equal(e.orderStatus, 'PARTIALLY_REFUNDED');
    assert.equal(e.totalRefundedCents, 15_050);
    assert.equal(e.refundLegId, null);
  });

  it('never throws on garbage input', () => {
    for (const garbage of [null, undefined, 42, 'nope', [], {}, { transaction: 'no' }]) {
      const e = extractRefundEvidence(garbage);
      assert.equal(e.refundLegId, null);
      assert.equal(e.totalRefundedCents, null);
    }
  });

  it('treats totalRefundedAmount of 0 as no refund', () => {
    const e = extractRefundEvidence({ status: 'CAPTURED', totalRefundedAmount: 0 });
    assert.equal(e.totalRefundedCents, null);
  });
});

describe('decideRefundPendingAction', () => {
  it('null evidence (gateway unreachable) → leave', () => {
    assert.deepEqual(decideRefundPendingAction(null, PAYMENT_ID, PAYMENT_CENTS), {
      kind: 'leave',
    });
  });

  it('CAPTURED with no refund evidence → release (admin can retry)', () => {
    const e = extractRefundEvidence({ status: 'CAPTURED', totalRefundedAmount: 0 });
    assert.deepEqual(decideRefundPendingAction(e, PAYMENT_ID, PAYMENT_CENTS), {
      kind: 'release',
    });
  });

  it('REFUNDED with a refund leg → finalize with the LEG id and amount', () => {
    const e = extractRefundEvidence({
      status: 'REFUNDED',
      totalRefundedAmount: 300,
      transaction: [
        { result: 'SUCCESS', transaction: { id: 'refund-leg9', type: 'REFUND', amount: 300 } },
      ],
    });
    const a = decideRefundPendingAction(e, PAYMENT_ID, PAYMENT_CENTS);
    assert.deepEqual(a, { kind: 'finalize', refundId: 'refund-leg9', amountCents: 30_000 });
  });

  it('PARTIALLY_REFUNDED via totalRefundedAmount only → finalize with fallback id + reported amount', () => {
    const e = extractRefundEvidence({ status: 'PARTIALLY_REFUNDED', totalRefundedAmount: 150 });
    const a = decideRefundPendingAction(e, PAYMENT_ID, PAYMENT_CENTS);
    assert.deepEqual(a, {
      kind: 'finalize',
      refundId: `SWEPT_REFUND:${PAYMENT_ID}`,
      amountCents: 15_000,
    });
  });

  it('REFUNDED status with no amounts at all → finalize with the payment amount', () => {
    const e = extractRefundEvidence({ status: 'REFUNDED' });
    const a = decideRefundPendingAction(e, PAYMENT_ID, PAYMENT_CENTS);
    assert.deepEqual(a, {
      kind: 'finalize',
      refundId: `SWEPT_REFUND:${PAYMENT_ID}`,
      amountCents: PAYMENT_CENTS,
    });
  });

  it('unknown / in-flight order states → leave (never guess)', () => {
    for (const status of ['', 'AUTHORIZED', 'AUTHENTICATION_INITIATED', 'PENDING', 'WHATEVER']) {
      const e = extractRefundEvidence({ status });
      assert.deepEqual(
        decideRefundPendingAction(e, PAYMENT_ID, PAYMENT_CENTS),
        { kind: 'leave' },
        `status=${status}`,
      );
    }
  });

  it('a successful refund leg forces finalize even if order.status looks CAPTURED', () => {
    // Defensive: some gateway versions keep status CAPTURED with refund legs
    // attached — the leg is harder evidence than the rollup status.
    const e = extractRefundEvidence({
      status: 'CAPTURED',
      transaction: [
        { result: 'SUCCESS', transaction: { id: 'refund-z', type: 'REFUND', amount: 100 } },
      ],
    });
    const a = decideRefundPendingAction(e, PAYMENT_ID, PAYMENT_CENTS);
    assert.equal(a.kind, 'finalize');
  });
});

describe('ledger-aware evidence (insurance-deposit legs must never finalize a service refund)', () => {
  // The poisoning scenario both design reviews flagged as CRITICAL:
  // an insurance deposit (1,000) was refunded weeks ago (leg `insref-…`,
  // recorded as a RefundLine). An admin SERVICE refund (4,000) is now stuck
  // REFUND_PENDING because its gateway call never went through. The order
  // reads PARTIALLY_REFUNDED — but ONLY because of the deposit leg.
  const poisonedOrder = {
    status: 'PARTIALLY_REFUNDED',
    totalRefundedAmount: 10, // 1,000 cents — the deposit only
    transaction: [
      { result: 'SUCCESS', transaction: { id: '1', type: 'PAYMENT', amount: 50 } },
      { result: 'SUCCESS', transaction: { id: 'insref-ir1-1', type: 'REFUND', amount: 10 } },
    ],
  };

  it('recorded insurance leg + no residual → RELEASE the stuck claim, never finalize', () => {
    const e = extractRefundEvidence(poisonedOrder, {
      legIds: ['insref-ir1-1'],
      recordedCents: 1_000,
    });
    assert.equal(e.refundLegId, null); // the deposit leg is accounted for
    assert.equal(e.residualRefundedCents, 0);
    assert.deepEqual(decideRefundPendingAction(e, PAYMENT_ID, PAYMENT_CENTS), {
      kind: 'release',
    });
  });

  it('insurance-prefixed legs are excluded even when NOT yet in the ledger', () => {
    const e = extractRefundEvidence(poisonedOrder, { legIds: [], recordedCents: 1_000 });
    assert.equal(e.refundLegId, null);
  });

  it('a genuinely unaccounted service leg still finalizes with ITS id and amount', () => {
    const order = {
      status: 'PARTIALLY_REFUNDED',
      totalRefundedAmount: 50, // 1,000 deposit + 4,000 service
      transaction: [
        { result: 'SUCCESS', transaction: { id: 'insref-ir1-1', type: 'REFUND', amount: 10 } },
        { result: 'SUCCESS', transaction: { id: 'refund-svc7', type: 'REFUND', amount: 40 } },
      ],
    };
    const e = extractRefundEvidence(order, { legIds: ['insref-ir1-1'], recordedCents: 1_000 });
    assert.deepEqual(decideRefundPendingAction(e, PAYMENT_ID, PAYMENT_CENTS), {
      kind: 'finalize',
      refundId: 'refund-svc7',
      amountCents: 4_000,
    });
  });

  it('previously-recorded partial service refunds do not re-finalize (residual math)', () => {
    const order = { status: 'PARTIALLY_REFUNDED', totalRefundedAmount: 20 };
    const e = extractRefundEvidence(order, { legIds: ['refund-old'], recordedCents: 2_000 });
    assert.equal(e.residualRefundedCents, 0);
    assert.deepEqual(decideRefundPendingAction(e, PAYMENT_ID, PAYMENT_CENTS), {
      kind: 'release',
    });
  });

  it('residual amount finalizes with the RESIDUAL, not the gateway total', () => {
    // 2,000 recorded earlier + 3,000 residual now at the gateway.
    const order = { status: 'PARTIALLY_REFUNDED', totalRefundedAmount: 50 };
    const e = extractRefundEvidence(order, { legIds: ['refund-old'], recordedCents: 2_000 });
    assert.deepEqual(decideRefundPendingAction(e, PAYMENT_ID, PAYMENT_CENTS), {
      kind: 'finalize',
      refundId: `SWEPT_REFUND:${PAYMENT_ID}`,
      amountCents: 3_000,
    });
  });

  it('REFUNDED order fully accounted for in the ledger → release, not a second finalize', () => {
    const order = { status: 'REFUNDED', totalRefundedAmount: 300 };
    const e = extractRefundEvidence(order, {
      legIds: ['refund-done'],
      recordedCents: 30_000,
    });
    assert.deepEqual(decideRefundPendingAction(e, PAYMENT_ID, PAYMENT_CENTS), {
      kind: 'release',
    });
  });
});

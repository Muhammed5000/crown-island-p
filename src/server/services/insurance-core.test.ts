// Run just this file: npx tsx --test src/server/services/insurance-core.test.ts
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  assembleFinalTotalCents,
  assertRefundMethodAllowed,
  assertRefundTransition,
  allowedRefundMethods,
  buildInsuranceSnapshot,
  canTransitionRefund,
  classifyInsuranceAnomalies,
  computeInsuranceCents,
  customerInsuranceState,
  deskRefundRef,
  initialRefundStatus,
  isActiveRefundStatus,
  isInsuranceRefundRef,
  providerRefundRef,
  refundableInsuranceCents,
  splitInvoiceMoney,
  validateInsuranceConfig,
  type InsuranceRefundStatus,
  type ServiceInsuranceConfig,
} from './insurance-core';

const pct = (percent: number): ServiceInsuranceConfig => ({
  insuranceEnabled: true,
  insuranceType: 'PERCENT',
  insurancePercent: percent,
  insuranceFixedCents: 0,
});
const fixed = (cents: number): ServiceInsuranceConfig => ({
  insuranceEnabled: true,
  insuranceType: 'FIXED',
  insurancePercent: 0,
  insuranceFixedCents: cents,
});
const disabled: ServiceInsuranceConfig = {
  insuranceEnabled: false,
  insuranceType: 'PERCENT',
  insurancePercent: 50,
  insuranceFixedCents: 5000,
};

describe('computeInsuranceCents', () => {
  it('is zero when disabled regardless of values', () => {
    assert.equal(computeInsuranceCents(disabled, 100_000), 0);
  });
  it('is zero on a non-positive base', () => {
    assert.equal(computeInsuranceCents(pct(10), 0), 0);
    assert.equal(computeInsuranceCents(pct(10), -500), 0);
    assert.equal(computeInsuranceCents(fixed(150_00), 0), 0);
  });
  it('percent of the pre-discount base, rounded', () => {
    assert.equal(computeInsuranceCents(pct(10), 1000_00), 100_00);
    assert.equal(computeInsuranceCents(pct(5), 2000_00), 100_00);
    // rounding: 12% of 333 → 39.96 → 40
    assert.equal(computeInsuranceCents(pct(12), 333), 40);
    assert.equal(computeInsuranceCents(pct(33), 100), 33);
    assert.equal(computeInsuranceCents(pct(100), 750), 750);
  });
  it('clamps out-of-range percents instead of exploding money', () => {
    assert.equal(computeInsuranceCents(pct(150), 1000), 1000); // clamped to 100
    assert.equal(computeInsuranceCents(pct(-10), 1000), 0);
  });
  it('fixed value is independent of the base size', () => {
    assert.equal(computeInsuranceCents(fixed(150_00), 1000_00), 150_00);
    assert.equal(computeInsuranceCents(fixed(150_00), 10_00), 150_00);
  });
  it('negative fixed values never produce a negative deposit', () => {
    assert.equal(computeInsuranceCents(fixed(-100), 1000), 0);
  });
});

describe('buildInsuranceSnapshot', () => {
  it('null when nothing to collect', () => {
    assert.equal(buildInsuranceSnapshot(disabled, 1000_00), null);
    assert.equal(buildInsuranceSnapshot(pct(10), 0), null);
  });
  it('freezes type-appropriate fields', () => {
    const p = buildInsuranceSnapshot(pct(10), 1000_00);
    assert.deepEqual(p, {
      type: 'PERCENT',
      percent: 10,
      fixedCents: null,
      baseCents: 1000_00,
      amountCents: 100_00,
    });
    const f = buildInsuranceSnapshot(fixed(150_00), 1000_00);
    assert.deepEqual(f, {
      type: 'FIXED',
      percent: null,
      fixedCents: 150_00,
      baseCents: 1000_00,
      amountCents: 150_00,
    });
  });
});

describe('validateInsuranceConfig', () => {
  it('accepts disabled configs unconditionally', () => {
    validateInsuranceConfig(disabled);
  });
  it('rejects out-of-range or fractional percents', () => {
    assert.throws(() => validateInsuranceConfig(pct(0)), { code: 'insurance_percent_invalid' });
    assert.throws(() => validateInsuranceConfig(pct(101)), { code: 'insurance_percent_invalid' });
    assert.throws(() => validateInsuranceConfig(pct(12.5)), { code: 'insurance_percent_invalid' });
    assert.throws(() => validateInsuranceConfig(pct(-5)), { code: 'insurance_percent_invalid' });
  });
  it('accepts percent boundaries 1 and 100', () => {
    validateInsuranceConfig(pct(1));
    validateInsuranceConfig(pct(100));
  });
  it('rejects non-positive or fractional fixed values', () => {
    assert.throws(() => validateInsuranceConfig(fixed(0)), { code: 'insurance_fixed_invalid' });
    assert.throws(() => validateInsuranceConfig(fixed(-100)), { code: 'insurance_fixed_invalid' });
    assert.throws(() => validateInsuranceConfig(fixed(10.5)), { code: 'insurance_fixed_invalid' });
  });
});

describe('assembleFinalTotalCents — the separation rule', () => {
  it('requirement example 1: percentage insurance with voucher', () => {
    // 1000 EGP service, 10% insurance, 300 voucher → pay 800 (insurance stays 100)
    assert.equal(
      assembleFinalTotalCents({
        serviceTotalCents: 1000_00,
        discountCents: 300_00,
        penaltiesCents: 0,
        insuranceCents: computeInsuranceCents(pct(10), 1000_00),
      }),
      800_00,
    );
  });
  it('requirement example 2: fixed insurance survives a full service discount', () => {
    // 1000 service fully discounted, fixed 150 insurance → pay exactly 150
    assert.equal(
      assembleFinalTotalCents({
        serviceTotalCents: 1000_00,
        discountCents: 1000_00,
        penaltiesCents: 0,
        insuranceCents: 150_00,
      }),
      150_00,
    );
  });
  it('requirement example 3: reception manual discount', () => {
    // 2000 service, 5% insurance (100), 500 reception discount → 1600
    assert.equal(
      assembleFinalTotalCents({
        serviceTotalCents: 2000_00,
        discountCents: 500_00,
        penaltiesCents: 0,
        insuranceCents: computeInsuranceCents(pct(5), 2000_00),
      }),
      1600_00,
    );
  });
  it('requirement example 4: multiple discounts stack against service only', () => {
    // 1500 service, 10% insurance (150), discounts 200+100+50=350 → 1150 + 150 = 1300
    assert.equal(
      assembleFinalTotalCents({
        serviceTotalCents: 1500_00,
        discountCents: 350_00,
        penaltiesCents: 0,
        insuranceCents: computeInsuranceCents(pct(10), 1500_00),
      }),
      1300_00,
    );
  });
  it('voucher excess dies in the clamp and never pays the deposit', () => {
    // service 300, voucher 500, insurance 100 → customer still pays 100
    assert.equal(
      assembleFinalTotalCents({
        serviceTotalCents: 300_00,
        discountCents: 500_00,
        penaltiesCents: 0,
        insuranceCents: 100_00,
      }),
      100_00,
    );
  });
  it('penalties are also un-discountable and additive', () => {
    assert.equal(
      assembleFinalTotalCents({
        serviceTotalCents: 1000,
        discountCents: 400,
        penaltiesCents: 250,
        insuranceCents: 100,
      }),
      950,
    );
  });
  it('property: for every discount 0..100% the payable never dips below insurance + penalties', () => {
    const serviceTotal = 1234_56;
    const insurance = computeInsuranceCents(pct(10), serviceTotal);
    for (let d = 0; d <= 100; d++) {
      const discount = Math.round((serviceTotal * d) / 100);
      const total = assembleFinalTotalCents({
        serviceTotalCents: serviceTotal,
        discountCents: discount,
        penaltiesCents: 500,
        insuranceCents: insurance,
      });
      assert.ok(total >= insurance + 500, `discount ${d}% produced ${total}`);
    }
  });
  it('identity when there is no insurance (legacy formula preserved)', () => {
    assert.equal(
      assembleFinalTotalCents({
        serviceTotalCents: 1000,
        discountCents: 300,
        penaltiesCents: 50,
        insuranceCents: 0,
      }),
      750,
    );
  });
  it('negative discount input cannot inflate the total', () => {
    assert.equal(
      assembleFinalTotalCents({
        serviceTotalCents: 1000,
        discountCents: -500,
        penaltiesCents: 0,
        insuranceCents: 100,
      }),
      1100,
    );
  });
});

describe('refundableInsuranceCents', () => {
  it('only COLLECTED money is refundable', () => {
    assert.equal(
      refundableInsuranceCents({ collectionStatus: 'PENDING', amountCents: 100, refundedCents: 0 }),
      0,
    );
    assert.equal(
      refundableInsuranceCents({ collectionStatus: 'VOIDED', amountCents: 100, refundedCents: 0 }),
      0,
    );
    assert.equal(
      refundableInsuranceCents({ collectionStatus: 'COLLECTED', amountCents: 100, refundedCents: 0 }),
      100,
    );
  });
  it('nets prior refunds and floors at zero', () => {
    assert.equal(
      refundableInsuranceCents({ collectionStatus: 'COLLECTED', amountCents: 100, refundedCents: 40 }),
      60,
    );
    assert.equal(
      refundableInsuranceCents({ collectionStatus: 'COLLECTED', amountCents: 100, refundedCents: 150 }),
      0,
    );
  });
});

describe('refund method routing', () => {
  it('card money returns only through the provider', () => {
    assert.deepEqual(allowedRefundMethods('CREDIT_AGRICOLE'), ['PROVIDER']);
    assert.throws(() => assertRefundMethodAllowed('CREDIT_AGRICOLE', 'CASH'), {
      code: 'insurance_refund_method_mismatch',
    });
    assert.throws(() => assertRefundMethodAllowed('CREDIT_AGRICOLE', 'INSTAPAY'), {
      code: 'insurance_refund_method_mismatch',
    });
  });
  it('desk money returns only over the desk', () => {
    assert.deepEqual(allowedRefundMethods('CASH'), ['CASH', 'INSTAPAY']);
    assert.deepEqual(allowedRefundMethods('INSTAPAY'), ['CASH', 'INSTAPAY']);
    assert.throws(() => assertRefundMethodAllowed('CASH', 'PROVIDER'), {
      code: 'insurance_refund_method_mismatch',
    });
  });
  it('initial workflow status follows the method', () => {
    assert.equal(initialRefundStatus('PROVIDER'), 'AWAITING_ADMIN');
    assert.equal(initialRefundStatus('CASH'), 'PENDING_DESK');
    assert.equal(initialRefundStatus('INSTAPAY'), 'PENDING_DESK');
  });
});

describe('refund state machine', () => {
  const ALL: InsuranceRefundStatus[] = [
    'AWAITING_ADMIN',
    'PENDING_DESK',
    'PROCESSING',
    'COMPLETED',
    'FAILED',
    'REJECTED',
    'MANUAL_ATTENTION',
  ];
  const LEGAL: Array<[InsuranceRefundStatus, InsuranceRefundStatus]> = [
    ['AWAITING_ADMIN', 'PROCESSING'],
    ['AWAITING_ADMIN', 'REJECTED'],
    ['PENDING_DESK', 'COMPLETED'],
    ['PENDING_DESK', 'REJECTED'],
    ['PROCESSING', 'COMPLETED'],
    ['PROCESSING', 'AWAITING_ADMIN'],
    ['PROCESSING', 'FAILED'],
    ['PROCESSING', 'MANUAL_ATTENTION'],
    ['MANUAL_ATTENTION', 'AWAITING_ADMIN'],
    ['MANUAL_ATTENTION', 'COMPLETED'],
    ['MANUAL_ATTENTION', 'REJECTED'],
    ['FAILED', 'AWAITING_ADMIN'],
    ['FAILED', 'REJECTED'],
  ];
  it('accepts exactly the legal transitions and rejects every other edge', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        const legal = LEGAL.some(([f, t]) => f === from && t === to);
        assert.equal(
          canTransitionRefund(from, to),
          legal,
          `${from} → ${to} expected ${legal ? 'legal' : 'illegal'}`,
        );
        if (!legal) {
          assert.throws(() => assertRefundTransition(from, to), {
            code: 'insurance_invalid_transition',
          });
        }
      }
    }
  });
  it('COMPLETED and REJECTED are immutable (corrections append new rows)', () => {
    for (const to of ALL) {
      assert.equal(canTransitionRefund('COMPLETED', to), false);
      assert.equal(canTransitionRefund('REJECTED', to), false);
    }
  });
  it('active statuses are the queue/claim states', () => {
    assert.ok(isActiveRefundStatus('AWAITING_ADMIN'));
    assert.ok(isActiveRefundStatus('PENDING_DESK'));
    assert.ok(isActiveRefundStatus('PROCESSING'));
    assert.ok(!isActiveRefundStatus('COMPLETED'));
    assert.ok(!isActiveRefundStatus('FAILED'));
  });
});

describe('refund references', () => {
  it('deterministic per attempt, prefixed for pool separation', () => {
    assert.equal(providerRefundRef('abc123', 1), 'insref-abc123-1');
    assert.equal(providerRefundRef('abc123', 2), 'insref-abc123-2');
    assert.equal(deskRefundRef('abc123'), 'INS_DESK:abc123');
  });
  it('recognises insurance refs so the booking-refund sweep can exclude them', () => {
    assert.ok(isInsuranceRefundRef('insref-abc123-1'));
    assert.ok(isInsuranceRefundRef('INS_DESK:abc123'));
    assert.ok(!isInsuranceRefundRef('refund-lx7a9kq3ff'));
    assert.ok(!isInsuranceRefundRef('MANUAL_REFUND:pay_1'));
    assert.ok(!isInsuranceRefundRef(null));
    assert.ok(!isInsuranceRefundRef(undefined));
  });
});

describe('splitInvoiceMoney', () => {
  it('legacy identity: no insurance, all refunds SERVICE', () => {
    const split = splitInvoiceMoney({
      totalCents: 1000,
      insuranceAmountCents: 0,
      refunds: [{ amountCents: 300, kind: 'SERVICE' }],
    });
    assert.equal(split.serviceGrossCents, 1000);
    assert.equal(split.serviceNetCents, 700); // === netRevenueCents(1000, [300])
    assert.equal(split.insuranceRefundedCents, 0);
  });
  it('keeps the pools disjoint', () => {
    const split = splitInvoiceMoney({
      totalCents: 1100,
      insuranceAmountCents: 100,
      refunds: [
        { amountCents: 100, kind: 'INSURANCE' },
        { amountCents: 500, kind: 'SERVICE' },
      ],
    });
    assert.equal(split.serviceGrossCents, 1000);
    assert.equal(split.serviceNetCents, 500);
    assert.equal(split.insuranceRefundedCents, 100);
  });
  it('floors at zero on over-refund rather than going negative', () => {
    const split = splitInvoiceMoney({
      totalCents: 500,
      insuranceAmountCents: 100,
      refunds: [{ amountCents: 900, kind: 'SERVICE' }],
    });
    assert.equal(split.serviceNetCents, 0);
  });
});

describe('customerInsuranceState', () => {
  const collected = {
    bookingStatus: 'CONFIRMED' as const,
    collectionStatus: 'COLLECTED' as const,
    decision: 'UNDECIDED' as const,
    refunds: [] as const,
  };
  it('VOIDED deposits show nothing', () => {
    assert.equal(
      customerInsuranceState({ ...collected, collectionStatus: 'VOIDED', bookingStatus: 'CANCELLED' }),
      null,
    );
  });
  it('PENDING shows "in your payment" only while the booking awaits payment', () => {
    assert.deepEqual(
      customerInsuranceState({ ...collected, collectionStatus: 'PENDING', bookingStatus: 'PENDING_PAYMENT' }),
      { kind: 'awaiting_capture' },
    );
    // Transitional/anomalous PENDING on a non-pending booking → nothing.
    assert.equal(
      customerInsuranceState({ ...collected, collectionStatus: 'PENDING', bookingStatus: 'CONFIRMED' }),
      null,
    );
  });
  it('COLLECTED + UNDECIDED → held (returned at checkout)', () => {
    assert.deepEqual(customerInsuranceState(collected), { kind: 'collected' });
  });
  it('REFUND decision without a COMPLETED payout is NEVER shown as refunded', () => {
    for (const status of ['AWAITING_ADMIN', 'PENDING_DESK', 'PROCESSING', 'FAILED', 'REJECTED', 'MANUAL_ATTENTION'] as const) {
      assert.deepEqual(
        customerInsuranceState({
          ...collected,
          decision: 'REFUND',
          refunds: [{ status, method: 'PROVIDER', completedAt: null }],
        }),
        { kind: 'refund_pending' },
        `status ${status} must stay refund_pending`,
      );
    }
  });
  it('a COMPLETED payout → refunded, carrying the latest payout method + date', () => {
    const older = new Date('2026-07-01T10:00:00Z');
    const newer = new Date('2026-07-03T10:00:00Z');
    assert.deepEqual(
      customerInsuranceState({
        ...collected,
        decision: 'REFUND',
        refunds: [
          { status: 'COMPLETED', method: 'CASH', completedAt: older },
          { status: 'REJECTED', method: 'PROVIDER', completedAt: null },
          { status: 'COMPLETED', method: 'INSTAPAY', completedAt: newer },
        ],
      }),
      { kind: 'refunded', method: 'INSTAPAY', completedAt: newer },
    );
  });
  it('NO_REFUND → retained, unless a completed payout proves money went out', () => {
    assert.deepEqual(
      customerInsuranceState({ ...collected, decision: 'NO_REFUND' }),
      { kind: 'retained' },
    );
    const when = new Date('2026-07-02T09:00:00Z');
    assert.deepEqual(
      customerInsuranceState({
        ...collected,
        decision: 'NO_REFUND',
        refunds: [{ status: 'COMPLETED', method: 'CASH', completedAt: when }],
      }),
      { kind: 'refunded', method: 'CASH', completedAt: when },
    );
  });
});

describe('classifyInsuranceAnomalies', () => {
  const base = {
    bookingInsuranceId: 'bi1',
    collectionStatus: 'COLLECTED' as const,
    decision: 'UNDECIDED' as const,
    amountCents: 100_00,
    refundedCents: 0,
    bookingStatus: 'CONFIRMED' as const,
    visitEndedDaysAgo: null,
    refunds: [],
  };
  it('healthy row → no anomalies', () => {
    assert.deepEqual(classifyInsuranceAnomalies(base), []);
  });
  it('over-refund', () => {
    assert.deepEqual(
      classifyInsuranceAnomalies({ ...base, refundedCents: 200_00 }),
      ['over_refunded'],
    );
  });
  it('PENDING deposit on a terminal booking', () => {
    assert.deepEqual(
      classifyInsuranceAnomalies({
        ...base,
        collectionStatus: 'PENDING',
        bookingStatus: 'CANCELLED',
      }),
      ['pending_on_terminal_booking'],
    );
  });
  it('REFUND decision without any attempt row', () => {
    assert.deepEqual(
      classifyInsuranceAnomalies({ ...base, decision: 'REFUND' }),
      ['refund_decision_without_attempt'],
    );
  });
  it('a rejected attempt does not satisfy a REFUND decision', () => {
    assert.deepEqual(
      classifyInsuranceAnomalies({
        ...base,
        decision: 'REFUND',
        refunds: [{ status: 'REJECTED', method: 'PROVIDER', proofUrl: null, ageMinutes: 5 }],
      }),
      ['refund_decision_without_attempt'],
    );
  });
  it('InstaPay completed without proof', () => {
    assert.deepEqual(
      classifyInsuranceAnomalies({
        ...base,
        decision: 'REFUND',
        refunds: [{ status: 'COMPLETED', method: 'INSTAPAY', proofUrl: null, ageMinutes: 5 }],
      }),
      ['instapay_completed_without_proof'],
    );
  });
  it('stuck PROCESSING and stale PENDING_DESK by age', () => {
    assert.deepEqual(
      classifyInsuranceAnomalies({
        ...base,
        decision: 'REFUND',
        refunds: [
          { status: 'PROCESSING', method: 'PROVIDER', proofUrl: null, ageMinutes: 45 },
          { status: 'PENDING_DESK', method: 'CASH', proofUrl: null, ageMinutes: 8 * 24 * 60 },
        ],
      }).sort(),
      ['stale_desk_payout', 'stuck_processing'],
    );
  });
  it('forgotten checkout after the visit ended', () => {
    assert.deepEqual(
      classifyInsuranceAnomalies({ ...base, visitEndedDaysAgo: 3 }),
      ['forgotten_checkout'],
    );
    assert.deepEqual(classifyInsuranceAnomalies({ ...base, visitEndedDaysAgo: 0 }), []);
  });
});

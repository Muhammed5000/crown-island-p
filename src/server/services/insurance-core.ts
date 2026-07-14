import { DomainError } from './errors';

/**
 * Pure insurance-deposit logic — no `server-only`, no Prisma — unit-testable
 * directly (mirrors the `booking-calc-core` ↔ `booking-calc` split). The
 * DB-bound flows live in `./insurance.ts` / `./insurance-refunds.ts`.
 * Money model: docs/INSURANCE.md.
 */

export type InsuranceChargeType = 'PERCENT' | 'FIXED';

export interface ServiceInsuranceConfig {
  insuranceEnabled: boolean;
  insuranceType: InsuranceChargeType;
  insurancePercent: number;
  insuranceFixedCents: number;
}

/** Frozen per-booking snapshot of the config that produced the deposit. */
export interface InsuranceSnapshot {
  type: InsuranceChargeType;
  percent: number | null;
  fixedCents: number | null;
  baseCents: number;
  amountCents: number;
}

/**
 * Compute the deposit from the ELIGIBLE SERVICE TOTAL BEFORE DISCOUNTS
 * (`calc.subtotalCents`). Never from a discounted balance — the separation
 * rule: vouchers/promos/manual discounts must not shrink the deposit.
 * Disabled config or non-positive base ⇒ 0. Same rounding family as
 * `computeDiscountCents` (round-half-up on the percent product).
 */
export function computeInsuranceCents(
  cfg: ServiceInsuranceConfig,
  baseCents: number,
): number {
  if (!cfg.insuranceEnabled || baseCents <= 0) return 0;
  if (cfg.insuranceType === 'PERCENT') {
    const pct = Math.max(0, Math.min(100, Math.trunc(cfg.insurancePercent)));
    return Math.max(0, Math.round((baseCents * pct) / 100));
  }
  return Math.max(0, Math.trunc(cfg.insuranceFixedCents));
}

/** Snapshot the config + computed amount for persistence, or null when no deposit applies. */
export function buildInsuranceSnapshot(
  cfg: ServiceInsuranceConfig,
  baseCents: number,
): InsuranceSnapshot | null {
  const amountCents = computeInsuranceCents(cfg, baseCents);
  if (amountCents <= 0) return null;
  return {
    type: cfg.insuranceType,
    percent: cfg.insuranceType === 'PERCENT' ? Math.trunc(cfg.insurancePercent) : null,
    fixedCents: cfg.insuranceType === 'FIXED' ? Math.trunc(cfg.insuranceFixedCents) : null,
    baseCents,
    amountCents,
  };
}

/**
 * Validate an admin-submitted service insurance config. Throws a typed
 * {@link DomainError} so the catalog action surfaces a field error.
 */
export function validateInsuranceConfig(cfg: ServiceInsuranceConfig): void {
  if (!cfg.insuranceEnabled) return;
  if (cfg.insuranceType === 'PERCENT') {
    if (
      !Number.isInteger(cfg.insurancePercent) ||
      cfg.insurancePercent < 1 ||
      cfg.insurancePercent > 100
    ) {
      throw new DomainError(
        'Insurance percent must be a whole number between 1 and 100',
        'insurance_percent_invalid',
        400,
      );
    }
  } else {
    if (!Number.isInteger(cfg.insuranceFixedCents) || cfg.insuranceFixedCents <= 0) {
      throw new DomainError(
        'Fixed insurance amount must be greater than zero',
        'insurance_fixed_invalid',
        400,
      );
    }
  }
}

/**
 * THE grand-total assembly — the single place the separation rule is encoded.
 * Discounts are clamped against the SERVICE total only; the deposit and
 * penalties ride on top un-discountable:
 *
 *   final = max(0, serviceTotal − discount) + penalties + insurance
 *
 * A 100% service discount still collects the full deposit; voucher excess dies
 * inside the clamp and can never bleed into it. Every quote/commit surface
 * (online commit, review page quote, reception commit) MUST assemble through
 * this function — never hand-add the parts.
 */
export function assembleFinalTotalCents(input: {
  serviceTotalCents: number;
  discountCents: number;
  penaltiesCents: number;
  insuranceCents: number;
}): number {
  const discounted = Math.max(
    0,
    input.serviceTotalCents - Math.max(0, input.discountCents),
  );
  const total =
    discounted + Math.max(0, input.penaltiesCents) + Math.max(0, input.insuranceCents);
  // Belt-and-braces: no assembly may ever produce a total below the
  // un-discountable parts (would mean a discount leaked into them).
  if (total < Math.max(0, input.penaltiesCents) + Math.max(0, input.insuranceCents)) {
    throw new DomainError(
      'Discounts may not reduce insurance or penalties',
      'insurance_not_discountable',
      409,
    );
  }
  return total;
}

/**
 * Maximum refundable deposit right now. `refundedCents` is
 * Σ RefundLine(kind=INSURANCE) on the booking's invoice — the single source of
 * refunded-insurance truth. Only COLLECTED money is refundable: a deposit that
 * was merely charged (PENDING) or voided has no refundable balance, and
 * voucher/discount value can never appear here because it never reached
 * `amountCents`.
 */
export function refundableInsuranceCents(input: {
  collectionStatus: 'PENDING' | 'COLLECTED' | 'VOIDED';
  amountCents: number;
  refundedCents: number;
}): number {
  if (input.collectionStatus !== 'COLLECTED') return 0;
  return Math.max(0, input.amountCents - Math.max(0, input.refundedCents));
}

// ── Refund method routing ────────────────────────────────────────────────────

export type InsuranceRefundMethod = 'PROVIDER' | 'CASH' | 'INSTAPAY';
export type PaidVia = 'CREDIT_AGRICOLE' | 'CASH' | 'INSTAPAY';

/**
 * The methods a refund may use, derived from the ORIGINAL payment channel —
 * never from client input. Card money goes back to the card (admin-approved
 * gateway refund); desk money goes back over the desk (cash or InstaPay,
 * reception's choice). Cross-channel refunds are structurally impossible.
 */
export function allowedRefundMethods(paidVia: PaidVia): InsuranceRefundMethod[] {
  return paidVia === 'CREDIT_AGRICOLE' ? ['PROVIDER'] : ['CASH', 'INSTAPAY'];
}

export function assertRefundMethodAllowed(
  paidVia: PaidVia,
  method: InsuranceRefundMethod,
): void {
  if (!allowedRefundMethods(paidVia).includes(method)) {
    throw new DomainError(
      'Refund method does not match the original payment channel',
      'insurance_refund_method_mismatch',
      409,
    );
  }
}

/** Initial workflow status for a refund attempt, by method. */
export function initialRefundStatus(
  method: InsuranceRefundMethod,
): 'AWAITING_ADMIN' | 'PENDING_DESK' {
  return method === 'PROVIDER' ? 'AWAITING_ADMIN' : 'PENDING_DESK';
}

// ── Refund workflow state machine ────────────────────────────────────────────

export type InsuranceRefundStatus =
  | 'AWAITING_ADMIN'
  | 'PENDING_DESK'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REJECTED'
  | 'MANUAL_ATTENTION';

const ACTIVE_REFUND_STATUSES: readonly InsuranceRefundStatus[] = [
  'AWAITING_ADMIN',
  'PENDING_DESK',
  'PROCESSING',
];

export function isActiveRefundStatus(status: InsuranceRefundStatus): boolean {
  return ACTIVE_REFUND_STATUSES.includes(status);
}

/**
 * Legal transitions of one refund attempt. Every mutation is additionally an
 * atomic `updateMany` conditioned on the from-state (0 rows ⇒ 409), so this
 * table is the shared truth for both the guard and the tests.
 */
const REFUND_TRANSITIONS: Record<InsuranceRefundStatus, readonly InsuranceRefundStatus[]> = {
  AWAITING_ADMIN: ['PROCESSING', 'REJECTED'],
  PENDING_DESK: ['COMPLETED', 'REJECTED'],
  PROCESSING: ['COMPLETED', 'AWAITING_ADMIN', 'FAILED', 'MANUAL_ATTENTION'],
  MANUAL_ATTENTION: ['AWAITING_ADMIN', 'COMPLETED', 'REJECTED'],
  COMPLETED: [], // immutable — corrections append new rows
  FAILED: ['AWAITING_ADMIN', 'REJECTED'], // retry with a fresh leg, or give up with a note
  REJECTED: [], // terminal for THIS attempt; a re-decision appends a new row
};

/**
 * Every from-state that may legally transition to `to` — the claim lists used
 * by the workflow's conditional `updateMany`s derive from the SAME table the
 * tests pin, so the runtime guards can never drift from the documented machine.
 */
export function refundStatusesAllowing(to: InsuranceRefundStatus): InsuranceRefundStatus[] {
  return (Object.keys(REFUND_TRANSITIONS) as InsuranceRefundStatus[]).filter((from) =>
    REFUND_TRANSITIONS[from].includes(to),
  );
}

export function canTransitionRefund(
  from: InsuranceRefundStatus,
  to: InsuranceRefundStatus,
): boolean {
  return REFUND_TRANSITIONS[from].includes(to);
}

export function assertRefundTransition(
  from: InsuranceRefundStatus,
  to: InsuranceRefundStatus,
): void {
  if (!canTransitionRefund(from, to)) {
    throw new DomainError(
      `Invalid insurance refund transition ${from} → ${to}`,
      'insurance_invalid_transition',
      409,
    );
  }
}

/**
 * Deterministic MPGS refund-leg transaction id for an attempt. Persisted on
 * the row BEFORE the gateway call so a crash-retry re-sends the SAME leg (the
 * gateway is idempotent per (order, transaction id)) and the sweep can match
 * order evidence back to the attempt. The `insref-` prefix also lets the
 * booking-refund sweep exclude insurance legs from its evidence.
 */
export const INSURANCE_REFUND_REF_PREFIX = 'insref-';
export const INSURANCE_DESK_REF_PREFIX = 'INS_DESK:';

export function providerRefundRef(insuranceRefundId: string, attempt: number): string {
  return `${INSURANCE_REFUND_REF_PREFIX}${insuranceRefundId}-${attempt}`;
}

export function deskRefundRef(insuranceRefundId: string): string {
  return `${INSURANCE_DESK_REF_PREFIX}${insuranceRefundId}`;
}

/** True when a gateway/ledger reference belongs to the insurance pool. */
export function isInsuranceRefundRef(ref: string | null | undefined): boolean {
  if (!ref) return false;
  return (
    ref.startsWith(INSURANCE_REFUND_REF_PREFIX) || ref.startsWith(INSURANCE_DESK_REF_PREFIX)
  );
}

// ── Customer-facing state mapping ────────────────────────────────────────────

/**
 * What the CUSTOMER is told about their deposit. Deliberately coarser than the
 * internal machines — the binding rule is "never show a pending refund as
 * completed", so `refunded` requires hard evidence (a COMPLETED payout row).
 */
export type CustomerInsuranceState =
  /// Deposit is part of the payable total; collected when the payment captures.
  | { kind: 'awaiting_capture' }
  /// Held by the resort; returned at reception checkout.
  | { kind: 'collected' }
  /// Staff decided REFUND but no payout has completed yet.
  | { kind: 'refund_pending' }
  /// A payout COMPLETED — money verifiably left (method of the latest payout).
  | { kind: 'refunded'; method: InsuranceRefundMethod; completedAt: Date | null }
  /// Staff decided NO_REFUND — the deposit was kept per policy.
  | { kind: 'retained' };

/**
 * Map the raw insurance row (+ its refund attempts) to the customer-visible
 * state, conservatively. `null` = show nothing (no row callers handle
 * themselves; VOIDED deposits were never collected; a PENDING deposit on a
 * booking that is no longer awaiting payment is transitional/anomalous and
 * must not be presented as money held).
 */
export function customerInsuranceState(input: {
  bookingStatus: 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';
  collectionStatus: 'PENDING' | 'COLLECTED' | 'VOIDED';
  decision: 'UNDECIDED' | 'REFUND' | 'NO_REFUND';
  refunds: readonly {
    status: InsuranceRefundStatus;
    method: InsuranceRefundMethod;
    completedAt: Date | null;
  }[];
}): CustomerInsuranceState | null {
  if (input.collectionStatus === 'VOIDED') return null;
  if (input.collectionStatus === 'PENDING') {
    return input.bookingStatus === 'PENDING_PAYMENT' ? { kind: 'awaiting_capture' } : null;
  }

  // COLLECTED — completed payout evidence outranks the decision flag (an
  // admin correction may have appended a payout after a stale decision).
  const completed = input.refunds
    .filter((r) => r.status === 'COMPLETED')
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))[0];
  if (completed) {
    return { kind: 'refunded', method: completed.method, completedAt: completed.completedAt };
  }
  if (input.decision === 'NO_REFUND') return { kind: 'retained' };
  if (input.decision === 'REFUND') return { kind: 'refund_pending' };
  return { kind: 'collected' };
}

// ── Reporting / ledger split ─────────────────────────────────────────────────

/**
 * Split one invoice's money into the service pool and the deposit pool.
 * `insuranceAmountCents` comes from the 1:1 BookingInsurance row (0 when the
 * booking has none) — NOT from InvoiceLine meta scans. Historical invoices
 * (no insurance, all refunds SERVICE) produce identical numbers to the legacy
 * `netRevenueCents(totalCents, refunds)`.
 */
export function splitInvoiceMoney(input: {
  totalCents: number;
  insuranceAmountCents: number;
  refunds: readonly { amountCents: number; kind: 'SERVICE' | 'INSURANCE' }[];
}): {
  serviceGrossCents: number;
  serviceNetCents: number;
  insuranceRefundedCents: number;
} {
  const insurance = Math.max(0, input.insuranceAmountCents);
  const serviceGrossCents = Math.max(0, input.totalCents - insurance);
  let serviceRefunded = 0;
  let insuranceRefunded = 0;
  for (const r of input.refunds) {
    if (r.kind === 'INSURANCE') insuranceRefunded += r.amountCents;
    else serviceRefunded += r.amountCents;
  }
  return {
    serviceGrossCents,
    serviceNetCents: Math.max(0, serviceGrossCents - serviceRefunded),
    insuranceRefundedCents: insuranceRefunded,
  };
}

// ── Reconciliation anomaly classifier ────────────────────────────────────────

export interface InsuranceAnomalyInput {
  bookingInsuranceId: string;
  collectionStatus: 'PENDING' | 'COLLECTED' | 'VOIDED';
  decision: 'UNDECIDED' | 'REFUND' | 'NO_REFUND';
  amountCents: number;
  refundedCents: number;
  bookingStatus: 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';
  /// Last visit day (inclusive), resort-civil. Null = unknown.
  visitEndedDaysAgo: number | null;
  refunds: readonly {
    status: InsuranceRefundStatus;
    method: InsuranceRefundMethod;
    proofUrl: string | null;
    ageMinutes: number;
  }[];
}

export type InsuranceAnomaly =
  | 'over_refunded'
  | 'pending_on_terminal_booking'
  | 'instapay_completed_without_proof'
  | 'refund_decision_without_attempt'
  | 'stuck_processing'
  | 'stale_desk_payout'
  | 'forgotten_checkout';

/** Pure invariant checks driven by the insurance sweep. */
export function classifyInsuranceAnomalies(
  input: InsuranceAnomalyInput,
  opts: { stuckProcessingMinutes?: number; staleDeskDays?: number; forgottenDays?: number } = {},
): InsuranceAnomaly[] {
  const stuckMin = opts.stuckProcessingMinutes ?? 30;
  const staleDeskMin = (opts.staleDeskDays ?? 7) * 24 * 60;
  const forgottenDays = opts.forgottenDays ?? 2;
  const anomalies: InsuranceAnomaly[] = [];

  if (input.refundedCents > input.amountCents) anomalies.push('over_refunded');

  const terminal = input.bookingStatus !== 'PENDING_PAYMENT' && input.bookingStatus !== 'CONFIRMED';
  if (input.collectionStatus === 'PENDING' && terminal) {
    anomalies.push('pending_on_terminal_booking');
  }

  const hasActiveOrDone = input.refunds.some(
    (r) => isActiveRefundStatus(r.status) || r.status === 'COMPLETED',
  );
  if (input.decision === 'REFUND' && input.collectionStatus === 'COLLECTED' && !hasActiveOrDone) {
    anomalies.push('refund_decision_without_attempt');
  }

  for (const r of input.refunds) {
    if (r.status === 'COMPLETED' && r.method === 'INSTAPAY' && !r.proofUrl) {
      anomalies.push('instapay_completed_without_proof');
    }
    if (r.status === 'PROCESSING' && r.ageMinutes >= stuckMin) {
      anomalies.push('stuck_processing');
    }
    if (r.status === 'PENDING_DESK' && r.ageMinutes >= staleDeskMin) {
      anomalies.push('stale_desk_payout');
    }
  }

  if (
    input.collectionStatus === 'COLLECTED' &&
    input.decision === 'UNDECIDED' &&
    input.visitEndedDaysAgo != null &&
    input.visitEndedDaysAgo >= forgottenDays
  ) {
    anomalies.push('forgotten_checkout');
  }

  return [...new Set(anomalies)];
}

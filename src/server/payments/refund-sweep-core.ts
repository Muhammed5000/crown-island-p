/**
 * Pure decision logic for the stale-REFUND_PENDING sweep (no server-only/Prisma
 * deps, so it is directly unit-testable — mirrors order-status.ts).
 *
 * Why this exists: `adminRefundBooking` atomically claims a payment
 * SUCCEEDED → REFUND_PENDING before calling the gateway (the H2 double-refund
 * guard). Two failure shapes can strand that claim forever:
 *   - the gateway refund fails AND the release-back-to-SUCCEEDED write also
 *     fails (DB hiccup) → stuck REFUND_PENDING, no money moved;
 *   - the gateway refund SUCCEEDS but the process dies before `applyRefundToDb`
 *     commits → stuck REFUND_PENDING, money already returned, no RefundLine.
 * A stuck REFUND_PENDING payment is un-refundable (the claim guard rejects every
 * retry) until a human edits the DB. The sweep resolves it from the gateway's
 * authoritative RETRIEVE_ORDER state; this module decides WHAT the evidence
 * means, the sweep in credit-agricole/reconcile.ts does the I/O.
 *
 * LEDGER-AWARE (docs/INSURANCE.md §6): an MPGS order can carry refund legs that
 * are NOT the stuck service refund — insurance-deposit payouts (`insref-…`) and
 * previously-recorded partial refunds. Evidence extraction therefore excludes
 * every leg already recorded as a RefundLine and every insurance-prefixed leg,
 * and works on the RESIDUAL refunded amount. Without this, a deposit refunded
 * weeks earlier would "finalize" a stuck service refund that never moved money.
 */

import { isInsuranceRefundRef } from '@/server/services/insurance-core';

/** What our own ledger already knows about this order's refunds. */
export interface KnownRefundLedger {
  /** RefundLine.paymobRefundId values already recorded for this invoice (any kind). */
  legIds: readonly string[];
  /** Σ RefundLine.amountCents already recorded for this invoice (any kind). */
  recordedCents: number;
}

/** Refund-relevant facts extracted from an MPGS RETRIEVE_ORDER response. */
export interface MpgsRefundEvidence {
  /** order.status, e.g. CAPTURED | REFUNDED | PARTIALLY_REFUNDED. */
  orderStatus: string;
  /** order.totalRefundedAmount (major units → cents), when present and > 0. */
  totalRefundedCents: number | null;
  /**
   * Transaction id of the first SUCCESSful REFUND leg that is NOT already in
   * our ledger and NOT an insurance leg — i.e. genuinely unaccounted-for money.
   */
  refundLegId: string | null;
  /** that leg's amount in cents, when present. */
  refundLegAmountCents: number | null;
  /**
   * Gateway total refunded minus what our ledger already records (floored at
   * 0). Null when the gateway total is unknown.
   */
  residualRefundedCents: number | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function majorToCents(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * Tolerant parse of an MPGS RETRIEVE_ORDER body. Never throws — garbage input
 * yields empty evidence (which the decision maps to the safe `leave`).
 *
 * MPGS shape (v59): `{ status, totalRefundedAmount, transaction: [ { result,
 * transaction: { id, type, amount } }, … ] }` — refund legs have
 * `transaction.type === 'REFUND'` and per-entry `result === 'SUCCESS'`.
 */
export function extractRefundEvidence(
  order: unknown,
  known?: KnownRefundLedger,
): MpgsRefundEvidence {
  const o = asRecord(order);
  const evidence: MpgsRefundEvidence = {
    orderStatus: typeof o?.status === 'string' ? o.status : '',
    totalRefundedCents: null,
    refundLegId: null,
    refundLegAmountCents: null,
    residualRefundedCents: null,
  };
  if (!o) return evidence;

  const total = majorToCents(o.totalRefundedAmount);
  if (total != null && total > 0) evidence.totalRefundedCents = total;
  if (total != null) {
    evidence.residualRefundedCents = Math.max(0, total - (known?.recordedCents ?? 0));
  }

  const knownIds = new Set(known?.legIds ?? []);
  const legs = Array.isArray(o.transaction) ? o.transaction : [];
  for (const entry of legs) {
    const e = asRecord(entry);
    const txn = asRecord(e?.transaction);
    if (!e || !txn) continue;
    if (txn.type !== 'REFUND' || e.result !== 'SUCCESS') continue;
    if (typeof txn.id !== 'string' || !txn.id) continue;
    // Skip money that is already accounted for: legs our ledger recorded, and
    // insurance-deposit legs (which have their own workflow + ledger rows).
    if (knownIds.has(txn.id) || isInsuranceRefundRef(txn.id)) continue;
    evidence.refundLegId = txn.id;
    evidence.refundLegAmountCents = majorToCents(txn.amount);
    break; // first UNACCOUNTED successful refund leg wins
  }
  return evidence;
}

export type RefundPendingAction =
  /** The gateway HAS the refund — write the DB side-effects (applyRefundToDb). */
  | { kind: 'finalize'; refundId: string; amountCents: number }
  /** Order is still plainly CAPTURED — no refund ever happened; give the claim back. */
  | { kind: 'release' }
  /** Unknown / in-flight / gateway unreachable — try again next tick. */
  | { kind: 'leave' };

/**
 * Decide what to do with a stuck REFUND_PENDING payment given the gateway's
 * order state. Conservative by design: anything ambiguous is `leave` (the sweep
 * runs every reconciler tick, so deferring costs minutes, while a wrong
 * finalize/release moves money state).
 */
export function decideRefundPendingAction(
  evidence: MpgsRefundEvidence | null,
  paymentId: string,
  paymentAmountCents: number,
): RefundPendingAction {
  if (!evidence) return { kind: 'leave' };

  // Genuinely unaccounted-for refund money at the gateway?
  const hasResidualRefund =
    evidence.refundLegId != null ||
    (evidence.residualRefundedCents != null && evidence.residualRefundedCents > 0) ||
    // Legacy shape (no ledger info, no parsable total): a fully REFUNDED order
    // is still decisive on its own.
    (evidence.residualRefundedCents == null &&
      evidence.totalRefundedCents == null &&
      evidence.orderStatus === 'REFUNDED');

  if (hasResidualRefund) {
    return {
      kind: 'finalize',
      // Prefer the gateway's own refund-leg id — for a refund started by
      // `adminRefundBooking` this is the exact id it would have stored, so the
      // unique RefundLine.paymobRefundId idempotency lines up. The fallback is
      // unique-per-payment (same convention as `ALREADY_REFUNDED:${id}`).
      refundId: evidence.refundLegId ?? `SWEPT_REFUND:${paymentId}`,
      amountCents:
        evidence.refundLegAmountCents ??
        evidence.residualRefundedCents ??
        evidence.totalRefundedCents ??
        paymentAmountCents,
    };
  }

  // No refund on the order and the money is still plainly captured → the
  // gateway call never went through; release the claim so admin can retry.
  if (evidence.orderStatus === 'CAPTURED') return { kind: 'release' };

  // The order HAS refunds but every one of them is already in our ledger
  // (residual 0 — e.g. an insurance-deposit leg refunded earlier): the stuck
  // claim's own call never happened — release it for a clean retry.
  if (
    evidence.residualRefundedCents === 0 &&
    (evidence.orderStatus === 'PARTIALLY_REFUNDED' || evidence.orderStatus === 'REFUNDED')
  ) {
    return { kind: 'release' };
  }

  return { kind: 'leave' };
}

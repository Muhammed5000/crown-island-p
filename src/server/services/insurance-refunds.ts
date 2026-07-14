import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { audit, auditStandalone } from '@/server/audit/audit';
import { log, errFields } from '@/lib/log';
import { assertNotLocalNode } from '@/server/sync/node-guard';
import { refundPaymentTransaction } from '@/server/payments/provider';
import { notifyCustomer } from './customer-notifications';
import { validateProofUrl } from './guest-id';
import { DomainError } from './errors';
import {
  assertRefundMethodAllowed,
  deskRefundRef,
  initialRefundStatus,
  providerRefundRef,
  refundStatusesAllowing,
  refundableInsuranceCents,
  type InsuranceRefundMethod,
  type PaidVia,
} from './insurance-core';

/**
 * Insurance-deposit checkout decisions + refund workflow (docs/INSURANCE.md §5).
 *
 * Deliberately SEPARATE from `applyRefundToDb`: that primitive cancels
 * bookings, releases capacity, reactivates sanctions and un-burns promos — all
 * wrong for a deposit return on a booking that stays CONFIRMED. Insurance
 * payouts write `RefundLine(kind = INSURANCE)` rows (the shared money-out
 * ledger) through `applyInsuranceRefund` below, and never touch
 * `Payment.status` / the `REFUND_PENDING` claim (that claim belongs to the
 * booking-refund machine; reusing it would poison the refund-pending sweep).
 *
 * Concurrency model: every transition is an atomic conditional `updateMany`
 * (0 rows ⇒ typed 409), and the DB backs it with a partial unique index
 * allowing at most one ACTIVE refund row per deposit.
 */

type Tx = Prisma.TransactionClient;

/** Σ RefundLine(kind=INSURANCE) — the single source of refunded-deposit truth. */
async function insuranceRefundedCents(tx: Tx, invoiceId: string): Promise<number> {
  const agg = await tx.refundLine.aggregate({
    where: { invoiceId, kind: 'INSURANCE' },
    _sum: { amountCents: true },
  });
  return agg._sum.amountCents ?? 0;
}

async function loadInsuranceForBooking(tx: Tx, bookingId: string) {
  const insurance = await tx.bookingInsurance.findUnique({
    where: { bookingId },
    include: {
      booking: {
        select: {
          id: true,
          reference: true,
          userId: true,
          status: true,
          createdByStaffId: true,
          invoice: { select: { id: true } },
        },
      },
      refunds: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!insurance) {
    throw new DomainError('This booking has no insurance deposit', 'insurance_not_found', 404);
  }
  if (!insurance.booking.invoice) {
    throw new DomainError('Booking has no invoice', 'insurance_not_found', 404);
  }
  return insurance;
}

// ── Checkout decision ─────────────────────────────────────────────────────────

export interface RecordDecisionInput {
  bookingId: string;
  staffId: string;
  decision: 'REFUND' | 'NO_REFUND';
  /** Mandatory when decision = NO_REFUND. Stored + audited. */
  reason?: string;
}

export interface RecordDecisionResult {
  decision: 'REFUND' | 'NO_REFUND';
  /** Present when a refund attempt was opened. */
  refund: {
    id: string;
    method: InsuranceRefundMethod;
    status: 'AWAITING_ADMIN' | 'PENDING_DESK';
    amountCents: number;
  } | null;
}

/**
 * Reception checkout decision: REFUND opens exactly one refund attempt
 * (method routed from the ORIGINAL payment channel, never client input);
 * NO_REFUND retains the deposit with a mandatory reason. The UNDECIDED-
 * conditioned claim makes duplicate submissions and desk/admin races lose
 * cleanly with a 409.
 */
export async function recordInsuranceDecision(
  input: RecordDecisionInput,
): Promise<RecordDecisionResult> {
  assertNotLocalNode('insurance checkout decision');
  const reason = input.reason?.trim() || null;
  if (input.decision === 'NO_REFUND' && !reason) {
    throw new DomainError(
      'A reason is required when the deposit is not refunded',
      'insurance_reason_required',
      400,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const insurance = await loadInsuranceForBooking(tx, input.bookingId);
    if (insurance.collectionStatus !== 'COLLECTED') {
      throw new DomainError(
        'Deposit was never collected — nothing to decide',
        'insurance_not_collected',
        409,
      );
    }

    // Atomic decision claim — the primary duplicate/race gate.
    const claim = await tx.bookingInsurance.updateMany({
      where: { id: insurance.id, decision: 'UNDECIDED' },
      data: {
        decision: input.decision,
        decidedAt: new Date(),
        decidedById: input.staffId,
        noRefundReason: input.decision === 'NO_REFUND' ? reason : null,
      },
    });
    if (claim.count === 0) {
      throw new DomainError('Deposit decision already recorded', 'insurance_already_decided', 409);
    }

    let refund: RecordDecisionResult['refund'] = null;
    if (input.decision === 'REFUND') {
      refund = await openRefundAttempt(tx, {
        insurance,
        requestedById: input.staffId,
        invoiceId: insurance.booking.invoice!.id,
      });
    }

    await audit(tx, {
      actorUserId: input.staffId,
      action: 'STATUS_CHANGE',
      entityType: 'BookingInsurance',
      entityId: insurance.id,
      before: { decision: 'UNDECIDED' },
      after: {
        decision: input.decision,
        reason,
        refundId: refund?.id ?? null,
        method: refund?.method ?? null,
        amountCents: refund?.amountCents ?? null,
        bookingId: input.bookingId,
      },
    });

    return { decision: input.decision, refund, customerId: insurance.booking.userId, reference: insurance.booking.reference, staffOwned: !!insurance.booking.createdByStaffId };
  });

  // Customer notification AFTER the tx (never throws). Walk-in bookings belong
  // to the staff account — never notify those.
  if (!result.staffOwned) {
    if (result.decision === 'REFUND' && result.refund) {
      await notifyCustomer({
        userId: result.customerId,
        kind: 'insurance_refund_started',
        titleEn: 'Deposit refund started',
        titleAr: 'بدأ استرداد مبلغ التأمين',
        bodyEn: `Your deposit refund for booking ${result.reference} is being processed.`,
        bodyAr: `جارٍ معالجة استرداد مبلغ التأمين لحجز ${result.reference}.`,
        url: '/booking/history',
      });
    } else if (result.decision === 'NO_REFUND') {
      await notifyCustomer({
        userId: result.customerId,
        kind: 'insurance_retained',
        titleEn: 'Deposit decision recorded',
        titleAr: 'تم تسجيل قرار مبلغ التأمين',
        bodyEn: `The deposit for booking ${result.reference} was retained. Please contact reception for details.`,
        bodyAr: `تم الاحتفاظ بمبلغ التأمين لحجز ${result.reference}. يرجى التواصل مع الاستقبال للتفاصيل.`,
        url: '/booking/history',
      });
    }
  }

  return { decision: result.decision, refund: result.refund };
}

/**
 * Create the single refund attempt for a REFUND decision. Caller must hold the
 * decision claim (or the cancellation path's equivalent). The partial unique
 * index on active rows is the DB backstop against a duplicate attempt.
 */
async function openRefundAttempt(
  tx: Tx,
  args: {
    insurance: { id: string; amountCents: number; collectionStatus: string; paidVia: string | null };
    invoiceId: string;
    requestedById: string;
  },
): Promise<NonNullable<RecordDecisionResult['refund']>> {
  const paidVia = args.insurance.paidVia;
  if (!paidVia) {
    throw new DomainError('Deposit has no payment channel snapshot', 'insurance_not_collected', 409);
  }
  const refunded = await insuranceRefundedCents(tx, args.invoiceId);
  const refundable = refundableInsuranceCents({
    collectionStatus: args.insurance.collectionStatus as 'PENDING' | 'COLLECTED' | 'VOIDED',
    amountCents: args.insurance.amountCents,
    refundedCents: refunded,
  });
  if (refundable <= 0) {
    throw new DomainError('Deposit already fully refunded', 'insurance_nothing_refundable', 409);
  }

  // Method routed from the ORIGINAL payment channel — card money goes back to
  // the card (admin-approved), desk money over the desk. For desk money the
  // row starts as CASH; the desk chooses CASH vs InstaPay at execution time
  // (both are legal for the channel; the executor re-validates).
  const method: InsuranceRefundMethod = paidVia === 'CREDIT_AGRICOLE' ? 'PROVIDER' : 'CASH';
  const status = initialRefundStatus(method);

  const row = await tx.insuranceRefund.create({
    data: {
      bookingInsuranceId: args.insurance.id,
      method,
      status,
      amountCents: refundable,
      requestedById: args.requestedById,
    },
  });
  return { id: row.id, method, status, amountCents: refundable };
}

/**
 * Auto-open the deposit-return workflow when a booking is cancel-refunded while
 * its COLLECTED deposit is still UNDECIDED — the guest never visits, so the
 * deposit goes back through its NORMAL flow (admin approval / desk payout),
 * never auto-executed here (no second gateway call inside a cancel action, no
 * fabricated desk payouts). Runs inside the caller's transaction; a lost claim
 * (already decided / already active) is a silent no-op.
 */
export async function openInsuranceRefundOnCancellation(
  tx: Tx,
  args: { bookingId: string; actorUserId: string | null },
): Promise<void> {
  const insurance = await tx.bookingInsurance.findUnique({
    where: { bookingId: args.bookingId },
    include: { booking: { select: { invoice: { select: { id: true } } } } },
  });
  if (!insurance || insurance.collectionStatus !== 'COLLECTED' || !insurance.booking.invoice) {
    return;
  }
  const actor = args.actorUserId ?? insurance.decidedById ?? 'system';

  const claim = await tx.bookingInsurance.updateMany({
    where: { id: insurance.id, decision: 'UNDECIDED' },
    data: { decision: 'REFUND', decidedAt: new Date(), decidedById: args.actorUserId },
  });
  if (claim.count === 0) return; // already decided — nothing to open

  try {
    const refund = await openRefundAttempt(tx, {
      insurance,
      invoiceId: insurance.booking.invoice.id,
      requestedById: actor,
    });
    await audit(tx, {
      actorUserId: args.actorUserId,
      action: 'STATUS_CHANGE',
      entityType: 'BookingInsurance',
      entityId: insurance.id,
      before: { decision: 'UNDECIDED' },
      after: {
        decision: 'REFUND',
        cause: 'booking_cancelled',
        refundId: refund.id,
        method: refund.method,
        amountCents: refund.amountCents,
      },
    });
  } catch (err) {
    if (err instanceof DomainError && err.code === 'insurance_nothing_refundable') return;
    throw err;
  }
}

// ── Desk execution (CASH / INSTAPAY) ─────────────────────────────────────────

export interface ExecuteDeskRefundInput {
  insuranceRefundId: string;
  staffId: string;
  method: 'CASH' | 'INSTAPAY';
  /** Mandatory InstaPay payout proof (/api/secure-media URL from the reception upload). */
  proofUrl?: string;
}

/**
 * Desk payout of a PENDING_DESK attempt. CASH requires the staff confirmation
 * (this call IS it); INSTAPAY additionally requires a validated proof image —
 * the completion and the proof are one atomic transaction, so the workflow can
 * never read "refunded" without its evidence.
 */
export async function executeDeskInsuranceRefund(input: ExecuteDeskRefundInput): Promise<void> {
  assertNotLocalNode('insurance desk refund');

  // Validate the proof BEFORE the transaction (touches disk).
  let proofUrl: string | null = null;
  if (input.method === 'INSTAPAY') {
    if (!input.proofUrl) {
      throw new DomainError(
        'An InstaPay transfer proof image is required',
        'insurance_proof_required',
        400,
      );
    }
    proofUrl = await validateProofUrl(input.proofUrl);
  }

  const done = await prisma.$transaction(async (tx) => {
    const row = await tx.insuranceRefund.findUnique({
      where: { id: input.insuranceRefundId },
      include: {
        bookingInsurance: {
          include: {
            booking: {
              select: {
                id: true,
                reference: true,
                userId: true,
                createdByStaffId: true,
                invoice: { select: { id: true } },
              },
            },
          },
        },
      },
    });
    if (!row) throw new DomainError('Refund not found', 'not_found', 404);
    const insurance = row.bookingInsurance;
    const invoiceId = insurance.booking.invoice?.id;
    if (!invoiceId) throw new DomainError('Booking has no invoice', 'insurance_not_found', 404);

    // Server-side channel check — desk methods only for desk-collected money.
    // Any non-card channel normalizes to the desk pool (CASH semantics).
    const channel: PaidVia = insurance.paidVia === 'CREDIT_AGRICOLE' ? 'CREDIT_AGRICOLE' : 'CASH';
    assertRefundMethodAllowed(channel, input.method);

    // Belt-and-braces over-refund guard inside the tx.
    const refunded = await insuranceRefundedCents(tx, invoiceId);
    if (refunded + row.amountCents > insurance.amountCents) {
      throw new DomainError('Refund exceeds the collected deposit', 'insurance_over_refund', 409);
    }

    // Atomic claim PENDING_DESK → COMPLETED (+ the executed method & proof).
    const claim = await tx.insuranceRefund.updateMany({
      where: { id: row.id, status: 'PENDING_DESK' },
      data: {
        status: 'COMPLETED',
        method: input.method,
        proofUrl,
        completedAt: new Date(),
      },
    });
    if (claim.count === 0) {
      throw new DomainError('Refund already processed', 'insurance_already_processed', 409);
    }

    // Ledger truth — unique desk marker makes any replay a no-op at the DB.
    await tx.refundLine.create({
      data: {
        invoiceId,
        amountCents: row.amountCents,
        kind: 'INSURANCE',
        reason: `insurance_desk_refund:${input.method.toLowerCase()}`,
        paymobRefundId: deskRefundRef(row.id),
      },
    });

    await audit(tx, {
      actorUserId: input.staffId,
      action: 'REFUND',
      entityType: 'InsuranceRefund',
      entityId: row.id,
      after: {
        bookingId: insurance.booking.id,
        method: input.method,
        amountCents: row.amountCents,
        proofUrl,
        cause: 'insurance_desk_payout',
      },
    });

    return {
      customerId: insurance.booking.userId,
      reference: insurance.booking.reference,
      staffOwned: !!insurance.booking.createdByStaffId,
      amountCents: row.amountCents,
    };
  });

  if (!done.staffOwned) {
    await notifyCustomer({
      userId: done.customerId,
      kind: 'insurance_refunded',
      titleEn: 'Deposit refunded',
      titleAr: 'تم استرداد مبلغ التأمين',
      bodyEn: `Your deposit for booking ${done.reference} has been refunded.`,
      bodyAr: `تم استرداد مبلغ التأمين لحجز ${done.reference}.`,
      url: '/booking/history',
    });
  }
}

// ── Admin approval (PROVIDER / original card) ────────────────────────────────

/**
 * Approve + execute a card-deposit refund through the gateway.
 *
 * Protocol (docs/INSURANCE.md §5):
 *  1. Atomic claim AWAITING_ADMIN → PROCESSING (+approvedById) — two admins
 *     race, the loser 409s and never reaches the gateway.
 *  2. Headroom check: Σ RefundLine(all kinds) + amount ≤ payment.amountCents.
 *  3. Persist the DETERMINISTIC leg id (insref-{rowId}-{attempt}) BEFORE the
 *     gateway call, then send it: a crash-retry re-sends the SAME leg and the
 *     gateway replays the outcome instead of paying twice.
 *  4. Success → finalize tx (RefundLine kind=INSURANCE + COMPLETED).
 *     Explicit gateway rejection → FAILED (attempt++ on the next retry).
 *     Transport/timeout → stays PROCESSING; the insurance sweep resolves it
 *     from RETRIEVE_ORDER leg evidence (never from error text).
 *
 * `Payment.status` is NEVER touched: the REFUND_PENDING claim belongs to the
 * booking-refund machine, and a fully service-refunded payment (REFUNDED) may
 * still hold a captured deposit — so SUCCEEDED and REFUNDED both qualify.
 */
export async function approveInsuranceRefund(input: {
  insuranceRefundId: string;
  adminUserId: string;
}): Promise<{ status: 'COMPLETED' | 'FAILED' }> {
  assertNotLocalNode('insurance refund approval');

  const row = await prisma.insuranceRefund.findUnique({
    where: { id: input.insuranceRefundId },
    include: {
      bookingInsurance: {
        include: {
          booking: {
            select: {
              id: true,
              reference: true,
              userId: true,
              createdByStaffId: true,
              invoice: { select: { id: true } },
              payments: {
                where: {
                  provider: 'CREDIT_AGRICOLE',
                  paymobOrderId: { not: null },
                  paidAt: { not: null },
                },
                orderBy: { paidAt: 'desc' },
                take: 1,
              },
            },
          },
        },
      },
    },
  });
  if (!row) throw new DomainError('Refund not found', 'not_found', 404);
  if (row.method !== 'PROVIDER') {
    throw new DomainError('Not a gateway refund', 'insurance_refund_method_mismatch', 409);
  }
  const insurance = row.bookingInsurance;
  const invoiceId = insurance.booking.invoice?.id;
  const payment = insurance.booking.payments[0];
  if (!invoiceId || !payment?.paymobOrderId) {
    throw new DomainError('No captured card payment to refund', 'no_refundable_payment', 409);
  }

  // Headroom: the deposit leg + everything already refunded (BOTH pools) can
  // never exceed what the card actually captured.
  const allRefunded =
    (
      await prisma.refundLine.aggregate({
        where: { invoiceId },
        _sum: { amountCents: true },
      })
    )._sum.amountCents ?? 0;
  if (allRefunded + row.amountCents > payment.amountCents) {
    await prisma.insuranceRefund.updateMany({
      where: { id: row.id, status: 'AWAITING_ADMIN' },
      data: {
        status: 'MANUAL_ATTENTION',
        failureMessage: `headroom_exceeded: refunded ${allRefunded} + deposit ${row.amountCents} > captured ${payment.amountCents}`,
      },
    });
    throw new DomainError(
      'Refund would exceed the captured amount — flagged for review',
      'insurance_over_refund',
      409,
    );
  }

  // 1+3. Claim AND persist the deterministic leg id in one atomic write.
  const legId = providerRefundRef(row.id, row.attempt);
  const claim = await prisma.insuranceRefund.updateMany({
    where: { id: row.id, status: 'AWAITING_ADMIN' },
    data: { status: 'PROCESSING', approvedById: input.adminUserId, providerRefundRef: legId },
  });
  if (claim.count === 0) {
    throw new DomainError('Refund already being processed', 'insurance_already_processed', 409);
  }

  try {
    await refundPaymentTransaction({
      provider: payment.provider,
      providerOrderId: payment.paymobOrderId,
      providerTransactionId: payment.paymobTransactionId ?? '',
      amountCents: row.amountCents,
      paymentId: payment.id,
      refundTransactionId: legId,
    });
  } catch (err) {
    if (err instanceof DomainError && err.code === 'mpgs_refund_rejected') {
      // Explicit gateway FAILURE result: this leg id is burned (the gateway
      // replays the failure forever) — bump the attempt so a retry sends a
      // fresh leg, and surface as retryable FAILED.
      await prisma.insuranceRefund.updateMany({
        where: { id: row.id, status: 'PROCESSING' },
        data: {
          status: 'FAILED',
          failureMessage: err.message,
          attempt: { increment: 1 },
          providerRefundRef: null,
        },
      });
      return { status: 'FAILED' };
    }
    if (err instanceof DomainError && err.code === 'credit_agricole_already_refunded') {
      // NEVER trust error text as proof of completion — the sweep verifies by
      // RETRIEVE_ORDER leg evidence and finalizes/flags from there.
      await prisma.insuranceRefund.updateMany({
        where: { id: row.id, status: 'PROCESSING' },
        data: { status: 'MANUAL_ATTENTION', failureMessage: 'gateway_reports_already_refunded' },
      });
      throw new DomainError(
        'Gateway reports no refundable balance — flagged for review',
        'insurance_over_refund',
        409,
      );
    }
    // Transport/timeout/unknown: the leg MAY exist at the gateway. Leave the
    // row PROCESSING (same leg id) — the insurance sweep resolves it from
    // order evidence; an admin retry would re-send the SAME idempotent leg.
    log.error('InsuranceRefund gateway call failed — row stays PROCESSING for the sweep', {
      insuranceRefundId: row.id,
      legId,
      ...errFields(err),
    });
    throw err;
  }

  // 4. Finalize — ledger + COMPLETED in one tx.
  const finalized = await finalizeProviderInsuranceRefund(row.id, legId, {
    invoiceId,
    amountCents: row.amountCents,
    actorUserId: input.adminUserId,
  });

  if (finalized && !insurance.booking.createdByStaffId) {
    await notifyCustomer({
      userId: insurance.booking.userId,
      kind: 'insurance_refunded',
      titleEn: 'Deposit refunded to your card',
      titleAr: 'تم استرداد مبلغ التأمين إلى بطاقتك',
      bodyEn: `Your deposit for booking ${insurance.booking.reference} was refunded to your original card. Banks may take a few days to post it.`,
      bodyAr: `تم استرداد مبلغ التأمين لحجز ${insurance.booking.reference} إلى بطاقتك الأصلية. قد يستغرق ظهوره في البنك عدة أيام.`,
      url: '/booking/history',
    });
  }
  return { status: 'COMPLETED' };
}

/**
 * Shared finalizer: write the INSURANCE RefundLine + flip PROCESSING →
 * COMPLETED. Idempotent by the unique leg id (a replay / concurrent sweep
 * finalize is a no-op). Used by the approve path and the insurance sweep.
 */
export async function finalizeProviderInsuranceRefund(
  insuranceRefundId: string,
  legId: string,
  args: { invoiceId: string; amountCents: number; actorUserId: string | null },
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.refundLine.findUnique({ where: { paymobRefundId: legId } });
    if (!existing) {
      await tx.refundLine.create({
        data: {
          invoiceId: args.invoiceId,
          amountCents: args.amountCents,
          kind: 'INSURANCE',
          reason: 'insurance_provider_refund',
          paymobRefundId: legId,
        },
      });
    }
    const flip = await tx.insuranceRefund.updateMany({
      where: { id: insuranceRefundId, status: { in: ['PROCESSING', 'MANUAL_ATTENTION'] } },
      data: { status: 'COMPLETED', completedAt: new Date(), failureMessage: null },
    });
    if (flip.count > 0) {
      await audit(tx, {
        actorUserId: args.actorUserId,
        action: 'REFUND',
        entityType: 'InsuranceRefund',
        entityId: insuranceRefundId,
        after: { legId, amountCents: args.amountCents, cause: 'insurance_provider_refund' },
      });
    }
    return flip.count > 0 || !existing;
  });
}

// ── Admin reject / retry / correction ────────────────────────────────────────

/**
 * Reject an attempt (admin, note required). The decision reverts to UNDECIDED
 * so reception/admin can re-decide — the rejected row stays as history.
 */
export async function rejectInsuranceRefund(input: {
  insuranceRefundId: string;
  adminUserId: string;
  note: string;
}): Promise<void> {
  assertNotLocalNode('insurance refund rejection');
  const note = input.note?.trim();
  if (!note) throw new DomainError('A note is required to reject', 'insurance_reason_required', 400);

  await prisma.$transaction(async (tx) => {
    const row = await tx.insuranceRefund.findUnique({
      where: { id: input.insuranceRefundId },
      select: { id: true, status: true, bookingInsuranceId: true },
    });
    if (!row) throw new DomainError('Refund not found', 'not_found', 404);
    const claim = await tx.insuranceRefund.updateMany({
      // Derived from the state-machine table (PROCESSING is not rejectable —
      // a leg may be in flight at the gateway; the sweep must resolve it first).
      where: { id: row.id, status: { in: refundStatusesAllowing('REJECTED') } },
      data: { status: 'REJECTED', failureMessage: note },
    });
    if (claim.count === 0) {
      throw new DomainError('Refund cannot be rejected in its current state', 'insurance_already_processed', 409);
    }
    // Re-open the decision (append-only correction — the rejected attempt and
    // the original decision stay in history/audit).
    await tx.bookingInsurance.updateMany({
      where: { id: row.bookingInsuranceId, decision: 'REFUND' },
      data: { decision: 'UNDECIDED', decidedAt: null, decidedById: null },
    });
    await audit(tx, {
      actorUserId: input.adminUserId,
      action: 'STATUS_CHANGE',
      entityType: 'InsuranceRefund',
      entityId: row.id,
      before: { status: row.status },
      after: { status: 'REJECTED', note },
    });
  });
}

/** Requeue a FAILED gateway attempt (admin). The next approve sends a fresh leg. */
export async function retryInsuranceRefund(input: {
  insuranceRefundId: string;
  adminUserId: string;
}): Promise<void> {
  assertNotLocalNode('insurance refund retry');
  const claim = await prisma.insuranceRefund.updateMany({
    where: { id: input.insuranceRefundId, status: { in: ['FAILED', 'MANUAL_ATTENTION'] } },
    data: { status: 'AWAITING_ADMIN', failureMessage: null },
  });
  if (claim.count === 0) {
    throw new DomainError('Refund is not retryable in its current state', 'insurance_already_processed', 409);
  }
  await auditStandalone({
    actorUserId: input.adminUserId,
    action: 'STATUS_CHANGE',
    entityType: 'InsuranceRefund',
    entityId: input.insuranceRefundId,
    after: { status: 'AWAITING_ADMIN', cause: 'admin_retry' },
  });
}

/**
 * Admin-only correction: NO_REFUND → REFUND (e.g. the guest successfully
 * disputed the retention). Guarded by "no completed payout exists"; appends a
 * fresh attempt through the normal claim.
 */
export async function reopenInsuranceDecision(input: {
  bookingId: string;
  adminUserId: string;
  reason: string;
}): Promise<void> {
  assertNotLocalNode('insurance decision correction');
  const reason = input.reason?.trim();
  if (!reason) throw new DomainError('A reason is required', 'insurance_reason_required', 400);

  await prisma.$transaction(async (tx) => {
    const insurance = await loadInsuranceForBooking(tx, input.bookingId);
    const hasCompleted = insurance.refunds.some((r) => r.status === 'COMPLETED');
    const hasActive = insurance.refunds.some((r) =>
      ['AWAITING_ADMIN', 'PENDING_DESK', 'PROCESSING'].includes(r.status),
    );
    if (hasCompleted || hasActive) {
      throw new DomainError(
        'Deposit already has a completed or active refund',
        'insurance_already_processed',
        409,
      );
    }
    const claim = await tx.bookingInsurance.updateMany({
      where: { id: insurance.id, decision: 'NO_REFUND' },
      data: { decision: 'UNDECIDED', decidedAt: null, decidedById: null },
    });
    if (claim.count === 0) {
      throw new DomainError('Decision is not NO_REFUND', 'insurance_already_decided', 409);
    }
    await audit(tx, {
      actorUserId: input.adminUserId,
      action: 'STATUS_CHANGE',
      entityType: 'BookingInsurance',
      entityId: insurance.id,
      before: { decision: 'NO_REFUND', noRefundReason: insurance.noRefundReason },
      after: { decision: 'UNDECIDED', cause: 'admin_correction', reason },
    });
  });
}

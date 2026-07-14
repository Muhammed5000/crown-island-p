import 'server-only';
import type { BookingStatus, Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { refundPaymentTransaction } from '@/server/payments/provider';
import { audit } from '@/server/audit/audit';
import { DomainError } from './errors';
import { applyRefundToDb } from './refunds';
import { releaseBookingSlotCapacity } from './capacity-cost';
import { releaseSanctionsForBooking } from './sanctions';
import { sendRefundNoticeEmail } from '@/server/email/booking-emails';
import { getRefundTiers } from '@/server/settings/settings';
import { computeTieredRefund, refundableBaseCents } from '@/lib/refund-policy';
import { log, errFields } from '@/lib/log';
import { paymentStatusAfterRefund } from './refund-application-core';
import { openInsuranceRefundOnCancellation } from './insurance-refunds';

/**
 * Admin-side booking queries + mutations.
 *
 * Listings here are NOT filtered by ownership — admins see everything. Every
 * write goes through a Prisma transaction that also writes an `AuditLog` row.
 */

export interface AdminBookingsQuery {
  q?: string;
  status?: BookingStatus;
  page?: number;
  pageSize?: number;
}

export async function adminListBookings(input: AdminBookingsQuery = {}) {
  const where: Prisma.BookingWhereInput = {};
  if (input.status) where.status = input.status;
  if (input.q) {
    // Postgres `LIKE` is case-sensitive, so opt into case-insensitive matching
    // explicitly (SQLite's LIKE was case-insensitive for ASCII by default).
    where.OR = [
      { reference: { contains: input.q, mode: 'insensitive' } },
      { user: { name: { contains: input.q, mode: 'insensitive' } } },
      { user: { email: { contains: input.q, mode: 'insensitive' } } },
      { user: { phone: { contains: input.q, mode: 'insensitive' } } },
      { guestName: { contains: input.q, mode: 'insensitive' } },
      { guestPhone: { contains: input.q, mode: 'insensitive' } },
    ];
  }

  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.max(1, input.pageSize ?? 20);

  const [total, items] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      include: {
        user: { select: { name: true, email: true, phone: true } },
        // The list renders only the service name + invoice total — a full
        // `category` include would drag the long-form copy/gallery JSON of the
        // category into every row of every page view.
        service: { select: { nameEn: true, nameAr: true } },
        invoice: { select: { totalCents: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function adminGetBooking(id: string) {
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      user: { include: { profile: true } },
      service: { include: { category: true } },
      invoice: { include: { lines: true, refunds: true } },
      payments: { orderBy: { createdAt: 'desc' } },
      units: { include: { place: true }, orderBy: [{ unitIndex: 'asc' }, { date: 'asc' }] },
      guestIds: { orderBy: { guestSeq: 'asc' } },
    },
  });
  if (!booking) return null;

  // Resolve the staff scalars (plain FK ids, no relation): the reception
  // operator physically at the desk and, for a manual-discount booking, the
  // supervisor who authorized it.
  const staffIds = [booking.enteredByStaffId, booking.discountAuthorizedById].filter(
    (v): v is string => !!v,
  );
  const staff = staffIds.length
    ? await prisma.user.findMany({
        where: { id: { in: staffIds } },
        select: { id: true, name: true, email: true, role: true },
      })
    : [];
  const byId = new Map(staff.map((s) => [s.id, s]));

  return {
    ...booking,
    receptionStaff: booking.enteredByStaffId ? byId.get(booking.enteredByStaffId) ?? null : null,
    discountAuthorizer: booking.discountAuthorizedById
      ? byId.get(booking.discountAuthorizedById) ?? null
      : null,
  };
}

/**
 * Cancel a CONFIRMED booking and refund the guest per the tiered, time-based
 * refund policy (src/lib/refund-policy.ts).
 *
 * The refund amount defaults to the tier that applies to how far ahead of the
 * visit day the cancellation happens, capped at whatever is still refundable
 * (never over-refunds an already-partly-refunded invoice). Staff may pass
 * `overrideAmountCents` to deviate (goodwill / weather / dispute) — that path
 * REQUIRES a reason and is fully audited.
 *
 * Two outcomes:
 *  - amount > 0 → reverse money through the shared `applyRefundToDb` primitive
 *    (partial or full), which marks the payment REFUNDED, records a RefundLine,
 *    cancels the booking, releases capacity + place, reactivates sanctions, and
 *    un-burns any promo. Gateway payments (PAYMOB / CREDIT_AGRICOLE) also call
 *    the provider refund API for the SAME amount.
 *  - amount == 0 → cancel WITHOUT returning money: release the physical holds
 *    (capacity + place) but keep the payment SUCCEEDED — the withheld total is a
 *    cancellation penalty, not a refund, so there is no RefundLine and sanctions
 *    / promo stay settled.
 */
export async function adminRefundBooking(input: {
  bookingId: string;
  adminUserId: string;
  reason?: string;
  /** Explicit amount to refund, overriding the policy tier. Requires a reason. */
  overrideAmountCents?: number;
}): Promise<{ refundId: string | null; refundedCents: number }> {
  const booking = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    include: {
      payments: { where: { status: 'SUCCEEDED' }, orderBy: { paidAt: 'desc' }, take: 1 },
      invoice: { select: { id: true, totalCents: true } },
      service: { select: { kind: true } },
    },
  });
  if (!booking) throw new DomainError('not_found', 'not_found', 404);
  const payment = booking.payments[0];
  if (!payment) {
    throw new DomainError('no_refundable_payment', 'no_refundable_payment', 409);
  }

  const totalCents = booking.invoice?.totalCents ?? payment.amountCents;

  // Net out anything already refunded on this invoice — BOTH pools — so the
  // payment-level cap can never exceed what the card/desk actually took
  // (guards a second partial refund, webhooks, and a prior deposit payout).
  const alreadyRefunded = booking.invoice
    ? (
        await prisma.refundLine.aggregate({
          where: { invoiceId: booking.invoice.id },
          _sum: { amountCents: true },
        })
      )._sum.amountCents ?? 0
    : 0;
  const remaining = Math.max(0, totalCents - alreadyRefunded);

  // Settled fines (SANCTION invoice lines) are RETAINED on cancellation — the tier
  // percentage applies to the service charge only, never to a paid penalty.
  const sanctionCents = booking.invoice
    ? (
        await prisma.invoiceLine.aggregate({
          where: { invoiceId: booking.invoice.id, meta: { path: ['kind'], equals: 'SANCTION' } },
          _sum: { totalCents: true },
        })
      )._sum.totalCents ?? 0
    : 0;

  // The insurance deposit is likewise OUTSIDE the tier: it returns in full via
  // its own workflow (opened below on cancellation), so the tiered service
  // refund excludes it exactly like sanctions, and the SERVICE remaining cap
  // subtracts only SERVICE-pool refund lines. docs/INSURANCE.md §6.
  const collectedInsurance = await prisma.bookingInsurance.findUnique({
    where: { bookingId: booking.id },
    select: { amountCents: true, collectionStatus: true },
  });
  const insuranceCents =
    collectedInsurance?.collectionStatus === 'COLLECTED' ? collectedInsurance.amountCents : 0;
  const serviceRefunded = booking.invoice
    ? (
        await prisma.refundLine.aggregate({
          where: { invoiceId: booking.invoice.id, kind: 'SERVICE' },
          _sum: { amountCents: true },
        })
      )._sum.amountCents ?? 0
    : 0;
  const serviceRemaining = Math.max(0, Math.max(0, totalCents - insuranceCents) - serviceRefunded);

  // Policy tier from the VISIT date (first day), on the service-only base, capped at
  // what's still owed in the SERVICE pool and at the payment-level remainder.
  const tiers = await getRefundTiers();
  const eligible = computeTieredRefund({
    bookingDate: booking.bookingDate,
    totalCents: refundableBaseCents(totalCents, sanctionCents + insuranceCents),
    tiers,
  });
  const requested = input.overrideAmountCents ?? eligible.refundCents;
  const amount = Math.min(Math.max(0, Math.round(requested)), serviceRemaining, remaining);

  // Deviating from the policy amount is a deliberate act — demand a reason.
  const isOverride = input.overrideAmountCents != null && amount !== eligible.refundCents;
  if (isOverride && !input.reason?.trim()) {
    throw new DomainError('refund_reason_required', 'refund_reason_required', 400);
  }

  // ── 0% (or nothing left to refund): cancel and KEEP the money ──────────────
  if (amount <= 0) {
    const result = await prisma.$transaction(async (tx) => {
      // Re-read status inside the tx so we don't double-cancel / race a webhook.
      const fresh = await tx.booking.findUnique({
        where: { id: booking.id },
        select: { status: true },
      });
      if (
        !fresh ||
        fresh.status === 'CANCELLED' ||
        fresh.status === 'EXPIRED' ||
        fresh.status === 'FAILED'
      ) {
        return { cancelled: false as const };
      }
      // Free the physical holds only if capacity was actually reserved.
      if (fresh.status === 'CONFIRMED') {
        await releaseBookingSlotCapacity(tx, booking);
        await tx.bookingUnit.updateMany({
          where: { bookingId: booking.id, placeId: { not: null } },
          data: { placeId: null, assignedById: null, assignedAt: null },
        });
      }
      await tx.booking.update({
        where: { id: booking.id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      // The 0% tier keeps the SERVICE money — but the deposit is damage
      // insurance for a visit that will never happen, so its return workflow
      // opens through the normal approval/desk flow (never auto-executed).
      await openInsuranceRefundOnCancellation(tx, {
        bookingId: booking.id,
        actorUserId: input.adminUserId,
      });
      await audit(tx, {
        actorUserId: input.adminUserId,
        action: 'STATUS_CHANGE',
        entityType: 'Booking',
        entityId: booking.id,
        before: { status: fresh.status },
        after: {
          status: 'CANCELLED',
          cause: 'admin_cancel_no_refund',
          eligiblePercent: eligible.percent,
          refundedCents: 0,
          keptCents: remaining,
          reason: input.reason ?? null,
        },
      });
      return { cancelled: true as const };
    });

    if (result.cancelled) {
      // Revoke physical (ZK) access promptly — best-effort, post-commit.
      const { safeRevokeBookingZkAccess } = await import('@/server/zk/provision');
      await safeRevokeBookingZkAccess(booking.id);
    }
    return { refundId: null, refundedCents: 0 };
  }

  // ── Positive refund: reverse money through the shared primitive ────────────
  // Reception/offline payments (CASH, INSTAPAY, …) have no gateway transaction to
  // reverse — the money is handed back at the desk. We still run the full DB
  // refund so a confirmed offline booking can be cancelled; only gateway-captured
  // payments (CREDIT_AGRICOLE) call the provider refund API.
  const isGatewayPayment = payment.provider === 'CREDIT_AGRICOLE';

  let refundId: string;
  let claimedForRefund = false;
  if (!isGatewayPayment) {
    // Offline (CASH/INSTAPAY): the money is handed back at the desk, no gateway
    // call. Unique per payment (matches the @unique RefundLine.paymobRefundId).
    refundId = `MANUAL_REFUND:${payment.id}`;
  } else if (!payment.paymobOrderId) {
    throw new DomainError('no_refundable_payment', 'no_refundable_payment', 409);
  } else {
    // ── H2: CLAIM the payment BEFORE the external gateway refund ───────────────
    // A concurrent or duplicated admin refund could otherwise both call the
    // gateway and return the money twice (the DB idempotency claim only runs
    // AFTER the provider call). Atomically flip SUCCEEDED → REFUND_PENDING; only
    // the winner (1 row) proceeds. A loser (0 rows) is already refunding/refunded
    // and must NOT hit the provider again.
    const claim = await prisma.payment.updateMany({
      where: { id: payment.id, status: 'SUCCEEDED' },
      data: { status: 'REFUND_PENDING' },
    });
    if (claim.count === 0) {
      throw new DomainError('refund_already_in_progress', 'refund_already_in_progress', 409);
    }
    claimedForRefund = true;
    try {
      // Refund through the provider that CAPTURED the payment (stored on the row).
      // Amount is the TIERED/override amount, so partial refunds reverse only the
      // eligible portion.
      const refund = await refundPaymentTransaction({
        provider: payment.provider,
        providerOrderId: payment.paymobOrderId,
        providerTransactionId: payment.paymobTransactionId ?? '',
        amountCents: amount,
        paymentId: payment.id,
      });
      refundId = refund.refundId;
    } catch (err) {
      // If the provider says it's already refunded, we still apply the DB
      // side-effects to keep our system in sync (booking cancelled, capacity
      // released).
      if (err instanceof DomainError && err.code === 'credit_agricole_already_refunded') {
        // Must be UNIQUE per payment: `paymobRefundId` is @unique and
        // applyRefundToDb short-circuits on an existing RefundLine with this id.
        refundId = `ALREADY_REFUNDED:${payment.id}`;
      } else {
        // Transient gateway/network failure — RELEASE the claim so the refund can
        // be retried (leaving REFUND_PENDING would strand the payment). If the
        // release itself fails (DB also down), the payment is stuck in
        // REFUND_PENDING until the refund-pending sweep (reconcile.ts) queries
        // the gateway and releases/finalises it — log loudly, don't mask the
        // original gateway error.
        await prisma.payment
          .updateMany({
            where: { id: payment.id, status: 'REFUND_PENDING' },
            data: { status: 'SUCCEEDED' },
          })
          .catch((releaseErr) => {
            log.error(
              'AdminRefund CRITICAL: failed to release the REFUND_PENDING claim after a gateway failure — payment is stuck until the refund-pending sweep recovers it',
              { paymentId: payment.id, bookingId: booking.id, ...errFields(releaseErr) },
            );
          });
        throw err;
      }
    }
  }

  // Apply DB changes; a later gateway event will be idempotent if it arrives.
  // applyRefundToDb computes full-vs-partial itself (from the cumulative RefundLine
  // sum) and only terminalizes on a full refund.
  const result = await prisma.$transaction(async (tx) => {
    const applied = await applyRefundToDb(tx, {
      paymentId: payment.id,
      amountCents: amount,
      paymobRefundId: refundId,
      reason: input.reason ?? 'admin_refund',
      cancelBooking: true,
    });

    // Booking cancelled with a COLLECTED, undecided deposit → open its return
    // through the normal workflow (admin approval / desk payout). Never a
    // second gateway call inside this action.
    if (applied.applied) {
      await openInsuranceRefundOnCancellation(tx, {
        bookingId: booking.id,
        actorUserId: input.adminUserId,
      });
    }

    await audit(tx, {
      actorUserId: input.adminUserId,
      action: 'REFUND',
      entityType: 'Booking',
      entityId: booking.id,
      after: {
        refundId,
        reason: input.reason ?? null,
        eligiblePercent: eligible.percent,
        eligibleCents: eligible.refundCents,
        overrideAmountCents: input.overrideAmountCents ?? null,
        refundedCents: amount,
        keptCents: Math.max(0, totalCents - alreadyRefunded - amount),
      },
    });

    return applied;
  });

  // H2 safety: if we claimed REFUND_PENDING but applyRefundToDb was an idempotent
  // no-op, the gateway has still confirmed the money is going back — finalise the
  // row to REFUNDED so it can never get stuck mid-refund.
  if (claimedForRefund) {
    await prisma.payment
      .updateMany({
        where: { id: payment.id, status: 'REFUND_PENDING' },
        data: {
          status: paymentStatusAfterRefund(!!result.isFull),
          refundedAt: result.isFull ? new Date() : null,
        },
      })
      .catch((finalizeErr) => {
        // The gateway HAS the refund; only our status flip failed. The
        // refund-pending sweep (reconcile.ts) will finalise it — do not fail
        // the admin request over it, but leave a trace.
        log.error(
          'AdminRefund failed to settle REFUND_PENDING after the refund ledger write — the refund-pending sweep will recover it',
          { paymentId: payment.id, bookingId: booking.id, ...errFields(finalizeErr) },
        );
      });
  }

  // Best-effort refund email, only when this call actually applied the refund
  // (a later provider webhook will see applied:false and stay silent).
  if (result.applied && result.bookingId) {
    await sendRefundNoticeEmail(result.bookingId, amount);
  }

  return { refundId, refundedCents: amount };
}

/**
 * Cancel a booking's unpaid payment from the admin panel.
 *
 * Only meaningful while the booking is still PENDING_PAYMENT. For SUCCEEDED
 * payments use `adminRefundBooking` instead — different concept entirely.
 *
 * Paymob intentions don't expose a "cancel" call: an intention naturally
 * becomes inert once it's no longer needed (the customer is sent away from
 * the checkout, or the intention's TTL elapses). Our defence against a
 * race — "what if the customer manages to complete the unified-checkout
 * AFTER the admin clicks cancel?" — is the re-check inside the DB
 * transaction below: if the webhook flipped the booking to CONFIRMED
 * between the read and the write, we leave it alone.
 *
 * Idempotency: re-running on a booking that's already CANCELLED returns
 * `{ alreadyCancelled: true }` without throwing — the UI can render a
 * generic "done" state regardless of how many times the button was clicked.
 */
export async function adminCancelBookingPayment(input: {
  bookingId: string;
  adminUserId: string;
  reason?: string;
}) {
  const booking = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    include: {
      payments: { orderBy: { createdAt: 'desc' } },
      invoice: true,
    },
  });
  if (!booking) throw new DomainError('not_found', 'not_found', 404);

  if (booking.status === 'CANCELLED' || booking.status === 'EXPIRED' || booking.status === 'FAILED') {
    // Nothing to do — treat as success so the UI converges.
    return { bookingId: booking.id, alreadyCancelled: true as const };
  }

  if (booking.status !== 'PENDING_PAYMENT') {
    // CONFIRMED bookings must go through refund, not cancel — refusing here
    // prevents an admin from silently voiding a captured charge.
    throw new DomainError('booking_not_cancellable', 'booking_not_cancellable', 409);
  }

  const pendingPayments = booking.payments.filter((p) => p.status === 'PENDING');
  if (pendingPayments.length === 0) {
    throw new DomainError('no_cancellable_payment', 'no_cancellable_payment', 409);
  }

  await prisma.$transaction(async (tx) => {
    // Re-fetch inside the transaction so a concurrent webhook can't make us
    // overwrite a CONFIRMED booking.
    const fresh = await tx.booking.findUnique({
      where: { id: booking.id },
      include: { invoice: true },
    });
    if (!fresh) return;
    if (fresh.status !== 'PENDING_PAYMENT') return;

    await tx.payment.updateMany({
      where: { bookingId: fresh.id, status: 'PENDING' },
      data: {
        status: 'FAILED',
        failureCode: 'cancelled_by_admin',
        failureMessage: input.reason ?? null,
      },
    });

    if (fresh.invoice) {
      await tx.invoice.update({
        where: { id: fresh.invoice.id },
        data: { status: 'CANCELLED' },
      });
    }

    await tx.booking.update({
      where: { id: fresh.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    // A never-collected insurance deposit dies with the unpaid booking.
    await tx.bookingInsurance.updateMany({
      where: { bookingId: fresh.id, collectionStatus: 'PENDING' },
      data: { collectionStatus: 'VOIDED' },
    });

    // Unpaid booking voided → free the sanctions it had reserved.
    await releaseSanctionsForBooking(tx, fresh.id);

    await audit(tx, {
      actorUserId: input.adminUserId,
      action: 'STATUS_CHANGE',
      entityType: 'Booking',
      entityId: fresh.id,
      before: { status: 'PENDING_PAYMENT' },
      after: { status: 'CANCELLED', reason: input.reason ?? null, cause: 'admin_cancel_payment' },
    });
  });

  return { bookingId: booking.id, alreadyCancelled: false as const };
}

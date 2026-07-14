import 'server-only';
import type { Prisma } from '@prisma/client';
import { releaseBookingSlotCapacity } from './capacity-cost';
import { reactivateSanctionsForRefundedBooking } from './sanctions';
import { log } from '@/lib/log';
import { refundDisposition } from './refund-application-core';

export interface ApplyRefundInput {
  paymentId: string;
  amountCents: number;
  paymobRefundId: string;
  reason?: string;
  /** Cancel/release the booking even when the policy refund is partial. */
  cancelBooking?: boolean;
}

/**
 * Applies the side-effects of a successful refund to the database.
 *
 * Shared between the admin-initiated refund action, the auto-refund of
 * unconfirmable captures, and the gateway refund event. It is idempotent: it
 * checks if the payment is already marked as REFUNDED or if the RefundLine
 * already exists before applying changes.
 *
 * Side-effects:
 * 1. Updates Payment status to REFUNDED (the atomic claim; also finalises a
 *    REFUND_PENDING row claimed before the gateway call).
 * 2. Creates a RefundLine record.
 * 3. Updates Booking status to CANCELLED and sets cancelledAt.
 * 4. On a FULL refund only: reactivates settled sanctions and un-burns the promo.
 * 5. Releases capacity slots if the booking was previously CONFIRMED.
 */
export interface ApplyRefundResult {
  /** True only when THIS call performed the refund (not an idempotent no-op). */
  applied: boolean;
  bookingId: string | null;
  /** True when this refund cleared the whole remaining balance (booking cancelled). */
  isFull?: boolean;
}

export async function applyRefundToDb(
  tx: Prisma.TransactionClient,
  input: ApplyRefundInput,
): Promise<ApplyRefundResult> {
  const payment = await tx.payment.findUnique({
    where: { id: input.paymentId },
    include: {
      booking: {
        include: {
          invoice: true,
          service: { select: { kind: true } }
        },
      },
    },
  });

  if (!payment || !payment.booking.invoice) {
    log.warn('Refunds payment or invoice not found for refund application', { paymentId: input.paymentId });
    return { applied: false, bookingId: payment?.bookingId ?? null };
  }

  // Idempotency: check if already refunded
  if (payment.status === 'REFUNDED') {
    return { applied: false, bookingId: payment.bookingId, isFull: true };
  }

  const invoice = payment.booking.invoice;
  // SERVICE-pool sums only: insurance-deposit payouts (kind=INSURANCE) live in a
  // disjoint pool and must never make a service refund look "already returned" —
  // and vice versa. See docs/INSURANCE.md §6.
  const priorRefunded =
    (
      await tx.refundLine.aggregate({
        where: { invoiceId: invoice.id, kind: 'SERVICE' },
        _sum: { amountCents: true },
      })
    )._sum.amountCents ?? 0;

  // The full/partial threshold is the SERVICE portion of the invoice: the grand
  // total minus a COLLECTED insurance deposit (the deposit returns through its
  // own workflow, outside the tier). A never-collected (PENDING/VOIDED) deposit
  // is not subtracted, so a full-capture auto-refund still classifies as full.
  const collectedInsurance = await tx.bookingInsurance.findUnique({
    where: { bookingId: payment.bookingId },
    select: { amountCents: true, collectionStatus: true },
  });
  const insuranceCents =
    collectedInsurance?.collectionStatus === 'COLLECTED' ? collectedInsurance.amountCents : 0;
  const serviceTotalCents = Math.max(0, invoice.totalCents - insuranceCents);

  // Idempotency: check if this specific Paymob refund ID has already been recorded
  const existingRefund = await tx.refundLine.findUnique({
    where: { paymobRefundId: input.paymobRefundId },
  });
  if (existingRefund) {
    return {
      applied: false,
      bookingId: payment.bookingId,
      isFull: priorRefunded >= serviceTotalCents,
    };
  }

  const shouldReleaseCapacity = payment.booking.status === 'CONFIRMED';

  // Is THIS refund the one that clears the WHOLE remaining balance? Computed
  // authoritatively from the cumulative RefundLine sum — never trusted from the
  // caller. Only a FULL refund terminalizes; a PARTIAL (tiered/override) refund
  // records the money returned but keeps the payment refundable + the booking
  // CONFIRMED, so a later refund of the remainder isn't permanently blocked.
  const disposition = refundDisposition({
    priorRefundedCents: priorRefunded,
    amountCents: input.amountCents,
    invoiceTotalCents: serviceTotalCents,
    cancelBooking: !!input.cancelBooking,
  });
  const { isFull, shouldCancelBooking } = disposition;

  // Terminalize the payment ONLY on a full refund. A PARTIAL (tiered/override)
  // refund deliberately leaves the payment status untouched — it stays SUCCEEDED
  // (or is restored from REFUND_PENDING by the caller's finalize) so the retained
  // balance remains refundable later. Forcing REFUNDED here on a partial would both
  // strand the remainder AND defeat the caller's REFUND_PENDING→SUCCEEDED finalize.
  if (disposition.paymentStatus === 'REFUNDED') {
    // Atomic claim — the race guard for the full-refund paths that CAN collide on
    // the same paymobRefundId (auto-refund vs the gateway webhook). The loser
    // matches 0 rows (the winner already set REFUNDED) and applies nothing.
    const claim = await tx.payment.updateMany({
      where: { id: payment.id, status: { not: 'REFUNDED' } },
      data: { status: 'REFUNDED', refundedAt: new Date(), paymobTransactionId: input.paymobRefundId },
    });
    if (claim.count === 0) {
      return { applied: false, bookingId: payment.bookingId, isFull: true };
    }
  }

  // Record the refund line (partial + full). The unique `paymobRefundId` + the
  // pre-check above make a replayed refund a no-op; admin partials are serialized
  // upstream by their REFUND_PENDING claim, so a partial never races itself here.
  await tx.refundLine.create({
    data: {
      invoiceId: invoice.id,
      amountCents: input.amountCents,
      // Always the SERVICE pool: insurance payouts never pass through this
      // function (they use applyInsuranceRefund, which writes kind=INSURANCE).
      kind: 'SERVICE',
      reason: input.reason ?? 'refund',
      paymobRefundId: input.paymobRefundId,
    },
  });

  if (shouldCancelBooking) {
    // Cancel the booking + free any physical place it held (the unique
    // [placeId, date] index would otherwise keep it reserved forever). Applies to a
    // FULL refund AND to a tiered PARTIAL cancellation (cancelBooking:true) — the
    // customer is leaving either way, so the booking must terminalize and the place
    // must free even though the payment stays SUCCEEDED with a retained balance.
    await tx.booking.update({
      where: { id: payment.bookingId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await tx.bookingUnit.updateMany({
      where: { bookingId: payment.bookingId, placeId: { not: null } },
      data: { placeId: null, assignedById: null, assignedAt: null },
    });
    // A never-collected deposit dies with the booking (e.g. the auto-refund of
    // an unconfirmable capture reverses the WHOLE captured amount — including
    // the deposit charge — as one SERVICE line; the deposit was never COLLECTED
    // so it voids rather than entering the refund workflow). A COLLECTED
    // deposit is untouched here — it returns via its own checkout/refund flow.
    await tx.bookingInsurance.updateMany({
      where: { bookingId: payment.bookingId, collectionStatus: 'PENDING' },
      data: { collectionStatus: 'VOIDED' },
    });
  }

  if (isFull) {

    // Reverse the booking's "consequences": the WHOLE charge — including any
    // settled sanction amounts — came back, so those penalties are owed again and
    // the single-use promo is freed. (A partial keeps the penalty, so this is
    // full-only.)
    await reactivateSanctionsForRefundedBooking(tx, payment.bookingId, null);
    const redemption = await tx.promoRedemption.findUnique({
      where: { bookingId: payment.bookingId },
      select: { id: true, promoCodeId: true },
    });
    if (redemption) {
      await tx.promoRedemption.delete({ where: { id: redemption.id } });
      await tx.promoCode.update({
        where: { id: redemption.promoCodeId },
        data: { redemptionCount: { decrement: 1 } },
      });
    }

    // Release capacity — mirror the reservation exactly via the shared helper.
    // Only for bookings that were CONFIRMED (i.e. had capacity reserved).
  }

  if (disposition.shouldCancelBooking && shouldReleaseCapacity) {
    await releaseBookingSlotCapacity(tx, payment.booking);
  }

  return { applied: true, bookingId: payment.bookingId, isFull };
}

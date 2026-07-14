import 'server-only';
import { prisma } from '@/server/db/prisma';
import { audit } from '@/server/audit/audit';
import { DomainError } from '@/server/services/errors';
import { applyRefundToDb } from '@/server/services/refunds';
import { releaseSanctionsForBooking } from '@/server/services/sanctions';
import { sendRefundNoticeEmail } from '@/server/email/booking-emails';
import { refundPaymentTransaction } from './provider';

/**
 * Automatic refund of a CAPTURED payment that can never confirm its booking.
 *
 * The confirm engine (`handleSucceeded`) refuses a captured transaction when the
 * booking's capacity filled between quote and capture (the unlucky second payer),
 * when the captured amount doesn't match the invoice, or when the booking was
 * cancelled/expired while the customer was paying. Before this helper those
 * branches only logged "manual refund required" — the customer stayed charged
 * with no booking until a human noticed. Now the money goes straight back.
 *
 * Runs AFTER the Serializable confirm transaction commits (a refund is an
 * external HTTP call). Never throws: on a captured order a refund hiccup must
 * not surface as a payment failure — for MPGS the periodic reconciler re-runs
 * the whole verify → bail → refund loop until it sticks.
 *
 * Concurrency: two channels (iframe complete + parent poll) can race into this.
 * That is safe without a claim lock — the gateway rejects the second full refund
 * as excess/already-refunded (mapped to `*_already_refunded`), and
 * `applyRefundToDb` is idempotent (REFUNDED guard + unique RefundLine id), so the
 * money is returned exactly once.
 */
export type AutoRefundReason = 'amount_mismatch' | 'capacity_full' | 'booking_terminal';

export async function autoRefundUnconfirmable(input: {
  paymentId: string;
  /** The amount actually captured by the gateway (refund THIS, not the invoice). */
  capturedAmountCents: number;
  /** Raw provider transaction id of the capture (kept for the shared refund shape). */
  capturedTransactionId: string;
  reason: AutoRefundReason;
}): Promise<{ refunded: boolean }> {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: input.paymentId },
      select: {
        id: true,
        status: true,
        provider: true,
        paymobOrderId: true,
        bookingId: true,
        booking: { select: { status: true } },
      },
    });
    if (!payment) return { refunded: false };

    // Do-not-refund guards (the state may have moved since the bail branch):
    //  - REFUNDED → the money is already back (this call raced another channel);
    //  - SUCCEEDED / CONFIRMED → another channel legitimately confirmed the
    //    booking (its own Serializable capacity guard passed) — the money is
    //    rightfully ours, refunding it would give away a confirmed booking.
    if (payment.status === 'REFUNDED' || payment.status === 'SUCCEEDED') {
      return { refunded: false };
    }
    if (payment.booking.status === 'CONFIRMED') return { refunded: false };
    // Only gateway captures can (and need to) be reversed here; offline payments
    // (CASH/INSTAPAY) never reach the gateway confirm engine.
    if (payment.provider !== 'CREDIT_AGRICOLE') {
      return { refunded: false };
    }

    let refundId: string;
    try {
      // Refund through the provider that CAPTURED the payment (stored on the
      // row), not the currently-active provider — correct even after a cutover.
      const refund = await refundPaymentTransaction({
        provider: payment.provider,
        providerOrderId: payment.paymobOrderId,
        providerTransactionId: input.capturedTransactionId,
        amountCents: input.capturedAmountCents,
        paymentId: payment.id,
      });
      refundId = refund.refundId;
    } catch (err) {
      if (err instanceof DomainError && err.code === 'credit_agricole_already_refunded') {
        // Unique per payment — see adminRefundBooking for why a shared literal
        // would collide on the @unique RefundLine.paymobRefundId.
        refundId = `ALREADY_REFUNDED:${payment.id}`;
      } else {
        // Money is captured but the refund didn't go through (network/gateway).
        // Leave the payment PENDING so the MPGS reconciler retries the whole loop.
        console.error(
          '[AutoRefund] gateway refund FAILED for unconfirmable captured payment — will retry via the MPGS reconciler',
          { paymentId: payment.id, reason: input.reason, amountCents: input.capturedAmountCents },
          err,
        );
        return { refunded: false };
      }
    }

    const result = await prisma.$transaction(async (dbTx) => {
      const applied = await applyRefundToDb(dbTx, {
        paymentId: payment.id,
        amountCents: input.capturedAmountCents,
        paymobRefundId: refundId,
        reason: `auto_refund_${input.reason}`,
      });
      // The booking was never confirmed, so its sanctions were reserved but not
      // settled — applyRefundToDb only reactivates SETTLED ones; free the
      // reservations too so the user's next booking can pick them up.
      await releaseSanctionsForBooking(dbTx, payment.bookingId);
      await audit(dbTx, {
        actorUserId: null, // payment system
        action: 'REFUND',
        entityType: 'Booking',
        entityId: payment.bookingId,
        after: {
          refundId,
          reason: `auto_refund_${input.reason}`,
          amountCents: input.capturedAmountCents,
          automatic: true,
        },
      });
      return applied;
    });

    // Best-effort notice — the customer just saw a failed booking, tell them the
    // charge is coming back. Only on the call that actually applied the refund.
    if (result.applied && result.bookingId) {
      try {
        await sendRefundNoticeEmail(result.bookingId, input.capturedAmountCents);
      } catch (err) {
        console.error('[AutoRefund] refund notice email failed', payment.bookingId, err);
      }
    }
    return { refunded: true };
  } catch (err) {
    // Belt-and-braces: this helper must NEVER throw into the confirm path.
    console.error('[AutoRefund] unexpected error', { paymentId: input.paymentId }, err);
    return { refunded: false };
  }
}

import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { unitCapacityCost, eachDay, capacityExceeded } from '@/server/services/capacity-cost';
import { effectiveDailyCap } from '@/server/services/place-capacity-core';
import { applyRefundToDb } from '@/server/services/refunds';
import { autoRefundUnconfirmable } from '@/server/payments/auto-refund';
import {
  releaseSanctionsForBooking,
  settleSanctionsForBooking,
} from '@/server/services/sanctions';
import { sendBookingConfirmationEmail, sendRefundNoticeEmail } from '@/server/email/booking-emails';

/**
 * Provider-neutral payment → DB synchronisation engine.
 *
 * Card payments run through Crédit Agricole (MPGS) Hosted Checkout. The verify
 * path (`credit-agricole/verify.ts`) RETRIEVEs the order server-side, normalises
 * it into the `ProviderTxn` shape below, and hands it to `handleEvent` so every
 * booking safeguard — amount re-verify, Serializable capacity guard, idempotency,
 * sanction settlement, confirmation email, auto-refund of unconfirmable captures —
 * is applied in exactly one place, regardless of provider.
 */

/**
 * The normalised transaction object the sync engine consumes. The field names
 * mirror a gateway transaction payload; the CA verify path constructs one of
 * these from an MPGS order. `success` is the ONLY signal used to confirm a
 * payment — never a free-text `data.message` (which is not part of any signed
 * or trusted contract).
 */
export interface ProviderTxn {
  id: number | string;
  pending: boolean;
  amount_cents: number;
  success: boolean;
  is_auth: boolean;
  is_capture: boolean;
  is_standalone_payment: boolean;
  is_voided: boolean;
  is_refunded: boolean;
  is_3d_secure: boolean;
  integration_id: number | string;
  has_parent_transaction: boolean;
  order?: { id: number | string };
  created_at: string;
  currency: string;
  source_data?: { pan?: string; sub_type?: string; type?: string };
  error_occured: boolean;
  owner: number | string;
  payment_key_claims?: { extra?: Record<string, unknown> } & Record<string, unknown>;
  data?: { extras?: Record<string, unknown>; message?: string } & Record<string, unknown>;
}

export interface ProviderWebhookEvent {
  type: string;
  obj: ProviderTxn;
}

/**
 * Why a CAPTURED transaction can be permanently unable to confirm its booking.
 * These are terminal for THIS payment: money was taken but the booking must not
 * confirm, so the captured funds are automatically returned (see
 * `autoRefundUnconfirmable`) — except `already_refunded`, where they already were.
 */
export type UnconfirmableReason =
  | 'amount_mismatch'
  | 'capacity_full'
  | 'booking_terminal'
  | 'already_refunded';

export interface HandleEventOutcome {
  handled: boolean;
  /** True when THIS call transitioned the booking to CONFIRMED (not a no-op). */
  confirmed?: boolean;
  /**
   * Set when a CAPTURED transaction can never confirm this booking. The
   * interactive verify path uses it to route the payer to the failed page
   * (instead of falsely showing success) while the auto-refund returns the money.
   */
  unconfirmable?: UnconfirmableReason;
}

export async function handleEvent(event: ProviderWebhookEvent): Promise<HandleEventOutcome> {
  const tx = event.obj;
  const transactionId = String(tx.id);
  // A genuine refund/void references a parent transaction. The CAPTURE leg of a
  // two-step auth/capture flow ALSO sets `has_parent_transaction` (it references
  // its auth), so exclude captures here — otherwise a successful capture would be
  // misrouted into handleRefunded() and the paid booking would never confirm.
  const isRefund =
    tx.is_refunded === true ||
    (tx.has_parent_transaction === true && tx.is_capture !== true);

  if (isRefund) {
    await handleRefunded(transactionId, tx);
    return { handled: true };
  }
  if (tx.pending) {
    return { handled: false };
  }
  // Confirm ONLY on the trusted `success` boolean. A payment is never confirmed
  // from a free-text status message: `success` is set by the server-side order
  // verification, so it cannot be forged by an untrusted payload.
  if (tx.success) {
    const r = await handleSucceeded(transactionId, tx);
    return { handled: true, confirmed: r.confirmed, unconfirmable: r.unconfirmable };
  }
  await handleFailed(transactionId, tx);
  return { handled: true };
}

function orderIdFromTx(tx: ProviderTxn): string | null {
  if (tx.order && tx.order.id != null) return String(tx.order.id);
  return null;
}

function getPaymentIdFromExtras(tx: ProviderTxn): string | null {
  const extras = tx.payment_key_claims?.extra || tx.data?.extras;
  if (extras && typeof extras === 'object' && 'paymentId' in extras) {
    const pid = (extras as Record<string, unknown>).paymentId;
    // Only accept a non-empty string id; anything else (object/array/number)
    // must not be coerced into a bogus lookup key.
    return typeof pid === 'string' && pid.length > 0 ? pid : null;
  }
  return null;
}

/**
 * Build the payment-lookup filter from a transaction's identifiers. Returns null
 * when NEITHER identifier is present: callers MUST treat that as "no match" and
 * not query, because `{ OR: [{ id: undefined }, { paymobOrderId: undefined }] }`
 * collapses to an empty `OR` in Prisma and would match an ARBITRARY payment row
 * (silently confirming/failing the wrong booking).
 */
function paymentLookupWhere(
  orderId: string | null,
  paymentIdFromExtras: string | null,
): Prisma.PaymentWhereInput | null {
  const or: Prisma.PaymentWhereInput[] = [];
  if (paymentIdFromExtras) or.push({ id: paymentIdFromExtras });
  if (orderId) or.push({ paymobOrderId: orderId });
  return or.length > 0 ? { OR: or } : null;
}

/** Result of the Serializable confirm transaction inside `handleSucceeded`. */
interface ConfirmTxResult {
  confirmed: boolean;
  bookingId: string | null;
  unconfirmable?: UnconfirmableReason;
  /** Present when the captured funds must be automatically returned post-commit. */
  refund?: { paymentId: string; amountCents: number };
}

export async function handleSucceeded(
  transactionId: string,
  tx: ProviderTxn,
): Promise<{ confirmed: boolean; unconfirmable?: UnconfirmableReason }> {
  const orderId = orderIdFromTx(tx);
  const paymentIdFromExtras = getPaymentIdFromExtras(tx);
  const where = paymentLookupWhere(orderId, paymentIdFromExtras);
  if (!where) {
    console.warn(
      '[Payment Sync] succeeded transaction has no order/payment identifier — ignoring',
      { transactionId },
    );
    return { confirmed: false };
  }

  const result = await prisma.$transaction(
    async (db): Promise<ConfirmTxResult> => {
      const payment = await db.payment.findFirst({
        where,
        include: {
          booking: {
            include: {
              invoice: true,
              service: {
                select: {
                  id: true,
                  kind: true,
                  placeAssignmentRequired: true,
                  dailyCapacityPeople: true,
                  dailyCapacityCars: true,
                  dailyCapacityHandicap: true,
                },
              },
            },
          },
        },
      });
      if (!payment) {
        console.warn('[Payment Sync] payment_not_found:', { orderId, paymentIdFromExtras });
        return { confirmed: false, bookingId: null };
      }

      // Duplicate-delivery guard — skip a re-processed identical transaction.
      // EXCEPTION: a payment an earlier transient gateway state (e.g. a 3-D Secure
      // 'FAILED' seen mid-flow) wrongly marked FAILED must still be RECOVERABLE — a
      // genuinely CAPTURED order has to confirm the booking rather than strand the
      // captured funds. So don't short-circuit a FAILED payment here; the SUCCEEDED
      // guard below still guarantees idempotency once it confirms.
      if (payment.paymobTransactionId === transactionId && payment.status !== 'FAILED') {
        return { confirmed: false, bookingId: payment.bookingId };
      }
      if (payment.status === 'SUCCEEDED') return { confirmed: false, bookingId: payment.bookingId };
      // Terminal-state guard against a replayed/duplicate original-capture event
      // delivered AFTER a refund. A refund rotates paymobTransactionId and flips
      // status to REFUNDED (and cancels the booking), so the two guards above stop
      // matching the original capture id — without this, a retried success
      // notification would re-CONFIRM a refunded+cancelled booking and re-increment
      // capacity. Treat any terminal state as a no-op, but report it as
      // `unconfirmable` so an interactive verify never shows the payer a success
      // page for money that was already returned. REFUND_PENDING is likewise
      // terminal here: a refund is being placed, so the capture must not confirm.
      if (payment.status === 'REFUNDED' || payment.status === 'REFUND_PENDING') {
        return {
          confirmed: false,
          bookingId: payment.bookingId,
          unconfirmable: 'already_refunded',
        };
      }
      // A capture landing on a CANCELLED/EXPIRED booking is money in hand for a
      // dead booking (the SUCCEEDED/REFUNDED guards above already excluded every
      // paid-or-refunded state, so this payment is PENDING/FAILED): the capture
      // must never confirm it — and the captured funds must go back automatically.
      if (payment.booking.status === 'CANCELLED' || payment.booking.status === 'EXPIRED') {
        return {
          confirmed: false,
          bookingId: payment.bookingId,
          unconfirmable: 'booking_terminal',
          refund: { paymentId: payment.id, amountCents: tx.amount_cents },
        };
      }

      // Verify the captured amount + currency match what the SERVER expected for
      // this booking. Even with a valid order verification, a transaction whose
      // amount or currency doesn't match the stored payment must NEVER confirm the
      // booking — this guards against under/over-payment, a partial capture, or a
      // transaction routed to the wrong order. The captured funds are returned
      // automatically post-commit (same-currency only: a cross-currency amount
      // can't be trusted in our minor units, so that stays a logged manual case).
      const currencyMatches =
        String(tx.currency ?? '').toUpperCase() === payment.currency.toUpperCase();
      if (tx.amount_cents !== payment.amountCents || !currencyMatches) {
        console.error('[Payment Sync] amount/currency mismatch — NOT confirming booking', {
          paymentId: payment.id,
          expectedCents: payment.amountCents,
          receivedCents: tx.amount_cents,
          expectedCurrency: payment.currency,
          receivedCurrency: tx.currency,
          autoRefund: currencyMatches,
        });
        return {
          confirmed: false,
          bookingId: payment.bookingId,
          unconfirmable: 'amount_mismatch',
          refund: currencyMatches
            ? { paymentId: payment.id, amountCents: tx.amount_cents }
            : undefined,
        };
      }

      // Reject authorization-only transactions: an auth (is_auth) that has NOT
      // been captured (is_capture) only HOLDS the funds — it never settles them,
      // so it must not confirm the booking. A standard single-message capture
      // reports is_auth=false; the capture leg of a two-step flow reports
      // is_capture=true. Either passes; a bare uncaptured authorization does not.
      if (tx.is_auth === true && tx.is_capture !== true) {
        console.warn('[Payment Sync] authorization-only (uncaptured) — NOT confirming booking', {
          paymentId: payment.id,
          transactionId,
        });
        return { confirmed: false, bookingId: payment.bookingId };
      }

      // ── C-1: re-validate capacity at confirmation, inside this Serializable
      // transaction, BEFORE granting confirmation. PENDING_PAYMENT holds are not
      // counted in BookingSlot, and the early availability check (createBooking /
      // quote) may have run against stale counters, so two payers can both pass it
      // for the last unit. Re-check here against the LIVE confirmed counters; under
      // Serializable, concurrent confirmations for the same slot serialize (one
      // retries and then sees the other's increment). If a day is genuinely full
      // (the unlucky second payer), do NOT confirm or increment — the captured
      // funds are automatically refunded post-commit (`autoRefundUnconfirmable`)
      // and the booking is cancelled, exactly like the amount-mismatch branch
      // above. This prevents overselling finite inventory (cabanas/umbrellas).
      const { serviceId, bookingDate, endDate, people, cars, handicapPeople, unitsPerDay } =
        payment.booking;
      const { kind, dailyCapacityCars, dailyCapacityHandicap, placeAssignmentRequired } =
        payment.booking.service;
      // People/unit ceiling: for a UNIT-based place-required service the ACTIVE
      // place count is an absolute cap (matches calcBooking), so an online booking
      // can never confirm past the physical inventory even if `dailyCapacityPeople`
      // was set higher than the number of places. EVENT is excluded (its counter
      // holds PEOPLE, not units — clamping would wrongly reject); non-place
      // services keep their cap.
      const clampToPlaces = placeAssignmentRequired && kind !== 'EVENT';
      const activePlaceCount = clampToPlaces
        ? await db.servicePlace.count({ where: { serviceId, isActive: true } })
        : 0;
      const peopleCap = effectiveDailyCap(
        payment.booking.service.dailyCapacityPeople,
        clampToPlaces,
        activePlaceCount,
      );
      const perDayCost = unitCapacityCost(payment.booking.service.kind, unitsPerDay, people);
      const days = eachDay(bookingDate, endDate);
      for (let i = 0; i < days.length; i++) {
        const date = days[i]!;
        const slot = await db.bookingSlot.findUnique({
          where: { serviceId_date: { serviceId, date } },
        });
        // Cars/handicap occupy their resource on EVERY day of the stay (a car
        // parks each day) — priced per-day too, so capacity must match. Checked
        // and reserved on all days, not just day 0.
        if (
          capacityExceeded(slot?.reservedPeople ?? 0, perDayCost, peopleCap) ||
          capacityExceeded(slot?.reservedCars ?? 0, cars, dailyCapacityCars) ||
          capacityExceeded(slot?.reservedHandicap ?? 0, handicapPeople, dailyCapacityHandicap)
        ) {
          console.error(
            '[Payment Sync] capacity exceeded at confirmation — NOT confirming booking (auto-refunding)',
            { paymentId: payment.id, bookingId: payment.bookingId, serviceId, date: date.toISOString() },
          );
          return {
            confirmed: false,
            bookingId: payment.bookingId,
            unconfirmable: 'capacity_full',
            refund: { paymentId: payment.id, amountCents: tx.amount_cents },
          };
        }
      }

      await db.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCEEDED',
          paidAt: new Date(),
          paymobTransactionId: transactionId,
          failureCode: null,
          failureMessage: null,
        },
      });

      if (payment.booking.invoice) {
        await db.invoice.update({
          where: { id: payment.booking.invoice.id },
          data: { status: 'PAID', paidAt: new Date() },
        });
      }

      await db.booking.update({
        where: { id: payment.bookingId },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
      });

      // Insurance deposit (if any): PENDING → COLLECTED. Collection is defined
      // by the provider capture confirmation — never earlier, and never by
      // discounts/vouchers. Conditional updateMany keeps replays no-ops;
      // `paidVia` snapshots the channel for refund-method routing at checkout.
      await db.bookingInsurance.updateMany({
        where: { bookingId: payment.bookingId, collectionStatus: 'PENDING' },
        data: {
          collectionStatus: 'COLLECTED',
          collectedAt: new Date(),
          paidVia: 'CREDIT_AGRICOLE',
        },
      });

      // The paid invoice carried the user's reserved sanctions — settle them
      // (conditional updateMany: a sanction settled elsewhere is skipped, so
      // it can never be marked PAID twice). Actor null = payment system.
      const settledSanctionCents = await settleSanctionsForBooking(db, payment.bookingId, null);

      // A-02: detect a stolen-lock over-charge. If this invoice priced a sanction
      // in but, by payment time, a later booking had reclaimed its (stale) lock,
      // we settle LESS than we charged — the customer paid for a penalty that was
      // already collected elsewhere. Flag it loudly (ops-actionable partial refund)
      // rather than silently keeping the extra money. (Automated partial reversal
      // is a documented follow-up — see RISK_REGISTER A-02.)
      if (payment.booking.invoice) {
        const chargedSanctionCents =
          (
            await db.invoiceLine.aggregate({
              where: {
                invoiceId: payment.booking.invoice.id,
                meta: { path: ['kind'], equals: 'SANCTION' },
              },
              _sum: { totalCents: true },
            })
          )._sum.totalCents ?? 0;
        if (settledSanctionCents < chargedSanctionCents) {
          console.error(
            '[Payment Sync] SANCTION OVER-CHARGE — booking paid a sanction it did not settle (stale-lock steal); a partial refund is owed',
            {
              paymentId: payment.id,
              bookingId: payment.bookingId,
              chargedSanctionCents,
              settledSanctionCents,
              overchargeCents: chargedSanctionCents - settledSanctionCents,
            },
          );
        }
      }

      // Apply confirmed capacity counters — one BookingSlot per day, each
      // incremented by the per-day unit cost (units for non-EVENT services, people
      // for EVENT). Cars/handicap are reserved on EVERY day: they occupy their
      // resource for the whole stay and are priced per-day, so capacity must match
      // (the release path mirrors this). `serviceId`, `days`, `perDayCost`, `cars`,
      // `handicapPeople` were computed and the capacity re-validated in C-1 above.
      for (let i = 0; i < days.length; i++) {
        const date = days[i]!;
        await db.bookingSlot.upsert({
          where: { serviceId_date: { serviceId, date } },
          create: {
            serviceId,
            date,
            reservedPeople: perDayCost,
            reservedCars: cars,
            reservedHandicap: handicapPeople,
          },
          update: {
            reservedPeople: { increment: perDayCost },
            reservedCars: { increment: cars },
            reservedHandicap: { increment: handicapPeople },
          },
        });
      }

      return { confirmed: true, bookingId: payment.bookingId };
    },
    // Serializable isolation closes the duplicate-confirm race: under the DB
    // default (Read Committed) two concurrent retries could both read the row as
    // PENDING and both increment BookingSlot capacity. Serializable aborts one
    // (→ P2034 → the caller retries → the idempotency guards then short-circuit it).
    { maxWait: 5_000, timeout: 15_000, isolationLevel: 'Serializable' },
  );

  // Fire the confirmation email AFTER the transaction commits, and only on a
  // fresh confirmation — best-effort, never throws (would otherwise turn a
  // committed payment into a retryable failure).
  if (result.confirmed && result.bookingId) {
    await sendBookingConfirmationEmail(result.bookingId);

    // Provision physical (ZK) cabin access — best-effort, post-commit. A no-op for
    // non-ZK services or when the integration is off; the ZK reconciler backstops
    // any transient failure so a paid booking never fails on account of ZK.
    const { safeSyncBookingZkAccess } = await import('@/server/zk/provision');
    await safeSyncBookingZkAccess(result.bookingId);

    // Now that the booking is confirmed, prompt the customer to rate it
    // (in-app + push, deep-linked to the review form). Best-effort, idempotent.
    const { promptBookingReview } = await import('@/server/services/review');
    await promptBookingReview(result.bookingId);
  }

  // Captured money that can never confirm this booking goes straight back.
  // AFTER the commit (a refund is an external HTTP call — it must not run inside
  // the Serializable transaction) and never throws: on a captured order a refund
  // hiccup must not surface as a payment failure — the MPGS reconciler re-runs
  // the whole verify→bail→refund loop until it sticks.
  if (result.refund && result.unconfirmable && result.unconfirmable !== 'already_refunded') {
    await autoRefundUnconfirmable({
      paymentId: result.refund.paymentId,
      capturedAmountCents: result.refund.amountCents,
      capturedTransactionId: transactionId,
      reason: result.unconfirmable,
    });
  }

  return { confirmed: result.confirmed, unconfirmable: result.unconfirmable };
}

async function handleFailed(transactionId: string, tx: ProviderTxn) {
  const orderId = orderIdFromTx(tx);
  const paymentIdFromExtras = getPaymentIdFromExtras(tx);
  const where = paymentLookupWhere(orderId, paymentIdFromExtras);
  if (!where) return;

  await prisma.$transaction(async (db) => {
    const payment = await db.payment.findFirst({
      where,
      include: { booking: { include: { invoice: true } } },
    });
    if (!payment) return;
    if (payment.paymobTransactionId === transactionId) return;
    // REFUNDED / REFUND_PENDING are terminal too: after an (auto-)refund the
    // gateway's order state is no longer CAPTURED, so a late re-verify can
    // classify it as failed — that must NOT clobber the refunded payment (or flip
    // its CANCELLED booking) back to FAILED, which would misreport money that was
    // actually returned.
    if (
      payment.status === 'FAILED' ||
      payment.status === 'SUCCEEDED' ||
      payment.status === 'REFUNDED' ||
      payment.status === 'REFUND_PENDING'
    ) {
      return;
    }
    if (payment.booking.status === 'CANCELLED' || payment.booking.status === 'EXPIRED') return;

    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        failureCode: tx.error_occured ? 'gateway_error' : 'gateway_declined',
        failureMessage: tx.data?.message || null,
        paymobTransactionId: transactionId,
      },
    });

    if (payment.booking.invoice) {
      await db.invoice.update({
        where: { id: payment.booking.invoice.id },
        data: { status: 'FAILED' },
      });
    }
    await db.booking.update({
      where: { id: payment.bookingId },
      data: { status: 'FAILED' },
    });

    // A never-collected insurance deposit dies with the payment.
    await db.bookingInsurance.updateMany({
      where: { bookingId: payment.bookingId, collectionStatus: 'PENDING' },
      data: { collectionStatus: 'VOIDED' },
    });

    // The payment died — free the sanctions this booking had reserved so the
    // user's next booking (or an admin settlement) can pick them up.
    await releaseSanctionsForBooking(db, payment.bookingId);
  });
}

async function handleRefunded(transactionId: string, tx: ProviderTxn) {
  const orderId = orderIdFromTx(tx);
  const paymentIdFromExtras = getPaymentIdFromExtras(tx);
  const where = paymentLookupWhere(orderId, paymentIdFromExtras);
  if (!where) return;

  const result = await prisma.$transaction(async (db) => {
    const payment = await db.payment.findFirst({ where });
    if (!payment) return { applied: false, bookingId: null };

    return applyRefundToDb(db, {
      paymentId: payment.id,
      amountCents: tx.amount_cents,
      paymobRefundId: transactionId,
      reason: 'gateway_webhook',
    });
  });

  // Best-effort refund email, only when this event actually applied the
  // refund (idempotent retries / admin-initiated refunds that already ran the
  // DB side-effects return applied:false here and send nothing).
  if (result.applied && result.bookingId) {
    await sendRefundNoticeEmail(result.bookingId, tx.amount_cents);
  }
}

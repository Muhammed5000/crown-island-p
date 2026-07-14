import 'server-only';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/server/db/prisma';
import { DomainError } from '@/server/services/errors';
import { loadAndReverifyPendingPayment } from '@/server/payments/reverify';
import { MpgsNotConfiguredError, formatMpgsAmount, getMpgsConfig } from './client';

/**
 * MPGS Hosted Checkout — session creation + refund.
 *
 * Lifecycle:
 *   1. Server creates a checkout session (CREATE_CHECKOUT_SESSION / PURCHASE) and
 *      stores the unique MPGS `order.id` on `Payment.paymobOrderId` (the generic
 *      provider-order-id column).
 *   2. The browser opens the Lightbox popup with `session.id`.
 *   3. On completion the browser hits our complete route, which verifies the
 *      result server-side via RETRIEVE_ORDER (see verify.ts) — the authoritative
 *      source of truth — before any booking is confirmed.
 */

export interface MpgsSessionResult {
  paymentId: string;
  /** MPGS order.id, persisted to Payment.paymobOrderId. */
  providerOrderId: string;
  amountCents: number;
  currency: string;
  /** Hosted Checkout session id consumed by the Lightbox. */
  sessionId: string;
  /** {host}/static/checkout/checkout.min.js */
  scriptUrl: string;
  /** Where the Lightbox sends the browser on completion (server verifies there). */
  completeUrl: string;
  /** Where the Lightbox sends the browser on cancel. */
  cancelUrl: string;
}

export async function createMpgsSession(input: {
  userId: string;
  bookingId: string;
  origin: string;
  locale: 'ar' | 'en';
}): Promise<MpgsSessionResult> {
  const { booking, payment, invoice } = await loadAndReverifyPendingPayment(
    input.userId,
    input.bookingId,
  );

  const config = getMpgsConfig();

  // STABLE per payment (the payment id itself), NOT a per-attempt timestamped id.
  // Every checkout session / retry for this payment then references the SAME MPGS
  // order, so the customer always pays the exact id we persist and RETRIEVE_ORDER
  // can always find it. A timestamped id let a duplicate session (StrictMode
  // double-fire, wizard + payment page) diverge from the stored one, leaving a
  // paid order we could never look up ("order not found" → false failure). MPGS
  // allows multiple sessions for one order id; the booking can't reach here once
  // CONFIRMED, so a paid id is never reused.
  const orderId = payment.id;
  const localePrefix = input.locale === 'en' ? 'en/' : '';
  const completeUrl = `${input.origin}/api/credit-agricole/complete?bid=${booking.id}&locale=${input.locale}`;
  const cancelUrl = `${input.origin}/${localePrefix}booking/payment?bid=${booking.id}`;

  const requestBody = {
    // v59 gateway uses CREATE_CHECKOUT_SESSION (INITIATE_CHECKOUT is deprecated
    // and rejects order.amount); the order is attached to the session here and
    // the client just configures with session.id + showLightbox.
    apiOperation: 'CREATE_CHECKOUT_SESSION',
    interaction: {
      operation: 'PURCHASE',
      merchant: { name: config.merchantName },
    },
    order: {
      id: orderId,
      amount: formatMpgsAmount(invoice.totalCents),
      currency: config.currency,
      // Required by the gateway for the PURCHASE operation.
      description: `Booking ${booking.reference}`,
    },
  };

  const response = await fetch(`${config.baseUrl}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: config.authHeader },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    console.error(`[MPGS] session create failed ${response.status}: ${errText.slice(0, 500)}`);
    throw new DomainError(
      `mpgs_session_failed:${response.status}:${errText.slice(0, 200)}`,
      'mpgs_session_failed',
      502,
    );
  }

  const json = (await response.json()) as { session?: { id?: string }; result?: string };
  const sessionId = json.session?.id ?? null;
  if (!sessionId) {
    throw new DomainError('mpgs_session_invalid', 'mpgs_session_invalid', 502);
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { provider: 'CREDIT_AGRICOLE', paymobOrderId: orderId, currency: config.currency },
  });

  return {
    paymentId: payment.id,
    providerOrderId: orderId,
    amountCents: invoice.totalCents,
    currency: config.currency,
    sessionId,
    scriptUrl: config.checkoutScriptUrl,
    completeUrl,
    cancelUrl,
  };
}

/**
 * Refund a captured MPGS order via the REFUND apiOperation. MPGS refunds target
 * the ORDER (a fresh, unique transaction id identifies the refund leg). The
 * endpoint is idempotent for the same (order, transaction id).
 *
 * `refundTransactionId` (optional) supplies a DETERMINISTIC leg id: callers who
 * persist the id BEFORE the call (insurance-deposit refunds) can crash-retry by
 * re-sending the SAME leg — the gateway replays the original outcome instead of
 * refunding twice. Omitted → a fresh unique id per call (legacy behaviour).
 */
export async function refundMpgsTransaction(input: {
  orderId: string;
  amountCents: number;
  refundTransactionId?: string;
}): Promise<{ refundId: string }> {
  const config = getMpgsConfig();
  // Globally unique per refund leg: this id is echoed back by MPGS and written to
  // the @unique RefundLine.paymobRefundId + Payment.paymobTransactionId, so a bare
  // millisecond timestamp could collide when two refunds fire in the same ms. The
  // random suffix removes that window (kept short — MPGS caps the transaction id).
  const refundTxnId =
    input.refundTransactionId ??
    `refund-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

  const response = await fetch(
    `${config.baseUrl}/order/${encodeURIComponent(input.orderId)}/transaction/${refundTxnId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: config.authHeader },
      body: JSON.stringify({
        apiOperation: 'REFUND',
        transaction: { amount: formatMpgsAmount(input.amountCents), currency: config.currency },
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    // Already fully refunded → the gateway rejects a further refund as an excess/
    // over-refund (e.g. "Missing merchant privilege 'Excess refund'") or
    // "already refunded"/"no funds". Treat all of these as the idempotent
    // already-refunded case so the admin flow still syncs the DB.
    if (/already.*refund|exceed|excess|no.*(funds|refundable)/i.test(errText)) {
      throw new DomainError('Transaction already refunded', 'credit_agricole_already_refunded', 400);
    }
    throw new DomainError(
      `mpgs_refund_failed:${response.status}:${errText.slice(0, 200)}`,
      'mpgs_refund_failed',
      502,
    );
  }

  const json = (await response.json()) as { result?: string; transaction?: { id?: string } };
  if (json.result !== 'SUCCESS') {
    throw new DomainError('mpgs_refund_rejected', 'mpgs_refund_rejected', 502);
  }
  return { refundId: json.transaction?.id ?? refundTxnId };
}

export { MpgsNotConfiguredError };

import 'server-only';
import type { PaymentProvider } from '@prisma/client';
import { DomainError } from '@/server/services/errors';
import { createMpgsSession, refundMpgsTransaction } from '@/server/credit-agricole/payments';
import { MpgsNotConfiguredError } from '@/server/credit-agricole/client';

/**
 * Active-payment-provider selector.
 *
 * Card payments run through Crédit Agricole Egypt via MPGS Hosted Checkout
 * (Lightbox popup): card entry stays on the acquirer, and bookings confirm
 * through the shared DB-sync engine (`@/server/payments/sync`). Crédit Agricole
 * is the only card gateway.
 *
 * Refunds dispatch by the STORED provider on the payment row; only
 * CREDIT_AGRICOLE card payments are refundable through the gateway (offline
 * methods are handed back at the desk by reception, never here).
 */

export type ActivePaymentProvider = 'credit_agricole';

/** The active card gateway. Crédit Agricole (MPGS) is the only one. */
export function getActivePaymentProvider(): ActivePaymentProvider {
  return 'credit_agricole';
}

export interface UnifiedIntentInput {
  userId: string;
  bookingId: string;
  /** Public origin of the current request (used to build provider return URLs). */
  origin: string;
  locale: 'ar' | 'en';
  /** Optional redirect override (retained for API compatibility; unused by MPGS). */
  redirectionUrl?: string;
}

export interface UnifiedIntentResult {
  paymentId: string;
  /** Generic provider order/intention reference. */
  providerOrderId: string;
  amountCents: number;
  currency: string;
  /** Retained for API compatibility; never set (MPGS uses the Lightbox, not a redirect). */
  checkoutUrl?: string;
  /** MPGS Hosted Checkout (Lightbox) parameters. */
  mpgs?: { sessionId: string; scriptUrl: string; completeUrl: string; cancelUrl: string };
}

/** Create/refresh a payment intention with Crédit Agricole (MPGS). */
export async function ensurePaymentIntention(
  input: UnifiedIntentInput,
): Promise<UnifiedIntentResult> {
  const r = await createMpgsSession({
    userId: input.userId,
    bookingId: input.bookingId,
    origin: input.origin,
    locale: input.locale,
  });
  return {
    paymentId: r.paymentId,
    providerOrderId: r.providerOrderId,
    amountCents: r.amountCents,
    currency: r.currency,
    mpgs: {
      sessionId: r.sessionId,
      scriptUrl: r.scriptUrl,
      completeUrl: r.completeUrl,
      cancelUrl: r.cancelUrl,
    },
  };
}

/** Refund a captured transaction through the provider that captured it. */
export async function refundPaymentTransaction(input: {
  provider: PaymentProvider;
  /** MPGS order id (Crédit Agricole) — required to target the refund. */
  providerOrderId: string | null;
  /** Generic provider transaction id (unused by MPGS, kept for the shared shape). */
  providerTransactionId: string;
  amountCents: number;
  paymentId: string;
  /**
   * Deterministic refund-leg id persisted by the caller BEFORE this call
   * (insurance-deposit refunds). Retries re-send the SAME leg — the gateway
   * replays the original outcome instead of paying out twice. Omitted → a
   * fresh unique id per call.
   */
  refundTransactionId?: string;
}): Promise<{ refundId: string }> {
  if (input.provider !== 'CREDIT_AGRICOLE') {
    // Only card payments captured through Crédit Agricole are gateway-refundable.
    // Offline methods (cash / InstaPay) are handed back at the desk, not here.
    throw new DomainError('no_refundable_payment', 'no_refundable_payment', 409);
  }
  if (!input.providerOrderId) {
    throw new DomainError('no_refundable_payment', 'no_refundable_payment', 409);
  }
  return refundMpgsTransaction({
    orderId: input.providerOrderId,
    amountCents: input.amountCents,
    refundTransactionId: input.refundTransactionId,
  });
}

/** True for a provider "not configured" error. */
export function isPaymentNotConfigured(err: unknown): boolean {
  return err instanceof MpgsNotConfiguredError;
}

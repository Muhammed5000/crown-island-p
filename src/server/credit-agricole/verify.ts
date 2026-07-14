import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { getMpgsConfig } from './client';
import { classifyMpgsOrder, resolveCapturedOutcome, type MpgsVerifyStatus } from './order-status';
import {
  handleEvent,
  type HandleEventOutcome,
  type ProviderTxn,
} from '@/server/payments/sync';

export type { MpgsVerifyStatus } from './order-status';

/**
 * Confirm an order through the shared sync engine, resilient to the confirm RACE.
 *
 * The payment page confirms the SAME order from two places at once — the isolated
 * iframe's `complete` navigation AND the parent page's `/check` poll — so two
 * Serializable confirmations can hit the same rows and Postgres aborts one with a
 * serialization failure (Prisma P2034). `handleEvent`/`handleSucceeded` are
 * idempotent, so we retry a few times: by the retry the winning transaction has
 * committed and the `payment.status === 'SUCCEEDED'` guard short-circuits cleanly.
 *
 * For a genuinely CAPTURED order we NEVER let a confirm-side error surface as a
 * payment failure — the money is real; the other transaction (or the periodic
 * reconciler) settles the booking. Without this, the losing side of the race was
 * reported as `failed`, dumping a paid customer on /booking/failed and then
 * blocking re-payment (the booking is already CONFIRMED → `booking_not_payable`).
 * A non-captured decision (a real decline/failure) still propagates.
 *
 * Returns the sync engine's outcome (null when a captured-order confirm error was
 * swallowed) so the caller can distinguish "confirmed / already confirmed" from
 * "captured but UNCONFIRMABLE — auto-refunded" and route the payer accordingly.
 */
async function confirmOrder(
  obj: ProviderTxn,
  captured: boolean,
): Promise<HandleEventOutcome | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await handleEvent({ type: 'TRANSACTION', obj });
    } catch (err) {
      const isSerialization =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';
      if (isSerialization && attempt < 4) continue;
      if (captured) {
        console.warn(
          '[MPGS] confirm did not stick on a CAPTURED order (race/transient) — reconciler will settle:',
          err,
        );
        return null;
      }
      throw err;
    }
  }
}

/**
 * MPGS order verification — the authoritative confirmation step.
 *
 * After the embedded checkout completes, the browser hits our complete route
 * which calls this. We RETRIEVE_ORDER server-side and treat the order as paid
 * ONLY when `result === 'SUCCESS'` (never on the form closing alone). The result
 * is normalised into the SHARED sync engine (`handleEvent`) so all the booking
 * safeguards — amount re-verify, Serializable capacity guard, idempotency,
 * sanction settlement, confirmation email — apply identically.
 *
 * The capture can take a few seconds to settle after the browser is sent to the
 * complete route, so callers in the interactive path poll a few times (`attempts`
 * / `delayMs`); the periodic reconciler uses a single attempt.
 */

interface MpgsOrderResponse {
  result?: string; // SUCCESS | FAILURE | PENDING | UNKNOWN
  status?: string; // CAPTURED | AUTHORIZED | FAILED | CANCELLED | …
  amount?: number | string;
  currency?: string;
  transaction?: Array<{ transaction?: { id?: string } }>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function latestTransactionId(order: MpgsOrderResponse): string {
  const list = order.transaction ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const id = list[i]?.transaction?.id;
    if (id) return id;
  }
  return '';
}

export async function verifyAndConfirmOrder(
  bookingId: string,
  opts?: { attempts?: number; delayMs?: number },
): Promise<MpgsVerifyStatus> {
  // The most recent Crédit Agricole payment row carries the MPGS order id.
  const payment = await prisma.payment.findFirst({
    where: { bookingId, provider: 'CREDIT_AGRICOLE' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, paymobOrderId: true, currency: true, status: true },
  });
  if (!payment || !payment.paymobOrderId) return 'not_found';

  // Already (auto-)refunded → terminal. Short-circuit before touching the
  // gateway: after a refund the order is no longer CAPTURED, so re-verifying
  // would misread it (and the payer polling /check must see 'refunded', not
  // spin on 'pending' forever).
  if (payment.status === 'REFUNDED') return 'refunded';

  const orderId = payment.paymobOrderId;
  const config = getMpgsConfig();
  const attempts = Math.max(1, opts?.attempts ?? 1);
  const delayMs = opts?.delayMs ?? 1500;

  for (let attempt = 0; attempt < attempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}/order/${encodeURIComponent(orderId)}`, {
        method: 'GET',
        headers: { Authorization: config.authHeader },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      // A transport error (AbortSignal timeout / DNS / connection reset) is NOT a
      // payment failure — the charge may well have been captured. Treat it like an
      // unresolved poll: retry, and on the final attempt fall through to the
      // post-loop 'pending' rather than throwing. A throw here makes the callers
      // (complete/check) show the payer a false 'failed'; instead the /check poll
      // and the reconciler settle a genuine capture out of band.
      if (attempt === attempts - 1) {
        console.error(
          `[MPGS] retrieve order transport error for ${orderId}: ${(err as Error).message}`,
        );
      }
      if (attempt < attempts - 1) await sleep(delayMs);
      continue;
    }

    if (response.ok) {
      const order = (await response.json()) as MpgsOrderResponse;
      const decision = classifyMpgsOrder(order.result ?? '', order.status ?? '');
      const success = decision === 'success';

      if (decision === 'declined') {
        // A definitive decline — no funds taken, booking stays payable.
        return 'declined';
      }

      // A transient 3-D Secure 'FAILED' order status frequently settles to
      // CAPTURED a beat later (observed on this MPGS setup: an order polled as
      // FAILED then finished CAPTURED). So we do NOT mark the booking failed on an
      // early poll — only on the FINAL attempt. `success` (CAPTURED) still confirms
      // immediately; the reconciler recovers anything that captures after we stop.
      const actOnFailure = decision === 'failed' && attempt === attempts - 1;
      if (success || actOnFailure) {
        const amountNum =
          typeof order.amount === 'number' ? order.amount : Number(order.amount ?? 0);
        const amountCents = Math.round(amountNum * 100);
        const transactionId = latestTransactionId(order);
        // MPGS transaction ids are per-ORDER sequence numbers ("1", "2", …) — NOT
        // globally unique — so namespace by the (globally unique) order id before
        // storing as the unique Payment.paymobTransactionId, or a second MPGS
        // payment whose sequence is also "1" collides and the confirmation fails.
        const providerTransactionId = transactionId ? `${orderId}:${transactionId}` : orderId;

        const obj: ProviderTxn = {
          id: providerTransactionId,
          pending: false,
          amount_cents: amountCents,
          success,
          // Hosted Checkout PURCHASE settles immediately; the sync engine's
          // auth-only and refund branches are not triggered.
          is_auth: false,
          is_capture: false,
          is_standalone_payment: true,
          is_voided: false,
          is_refunded: false,
          is_3d_secure: true,
          integration_id: 'mpgs',
          has_parent_transaction: false,
          order: { id: orderId },
          created_at: new Date().toISOString(),
          currency: order.currency || payment.currency,
          source_data: {},
          error_occured: !success,
          owner: '',
          data: {
            extras: { paymentId: payment.id },
            message: success ? 'Approved' : `mpgs_${order.status || order.result || 'failed'}`,
          },
        };

        const outcome = await confirmOrder(obj, success);
        if (!success) return 'failed';
        // A captured order normally reads 'success' — but when the sync engine
        // reports it UNCONFIRMABLE (capacity full / amount mismatch / booking
        // terminal) the charge is auto-refunded and the payer must land on the
        // failed page, never the success page.
        if (outcome) return resolveCapturedOutcome(outcome);
        // No outcome: confirmOrder swallowed an error on this CAPTURED order
        // (exhausted P2034 retries or a transient DB failure). Don't guess —
        // read what actually happened. CONFIRMED means the concurrent winner
        // landed it ('success'); CANCELLED means it was auto-refunded
        // ('refunded'); anything else is genuinely unresolved ('pending' — the
        // payer stays on the payment page and the poll/reconciler settles it)
        // rather than a false success the page can never back out of.
        const booking = await prisma.booking.findUnique({
          where: { id: bookingId },
          select: { status: true },
        });
        if (booking?.status === 'CONFIRMED') return 'success';
        if (booking?.status === 'CANCELLED') return 'refunded';
        return 'pending';
      }

      // Otherwise 'pending' (AUTHENTICATION_INITIATED / AUTHORIZED / settling) →
      // retry below; the booking stays PENDING and payable.
    } else if (attempt === attempts - 1) {
      // A 400 here is the gateway saying the order has no completed transaction
      // yet: a checkout SESSION was created (so paymobOrderId is set) but the
      // customer hasn't finished paying. That is the EXPECTED state every time
      // the payment page / an early reconciler pass re-checks an unpaid order —
      // NOT an application error. Keep it a quiet warn (console.error would pop
      // the Next dev overlay and alarm nobody usefully); stay 'pending'. Real
      // problems (auth 401/403, gateway 5xx) still log at error level.
      if (response.status === 400) {
        console.warn(`[MPGS] order ${orderId} has no transaction yet — staying pending (unpaid)`);
      } else {
        console.error(`[MPGS] retrieve order failed ${response.status} for ${orderId}`);
      }
    }

    if (attempt < attempts - 1) await sleep(delayMs);
  }

  // Not yet resolved (still settling, or transient) — leave PENDING for the
  // reconciler / a later verify.
  return 'pending';
}

import {
  reconcilePendingMpgs,
  sweepStuckRefundPending,
  flagAgedOutPayments,
} from '@/server/credit-agricole/reconcile';
import { MpgsNotConfiguredError } from '@/server/credit-agricole/client';
import { isCronAuthorized } from '@/server/cron/auth';
import { apiError, apiOk } from '@/server/http/respond';
import { log, errFields } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/reconcile-payments
 *
 * Out-of-band confirmation sweep for MPGS (Crédit Agricole) Hosted Checkout: for
 * any payment captured by the gateway whose browser never reached `/complete`,
 * re-runs RETRIEVE_ORDER and confirms the booking. Drive it from a scheduler (the
 * docker-compose cron sidecar, or any external cron) every few minutes with
 * `Authorization: Bearer <CRON_SECRET>`. The sweep is idempotent and safe to call
 * concurrently.
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return apiError('unauthorized', 401);
  }
  try {
    const result = await reconcilePendingMpgs();
    // Companion sweeps (same cadence, both idempotent): recover payments
    // stranded in REFUND_PENDING, and flag PENDING payments that aged out of
    // the reconcile window for manual review.
    const refundPending = await sweepStuckRefundPending();
    const agedOut = await flagAgedOutPayments();
    return apiOk({ ok: true, ...result, refundPending, agedOut });
  } catch (err) {
    if (err instanceof MpgsNotConfiguredError) {
      // Provider not configured (e.g. Paymob is active) — nothing to reconcile.
      return apiOk({ ok: true, scanned: 0, skipped: 'mpgs_not_configured' });
    }
    log.error('cron reconcile-payments failed', errFields(err));
    return apiError('internal_error', 500);
  }
}

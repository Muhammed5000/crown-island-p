import { sweepInsurance } from '@/server/services/insurance-sweep';
import { isCronAuthorized } from '@/server/cron/auth';
import { apiError, apiOk } from '@/server/http/respond';
import { log, errFields } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/insurance
 *
 * Insurance-deposit reconciliation (docs/INSURANCE.md §9): resolves stuck
 * PROCESSING deposit refunds from authoritative gateway leg evidence, voids
 * orphaned PENDING deposits on terminal bookings, and surfaces forgotten
 * checkouts + ledger invariant violations. Idempotent and safe to run
 * concurrently with the in-process scheduler. `Authorization: Bearer <CRON_SECRET>`.
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return apiError('unauthorized', 401);
  }
  try {
    const result = await sweepInsurance();
    return apiOk({ ok: true, ...result });
  } catch (err) {
    log.error('cron insurance sweep failed', errFields(err));
    return apiError('internal_error', 500);
  }
}

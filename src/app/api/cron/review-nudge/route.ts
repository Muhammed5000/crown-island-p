import { sweepReviewNudges } from '@/server/services/review-nudge';
import { isCronAuthorized } from '@/server/cron/auth';
import { apiError, apiOk } from '@/server/http/respond';
import { log, errFields } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/review-nudge
 *
 * Post-visit review-nudge sweep: notifies account customers whose visit has
 * passed (and who haven't reviewed / been nudged) to rate their booking. Also
 * runs as an in-process daily scheduler (see instrumentation.ts) — this endpoint
 * lets an external cron drive it too. Guard with `Authorization: Bearer
 * <CRON_SECRET>`. Idempotent.
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return apiError('unauthorized', 401);
  }
  try {
    const result = await sweepReviewNudges();
    return apiOk({ ok: true, ...result });
  } catch (err) {
    log.error('cron review-nudge failed', errFields(err));
    return apiError('internal_error', 500);
  }
}

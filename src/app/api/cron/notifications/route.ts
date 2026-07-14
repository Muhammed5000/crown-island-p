import { dispatchDueScheduledCampaigns } from '@/server/services/admin-notifications';
import { isCronAuthorized } from '@/server/cron/auth';
import { apiError, apiOk } from '@/server/http/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/notifications
 *
 * Dispatches every scheduled notification campaign whose time has come. Drive it
 * once a minute from a scheduler — a cron sidecar in docker-compose, or any
 * external cron — sending `Authorization: Bearer <CRON_SECRET>` in the HEADER.
 * (A query-string token was previously accepted but was dropped: URL params leak
 * into access logs / Referer / proxies. Both shipped callers use the header.)
 *
 * The dispatcher claims each due campaign atomically, so calling this twice
 * concurrently (or a retry) never double-sends.
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return apiError('unauthorized', 401);
  }
  const result = await dispatchDueScheduledCampaigns();
  return apiOk({ ok: true, ...result });
}

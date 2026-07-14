import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { config } from '@/server/config';

/**
 * Shared authorization for the /api/cron/* endpoints.
 *
 * The three cron routes (reconcile-payments, review-nudge, notifications) each
 * hand-rolled the same check; this centralises it. Header-only Bearer token
 * (a `?token=` query param is deliberately NOT accepted — it leaks via logs,
 * Referer and proxies), compared in constant time. Refuses everything while
 * CRON_SECRET is unset.
 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function isCronAuthorized(request: Request): boolean {
  const secret = config.cronSecret;
  if (!secret) return false; // refuse to run while unconfigured
  const header = request.headers.get('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  return safeEqual(bearer, secret);
}

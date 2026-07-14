import { NextResponse } from 'next/server';
import { getSessionUser } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The endpoint is consumed SERVER-SIDE (web-push POSTs to it on every broadcast),
 * so it is an SSRF sink. Accept only https URLs whose host is a real DNS name —
 * never loopback/`localhost` or a raw IP literal (which is how an attacker would
 * reach `169.254.169.254`, `localhost`, or other internal/metadata hosts). Real
 * push services (FCM, Mozilla, WNS, Apple) always use public DNS hostnames.
 */
function isAllowedPushEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false; // IPv4 literal
  if (host.includes(':') || host.startsWith('[')) return false; // IPv6 literal
  return true;
}

/**
 * POST /api/push/subscribe
 *
 * Body: a browser PushSubscription JSON ({ endpoint, keys: { p256dh, auth } })
 * plus the customer's current `locale`. Upserts one row per endpoint for the
 * signed-in user. The endpoint is globally unique, so if a shared device was
 * previously another account's it is reassigned to the current user.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string }; locale?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const endpoint = body.endpoint?.trim();
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'invalid_subscription' }, { status: 400 });
  }
  // Bound the stored strings and SSRF-guard the endpoint before it can ever be
  // POSTed to server-side by the push dispatcher.
  if (
    endpoint.length > 2048 ||
    p256dh.length > 255 ||
    auth.length > 255 ||
    !isAllowedPushEndpoint(endpoint)
  ) {
    return NextResponse.json({ error: 'invalid_subscription' }, { status: 400 });
  }

  const locale = body.locale === 'en' ? 'en' : 'ar';
  const userAgent = request.headers.get('user-agent')?.slice(0, 255) ?? null;

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: user.id, endpoint, p256dh, auth, locale, userAgent },
    update: { userId: user.id, p256dh, auth, locale, userAgent, lastSeenAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}

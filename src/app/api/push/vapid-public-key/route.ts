import { NextResponse } from 'next/server';
import { getVapidPublicKey } from '@/server/push/web-push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/push/vapid-public-key
 *
 * Serves the public VAPID key to the browser at RUNTIME. Doing this via an API
 * route (rather than a NEXT_PUBLIC_* env var) keeps it out of the Docker build —
 * `NEXT_PUBLIC_*` values are baked in at build time, but the key is configured
 * per-deployment. Returns 503 when push isn't configured so the client can hide
 * the toggle gracefully.
 */
export async function GET() {
  const key = getVapidPublicKey();
  if (!key) return NextResponse.json({ error: 'push_not_configured' }, { status: 503 });
  return NextResponse.json({ key });
}

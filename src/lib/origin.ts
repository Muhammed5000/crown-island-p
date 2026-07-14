import 'server-only';
import { headers } from 'next/headers';
import { resolveOrigin } from './origin-core';

/**
 * Resolve the request's canonical origin (e.g. `https://crown-island.com` or
 * `https://abc123.ngrok-free.app`) at runtime.
 *
 * Why this exists
 * ──────────────
 * Earlier revisions hard-coded `http://localhost:3000` as the fallback when
 * `NEXT_PUBLIC_APP_URL` was blank. That meant any request handled on a real
 * domain (preview deploy, ngrok tunnel, prod) without the env var explicitly
 * set would emit links pointing back at the developer's laptop — most
 * visibly in password-reset emails and the post-payment redirect.
 *
 * The decision itself (override → allowlist → prod fail-closed → dev
 * proxy-trust) lives in `origin-core.ts` so it is unit-testable; see the trust
 * model documented there. This wrapper only supplies the request headers and
 * logs the warning when a client-influenced header was rejected.
 */
export async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  const { origin, warning } = resolveOrigin({
    nodeEnv: process.env.NODE_ENV,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    trustedHosts: process.env.TRUSTED_HOSTS,
    xfHost: h.get('x-forwarded-host'),
    host: h.get('host'),
    xfProto: h.get('x-forwarded-proto'),
  });
  if (warning) console.error('[origin]', warning);
  return origin;
}

/**
 * Build an absolute URL by appending `path` (and optional query string) to
 * the resolved origin. `path` must start with `/`.
 */
export async function buildAbsoluteUrl(
  path: string,
  params?: Record<string, string>,
): Promise<string> {
  const origin = await getRequestOrigin();
  const qs = params ? new URLSearchParams(params).toString() : '';
  return `${origin}${path}${qs ? `?${qs}` : ''}`;
}

/**
 * Pure origin-resolution decision (no server-only/headers deps, so it is
 * directly unit-testable). `src/lib/origin.ts` is the request-context wrapper.
 *
 * Resolution order
 *   1. `NEXT_PUBLIC_APP_URL` — explicit operator override, always wins.
 *   2. Production + non-empty `TRUSTED_HOSTS` — header host allowed only when
 *      allowlisted; anything else snaps to the first trusted host.
 *   3. Production + NO allowlist and NO override — `x-forwarded-host` is
 *      client-influenced behind a non-stripping proxy, so it is IGNORED: only
 *      the connection `host` header is used, and a differing forwarded host is
 *      reported back as a warning (a poisoned header must never mint
 *      reset/verify/payment links to an attacker domain).
 *   4. Non-production — trust the proxy pair so the ngrok /
 *      *.trycloudflare.com dev-tunnel workflow keeps working.
 */

export interface ResolveOriginInput {
  nodeEnv: string | undefined;
  /** NEXT_PUBLIC_APP_URL */
  appUrl: string | undefined;
  /** TRUSTED_HOSTS (comma-separated allowlist) */
  trustedHosts: string | undefined;
  xfHost: string | null;
  host: string | null;
  xfProto: string | null;
}

export interface ResolveOriginResult {
  origin: string;
  /** Set when a client-influenced header was rejected/ignored — caller logs it. */
  warning?: string;
}

function protoFor(host: string, xfProto: string | null): string {
  // Heuristic: localhost and bare IPs default to http, everything else https.
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  return xfProto ?? (isLocal ? 'http' : 'https');
}

export function resolveOrigin(input: ResolveOriginInput): ResolveOriginResult {
  // 1. Explicit canonical override always wins.
  const override = input.appUrl?.trim();
  if (override) return { origin: override.replace(/\/$/, '') };

  const isProd = input.nodeEnv === 'production';
  const trusted = (input.trustedHosts ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  // 3. Production WITHOUT any trust configuration: never trust the forwarded
  //    host — a poisoned x-forwarded-host must not become the link host.
  if (isProd && trusted.length === 0) {
    const host = input.host;
    if (!host) return { origin: 'http://localhost:3000' };
    const warning =
      input.xfHost && input.xfHost.toLowerCase() !== host.toLowerCase()
        ? `x-forwarded-host "${input.xfHost}" ignored (no NEXT_PUBLIC_APP_URL / TRUSTED_HOSTS configured) — using host "${host}"`
        : undefined;
    return { origin: `${protoFor(host, input.xfProto)}://${host}`, ...(warning && { warning }) };
  }

  const host = input.xfHost ?? input.host;
  if (!host) {
    // Genuine last-resort. Only reachable from code paths that lost the
    // request context — which the current callers don't, but the fallback
    // keeps callers honest if that changes.
    return { origin: 'http://localhost:3000' };
  }

  // 2. Production allowlist: a header host is trusted only when vouched for.
  if (isProd && trusted.length > 0 && !trusted.includes(host.toLowerCase())) {
    return {
      origin: `https://${trusted[0]}`,
      warning: `untrusted host rejected in production: ${host}`,
    };
  }

  // 4. Trusted (or non-production) header-derived host.
  return { origin: `${protoFor(host, input.xfProto)}://${host}` };
}

import { NextRequest } from 'next/server';
import { handlers } from '@/server/auth';
import { resolveOrigin } from '@/lib/origin-core';
import { log } from '@/lib/log';

// Auth.js needs Node.js (Prisma adapter). Force Node runtime explicitly so the
// proxy's edge runtime doesn't accidentally inherit here.
export const runtime = 'nodejs';

type RouteHandler = (req: NextRequest) => Promise<Response> | Response;

/**
 * Rebuild the request URL onto the REAL public origin so Auth.js derives the
 * correct OAuth `redirect_uri` and post-login redirect.
 *
 * Why: behind a tunnel/reverse proxy (ngrok, Cloudflare, nginx) the public host
 * lives in `Host` / `X-Forwarded-Host`, but Next's dev server builds
 * `Request.url` from its own bind address (`https://localhost:3000`). Auth.js
 * reads `Request.url`, so without this it forwards users to `localhost`.
 *
 * SECURITY (AUTH-002): the origin is resolved through the SAME allowlist /
 * fail-closed policy used to mint verify/reset/payment links
 * (`resolveOrigin` in `src/lib/origin-core.ts`) instead of blindly trusting the
 * forwarded header. A client-influenced `x-forwarded-host` is honored only when
 * vouched for by `NEXT_PUBLIC_APP_URL` / `TRUSTED_HOSTS` (production) or in a
 * non-production dev tunnel; otherwise it is ignored and the connection `host`
 * is used. A poisoned `X-Forwarded-Host` therefore can no longer move Auth.js's
 * redirect_uri or callback origin to an attacker domain. No-op for plain
 * localhost dev (rebuilt URL equals the original); touches only this Node route.
 */
function withForwardedHost(handler: RouteHandler): RouteHandler {
  return (req) => {
    const { origin, warning } = resolveOrigin({
      nodeEnv: process.env.NODE_ENV,
      appUrl: process.env.NEXT_PUBLIC_APP_URL,
      trustedHosts: process.env.TRUSTED_HOSTS,
      xfHost: req.headers.get('x-forwarded-host'),
      host: req.headers.get('host'),
      xfProto: req.headers.get('x-forwarded-proto'),
    });
    if (warning) log.error('auth origin resolve warning', { warning });

    const orig = new URL(req.url);
    const trusted = new URL(origin);
    const rebuilt = new URL(`${trusted.protocol}//${trusted.host}${orig.pathname}${orig.search}`);
    if (rebuilt.href === orig.href) return handler(req);

    const base = { method: req.method, headers: req.headers };
    // `duplex: 'half'` is required by undici/Node when forwarding a streamed
    // request body; the inferred (un-annotated) shape avoids the DOM-vs-Next
    // `RequestInit` typing clash. GET/HEAD carry no body.
    const init =
      req.method === 'GET' || req.method === 'HEAD'
        ? base
        : { ...base, body: req.body, duplex: 'half' as const };
    return handler(new NextRequest(rebuilt, init));
  };
}

export const GET = withForwardedHost(handlers.GET);
export const POST = withForwardedHost(handlers.POST);

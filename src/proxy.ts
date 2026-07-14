import NextAuth from 'next-auth';
import createIntlMiddleware from 'next-intl/middleware';
import { authConfig } from '@/server/auth/config';
import { routing } from '@/i18n/routing';

/**
 * Next 16 proxy (formerly `middleware.ts`).
 *
 * Two-stage processing:
 *  1. Auth.js evaluates the JWT and calls `authConfig.callbacks.authorized()` to
 *     decide whether the request may proceed. Unauthorised requests are
 *     redirected to /login automatically.
 *  2. next-intl handles locale negotiation and rewrites the URL.
 *
 * Both are wired here because Next allows only one root proxy. The JWT strategy
 * (configured in `authConfig`) keeps this edge-runtime-safe.
 */

const { auth: authProxy } = NextAuth(authConfig);
const intlProxy = createIntlMiddleware(routing);

export default authProxy((request) => {
  // Set internal header for server-side logic (e.g. Terms Gate redirection)
  request.headers.set('x-next-pathname', request.nextUrl.pathname);

  // Force default locale to Arabic for all new visitors by overriding Accept-Language,
  // but let next-intl process the NEXT_LOCALE cookie if the user explicitly switched.
  if (!request.cookies.has('NEXT_LOCALE')) {
    request.headers.set('accept-language', 'ar');
  }

  return intlProxy(request);
});

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};

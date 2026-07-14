import type { NextAuthConfig } from 'next-auth';
import { NextResponse } from 'next/server';
import { buildProviders } from './providers';
import { isGateOnlyRole, gateHomePath } from './roles';

/**
 * Edge-safe authentication configuration.
 *
 * This module is imported by the proxy (which runs in the edge runtime), so it
 * MUST NOT depend on Prisma directly — provider implementations only reference
 * Prisma through dynamic imports inside their `authorize` callbacks.
 *
 * The full auth handler with the Prisma adapter lives in `./index.ts` and is
 * only loaded from Node-runtime contexts (API routes, server actions, RSC).
 */

export const authConfig = {
  // Use JWT sessions so the proxy/edge runtime can resolve the user without hitting Prisma.
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
    // Auth.js's default `/api/auth/error` lives inside its built-in route
    // handler — when shown, it's whatever URL Auth.js's internal builder
    // resolves (which historically baked `localhost:3000` in front of it
    // even on tunnels / preview deploys). Pointing at our own `/login`
    // sidesteps that: the redirect lands on a real Crown Island page on
    // the actual request origin, and we surface the `?error=` code there.
    error: '/login',
  },
  // trustHost: true ensures Auth.js respects the x-forwarded-host header
  // provided by your tunnel (ngrok, localtunnel) or production proxy.
  // IMPORTANT: For this to be truly dynamic, you must REMOVE or COMMENT OUT
  // the AUTH_URL variable from your .env file.
  trustHost: true,
  providers: buildProviders(),
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        // role / email / phone are populated by the full handler in ./index.ts during sign-in.
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.uid as string) ?? session.user.id;
        if (token.role) session.user.role = token.role as string;
        if (token.termsAcceptedAt) {
          session.user.termsAcceptedAt = token.termsAcceptedAt as string;
        }
      }
      return session;
    },
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;

      // /admin/login is the in-app "you need to sign in" landing — it must be
      // reachable WITHOUT auth, otherwise the redirect chain loops.
      if (/^\/(?:[a-z]{2}\/)?admin\/login\/?$/i.test(path)) {
        return true;
      }

      // Guests may freely browse the catalog — the booking landing, category
      // pages, service lists and service-detail/date pages are all public so
      // visitors can explore and understand the experience before signing up.
      // Authentication is required only for routes that create or read real
      // user data: the booking commit/payment steps, the user's bookings,
      // profile, settings, menu, per-booking map and support.
      const requiresAuth =
        /^\/(?:[a-z]{2}\/)?(?:bookings|profile|settings|menu|map|support|booking\/(?:review|payment|success|failed))(?:\/|$)/i.test(
          path,
        );
      const requiresAdmin = /^\/(?:[a-z]{2}\/)?admin(?:\/|$)/i.test(path);
      // The gate scanner lives outside both the admin panel and the guest app.
      const requiresGate = /^\/(?:[a-z]{2}\/)?gate(?:\/|$)/i.test(path);
      // Paymob's browser redirect for MOBILE-APP payments. Sessionless static
      // page (no user data) — it must render for WHOEVER the browser happens
      // to be signed in as (or nobody), so it is exempt from the gate-only
      // confinement below: a staff cookie in the phone's browser must not
      // hijack a customer's payment return into the gate scanner.
      const isPaymentReturn = /^\/(?:[a-z]{2}\/)?payment-return(?:\/|$)/i.test(path);

      // STAFF / SECURITY are confined to the gate scanner and must never see a
      // customer page — including the PUBLIC landing (`/`) and booking catalog
      // (`/booking/**`). This confinement therefore runs BEFORE the public-route
      // bail-out below: a signed-in gate-only account that reaches for anything
      // outside `/gate/**` is bounced back to `/gate/scan` instead of being shown
      // the customer experience. (Guests — no `auth.user` — are unaffected.)
      if (auth?.user && isGateOnlyRole(auth.user.role) && !requiresGate && !isPaymentReturn) {
        // Each gate-only role has a home: ops staff → the housekeeping &
        // maintenance desk, everyone else → the scanner.
        return NextResponse.redirect(new URL(gateHomePath(auth.user.role), request.nextUrl));
      }

      // Public route — nothing to enforce (guests + signed-in customers).
      if (!requiresAuth && !requiresAdmin && !requiresGate) return true;

      // Every protected route needs a session. Unauthenticated requests fall
      // through to the normal Auth.js sign-in redirect.
      if (!auth?.user) return false;

      // Admin / gate routes: signed-in non-gate users are allowed past the proxy
      // so the route's layout can render its own role-aware 403 for the cases
      // that aren't permitted (e.g. a customer opening /admin or /gate). Within
      // `/gate/**`, SECURITY reaching `/gate/reception` is 403'd by that page's
      // `requireReceptionOrNull` guard, so SECURITY is limited to `/gate/scan`
      // while STAFF also gets the reception desk. Guest pages are open to any
      // signed-in customer.
      return true;
    },
  },
} satisfies NextAuthConfig;

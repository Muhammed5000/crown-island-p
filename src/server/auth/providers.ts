import type { Provider } from 'next-auth/providers';
import Google from 'next-auth/providers/google';
import Facebook from 'next-auth/providers/facebook';
import Apple from 'next-auth/providers/apple';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { canUseStaffPassword, isPrivilegedRole } from './roles';
import { log, errFields } from '@/lib/log';

/**
 * Build the OAuth + customer-password + admin-password provider list at boot.
 *
 * OAuth providers are *conditionally* registered: if their environment
 * variables are blank (the dev default) they're omitted so the login page
 * only renders buttons that actually work.
 *
 * Two credential providers live alongside the OAuth ones:
 *  - `customer-password` — email + password for customer accounts. The user
 *     must have set a password during the email-verified registration flow.
 *  - `admin-password` — email + password for every staff-area role.
 *     Customers cannot sign in through this provider.
 *
 * The legacy phone-OTP provider has been removed. Email is now the only
 * passwordless flow.
 */
/**
 * Auto-link OAuth sign-ins to an existing User with the same email.
 *
 * SECURITY TRADEOFF — read before changing:
 *
 *   With `allowDangerousEmailAccountLinking: true`, if an OAuth provider
 *   returns an email that already matches a Crown Island `User` row created
 *   any other way (password sign-up, admin CLI, prior OAuth via a different
 *   provider), Auth.js automatically attaches the new `Account` record to
 *   that existing user instead of rejecting with `OAuthAccountNotLinked`.
 *
 *   This is the product behaviour requested by the team: "if a user already
 *   exists, no problem to continue."
 *
 *   The trust model shifts to: **whoever controls the email controls the
 *   account.** That includes accounts originally protected by a password
 *   the email-controller doesn't know. The realistic threat is an attacker
 *   who briefly takes over an inbox (SIM-swap on a phone-recovery account,
 *   reused Google password from a data breach, etc.) and can then sign in
 *   to Crown Island via Google as that user — including privileged ADMIN /
 *   SUPER_ADMIN / DEVELOPER accounts.
 *
 *   Mitigations to consider IF/WHEN privileged accounts grow in number:
 *     - Add a `signIn` callback that refuses OAuth linking when the existing
 *       user's role is privileged. Effect: admins must use the password
 *       sign-in path at `/admin/login` exclusively. Doable in a single
 *       callback and a regression-test update.
 *     - Require step-up auth (password re-check) before the JWT is granted
 *       admin role.
 *
 *   This module turns the flag on for all three social providers. The
 *   credentials providers below don't use it — they're proving knowledge
 *   of a password, which is a different trust model.
 *
 *   Note: If you still see OAuthAccountNotLinked, ensure the existing User
 *   record has the same email and that the OAuth provider (Google) is 
 *   successfully returning that email address.
 */
const OAUTH_LINKING = { allowDangerousEmailAccountLinking: true } as const;

/**
 * Reversible kill-switch — Facebook & Apple sign-in are DISABLED until further
 * notice (product decision). This gates BOTH the provider registration (so the
 * OAuth callback cannot complete even if credentials exist) AND the login-page
 * buttons (via `activeProviderIds`, which the login page reads to decide which
 * buttons to render). To re-enable later: flip the relevant flag to `true` AND
 * provide the matching AUTH_FACEBOOK_ID/SECRET or AUTH_APPLE_ID/SECRET env vars.
 * Google and email/password sign-in are unaffected.
 */
const FACEBOOK_LOGIN_ENABLED = false;
const APPLE_LOGIN_ENABLED = false;

/** Best-effort client IP from request headers (no server-only import — keeps this module edge-safe). */
function ipFromHeaders(headers?: Headers | null): string | null {
  if (!headers) return null;
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip');
}

/**
 * Record a failed sign-in against a REAL account in the audit log.
 *
 * Only called when the email matched an existing user — never for unknown
 * emails. That keeps the signal meaningful (someone is targeting a real
 * account), avoids unbounded bot-noise rows, and avoids turning the audit log
 * into a user-enumeration oracle. Best-effort: a logging failure must never
 * block (or leak through) the auth response, so errors are swallowed.
 *
 * `auditStandalone` is dynamically imported because it pulls in Prisma
 * (`server-only`); a top-level import would break this module's edge-safety.
 */
async function recordFailedLogin(
  userId: string,
  email: string,
  reason: 'bad_password' | 'insufficient_role',
  request?: Request,
): Promise<void> {
  try {
    const { auditStandalone } = await import('@/server/audit/audit');
    const headers = request?.headers;
    await auditStandalone({
      actorUserId: userId,
      action: 'LOGIN',
      entityType: 'User',
      entityId: userId,
      after: { success: false, reason, email },
      ipAddress: ipFromHeaders(headers),
      userAgent: headers?.get('user-agent') ?? null,
    });
  } catch (err) {
    log.warn('auth failed-login audit could not be written', { ...errFields(err) });
  }
}

export function buildProviders(): Provider[] {
  const providers: Provider[] = [];

  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
    providers.push(
      Google({
        clientId: process.env.AUTH_GOOGLE_ID,
        clientSecret: process.env.AUTH_GOOGLE_SECRET,
        // Always show Google's account chooser. Without this, a returning user
        // who already has a Google session is silently re-authenticated with the
        // previously-used account — so "Sign in with Google" can never switch to
        // a different account. `select_account` forces the picker every time.
        authorization: { params: { prompt: 'select_account' } },
        ...OAUTH_LINKING,
      }),
    );
  }

  if (FACEBOOK_LOGIN_ENABLED && process.env.AUTH_FACEBOOK_ID && process.env.AUTH_FACEBOOK_SECRET) {
    providers.push(
      Facebook({
        clientId: process.env.AUTH_FACEBOOK_ID,
        clientSecret: process.env.AUTH_FACEBOOK_SECRET,
        ...OAUTH_LINKING,
      }),
    );
  }

  if (APPLE_LOGIN_ENABLED && process.env.AUTH_APPLE_ID && process.env.AUTH_APPLE_SECRET) {
    providers.push(
      Apple({
        clientId: process.env.AUTH_APPLE_ID,
        clientSecret: process.env.AUTH_APPLE_SECRET,
        ...OAUTH_LINKING,
      }),
    );
  }

  // ─── Customer email + password ────────────────────────────────────────
  providers.push(
    Credentials({
      id: 'customer-password',
      name: 'Customer password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(rawCredentials, request) {
        const schema = z.object({
          email: z.string().trim().email().max(254).transform((s) => s.toLowerCase()),
          password: z.string().min(1).max(200),
        });
        const parsed = schema.safeParse(rawCredentials);
        if (!parsed.success) return null;

        const { prisma } = await import('@/server/db/prisma');
        const { compare } = await import('bcryptjs');
        const { consumeLoginAttemptEmailAndIp, clearLoginAttempts } = await import(
          '@/server/auth/rate-limit'
        );

        // Brute-force throttle (grace-then-backoff), keyed per email AND per source
        // IP: guessing one account is slowed after a few failures, and a password
        // spray across many emails from one IP is bounded too (the per-email counter
        // alone can't stop spraying — each fresh email gets its own grace). Counters
        // are cleared on a correct password so legitimate sign-ins are never delayed.
        // A throttled attempt returns the same `null` as a bad password (no oracle).
        const ip = ipFromHeaders((request as Request | undefined)?.headers);
        if (!(await consumeLoginAttemptEmailAndIp(parsed.data.email, ip)).ok) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            role: true,
            passwordHash: true,
            emailVerified: true,
            deletedAt: true,
            blockedAt: true,
          },
        });
        // Archived (soft-deleted) OR blocked (banned) accounts cannot authenticate.
        if (!user || !user.passwordHash || !user.emailVerified || user.deletedAt || user.blockedAt) return null;

        const ok = await compare(parsed.data.password, user.passwordHash);
        if (!ok) {
          await recordFailedLogin(user.id, parsed.data.email, 'bad_password', request as Request | undefined);
          return null;
        }

        // AUTH-006: this door is CUSTOMER-only. A privileged (staff/admin) account
        // must authenticate through `admin-password` so the surfaces stay distinct
        // (otherwise a correct staff password here would drop them into the customer
        // app). The password was already correct, so this is separation, not an
        // extra credential check — reject it regardless.
        if (isPrivilegedRole(user.role)) return null;

        // Correct password — clear the throttles so the next sign-in is instant.
        await clearLoginAttempts(parsed.data.email, ip);

        // This provider is for customers and verified accounts only — admin
        // sign-in goes through `admin-password` so the surfaces stay distinct.
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  );

  // ─── Admin email + password (restricted to staff roles) ───────────────
  providers.push(
    Credentials({
      id: 'admin-password',
      name: 'Admin password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(rawCredentials, request) {
        const schema = z.object({
          email: z.string().email().max(254),
          password: z.string().min(1).max(200),
        });
        const parsed = schema.safeParse(rawCredentials);
        if (!parsed.success) return null;

        const { prisma } = await import('@/server/db/prisma');
        const { compare } = await import('bcryptjs');
        const { consumeLoginAttemptEmailAndIp, clearLoginAttempts } = await import(
          '@/server/auth/rate-limit'
        );

        // Brute-force throttle (grace-then-backoff) keyed per email AND per source
        // IP — privileged admin sign-in cannot be guessed without limit, and a
        // password spray across many admin emails from one IP is bounded. Cleared
        // on a correct password (below).
        const ip = ipFromHeaders((request as Request | undefined)?.headers);
        if (!(await consumeLoginAttemptEmailAndIp(parsed.data.email, ip)).ok) return null;

        // Raw query — works even before `prisma generate` has been re-run
        // against the latest schema.
        const rows = await prisma.$queryRaw<
          Array<{
            id: string;
            email: string | null;
            name: string | null;
            image: string | null;
            role: string;
            passwordHash: string | null;
          }>
        >`
          SELECT "id", "email", "name", "image", "role", "passwordHash"
          FROM "User"
          WHERE LOWER("email") = LOWER(${parsed.data.email})
            AND "deletedAt" IS NULL
            AND "blockedAt" IS NULL
          LIMIT 1
        `;
        const user = rows[0];
        if (!user || !user.passwordHash) return null;

        const ok = await compare(parsed.data.password, user.passwordHash);
        if (!ok) {
          await recordFailedLogin(user.id, parsed.data.email, 'bad_password', request as Request | undefined);
          return null;
        }

        // Correct password — clear the throttles so legitimate staff sign-in is instant.
        await clearLoginAttempts(parsed.data.email, ip);

        if (!canUseStaffPassword(user.role)) {
          // Valid password but not a staff role — a customer trying the admin
          // door. Security-relevant: worth a row even though the creds checked out.
          await recordFailedLogin(user.id, parsed.data.email, 'insufficient_role', request as Request | undefined);
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  );

  return providers;
}

/** Names of the currently-active providers, exposed to the UI so dead buttons aren't rendered. */
export function activeProviderIds(): Set<string> {
  const ids = new Set<string>(['customer-password', 'admin-password']);
  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) ids.add('google');
  if (FACEBOOK_LOGIN_ENABLED && process.env.AUTH_FACEBOOK_ID && process.env.AUTH_FACEBOOK_SECRET) ids.add('facebook');
  if (APPLE_LOGIN_ENABLED && process.env.AUTH_APPLE_ID && process.env.AUTH_APPLE_SECRET) ids.add('apple');
  return ids;
}

import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/server/db/prisma';
import { authConfig } from './config';
import { isPrivilegedRole } from './roles';
import { isAnyIdentityBlocked } from '@/server/services/blocklist';
import { log, errFields } from '@/lib/log';

function stripTokenIdentity(token: Record<string, unknown>): void {
  delete token.uid;
  delete token.sub;
  delete token.role;
  delete token.name;
  delete token.email;
  delete token.phone;
  delete token.picture;
  delete token.image;
}

/**
 * Full Auth.js handler with the Prisma adapter.
 *
 * Imported only from Node-runtime contexts (API routes, server actions, server
 * components). The proxy uses the lighter `./config` instead.
 *
 * Admin bootstrap policy
 * ──────────────────────
 * Role assignment NEVER happens inside an auth callback. Earlier revisions of
 * this file auto-promoted any sign-in whose email matched `ADMIN_BOOTSTRAP_EMAIL`
 * to SUPER_ADMIN. That env var was advertised in the README alongside the
 * default admin password, which meant any deployment that forgot to unset the
 * variable (or rotated the password) was one OAuth registration away from
 * total takeover. The callback was removed in full.
 *
 * To create the first admin, run the CLI script out-of-band:
 *
 *     npm run admin:create -- <email> [<password>] [--role=SUPER_ADMIN]
 *
 * That script (`scripts/create-admin.ts`) is the only supported path to mint
 * privileged accounts. Subsequent role changes go through `/admin/users` and
 * are written by `adminUpdateUser`, which requires SUPER_ADMIN to call.
 *
 * `ADMIN_BOOTSTRAP_EMAIL` is still read elsewhere — by
 * `resolveAdminNotifyEmail()` in `src/server/settings/settings.ts` — as a
 * fallback for the *notification recipient* address. That use does not touch
 * roles or sessions and is unaffected by this change.
 */
export const { auth, handlers, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  // Note: tunnel/proxy host handling (so OAuth redirect_uri + the post-login
  // redirect use the real public origin instead of localhost) is done in the
  // auth route handler — see src/app/api/auth/[...nextauth]/route.ts. It fixes
  // Request.url from the forwarded host, which is cleaner and fully dynamic
  // (no env var, works on localhost AND any tunnel).
  callbacks: {
    ...authConfig.callbacks,
    /**
     * Refuse OAuth account-linking onto an existing PRIVILEGED account.
     *
     * `allowDangerousEmailAccountLinking` (set on every social provider) means
     * an OAuth sign-in whose email matches an existing User is auto-attached to
     * that user. For customers this is the requested "just continue" behaviour.
     * For staff/admin it is a privilege-escalation path: anyone who briefly
     * controls a privileged user's inbox (SIM-swap, breached Google password)
     * could sign in as that admin via Google without ever knowing the password.
     *
     * This guard blocks that: privileged roles must use the password path at
     * `/admin/login`. Credential sign-ins are untouched (they already prove
     * knowledge of a password). If account state cannot be checked, fail closed:
     * availability must not bypass the privileged-link check.
     */
    async signIn({ user, account, profile }) {
      if (!account || account.type === 'credentials') return true;

      const email = (
        (user?.email ?? (profile?.email as string | undefined)) ?? ''
      )
        .trim()
        .toLowerCase();
      if (!email) return true;

      try {
        const existing = await prisma.user.findUnique({
          where: { email },
          select: { id: true, role: true, deletedAt: true, blockedAt: true },
        });

        if (existing) {
          // Privileged accounts must use the password path at /admin/login —
          // OAuth-linking onto staff/admin is a privilege-escalation vector.
          if (isPrivilegedRole(existing.role)) return false;
          // BLOCKED/banned accounts can never come back via OAuth.
          if (existing.blockedAt) return false;
          // A banned EMAIL is rejected even if this row isn't itself flagged.
          if (await isAnyIdentityBlocked([{ kind: 'EMAIL', value: email }])) {
            return false;
          }
          // An ARCHIVED (admin-removed, soft-deleted) account is REACTIVATED in
          // place — the same policy magic-link/register already apply. The OAuth
          // sign-in proves inbox ownership, so we clear `deletedAt` to restore
          // the account (its bookings/history are intact) instead of dead-ending
          // the user on ?error=AccessDenied. We MUST persist this clear here:
          // the jwt re-hydration below treats a `deletedAt` row as logged-out,
          // so merely allowing sign-in without un-archiving would bounce them
          // straight back to anonymous.
          if (existing.deletedAt) {
            await prisma.user.update({
              where: { id: existing.id },
              data: { deletedAt: null },
            });
          }
          return true;
        }

        // No account yet — block a banned identity from signing up fresh via OAuth.
        if (await isAnyIdentityBlocked([{ kind: 'EMAIL', value: email }])) {
          return false;
        }
      } catch (err) {
        log.warn('auth signIn denied — privileged-link check unavailable', { ...errFields(err) });
        return false;
      }
      return true;
    },
    async jwt(params) {
      const token = await authConfig.callbacks!.jwt!(params);
      const userId = (token.uid as string) || params.user?.id;

      // Re-hydrate role / name / email / phone from DB on every session check.
      // This ensures that if an admin changes a user's role, the user's session
      // picks it up without them having to sign out and sign back in.
      if (userId) {
        // Re-hydration touches the database, which may be unreachable in local
        // A thrown error here must not preserve a stale privileged identity.
        // Strip the token identity and resolve the request as anonymous instead.
        let dbUser:
          | { role: unknown; name: unknown; email: unknown; phone: unknown; image: unknown; termsAcceptedAt: Date | null; deletedAt: Date | null; blockedAt: Date | null; tokenVersion: number }
          | null = null;
        try {
          dbUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { role: true, name: true, email: true, phone: true, image: true, termsAcceptedAt: true, deletedAt: true, blockedAt: true, tokenVersion: true },
          });
        } catch (err) {
          log.warn('auth denying JWT re-hydration — database unreachable', { ...errFields(err) });
          stripTokenIdentity(token as Record<string, unknown>);
          return token;
        }
        // An archived (soft-deleted) OR blocked account is treated exactly like a
        // missing one: strip its identity so the session resolves to anonymous
        // and the user is bounced to the login page on their next request — a
        // live block takes effect on the blocked user's very next request.
        if (dbUser && !dbUser.deletedAt && !dbUser.blockedAt) {
          // Session-invalidation: a password reset/change bumps the user's
          // tokenVersion. On RE-HYDRATION (no fresh `params.user`), a token whose
          // version no longer matches the DB is stale → strip its identity so the
          // session resolves to anonymous on the next request. Tokens issued
          // before this column existed carry no numeric version and are
          // grandfathered (not evicted) — they adopt the current version below.
          const tokenVer = (token as Record<string, unknown>).tokenVersion;
          if (!params.user && typeof tokenVer === 'number' && tokenVer !== dbUser.tokenVersion) {
            stripTokenIdentity(token as Record<string, unknown>);
            return token;
          }
          (token as Record<string, unknown>).role = dbUser.role;
          (token as Record<string, unknown>).name = dbUser.name;
          (token as Record<string, unknown>).email = dbUser.email;
          (token as Record<string, unknown>).phone = dbUser.phone;
          (token as Record<string, unknown>).image = dbUser.image;
          (token as Record<string, unknown>).termsAcceptedAt = dbUser.termsAcceptedAt?.toISOString() ?? null;
          (token as Record<string, unknown>).tokenVersion = dbUser.tokenVersion;
        } else if (!params.user) {
          // The user this token references no longer exists — e.g. the database
          // was reset (SQLite → Postgres migration) or the account was deleted.
          // This branch only runs on RE-HYDRATION (no fresh `params.user`), so a
          // legitimate sign-in is never affected. Strip the identity so the
          // session resolves to anonymous instead of leaving the visitor in a
          // half-authenticated state that forces them onto /profile/complete and
          // hides the sign-in options. `getSessionUser()` then returns null and
          // the login page renders the OAuth buttons as expected.
          stripTokenIdentity(token as Record<string, unknown>);
        }
      }
      return token;
    },
  },
});

import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { buildAbsoluteUrl } from '@/lib/origin';

/**
 * Cryptographically random token helpers for magic-link + password-reset
 * flows.
 *
 * Threat model:
 *  - The raw token only ever leaves our server inside the email body. We
 *    store its SHA-256 hash, so even a DB read can't be used to mint a
 *    valid link.
 *  - 32 random bytes → 256 bits of entropy, URL-safe base64 (no padding).
 *  - Single-use: callers consume the token, marking `usedAt` to prevent
 *    replay.
 */

/** Generate a fresh URL-safe token. ~43 characters. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Hash a token for storage / lookup. Stable: same input → same output. */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/** Default lifetime for email verification + password reset links. */
export const EMAIL_VERIFICATION_TTL_MINUTES = 30;
export const PASSWORD_RESET_TTL_MINUTES = 30;

export function tokenExpiresAt(minutesFromNow: number): Date {
  return new Date(Date.now() + minutesFromNow * 60 * 1_000);
}

/**
 * Build the absolute URL the user clicks on (verify-email, password-reset).
 *
 * Origin resolution is delegated to `getRequestOrigin()` — `NEXT_PUBLIC_APP_URL`
 * still wins if explicitly set, but the default is now the *actual* request
 * origin (Vercel host, ngrok tunnel, prod domain), not `localhost:3000`.
 *
 * This is async because deriving the origin reads request headers.
 */
export async function buildLink(
  path: string,
  params: Record<string, string>,
): Promise<string> {
  return buildAbsoluteUrl(path, params);
}

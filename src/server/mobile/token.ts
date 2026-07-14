import 'server-only';
import crypto from 'crypto';

/**
 * Bearer tokens for the mobile app (`/api/mobile/**`).
 *
 * The website itself authenticates with Auth.js httpOnly cookies, which a
 * native app cannot use. Mobile clients instead receive a compact signed
 * token from `/api/mobile/auth/login` / `register/complete` and send it back
 * as `Authorization: Bearer <token>`.
 *
 * Format mirrors `src/lib/qr.ts` (base64url(JSON payload) + "." + HMAC-SHA256
 * signature) but with a DIFFERENT derived key (`AUTH_SECRET + ":mobile-auth"`)
 * and a `typ: 'mobile'` claim, so a QR visit token can never be replayed as a
 * session token or vice versa.
 *
 * The token only proves "this is user X (at session epoch `tv`) until exp".
 * Role, block and delete status are NEVER trusted from the token —
 * `getMobileUser()` re-reads the user row on every request, exactly like the web
 * JWT re-hydration, so bans and role changes take effect on the user's very next
 * request. AUTH-005: the token also carries the session epoch (`tv` =
 * User.tokenVersion) so that a password change / "sign out everywhere" / reset —
 * all of which bump tokenVersion — immediately invalidate an OLD 30-day mobile
 * token, instead of leaving a stolen one valid for up to a month.
 */

export interface MobileTokenPayload {
  typ: 'mobile';
  /** User id. */
  uid: string;
  /** Session epoch — must equal the user's current `tokenVersion` (AUTH-005). */
  tv: number;
  /** Issued-at, unix seconds. */
  iat: number;
  /** Expiry, unix seconds. */
  exp: number;
}

export const MOBILE_TOKEN_TTL_DAYS = 30;

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set; cannot sign mobile tokens');
  // Domain-separated key so mobile tokens and QR tokens can never cross over.
  return `${s}:mobile-auth`;
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function signMobileToken(userId: string, tokenVersion: number): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: MobileTokenPayload = {
    typ: 'mobile',
    uid: userId,
    tv: tokenVersion,
    iat: now,
    exp: now + MOBILE_TOKEN_TTL_DAYS * 24 * 60 * 60,
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', getSecret()).update(body).digest();
  return `${body}.${base64UrlEncode(sig)}`;
}

export function verifyMobileToken(token: string): MobileTokenPayload | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let expected: Buffer;
  try {
    expected = crypto.createHmac('sha256', getSecret()).update(body).digest();
  } catch {
    return null;
  }
  let provided: Buffer;
  try {
    provided = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (expected.length !== provided.length) return null;
  if (!crypto.timingSafeEqual(expected, provided)) return null;

  let payload: MobileTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (payload?.typ !== 'mobile') return null;
  if (typeof payload.uid !== 'string' || !payload.uid) return null;
  if (typeof payload.tv !== 'number') return null; // AUTH-005: epoch must be present
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
  return payload;
}

/**
 * Pure data-shaping helpers — no DB, no secrets, no I/O. Intentionally NOT
 * marked `server-only` so the regression test can import them directly under
 * Node's built-in test runner without a bundler shim. The calling module
 * (`./audit.ts`) carries the server-only guard, which is sufficient: there
 * is no path for these helpers to reach a client bundle that doesn't also
 * pull in audit writes.
 */
import type { User } from '@prisma/client';

/**
 * Safe projections + redaction helpers for audit log writes.
 *
 * Audit rows are queryable by any STAFF / ADMIN / SUPER_ADMIN through the
 * `/admin/audit-logs` page and exported via the reporting flow. That makes
 * them an unsuitable home for any value that should NEVER be read offline:
 *  - bcrypt password hashes
 *  - email-verification / password-reset token hashes
 *  - OAuth access / refresh / id tokens
 *  - session tokens
 *
 * Two layers protect against accidental leaks:
 *
 *   1. **Allowlist projections** (preferred) — call `auditableUser()` on a
 *      Prisma `User` row before passing it as `before`/`after`. Only the
 *      explicitly listed columns survive; new columns added to the User
 *      model are excluded by default until a maintainer opts them in.
 *
 *   2. **Defensive redaction** (backstop) — the `audit()` / `auditStandalone()`
 *      writers run `redactSensitive()` over their `before`/`after` payloads.
 *      Any key whose name matches a known secret-bearing field is replaced
 *      with the literal string `[REDACTED]` before the JSON hits Prisma.
 *      Layer 1 is the contract; layer 2 catches mistakes.
 *
 * Allowlists are preferred to denylists for the projection because the
 * `User` model gains fields over time. If we redacted by a fixed denylist
 * we would silently leak the next sensitive column anyone adds.
 */

// ────────────────────────────────────────────────────────────────────────
// 1) User allowlist projection
// ────────────────────────────────────────────────────────────────────────

/**
 * Fields from `User` that are safe to persist into an `AuditLog` row.
 *
 * Add-only contract: when you add a new column to the `User` model, decide
 * deliberately whether it belongs here. If you're not sure, leave it out —
 * an audit row missing a value is recoverable; one containing a secret is
 * not.
 *
 * Intentionally excluded: `passwordHash` (bcrypt secret).
 */
export const AUDITABLE_USER_FIELDS = [
  'id',
  'email',
  'emailVerified',
  'phone',
  'phoneVerified',
  'name',
  'image',
  'role',
  'createdAt',
  'updatedAt',
] as const satisfies ReadonlyArray<keyof User>;

export type AuditableUser = Pick<User, (typeof AUDITABLE_USER_FIELDS)[number]>;

/**
 * Project a `User` (or partial user) into the audit-safe shape. Tolerates
 * `null` / `undefined` so callers can pass `before` from a `findUnique()`
 * result without a branch.
 */
export function auditableUser(user: User | null | undefined): AuditableUser | null {
  if (!user) return null;
  const out = {} as AuditableUser;
  for (const key of AUDITABLE_USER_FIELDS) {
    // Index access is type-safe via the satisfies clause above.
    (out as Record<string, unknown>)[key] = user[key];
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// 2) Defensive backstop redaction
// ────────────────────────────────────────────────────────────────────────

/**
 * Property names that must never be persisted into an audit row, regardless
 * of which entity they appear under. Matched case-insensitively against the
 * exact key name (no substring matching — keeps things predictable).
 *
 * If you find yourself wanting to log one of these, that's the signal to
 * rework the design rather than relax the list.
 */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set(
  [
    'passwordHash',
    'password',
    'pinHash',
    'pin',
    'tokenHash',
    'token',
    'accessToken',
    'refreshToken',
    'idToken',
    'sessionToken',
    'clientSecret',
    'paymobSecretKey',
    'paymobHmacSecret',
    'mpgsPassword',
    'mpgsWebhookSecret',
    'authSecret',
    // Government-ID numbers. `guestName` is the column holding a guest's ID /
    // passport NUMBER (not a person's name); the intentional audit logs it
    // pre-masked under a different key. These backstop any raw leak.
    'guestName',
    'nationalId',
    'passportId',
    'idNumber',
  ].map((k) => k.toLowerCase()),
);

const REDACTED = '[REDACTED]' as const;

/** Maximum nesting we walk. Cycles or absurdly deep trees stop at this depth. */
const MAX_DEPTH = 8;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively walk a JSON-serialisable value and replace any property whose
 * key matches `SENSITIVE_KEYS` with the literal `[REDACTED]`. Dates, arrays,
 * and primitives are returned unchanged. Class instances other than plain
 * objects are passed through untouched — Prisma already refuses to JSON
 * non-serialisable values, so a downstream error is the right outcome.
 *
 * This is a *backstop*. The right fix is to use `auditableUser()` (or its
 * future siblings) at the call site so secret-bearing fields never reach
 * the audit boundary at all.
 */
export function redactSensitive<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactSensitive(v, depth + 1)) as unknown as T;
  }
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = REDACTED;
      continue;
    }
    out[k] = redactSensitive(v, depth + 1);
  }
  return out as unknown as T;
}

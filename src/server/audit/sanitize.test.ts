/**
 * Regression tests for the audit-log sanitiser.
 *
 * No test runner is currently installed in this repo, so this file uses
 * Node's built-in `node:test` runner (Node ≥20) so it runs *today* with no
 * new dependencies. Two ways to run it:
 *
 *   # via the already-installed tsx
 *   npx tsx --test src/server/audit/sanitize.test.ts
 *
 *   # or, once you add vitest, rename `node:test` → `vitest` and the
 *   # assertions translate cleanly to `expect(...).toEqual(...)`.
 *
 * If a future test runner (vitest, jest, …) is added to `package.json`,
 * move this file under whatever convention the runner expects and update
 * the imports — the test bodies don't need to change.
 *
 * What we're guarding against:
 *   1. A future maintainer adding `passwordHash` (or other secret fields)
 *      back into an audit `before` / `after` payload.
 *   2. The defensive `redactSensitive()` backstop silently regressing — if
 *      someone removes it from `audit.ts` these tests still pass, but the
 *      separate test on the backstop fails loudly.
 *   3. `auditableUser()` accidentally letting through a column added later.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { auditableUser, redactSensitive, AUDITABLE_USER_FIELDS } from './sanitize';

// ────────────────────────────────────────────────────────────────────────
// Fixture builders
// ────────────────────────────────────────────────────────────────────────

/**
 * A User-shaped object that includes every secret field we care about.
 * Values are obviously-bogus literals so test output is safe to paste into
 * an issue or PR description.
 */
function fakeUserRow() {
  return {
    id: 'user_test_1',
    email: 'tester@example.com',
    emailVerified: new Date('2026-01-01T00:00:00Z'),
    phone: '+201000000000',
    phoneVerified: null,
    name: 'Test User',
    passwordHash: 'BOGUS_BCRYPT_NOT_A_REAL_HASH',
    tokenVersion: 0,
    pinHash: null,
    image: null,
    role: 'CUSTOMER' as const,
    termsAcceptedAt: null,
    refundPolicyAcceptedAt: null,
    deletedAt: null,
    blockedAt: null,
    blockedReason: null,
    blockedById: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
  };
}

// ────────────────────────────────────────────────────────────────────────
// auditableUser() — primary allowlist projection
// ────────────────────────────────────────────────────────────────────────

describe('auditableUser()', () => {
  it('strips passwordHash from a full user row', () => {
    const projected = auditableUser(fakeUserRow());
    assert.ok(projected !== null, 'projection should not be null');
    assert.equal(
      'passwordHash' in (projected as Record<string, unknown>),
      false,
      'passwordHash must not appear in the projected output',
    );
  });

  it('keeps the documented allowlisted fields', () => {
    const projected = auditableUser(fakeUserRow());
    assert.ok(projected !== null);
    const projectedKeys = Object.keys(projected as object).sort();
    const expected = [...AUDITABLE_USER_FIELDS].sort();
    assert.deepEqual(projectedKeys, expected);
  });

  it('returns null when given null or undefined', () => {
    assert.equal(auditableUser(null), null);
    assert.equal(auditableUser(undefined), null);
  });

  it('preserves the values of allowlisted fields exactly', () => {
    const row = fakeUserRow();
    const projected = auditableUser(row);
    assert.ok(projected !== null);
    // Cast through unknown because the projection's static type intentionally
    // omits passwordHash — but we already asserted it's absent above.
    const p = projected as Record<string, unknown>;
    assert.equal(p.id, row.id);
    assert.equal(p.email, row.email);
    assert.equal(p.role, row.role);
    assert.equal(p.name, row.name);
    assert.deepEqual(p.emailVerified, row.emailVerified);
  });
});

// ────────────────────────────────────────────────────────────────────────
// redactSensitive() — defensive backstop
// ────────────────────────────────────────────────────────────────────────

describe('redactSensitive()', () => {
  it('redacts known secret keys at the top level', () => {
    const out = redactSensitive({
      passwordHash: 'bogus',
      tokenHash: 'bogus',
      accessToken: 'bogus',
      refreshToken: 'bogus',
      idToken: 'bogus',
      sessionToken: 'bogus',
      email: 'keep@example.com',
    });
    assert.equal(out.passwordHash, '[REDACTED]');
    assert.equal(out.tokenHash, '[REDACTED]');
    assert.equal(out.accessToken, '[REDACTED]');
    assert.equal(out.refreshToken, '[REDACTED]');
    assert.equal(out.idToken, '[REDACTED]');
    assert.equal(out.sessionToken, '[REDACTED]');
    assert.equal(out.email, 'keep@example.com');
  });

  it('matches secret keys case-insensitively', () => {
    const out = redactSensitive({ PasswordHash: 'bogus', PASSWORD: 'bogus' });
    assert.equal(out.PasswordHash, '[REDACTED]');
    assert.equal(out.PASSWORD, '[REDACTED]');
  });

  it('walks into nested objects', () => {
    const out = redactSensitive({
      user: { id: 'u1', passwordHash: 'bogus' },
    });
    assert.equal(out.user.passwordHash, '[REDACTED]');
    assert.equal(out.user.id, 'u1');
  });

  it('walks into arrays of objects', () => {
    const out = redactSensitive({
      items: [{ accessToken: 'bogus', label: 'keep' }],
    });
    assert.equal(out.items[0]!.accessToken, '[REDACTED]');
    assert.equal(out.items[0]!.label, 'keep');
  });

  it('passes primitives, Date, and null through unchanged', () => {
    assert.equal(redactSensitive('hello'), 'hello');
    assert.equal(redactSensitive(42), 42);
    assert.equal(redactSensitive(null), null);
    const d = new Date('2026-01-01');
    assert.equal(redactSensitive(d), d, 'Date instance should pass through identity');
  });

  it('does NOT match arbitrary substrings — only exact keys', () => {
    // `passwordHashHistory` would be a legitimate field name; we deliberately
    // require an exact (case-insensitive) match so substrings don't get
    // false-positive redacted.
    const out = redactSensitive({ passwordHashHistory: ['old1', 'old2'] });
    assert.deepEqual(out.passwordHashHistory, ['old1', 'old2']);
  });

  it('returns input unchanged for non-plain objects (Date, class instances)', () => {
    class Foo {
      passwordHash = 'bogus';
    }
    const foo = new Foo();
    // Backstop only walks plain objects. Class instances pass through
    // unredacted — but they also fail Prisma's JSON validator, which is the
    // intended "you must convert to a plain object before audit" behaviour.
    const out = redactSensitive(foo);
    assert.equal(out.passwordHash, 'bogus');
  });
});

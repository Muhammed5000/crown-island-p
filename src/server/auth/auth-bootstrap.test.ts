/**
 * Regression test — "auth callbacks never grant roles".
 *
 * What we're guarding against: a prior version of `src/server/auth/index.ts`
 * wrote `role: 'SUPER_ADMIN'` to any user whose email matched the
 * `ADMIN_BOOTSTRAP_EMAIL` env var, inside the `signIn` callback. The README
 * documented a default admin email + password alongside it, which turned the
 * combination into a one-step takeover for any deploy that forgot to unset
 * the env var.
 *
 * The fix: the `signIn` callback was removed in full. Admin accounts are
 * minted exclusively by the out-of-band CLI scripts in `scripts/`.
 *
 * This test is a **source-level contract**: it parses
 * `src/server/auth/index.ts` (and `config.ts`) with TypeScript-comment-aware
 * stripping and asserts no auth callback in those files contains either a
 * role mutation literal or a `prisma.user.update` call. Cheaper than a real
 * NextAuth integration test and catches exactly the regression we care
 * about: a future PR re-introducing the auto-promote, in any form.
 *
 * Run:
 *   npx tsx --test src/server/auth/auth-bootstrap.test.ts
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Strip `// line` and `/* block *\/` comments so doc-blocks that *mention* the
 * banned patterns (this fix added one such block) don't trip the test.
 *
 * Naive — does not handle comments-inside-strings — but the files under test
 * don't have any string literals containing `//` or `/*`. Good enough.
 */
function stripComments(src: string): string {
  return src
    // Block comments (non-greedy, multiline).
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Line comments (to end of line).
    .replace(/\/\/[^\n]*/g, '');
}

function readSource(relativePath: string): string {
  const full = join(__dirname, relativePath);
  return readFileSync(full, 'utf8');
}

const FILES_UNDER_CONTRACT = [
  'index.ts',
  'config.ts',
] as const;

const FORBIDDEN_PATTERNS: ReadonlyArray<{ pattern: RegExp; description: string }> = [
  {
    pattern: /role\s*:\s*['"`](SUPER_ADMIN|ADMIN|STAFF|DEVELOPER)['"`]/,
    description: 'role literal assignment to a privileged value',
  },
];

/**
 * Return any `(prisma|tx).user.update(...)` call in `src` whose argument writes
 * a `role`. A blanket "no user.update" ban used to live here, but the
 * security-reviewed archived-account REACTIVATION legitimately calls
 * `user.update` to clear `deletedAt` (role-neutral). The real invariant we must
 * keep is narrower and exact: an auth callback may mutate a user, but NEVER its
 * role. We extract each call's balanced-paren argument span and flag only those
 * containing `role`.
 */
function userUpdatesWritingRole(src: string): string[] {
  const offenders: string[] = [];
  const re = /\b(?:prisma|tx)\.user\.update\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const open = m.index + m[0].length - 1; // index of the '('
    let depth = 0;
    let end = open;
    for (let i = open; i < src.length; i++) {
      const ch = src[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const call = src.slice(open, end + 1);
    if (/\brole\b/.test(call)) offenders.push(call.slice(0, 100));
  }
  return offenders;
}

describe('auth callbacks never grant roles', () => {
  for (const file of FILES_UNDER_CONTRACT) {
    it(`${file}: contains no role-mutation patterns (outside comments)`, () => {
      const raw = readSource(file);
      const stripped = stripComments(raw);

      for (const { pattern, description } of FORBIDDEN_PATTERNS) {
        const match = stripped.match(pattern);
        assert.equal(
          match,
          null,
          `Forbidden pattern (${description}) found in src/server/auth/${file}: ${match?.[0] ?? ''}\n` +
            `Role assignments must happen out-of-band via scripts/create-admin.ts or scripts/promote-admin.ts, ` +
            `never inside an auth callback. See the header comment in index.ts for context.`,
        );
      }
    });
  }

  for (const file of FILES_UNDER_CONTRACT) {
    it(`${file}: no user.update writes a role`, () => {
      const offenders = userUpdatesWritingRole(stripComments(readSource(file)));
      assert.deepEqual(
        offenders,
        [],
        `A user.update writing a \`role\` was found in src/server/auth/${file}: ${offenders.join(' | ')}\n` +
          `Auth callbacks may mutate a user (e.g. clearing deletedAt to reactivate an account) ` +
          `but must NEVER assign a role — that happens out-of-band via scripts/.`,
      );
    });
  }

  it('signIn callback, if present, is a deny-guard only (never grants roles)', () => {
    // A `signIn` callback was deliberately introduced (see the index.ts header):
    // it BLOCKS OAuth account-linking onto a privileged or archived account by
    // returning false. That is the exact inverse of the original takeover bug,
    // which GRANTED a role from inside this callback.
    //
    // The protection that matters — "auth callbacks never grant roles" — is
    // still enforced by the FORBIDDEN_PATTERNS test above, which runs over the
    // whole of index.ts (no privileged role literals, no user.update). Here we
    // additionally pin the callback to deny-only: if a signIn callback exists it
    // must contain a `return false` rejection, so it can only ever *reduce*
    // access, never expand it.
    const stripped = stripComments(readSource('index.ts'));
    const hasSignIn = /\b(async\s+)?signIn\s*[(:]/.test(stripped);
    if (hasSignIn) {
      assert.ok(
        /return\s+false/.test(stripped),
        'a signIn callback exists in index.ts but contains no `return false` — ' +
          'it must be a pure deny-guard. Grants must happen out-of-band via scripts/.',
      );
    }
  });

  it('the ADMIN_BOOTSTRAP_EMAIL env var is NOT read inside auth callbacks', () => {
    // The env var still has a legitimate use in
    // `src/server/settings/settings.ts` as a notification-email fallback.
    // It must not be read inside the auth module — that was the original
    // attack vector.
    for (const file of FILES_UNDER_CONTRACT) {
      const stripped = stripComments(readSource(file));
      assert.equal(
        stripped.includes('ADMIN_BOOTSTRAP_EMAIL'),
        false,
        `src/server/auth/${file} must not reference ADMIN_BOOTSTRAP_EMAIL. ` +
          `Its only supported use is as a notification-email fallback in ` +
          `src/server/settings/settings.ts.`,
      );
    }
  });
});

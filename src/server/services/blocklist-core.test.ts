/**
 * Unit tests for the identity-blocklist core (no DB — the db is injected as a
 * recording fake). Run with the repo convention (no test runner installed):
 *
 *   npx tsx --test src/server/services/blocklist-core.test.ts
 *
 * What we're guarding against (the reception walk-in blocklist fix):
 *  1. `normIdentity` regressing so a blocked passport/email/phone slips past
 *     because writing and checking normalise differently.
 *  2. A guest document number no longer being tested as BOTH national-id AND
 *     passport — which is how a single reception-entered number matches an admin
 *     block made under either kind.
 *  3. The blank-input short-circuit regressing into a DB query with an empty
 *     `OR` (which could match the wrong rows / waste a query).
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  normIdentity,
  isAnyIdentityBlocked,
  anyDocumentNumberBlocked,
  isDocumentNumberBlocked,
  type BlocklistDb,
} from './blocklist-core';

/**
 * Recording fake of the minimal Prisma surface. Captures every `where` it is
 * asked, so a test can assert BOTH the outcome and the exact query built — and
 * that no query is made on the blank-input paths.
 */
function fakeDb(result: { id: string } | null = null) {
  const queries: Array<Array<{ kind: string; value: string }>> = [];
  const db: BlocklistDb = {
    blockedIdentity: {
      async findFirst(args) {
        queries.push(args.where.OR);
        return result;
      },
    },
  };
  return { db, queries };
}

describe('normIdentity', () => {
  it('EMAIL → trimmed + lower-cased', () => {
    assert.equal(normIdentity('EMAIL', '  Foo.Bar@Example.COM '), 'foo.bar@example.com');
  });

  it('PHONE → canonicalises equivalent formats to ONE E.164 (ban/uniqueness cannot be bypassed)', () => {
    const canonical = '+201001234567';
    // Punctuation, a local "0…" number, and an "00" international prefix must ALL
    // collapse to the same E.164 string — otherwise a re-typed format slips past
    // both the blocklist and the phone @unique constraint.
    assert.equal(normIdentity('PHONE', '+20 100-123 (4567)'), canonical);
    assert.equal(normIdentity('PHONE', '01001234567'), canonical);
    assert.equal(normIdentity('PHONE', '00201001234567'), canonical);
    assert.equal(normIdentity('PHONE', '+201001234567'), canonical);
  });

  it('PASSPORT → trimmed + UPPER-cased', () => {
    assert.equal(normIdentity('PASSPORT', '  a1234567 '), 'A1234567');
  });

  it('NATIONAL_ID → trimmed only (digits/case preserved)', () => {
    assert.equal(normIdentity('NATIONAL_ID', '  30212180201136 '), '30212180201136');
  });
});

describe('isAnyIdentityBlocked', () => {
  it('returns false and never queries when there are no checks', async () => {
    const { db, queries } = fakeDb({ id: 'x' });
    assert.equal(await isAnyIdentityBlocked([], db), false);
    assert.equal(queries.length, 0);
  });

  it('returns false and never queries when every value is blank/null/whitespace', async () => {
    const { db, queries } = fakeDb({ id: 'x' });
    const blocked = await isAnyIdentityBlocked(
      [
        { kind: 'EMAIL', value: '' },
        { kind: 'PHONE', value: null },
        { kind: 'NATIONAL_ID', value: undefined },
        { kind: 'PASSPORT', value: '   ' },
      ],
      db,
    );
    assert.equal(blocked, false);
    assert.equal(queries.length, 0, 'must not hit the DB with an empty OR');
  });

  it('normalises each value and drops blanks before querying', async () => {
    const { db, queries } = fakeDb(null);
    await isAnyIdentityBlocked(
      [
        { kind: 'EMAIL', value: '  USER@Mail.com ' },
        { kind: 'PASSPORT', value: 'ab12cd' },
        { kind: 'PHONE', value: '' }, // dropped
      ],
      db,
    );
    assert.equal(queries.length, 1);
    assert.deepEqual(queries[0], [
      { kind: 'EMAIL', value: 'user@mail.com' },
      { kind: 'PASSPORT', value: 'AB12CD' },
    ]);
  });

  it('returns true on a DB hit, false on a miss', async () => {
    const hit = fakeDb({ id: 'blk_1' });
    assert.equal(await isAnyIdentityBlocked([{ kind: 'EMAIL', value: 'a@b.com' }], hit.db), true);

    const miss = fakeDb(null);
    assert.equal(await isAnyIdentityBlocked([{ kind: 'EMAIL', value: 'a@b.com' }], miss.db), false);
  });
});

describe('anyDocumentNumberBlocked', () => {
  it('tests a single number as BOTH national-id (trimmed) and passport (upper-cased)', async () => {
    const { db, queries } = fakeDb(null);
    await anyDocumentNumberBlocked(['  ab123456 '], db);
    assert.equal(queries.length, 1);
    assert.deepEqual(queries[0], [
      { kind: 'NATIONAL_ID', value: 'ab123456' },
      { kind: 'PASSPORT', value: 'AB123456' },
    ]);
  });

  it('catches a passport blocked in upper-case even when reception typed lower-case', async () => {
    // DB holds the passport blocked as 'X9988'; reception keys 'x9988'.
    const db: BlocklistDb = {
      blockedIdentity: {
        async findFirst(args) {
          const hit = args.where.OR.some((c) => c.kind === 'PASSPORT' && c.value === 'X9988');
          return hit ? { id: 'blk_pp' } : null;
        },
      },
    };
    assert.equal(await anyDocumentNumberBlocked(['x9988'], db), true);
  });

  it('expands multiple numbers and skips blanks (2 checks per real number)', async () => {
    const { db, queries } = fakeDb(null);
    await anyDocumentNumberBlocked(['111', '', null, ' 222 ', undefined], db);
    assert.equal(queries.length, 1);
    assert.deepEqual(queries[0], [
      { kind: 'NATIONAL_ID', value: '111' },
      { kind: 'PASSPORT', value: '111' },
      { kind: 'NATIONAL_ID', value: '222' },
      { kind: 'PASSPORT', value: '222' },
    ]);
  });

  it('returns false and never queries when all numbers are blank', async () => {
    const { db, queries } = fakeDb({ id: 'x' });
    assert.equal(await anyDocumentNumberBlocked(['', '   ', null, undefined], db), false);
    assert.equal(queries.length, 0);
  });

  it('returns true when the DB has a matching block', async () => {
    const { db } = fakeDb({ id: 'blk_2' });
    assert.equal(await anyDocumentNumberBlocked(['30212180201136'], db), true);
  });
});

describe('isDocumentNumberBlocked', () => {
  it('delegates a single number to the dual-kind check', async () => {
    const { db, queries } = fakeDb(null);
    await isDocumentNumberBlocked(' p123 ', db);
    assert.deepEqual(queries[0], [
      { kind: 'NATIONAL_ID', value: 'p123' },
      { kind: 'PASSPORT', value: 'P123' },
    ]);
  });

  it('returns false and never queries for a null/blank number', async () => {
    const { db, queries } = fakeDb({ id: 'x' });
    assert.equal(await isDocumentNumberBlocked(null, db), false);
    assert.equal(await isDocumentNumberBlocked('   ', db), false);
    assert.equal(queries.length, 0);
  });

  it('returns true when the number is blocked', async () => {
    const { db } = fakeDb({ id: 'blk_3' });
    assert.equal(await isDocumentNumberBlocked('A1', db), true);
  });
});

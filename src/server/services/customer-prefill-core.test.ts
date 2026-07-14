/**
 * Unit tests for the pure returning-guest prefill helpers (no DB). Run with:
 *   npx tsx --test src/server/services/customer-prefill-core.test.ts
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  dedupeKnownGuests,
  guestDocBelongsToCustomer,
  type KnownGuestSourceRow,
} from './customer-prefill-core';

const row = (over: Partial<KnownGuestSourceRow>): KnownGuestSourceRow => ({
  documentId: 'doc_1',
  idNumber: '29001011234567',
  imageUrl: '/api/secure-media/2026/07/aaaaaaaaaaaaaaaaaaaaaaaa.jpg',
  fileName: 'id.jpg',
  seenAtIso: '2026-07-01T10:00:00.000Z',
  ...over,
});

describe('dedupeKnownGuests', () => {
  it('collapses the same ID number to ONE person, newest photo wins', () => {
    const out = dedupeKnownGuests([
      row({ documentId: 'old', seenAtIso: '2026-01-01T00:00:00.000Z', imageUrl: '/api/secure-media/2026/01/bbbbbbbbbbbbbbbbbbbbbbbb.jpg' }),
      row({ documentId: 'new', seenAtIso: '2026-07-01T00:00:00.000Z' }),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.sourceDocumentId, 'new');
  });

  it('treats case/whitespace variants of one number as the SAME person (passport ab123 = AB123)', () => {
    const out = dedupeKnownGuests([
      row({ documentId: 'a', idNumber: 'ab 123', seenAtIso: '2026-01-01T00:00:00.000Z' }),
      row({ documentId: 'b', idNumber: 'AB123', seenAtIso: '2026-02-01T00:00:00.000Z' }),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.sourceDocumentId, 'b');
    // The DISPLAYED number is the winner's as-typed value, not the normalized key.
    assert.equal(out[0]!.idNumber, 'AB123');
  });

  it('skips rows without a typed ID number (unreusable + would bypass the blocklist re-check)', () => {
    const out = dedupeKnownGuests([
      row({ documentId: 'a', idNumber: null }),
      row({ documentId: 'b', idNumber: '   ' }),
      row({ documentId: 'c', idNumber: '111' }),
    ]);
    assert.deepEqual(out.map((g) => g.sourceDocumentId), ['c']);
  });

  it('sorts distinct people newest-first and caps the list', () => {
    const out = dedupeKnownGuests(
      [
        row({ documentId: 'a', idNumber: '1', seenAtIso: '2026-01-01T00:00:00.000Z' }),
        row({ documentId: 'b', idNumber: '2', seenAtIso: '2026-03-01T00:00:00.000Z' }),
        row({ documentId: 'c', idNumber: '3', seenAtIso: '2026-02-01T00:00:00.000Z' }),
      ],
      2,
    );
    assert.deepEqual(out.map((g) => g.sourceDocumentId), ['b', 'c']);
  });

  it('keeps the current photo when an OLDER duplicate arrives later in the list', () => {
    const out = dedupeKnownGuests([
      row({ documentId: 'new', seenAtIso: '2026-07-01T00:00:00.000Z' }),
      row({ documentId: 'old', seenAtIso: '2026-01-01T00:00:00.000Z' }),
    ]);
    assert.equal(out[0]!.sourceDocumentId, 'new');
  });
});

describe('guestDocBelongsToCustomer (the IDOR guard)', () => {
  const PHONE = '+201000000001';

  it('accepts a walk-in source booking with the SAME guest phone', () => {
    assert.equal(
      guestDocBelongsToCustomer(
        { bookingUserId: 'staff_1', bookingGuestPhone: PHONE, bookingCreatedByStaffId: 'staff_1' },
        { guestPhone: PHONE, accountUserId: null },
      ),
      true,
    );
  });

  it('rejects a walk-in source booking with a DIFFERENT guest phone', () => {
    assert.equal(
      guestDocBelongsToCustomer(
        { bookingUserId: 'staff_1', bookingGuestPhone: '+201099999999', bookingCreatedByStaffId: 'staff_1' },
        { guestPhone: PHONE, accountUserId: null },
      ),
      false,
    );
  });

  it("accepts the phone-matched account's ONLINE booking (userId match, no staff creator)", () => {
    assert.equal(
      guestDocBelongsToCustomer(
        { bookingUserId: 'cust_1', bookingGuestPhone: null, bookingCreatedByStaffId: null },
        { guestPhone: PHONE, accountUserId: 'cust_1' },
      ),
      true,
    );
  });

  it('NEVER matches userId on a reception booking — its userId is the STAFF member', () => {
    // A staff member's own account must not "own" every walk-in they created.
    assert.equal(
      guestDocBelongsToCustomer(
        { bookingUserId: 'cust_1', bookingGuestPhone: '+201099999999', bookingCreatedByStaffId: 'someone' },
        { guestPhone: PHONE, accountUserId: 'cust_1' },
      ),
      false,
    );
  });

  it('rejects when there is no account and phones differ (null-phone source)', () => {
    assert.equal(
      guestDocBelongsToCustomer(
        { bookingUserId: 'cust_2', bookingGuestPhone: null, bookingCreatedByStaffId: null },
        { guestPhone: PHONE, accountUserId: null },
      ),
      false,
    );
  });
});

/**
 * Object-level secure-media authorization tests.
 *
 *   npx tsx --test src/server/services/secure-media-authz-core.test.ts
 *
 * Pins the product decision of 2026-07-05: reception keeps broad (audited)
 * access to guest IDs (returning-guest prefill), SECURITY is scoped to the
 * current visit, ops staff never see IDs, unattached uploads (mid-wizard,
 * pre-commit) are uploader-only, unowned files are admin-only.
 * A regression here is a PII leak (or a broken gate/reception flow).
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  decideSecureMediaAccess,
  type SecureMediaOwner,
} from './secure-media-authz-core';

const DAY = 86_400_000;
const TODAY = Date.UTC(2026, 6, 5); // 2026-07-05

function guestId(over: Partial<Extract<SecureMediaOwner, { type: 'guestId' }>> = {}) {
  return {
    type: 'guestId',
    uploadedById: 'reception-1',
    bookingStatus: 'CONFIRMED',
    visitStartDayUTC: TODAY,
    visitEndDayUTC: TODAY,
    ...over,
  } satisfies SecureMediaOwner;
}

function decide(role: string, owner: SecureMediaOwner, userId = 'user-x') {
  return decideSecureMediaAccess({ role, userId, owner, todayDayUTC: TODAY });
}

describe('admin tiers', () => {
  it('ADMIN/SUPER_ADMIN/DEVELOPER may access everything, including unowned', () => {
    for (const role of ['ADMIN', 'SUPER_ADMIN', 'DEVELOPER']) {
      assert.equal(decide(role, guestId()), true, role);
      assert.equal(decide(role, { type: 'paymentProof' }), true, role);
      assert.equal(decide(role, { type: 'opsProof' }), true, role);
      assert.equal(decide(role, { type: 'unowned' }), true, role);
    }
  });
});

describe('guest ID images', () => {
  it('reception ladder keeps BROAD access — including past bookings (prefill flow)', () => {
    const pastBooking = guestId({
      visitStartDayUTC: TODAY - 90 * DAY,
      visitEndDayUTC: TODAY - 90 * DAY,
      bookingStatus: 'CANCELLED',
    });
    for (const role of ['STAFF', 'SUPERVISOR', 'MANAGER', 'DIRECTOR']) {
      assert.equal(decide(role, pastBooking), true, role);
    }
  });

  it('SECURITY may see IDs of a CONFIRMED booking whose visit is current (±1 day)', () => {
    assert.equal(decide('SECURITY', guestId()), true, 'visit day');
    assert.equal(
      decide('SECURITY', guestId({ visitStartDayUTC: TODAY + DAY, visitEndDayUTC: TODAY + DAY })),
      true,
      'arriving tomorrow (−1 day grace)',
    );
    assert.equal(
      decide(
        'SECURITY',
        guestId({ visitStartDayUTC: TODAY - 3 * DAY, visitEndDayUTC: TODAY + 2 * DAY }),
      ),
      true,
      'mid-stay of a multi-day booking',
    );
  });

  it('SECURITY is DENIED past bookings and non-confirmed ones', () => {
    assert.equal(
      decide('SECURITY', guestId({ visitStartDayUTC: TODAY - 90 * DAY, visitEndDayUTC: TODAY - 90 * DAY })),
      false,
      'old booking',
    );
    assert.equal(
      decide('SECURITY', guestId({ bookingStatus: 'PENDING_PAYMENT' })),
      false,
      'unpaid booking',
    );
    assert.equal(
      decide('SECURITY', guestId({ bookingStatus: 'CANCELLED' })),
      false,
      'cancelled booking',
    );
  });

  it('SECURITY may always see IDs it uploaded itself, regardless of window', () => {
    const own = guestId({
      uploadedById: 'sec-9',
      visitStartDayUTC: TODAY - 90 * DAY,
      visitEndDayUTC: TODAY - 90 * DAY,
      bookingStatus: 'CANCELLED',
    });
    assert.equal(decideSecureMediaAccess({ role: 'SECURITY', userId: 'sec-9', owner: own, todayDayUTC: TODAY }), true);
  });

  it('HOUSEKEEPING / MAINTENANCE are denied guest IDs outright', () => {
    for (const role of ['HOUSEKEEPING', 'MAINTENANCE']) {
      assert.equal(decide(role, guestId()), false, role);
    }
  });

  it('customers / unknown roles are denied', () => {
    assert.equal(decide('CUSTOMER', guestId()), false);
    assert.equal(
      decideSecureMediaAccess({ role: null, userId: 'u', owner: guestId(), todayDayUTC: TODAY }),
      false,
    );
  });
});

describe('payment proofs', () => {
  it('money-visible gate roles allowed; money-blind roles denied', () => {
    for (const role of ['STAFF', 'SUPERVISOR', 'MANAGER', 'DIRECTOR']) {
      assert.equal(decide(role, { type: 'paymentProof' }), true, role);
    }
    for (const role of ['SECURITY', 'HOUSEKEEPING', 'MAINTENANCE', 'CUSTOMER']) {
      assert.equal(decide(role, { type: 'paymentProof' }), false, role);
    }
  });
});

describe('ops proofs', () => {
  it('ops-authorised roles allowed; SECURITY and customers denied', () => {
    for (const role of ['STAFF', 'SUPERVISOR', 'MANAGER', 'DIRECTOR', 'HOUSEKEEPING', 'MAINTENANCE']) {
      assert.equal(decide(role, { type: 'opsProof' }), true, role);
    }
    assert.equal(decide('SECURITY', { type: 'opsProof' }), false);
    assert.equal(decide('CUSTOMER', { type: 'opsProof' }), false);
  });
});

describe('unattached uploads (Media row, no referencing entity — mid-wizard)', () => {
  const mine: SecureMediaOwner = { type: 'unattached', uploadedById: 'staff-7' };

  it('the uploader themself may preview it (reception wizard, deferred commit)', () => {
    assert.equal(
      decideSecureMediaAccess({ role: 'STAFF', userId: 'staff-7', owner: mine, todayDayUTC: TODAY }),
      true,
    );
    // Same rule for a gate scanner's own upload — role-agnostic uploader match.
    assert.equal(
      decideSecureMediaAccess({ role: 'SECURITY', userId: 'staff-7', owner: mine, todayDayUTC: TODAY }),
      true,
    );
  });

  it('any OTHER non-admin staff member is denied', () => {
    for (const role of ['STAFF', 'DIRECTOR', 'SECURITY', 'HOUSEKEEPING', 'CUSTOMER']) {
      assert.equal(decide(role, mine, 'someone-else'), false, role);
    }
  });

  it('a manifest row with no uploader recorded stays denied (fail closed)', () => {
    assert.equal(
      decide('STAFF', { type: 'unattached', uploadedById: null }, 'staff-7'),
      false,
    );
  });

  it('admin tiers pass via the blanket admin rule', () => {
    assert.equal(decide('ADMIN', mine, 'someone-else'), true);
  });
});

describe('unowned files (fail closed)', () => {
  it('every non-admin role is denied', () => {
    for (const role of ['STAFF', 'DIRECTOR', 'SECURITY', 'HOUSEKEEPING', 'CUSTOMER']) {
      assert.equal(decide(role, { type: 'unowned' }), false, role);
    }
  });
});

/**
 * Tests for the post-verify return routing decision.
 *
 *   npx tsx --test src/server/credit-agricole/return-routing-core.test.ts
 *
 * A regression here is user-visible: routing a CONFIRMED booking anywhere but
 * 'success' would re-show the pay form for an already-captured payment (a
 * double-charge), and routing a CANCELLED (auto-refunded) booking to 'success'
 * would show a ticket for money that was returned.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import type { BookingStatus } from '@prisma/client';
import { routeAfterVerify } from './return-routing-core';

describe('routeAfterVerify', () => {
  it('CONFIRMED → success (never re-show the pay form → no double charge)', () => {
    assert.equal(routeAfterVerify('CONFIRMED'), 'success');
  });

  it('FAILED → failed', () => {
    assert.equal(routeAfterVerify('FAILED'), 'failed');
  });

  it('CANCELLED → failed (captured then auto-refunded)', () => {
    assert.equal(routeAfterVerify('CANCELLED'), 'failed');
  });

  it('PENDING_PAYMENT → stay (still resolving)', () => {
    assert.equal(routeAfterVerify('PENDING_PAYMENT'), 'stay');
  });

  it('EXPIRED → stay', () => {
    assert.equal(routeAfterVerify('EXPIRED'), 'stay');
  });

  it('covers every BookingStatus value (guards against a new status defaulting wrong)', () => {
    const all: BookingStatus[] = [
      'PENDING_PAYMENT',
      'CONFIRMED',
      'CANCELLED',
      'EXPIRED',
      'FAILED',
    ];
    for (const s of all) {
      assert.ok(['success', 'failed', 'stay'].includes(routeAfterVerify(s)), s);
    }
  });
});

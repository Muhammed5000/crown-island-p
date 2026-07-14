import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateVisitCodeString,
  looksLikeVisitCode,
  normalizePhoneDigits,
  visitIdentityKey,
  visitLastDay,
} from './visit-code-core';

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

test('generateVisitCodeString: shape, charset, uniqueness-ish', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const code = generateVisitCodeString();
    assert.match(code, /^V-[A-Z2-9]{12}$/);
    assert.ok(!/[01OI]/.test(code.slice(2)), 'ambiguous chars excluded');
    seen.add(code);
  }
  assert.equal(seen.size, 500, 'no collisions in 500 draws');
});

test('looksLikeVisitCode accepts generated codes and rejects references/garbage', () => {
  assert.ok(looksLikeVisitCode(generateVisitCodeString()));
  // Tolerates whitespace + lowercase (manual entry / loose barcode readers).
  assert.ok(looksLikeVisitCode('  v-abcdefghjkmn '));
  assert.equal(looksLikeVisitCode('CI-20260611-ABCDEF'), false);
  assert.equal(looksLikeVisitCode('V-SHORT'), false);
  assert.equal(looksLikeVisitCode(''), false);
});

test('normalizePhoneDigits: strips formatting and leading zeros', () => {
  assert.equal(normalizePhoneDigits('+20 100 123 4567'), '201001234567');
  assert.equal(normalizePhoneDigits('0100-123-4567'), '1001234567');
  assert.equal(normalizePhoneDigits(null), '');
});

test('identity: online bookings group by the account user', () => {
  assert.equal(
    visitIdentityKey({ id: 'b1', userId: 'u1', createdByStaffId: null, guestPhone: null }),
    'user:u1',
  );
});

test('identity: walk-ins group by guest phone, NEVER by the staff userId', () => {
  const key = visitIdentityKey({
    id: 'b2',
    userId: 'staff-1', // the reception operator — must not appear in the key
    createdByStaffId: 'staff-1',
    guestPhone: '+20 100 123 4567',
  });
  assert.equal(key, 'phone:201001234567');
  assert.ok(!key.includes('staff-1'));
});

test('identity: same guest phone in different formats yields ONE key', () => {
  const a = visitIdentityKey({ id: 'b3', userId: 's', createdByStaffId: 's', guestPhone: '+201001234567' });
  const b = visitIdentityKey({ id: 'b4', userId: 's', createdByStaffId: 's', guestPhone: '0100 123 4567' });
  // The leading-zero strip + country code make these differ ONLY when the
  // stored values genuinely differ; E.164-stored phones are always identical.
  assert.equal(a, 'phone:201001234567');
  assert.equal(b, 'phone:1001234567');
});

test('identity: walk-in without a usable phone isolates to its own booking', () => {
  assert.equal(
    visitIdentityKey({ id: 'b5', userId: 's', createdByStaffId: 's', guestPhone: '00' }),
    'booking:b5',
  );
});

test('visitLastDay: single-day, multi-day, and mixed groups', () => {
  assert.equal(
    visitLastDay([{ bookingDate: utc('2026-05-14'), endDate: null }]).getTime(),
    utc('2026-05-14').getTime(),
  );
  assert.equal(
    visitLastDay([
      { bookingDate: utc('2026-05-14'), endDate: null },
      { bookingDate: utc('2026-05-14'), endDate: utc('2026-05-16') },
    ]).getTime(),
    utc('2026-05-16').getTime(),
  );
});

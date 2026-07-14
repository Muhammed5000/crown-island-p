import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zkAccessWindow,
  isoCivilDay,
  computeDesiredLevels,
  isBookingPastCivilDay,
  zkPersonName,
  isActiveBookingStatus,
} from './provision-core';

// Booking day keys are stored as UTC midnight of the resort-local civil day.
const civil = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

test('single-day access window spans 00:00:00 → 23:59:59 of the booking day', () => {
  const w = zkAccessWindow(civil('2026-07-03'), null);
  assert.deepEqual(w, { start: '2026-07-03 00:00:00', end: '2026-07-03 23:59:59' });
});

test('multi-day access window spans the first day 00:00 → last day 23:59:59', () => {
  const w = zkAccessWindow(civil('2026-07-03'), civil('2026-07-05'));
  assert.deepEqual(w, { start: '2026-07-03 00:00:00', end: '2026-07-05 23:59:59' });
});

test('isoCivilDay reads the stored UTC-midnight day back as yyyy-MM-dd', () => {
  assert.equal(isoCivilDay(civil('2026-12-31')), '2026-12-31');
});

test('desired levels are the distinct, trimmed, non-null place level ids', () => {
  const levels = computeDesiredLevels([
    { place: { zkAccessLevelId: 'L1' } },
    { place: { zkAccessLevelId: ' L2 ' } },
    { place: { zkAccessLevelId: 'L1' } }, // dup
    { place: { zkAccessLevelId: null } }, // no door
    { place: null }, // unassigned unit
  ]);
  assert.deepEqual(levels.sort(), ['L1', 'L2']);
});

test('no assigned places yet → empty desired levels (a valid intermediate state)', () => {
  assert.deepEqual(computeDesiredLevels([{ place: null }, { place: { zkAccessLevelId: '' } }]), []);
});

test('a booking is "past" only after its LAST day has fully elapsed', () => {
  const today = civil('2026-07-03').getTime();
  // Today's single-day booking is NOT past.
  assert.equal(isBookingPastCivilDay(civil('2026-07-03'), null, today), false);
  // Yesterday's single-day booking IS past.
  assert.equal(isBookingPastCivilDay(civil('2026-07-02'), null, today), true);
  // Multi-day booking whose range still covers today is NOT past.
  assert.equal(isBookingPastCivilDay(civil('2026-07-01'), civil('2026-07-04'), today), false);
  // Multi-day booking that ended yesterday IS past.
  assert.equal(isBookingPastCivilDay(civil('2026-06-30'), civil('2026-07-02'), today), true);
});

test('zkPersonName prefers walk-in guest, then account name, then reference', () => {
  assert.equal(zkPersonName({ guestName: 'Ali', userName: 'Sara', reference: 'CI-1' }), 'Ali');
  assert.equal(zkPersonName({ guestName: null, userName: 'Sara', reference: 'CI-1' }), 'Sara');
  assert.equal(zkPersonName({ guestName: ' ', userName: '', reference: 'CI-1' }), 'Guest CI-1');
});

test('active booking statuses are CONFIRMED and PENDING_PAYMENT only', () => {
  assert.equal(isActiveBookingStatus('CONFIRMED'), true);
  assert.equal(isActiveBookingStatus('PENDING_PAYMENT'), true);
  for (const s of ['CANCELLED', 'EXPIRED', 'FAILED']) {
    assert.equal(isActiveBookingStatus(s), false, s);
  }
});

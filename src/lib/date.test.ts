/**
 * Unit tests for the resort-local civil-day helpers.
 *
 * Run with:  npx tsx --test src/lib/date.test.ts
 *
 * These guard the timezone Critical: the helpers must return the resort
 * (Africa/Cairo) civil day / wall clock independently of the host process
 * timezone, so a same-day pass is admissible for its whole local day even on a
 * UTC host near local midnight.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resortCivilDayUTC,
  resortHourMinute,
  rangeDays,
  parseIsoDateUTC,
  parseReportRange,
  resortDayKey,
  resortCivilDayStartUTC,
} from './date';

// 2026-01-15T23:30:00Z is 2026-01-16 01:30 in Africa/Cairo (UTC+2 in winter).
// The resort civil day must be Jan 16 (LOCAL), not Jan 15 (UTC) — this is the
// exact near-midnight scenario that wrongly refused valid same-day passes.
const nearMidnight = new Date('2026-01-15T23:30:00Z');

test('resortCivilDayUTC returns the resort-local civil day, not the UTC day', () => {
  assert.equal(resortCivilDayUTC(nearMidnight), Date.UTC(2026, 0, 16));
});

test('resortHourMinute returns the resort wall clock at the boundary', () => {
  assert.equal(resortHourMinute(nearMidnight), '01:30');
});

test('an unambiguous midday instant maps to the same civil day and clock', () => {
  const noonish = new Date('2026-01-16T10:00:00Z'); // 12:00 in Cairo (UTC+2)
  assert.equal(resortCivilDayUTC(noonish), Date.UTC(2026, 0, 16));
  assert.equal(resortHourMinute(noonish), '12:00');
});

test('rangeDays expands an inclusive range to per-day strings', () => {
  assert.deepEqual(rangeDays('2026-06-10', '2026-06-12'), ['2026-06-10', '2026-06-11', '2026-06-12']);
});

test('rangeDays returns a single day for same/empty/reversed ranges', () => {
  assert.deepEqual(rangeDays('2026-06-10', '2026-06-10'), ['2026-06-10']);
  assert.deepEqual(rangeDays('2026-06-10', '2026-06-09'), ['2026-06-10']); // reversed → just start
});

test('rangeDays caps a runaway range at 60 days', () => {
  assert.ok(rangeDays('2026-01-01', '2027-01-01').length <= 60);
});

test('parseIsoDateUTC builds UTC midnight of the civil day (month off-by-one preserved)', () => {
  assert.equal(parseIsoDateUTC('2026-06-10')!.getTime(), Date.UTC(2026, 5, 10));
  assert.equal(parseIsoDateUTC('2026-01-01')!.getTime(), Date.UTC(2026, 0, 1));
});

test('parseIsoDateUTC returns null for anything that is not yyyy-mm-dd', () => {
  assert.equal(parseIsoDateUTC('2026-6-10'), null); // not zero-padded
  assert.equal(parseIsoDateUTC('10/06/2026'), null);
  assert.equal(parseIsoDateUTC('2026-06-10T00:00:00Z'), null); // trailing time
  assert.equal(parseIsoDateUTC(''), null);
});

test('DATE-001: parseIsoDateUTC rejects impossible calendar dates (no silent rollover)', () => {
  assert.equal(parseIsoDateUTC('2026-02-31'), null); // Feb 31 → would roll to Mar
  assert.equal(parseIsoDateUTC('2026-13-01'), null); // month 13
  assert.equal(parseIsoDateUTC('2026-06-00'), null); // day 0
  assert.equal(parseIsoDateUTC('2026-04-31'), null); // Apr has 30 days
  assert.equal(parseIsoDateUTC('2025-02-29'), null); // 2025 is not a leap year
  // Real leap day still parses.
  assert.equal(parseIsoDateUTC('2028-02-29')!.getTime(), Date.UTC(2028, 1, 29));
});

test('TIME-001: report boundaries bracket the exact Cairo civil day (offset-independent)', () => {
  // A single-day report for 2026-07-01 must START at Cairo midnight of the 1st
  // and END (exclusive) at Cairo midnight of the 2nd — verified by the civil-day
  // key on each boundary and one ms inside it, so the assertion holds under either
  // Cairo offset (+2 winter / +3 summer) without hard-coding the UTC instant.
  const { from, toExclusive } = parseReportRange('2026-07-01', '2026-07-01');
  assert.equal(resortDayKey(from), '2026-07-01'); // first instant is the 1st
  assert.equal(resortDayKey(new Date(from.getTime() - 1)), '2026-06-30'); // just before → prior day
  assert.equal(resortDayKey(new Date(toExclusive.getTime() - 1)), '2026-07-01'); // last instant is the 1st
  assert.equal(resortDayKey(toExclusive), '2026-07-02'); // exclusive end is the next day
});

test('TIME-001: resortDayKey buckets a post-Cairo-midnight instant on the local day', () => {
  // Cairo is always ahead of UTC (+2 or +3), so a small-hours-UTC instant is
  // already the local day — this is exactly the sale that UTC bucketing mis-filed.
  assert.equal(resortDayKey(new Date('2026-07-01T00:30:00Z')), '2026-07-01');
  assert.equal(resortDayKey(new Date('2026-01-15T22:30:00Z')), '2026-01-16');
});

test('TIME-001: resortCivilDayStartUTC lands exactly on the requested civil day', () => {
  for (const [y, m, d] of [[2026, 7, 1], [2026, 1, 1], [2026, 6, 30]] as const) {
    const start = resortCivilDayStartUTC(y, m, d);
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    assert.equal(resortDayKey(start), key); // the start IS that civil day
    assert.notEqual(resortDayKey(new Date(start.getTime() - 1)), key); // one ms before is the previous day
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateInvoiceToPlaces, clipSpanMs, durationDays, mergedSpansMs, UNASSIGNED, type ReportRange } from './report-math';
import { parseReportRange, resortDayKey } from '@/lib/date';

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);
const range = (from: string, toExcl: string): ReportRange => ({ from: utc(from), toExclusive: utc(toExcl) });
const DAY = 86_400_000;

// ── durationDays ──
test('durationDays: single day, inclusive multi-day, same-day endDate', () => {
  assert.equal(durationDays(utc('2026-06-10'), null), 1);
  assert.equal(durationDays(utc('2026-06-10'), utc('2026-06-10')), 1);
  assert.equal(durationDays(utc('2026-06-10'), utc('2026-06-12')), 3);
});

// ── clipSpanMs ──
test('clipSpanMs: span fully inside range', () => {
  const r = range('2026-06-01', '2026-06-30');
  assert.equal(clipSpanMs(utc('2026-06-10'), utc('2026-06-12'), r), 2 * DAY);
});

test('clipSpanMs: span straddling both range edges is clipped to the range', () => {
  const r = range('2026-06-10', '2026-06-12');
  assert.equal(clipSpanMs(utc('2026-06-01'), utc('2026-06-30'), r), 2 * DAY);
});

test('clipSpanMs: span entirely outside range = 0 (never negative)', () => {
  const r = range('2026-06-10', '2026-06-12');
  assert.equal(clipSpanMs(utc('2026-06-01'), utc('2026-06-05'), r), 0);
  assert.equal(clipSpanMs(utc('2026-07-01'), utc('2026-07-05'), r), 0);
});

test('clipSpanMs: open span (endsAt null) is clipped at now', () => {
  const r = range('2026-06-01', '2026-06-30');
  const now = utc('2026-06-11');
  assert.equal(clipSpanMs(utc('2026-06-10'), null, r, now), 1 * DAY);
});

// ── mergedSpansMs ──
test('mergedSpansMs: overlapping spans never double-count', () => {
  const r = range('2026-06-01', '2026-06-30');
  // [10:00→12:00] and [11:00→13:00] on the same day = 3h, not 4h.
  const spans = [
    { startsAt: new Date('2026-06-10T10:00:00Z'), endsAt: new Date('2026-06-10T12:00:00Z') },
    { startsAt: new Date('2026-06-10T11:00:00Z'), endsAt: new Date('2026-06-10T13:00:00Z') },
  ];
  assert.equal(mergedSpansMs(spans, r), 3 * 3_600_000);
});

test('mergedSpansMs: disjoint spans sum; out-of-range spans drop; open span clips at now', () => {
  const r = range('2026-06-01', '2026-06-30');
  const now = new Date('2026-06-20T12:00:00Z');
  const spans = [
    { startsAt: new Date('2026-06-10T10:00:00Z'), endsAt: new Date('2026-06-10T11:00:00Z') }, // 1h
    { startsAt: new Date('2026-07-05T10:00:00Z'), endsAt: new Date('2026-07-05T20:00:00Z') }, // outside
    { startsAt: new Date('2026-06-20T10:00:00Z'), endsAt: null }, // open → 2h at now
  ];
  assert.equal(mergedSpansMs(spans, r, now), 3 * 3_600_000);
  assert.equal(mergedSpansMs([], r, now), 0);
});

// ── allocateInvoiceToPlaces ──
test('allocate: single place single day gets the whole net total', () => {
  const r = range('2026-06-01', '2026-06-30');
  const got = allocateInvoiceToPlaces([{ placeId: 'p1', date: utc('2026-06-10') }], 50_000, r);
  assert.deepEqual([...got.entries()], [['p1', 50_000]]);
});

test('allocate: multi-place multi-day booking splits evenly and sums back exactly', () => {
  const r = range('2026-06-01', '2026-06-30');
  // 2 places × 2 days = 4 unit-days, 10_001 cents → shares must total 10_001.
  const units = [
    { placeId: 'p1', date: utc('2026-06-10') },
    { placeId: 'p1', date: utc('2026-06-11') },
    { placeId: 'p2', date: utc('2026-06-10') },
    { placeId: 'p2', date: utc('2026-06-11') },
  ];
  const got = allocateInvoiceToPlaces(units, 10_001, r);
  const sum = [...got.values()].reduce((a, b) => a + b, 0);
  assert.equal(sum, 10_001);
  assert.equal(got.size, 2);
  for (const v of got.values()) assert.ok(v === 5_000 || v === 5_001);
});

test('allocate: range-edge clipping attributes only the in-range share', () => {
  // 2-day booking, only the second day is inside the range → half the total.
  const r = range('2026-06-11', '2026-06-30');
  const units = [
    { placeId: 'p1', date: utc('2026-06-10') },
    { placeId: 'p1', date: utc('2026-06-11') },
  ];
  const got = allocateInvoiceToPlaces(units, 10_000, r);
  assert.deepEqual([...got.entries()], [['p1', 5_000]]);
});

test('allocate: unplaced unit-days land in the UNASSIGNED bucket', () => {
  const r = range('2026-06-01', '2026-06-30');
  const units = [
    { placeId: 'p1', date: utc('2026-06-10') },
    { placeId: null, date: utc('2026-06-10') },
  ];
  const got = allocateInvoiceToPlaces(units, 9_000, r);
  assert.equal(got.get('p1'), 4_500);
  assert.equal(got.get(UNASSIGNED), 4_500);
});

test('allocate: empty units / zero net / fully out-of-range → empty map', () => {
  const r = range('2026-06-01', '2026-06-30');
  assert.equal(allocateInvoiceToPlaces([], 10_000, r).size, 0);
  assert.equal(allocateInvoiceToPlaces([{ placeId: 'p1', date: utc('2026-06-10') }], 0, r).size, 0);
  assert.equal(allocateInvoiceToPlaces([{ placeId: 'p1', date: utc('2026-07-10') }], 10_000, r).size, 0);
});

test('allocate: three-way uneven split distributes remainder deterministically', () => {
  const r = range('2026-06-01', '2026-06-30');
  const units = [
    { placeId: 'a', date: utc('2026-06-10') },
    { placeId: 'b', date: utc('2026-06-10') },
    { placeId: 'c', date: utc('2026-06-10') },
  ];
  const got = allocateInvoiceToPlaces(units, 100, r);
  const sum = [...got.values()].reduce((x, y) => x + y, 0);
  assert.equal(sum, 100);
  for (const v of got.values()) assert.ok(v === 33 || v === 34);
});

// ── parseReportRange ── (TIME-001: boundaries are Africa/Cairo civil days, not
// UTC; asserted via the civil-day key on each boundary so the checks hold under
// either Cairo offset (+2 winter / +3 summer) without hard-coding a UTC instant.)
test('parseReportRange: explicit range → Cairo civil-day boundaries, end exclusive', () => {
  const { from, toExclusive } = parseReportRange('2026-06-01', '2026-06-10');
  assert.equal(resortDayKey(from), '2026-06-01'); // first instant is the 1st
  assert.equal(resortDayKey(new Date(from.getTime() - 1)), '2026-05-31');
  assert.equal(resortDayKey(new Date(toExclusive.getTime() - 1)), '2026-06-10'); // last instant is the 10th
  assert.equal(resortDayKey(toExclusive), '2026-06-11'); // exclusive end is the next day
});

test('parseReportRange: defaults to the last 30 Cairo days', () => {
  const now = utc('2026-06-10'); // 03:00 Cairo on the 10th (summer) → today = the 10th
  const { from, toExclusive } = parseReportRange(undefined, undefined, now);
  assert.equal(resortDayKey(new Date(toExclusive.getTime() - 1)), '2026-06-10');
  assert.equal(resortDayKey(from), '2026-05-12');
  // June has no DST transition, so the span is exactly 30 civil days.
  assert.equal((toExclusive.getTime() - from.getTime()) / DAY, 30);
});

test('parseReportRange: reversed range is swapped; garbage falls back to defaults', () => {
  const swapped = parseReportRange('2026-06-10', '2026-06-01');
  assert.equal(resortDayKey(swapped.from), '2026-06-01');
  assert.equal(resortDayKey(new Date(swapped.toExclusive.getTime() - 1)), '2026-06-10');
  const now = utc('2026-06-10');
  const junk = parseReportRange('not-a-date', '10/06/2026', now);
  assert.equal(resortDayKey(new Date(junk.toExclusive.getTime() - 1)), '2026-06-10');
});

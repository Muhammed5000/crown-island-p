/**
 * Unit tests for the pure working-hours math behind the staff module.
 *
 * Run with:  npx tsx --test src/lib/work-hours.test.ts
 *
 * These guard the two accuracy-critical rules the staff dashboard depends on:
 *   1. an idle gap longer than the threshold SPLITS a shift (long breaks are not
 *      counted as worked time), and
 *   2. a session's worked time is never counted past its last real activity
 *      (an open/un-closed session can't inflate hours).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WORK_SESSION_IDLE_MS,
  nextSessionAction,
  sessionWorkedMs,
  sessionMsInWindow,
  currentWindows,
} from './work-hours';

const H = 3_600_000; // one hour in ms
const d = (iso: string) => new Date(iso);

// ── nextSessionAction (idle-gap split rule) ─────────────────────────────────

test('nextSessionAction: no open session → open a new one', () => {
  assert.equal(nextSessionAction(null, d('2026-07-01T10:00:00Z')), 'open');
});

test('nextSessionAction: action within the idle window → extend the shift', () => {
  const open = { lastActivityAt: d('2026-07-01T10:00:00Z') };
  // 2h later, under the 3h threshold.
  assert.equal(nextSessionAction(open, d('2026-07-01T12:00:00Z')), 'extend');
});

test('nextSessionAction: exactly at the idle threshold still extends (<=)', () => {
  const open = { lastActivityAt: d('2026-07-01T10:00:00Z') };
  assert.equal(nextSessionAction(open, new Date(open.lastActivityAt.getTime() + WORK_SESSION_IDLE_MS)), 'extend');
});

test('nextSessionAction: gap beyond the idle threshold → split into a new shift', () => {
  const open = { lastActivityAt: d('2026-07-01T10:00:00Z') };
  // 5h later, over the 3h threshold.
  assert.equal(nextSessionAction(open, d('2026-07-01T15:00:00Z')), 'split');
});

// ── sessionWorkedMs (never counts past last activity) ───────────────────────

test('sessionWorkedMs: closed session = endedAt − startedAt', () => {
  const ms = sessionWorkedMs({ startedAt: d('2026-07-01T09:00:00Z'), lastActivityAt: d('2026-07-01T11:30:00Z'), endedAt: d('2026-07-01T12:00:00Z') });
  assert.equal(ms, 3 * H);
});

test('sessionWorkedMs: open session is measured to last activity, not "now"', () => {
  // Un-closed session: worked time stops at the last real action (11:00), so it
  // can never inflate no matter how much later it is read.
  const ms = sessionWorkedMs({ startedAt: d('2026-07-01T09:00:00Z'), lastActivityAt: d('2026-07-01T11:00:00Z'), endedAt: null });
  assert.equal(ms, 2 * H);
});

test('sessionWorkedMs: clamps at 0 for a degenerate span', () => {
  const ms = sessionWorkedMs({ startedAt: d('2026-07-01T12:00:00Z'), lastActivityAt: d('2026-07-01T11:00:00Z'), endedAt: d('2026-07-01T11:00:00Z') });
  assert.equal(ms, 0);
});

test('a long break is excluded: two split shifts sum to less than first→last span', () => {
  // Morning shift 09:00–11:00, 5h break, afternoon shift 16:00–18:00.
  const morning = { startedAt: d('2026-07-01T09:00:00Z'), lastActivityAt: d('2026-07-01T11:00:00Z'), endedAt: d('2026-07-01T11:00:00Z') };
  const afternoon = { startedAt: d('2026-07-01T16:00:00Z'), lastActivityAt: d('2026-07-01T18:00:00Z'), endedAt: null };
  const worked = sessionWorkedMs(morning) + sessionWorkedMs(afternoon);
  assert.equal(worked, 4 * H); // 2h + 2h — the 5h break is NOT counted
  const naiveFirstToLast = afternoon.lastActivityAt.getTime() - morning.startedAt.getTime();
  assert.equal(naiveFirstToLast, 9 * H); // the old over-counting behaviour
  assert.ok(worked < naiveFirstToLast);
});

// ── sessionMsInWindow (accurate hours-in-window clipping) ────────────────────

const win = { from: d('2026-07-01T00:00:00Z'), toExclusive: d('2026-07-02T00:00:00Z') };

test('sessionMsInWindow: session fully inside the window counts in full', () => {
  assert.equal(sessionMsInWindow({ startedAt: d('2026-07-01T09:00:00Z'), lastActivityAt: d('2026-07-01T12:00:00Z'), endedAt: d('2026-07-01T12:00:00Z') }, win), 3 * H);
});

test('sessionMsInWindow: a session straddling the start is clipped to the window', () => {
  // Started the previous evening, worked into the window until 02:00.
  assert.equal(sessionMsInWindow({ startedAt: d('2026-06-30T22:00:00Z'), lastActivityAt: d('2026-07-01T02:00:00Z'), endedAt: d('2026-07-01T02:00:00Z') }, win), 2 * H);
});

test('sessionMsInWindow: a session entirely outside the window is 0', () => {
  assert.equal(sessionMsInWindow({ startedAt: d('2026-07-05T09:00:00Z'), lastActivityAt: d('2026-07-05T12:00:00Z'), endedAt: d('2026-07-05T12:00:00Z') }, win), 0);
});

test('sessionMsInWindow: open session clipped to window end, not measured beyond it', () => {
  // Open session whose last activity is after the window end → counts only up to
  // the window boundary.
  assert.equal(sessionMsInWindow({ startedAt: d('2026-07-01T22:00:00Z'), lastActivityAt: d('2026-07-02T05:00:00Z'), endedAt: null }, win), 2 * H);
});

// ── currentWindows (UTC-day-aligned day / Mon-week / month) ──────────────────

test('currentWindows: month window is the calendar month in UTC', () => {
  const w = currentWindows(d('2026-07-15T13:00:00Z'));
  assert.equal(w.month.from.toISOString(), '2026-07-01T00:00:00.000Z');
  assert.equal(w.month.toExclusive.toISOString(), '2026-08-01T00:00:00.000Z');
});

test('currentWindows: day window is the UTC day containing "now"', () => {
  const w = currentWindows(d('2026-07-15T13:00:00Z'));
  assert.equal(w.day.from.toISOString(), '2026-07-15T00:00:00.000Z');
  assert.equal(w.day.toExclusive.toISOString(), '2026-07-16T00:00:00.000Z');
});

test('currentWindows: week starts on Monday and spans exactly 7 days', () => {
  const w = currentWindows(d('2026-07-15T13:00:00Z')); // 2026-07-15 is a Wednesday
  assert.equal(w.week.from.getUTCDay(), 1, 'week starts on Monday');
  assert.equal(w.week.toExclusive.getTime() - w.week.from.getTime(), 7 * 24 * H);
  // "now" falls within its own week window.
  assert.ok(w.day.from.getTime() >= w.week.from.getTime() && w.day.from.getTime() < w.week.toExclusive.getTime());
});

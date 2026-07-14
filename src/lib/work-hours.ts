/**
 * Pure working-hours math — no DB, no `server-only`, no timezone env.
 *
 * The staff module derives working time from real gate/reception activity (see
 * `@/server/services/work-session`). All the fiddly, bug-prone arithmetic lives
 * here as pure functions so it can be unit-tested in isolation. Bucketing is by
 * UTC day, matching the admin Revenue report and the gate-operator profile.
 */

/**
 * Idle gap (ms) after which the next action opens a fresh session rather than
 * extending the previous one — a gap longer than this is treated as off-shift
 * and excluded from worked time. Three hours bridges genuine quiet periods at a
 * resort desk while still splitting clearly-separate shifts.
 */
export const WORK_SESSION_IDLE_MS = 3 * 60 * 60 * 1000;

export type SessionAction = 'extend' | 'split' | 'open';

/** A staff work session's timing (open when `endedAt` is null). */
export interface WorkSpan {
  startedAt: Date;
  lastActivityAt: Date;
  endedAt: Date | null;
}

/** A half-open time window `[from, toExclusive)`. */
export interface TimeWindow {
  from: Date;
  toExclusive: Date;
}

/**
 * Given the staffer's currently-open session (if any) and the action time,
 * decide whether to extend it, split (close the stale one + open fresh), or open
 * the first session.
 */
export function nextSessionAction(
  open: { lastActivityAt: Date } | null,
  now: Date,
  idleMs: number = WORK_SESSION_IDLE_MS,
): SessionAction {
  if (!open) return 'open';
  return now.getTime() - open.lastActivityAt.getTime() <= idleMs ? 'extend' : 'split';
}

/**
 * Worked milliseconds of a session. Open → measured to last activity; closed →
 * to `endedAt`. Never counts past the last real action, so an un-closed session
 * can't inflate hours. Clamped at 0.
 */
export function sessionWorkedMs(s: WorkSpan): number {
  const end = s.endedAt ?? s.lastActivityAt;
  return Math.max(0, end.getTime() - s.startedAt.getTime());
}

/** Overlap (ms) of a session's worked span with a window — accurate hours-in-window. */
export function sessionMsInWindow(s: WorkSpan, w: TimeWindow): number {
  const start = Math.max(s.startedAt.getTime(), w.from.getTime());
  const end = Math.min((s.endedAt ?? s.lastActivityAt).getTime(), w.toExclusive.getTime());
  return Math.max(0, end - start);
}

/** UTC midnight of the day `d` falls on. */
export function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Today / this (Monday-start) week / this calendar month, as UTC-day windows —
 * the headline period rollups on the staff profile.
 */
export function currentWindows(now: Date = new Date()): { day: TimeWindow; week: TimeWindow; month: TimeWindow } {
  const today = utcDayStart(now);
  const dow = (today.getUTCDay() + 6) % 7; // 0 = Monday
  const weekStart = new Date(today.getTime() - dow * 86_400_000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    day: { from: today, toExclusive: new Date(today.getTime() + 86_400_000) },
    week: { from: weekStart, toExclusive: new Date(weekStart.getTime() + 7 * 86_400_000) },
    month: { from: monthStart, toExclusive: monthEnd },
  };
}

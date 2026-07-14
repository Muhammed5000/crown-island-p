import 'server-only';
import type { Prisma, UserRole } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { splitPaidInvoice, type InvoiceInsuranceLite } from './report-math';
import { GATE_ROLES } from '@/server/auth/roles';
import { sessionMsInWindow, currentWindows, utcDayStart, type TimeWindow } from '@/lib/work-hours';
import { resortDayKey } from '@/lib/date';

export { currentWindows } from '@/lib/work-hours';

/**
 * Staff operational performance & revenue analytics.
 *
 * This is the read/aggregation layer behind the admin "Staff" dashboard. It
 * reuses the existing sources of truth — nothing here writes, and no number is
 * invented:
 *
 *   - ACTIVITY  → `GateScanEvent` (operatorId, result, people, amountCents).
 *   - REVENUE   → the canonical SERVICE-net (`splitPaidInvoice`: insurance
 *                 deposit excluded, only kind=SERVICE refunds netted) for PAID
 *                 invoices, attributed to the staffer who created the
 *                 (reception) booking via `Booking.createdByStaffId`. This is the
 *                 SAME source the admin Revenue report uses, so the numbers match.
 *                 Deposits never inflate a staffer's revenue.
 *   - PAYOUTS   → desk insurance-deposit payouts (`InsuranceRefund` COMPLETED,
 *                 CASH/INSTAPAY), attributed to `requestedById` (the reception
 *                 staffer whose checkout decision opened the payout — the desk
 *                 completer may differ). Cash leaving the drawer; kept separate,
 *                 never netted against revenueCents or cashCents.
 *   - HOURS     → `WorkSession` worked spans (see work-session.ts).
 *
 * Double-counting guard: a reception sale appears both as `Invoice.totalCents`
 * AND as `GateScanEvent.amountCents` (RECEPTION) — the SAME money. We treat the
 * invoice net as the headline "revenue handled", and expose the gate-scan amount
 * separately as "cash collected at the desk". They are never summed together.
 *
 * Bucketing is by UTC day, matching the existing gate-operator profile and the
 * admin Revenue report (one consistent convention across the reporting surface).
 */

/** The operational roles that appear in the staff dashboard (the gate/desk set). */
const STAFF_ROLES = Array.from(GATE_ROLES) as UserRole[];

export interface StaffRollup {
  /** SERVICE-net reception revenue (PAID invoices; deposit + INSURANCE refunds excluded). */
  revenueCents: number;
  /** Cash / InstaPay physically collected at the desk (GateScanEvent RECEPTION amount). */
  cashCents: number;
  /** Insurance-deposit desk payouts (COMPLETED CASH/INSTAPAY InsuranceRefund rows,
   * by requestedById) — cash leaving the drawer. Never summed with the above. */
  depositPayoutCents: number;
  /** Reception bookings created. */
  bookings: number;
  /** Gate scans handled (admits + exits + denies). */
  gateScans: number;
  admittedPeople: number;
  admittedScans: number;
  deniedScans: number;
  exitedScans: number;
  /** True worked time in the window (from WorkSession), in milliseconds. */
  workedMs: number;
  /**
   * First→last scan span in the window — a secondary "active window" estimate
   * available for historical data (before WorkSession tracking began). Never
   * summed with `workedMs`; shown as a reference, not billable hours.
   */
  scanWindowMs: number;
}

const emptyRollup = (): StaffRollup => ({
  revenueCents: 0,
  cashCents: 0,
  depositPayoutCents: 0,
  bookings: 0,
  gateScans: 0,
  admittedPeople: 0,
  admittedScans: 0,
  deniedScans: 0,
  exitedScans: 0,
  workedMs: 0,
  scanWindowMs: 0,
});

type Window = TimeWindow;

type ScanRow = {
  createdAt: Date;
  result: 'ADMITTED' | 'EXITED' | 'DENIED' | 'RECEPTION';
  people: number;
  amountCents: number | null;
};
type InvoiceRow = {
  paidAt: Date | null;
  totalCents: number;
  refunds: { amountCents: number; kind: 'SERVICE' | 'INSURANCE' }[];
  /** 1:1 booking insurance row (null = uninsured booking). */
  insurance: InvoiceInsuranceLite | null;
};
type SessionRow = { startedAt: Date; lastActivityAt: Date; endedAt: Date | null };
/** Completed desk deposit payout (bucketed by completedAt). */
type PayoutRow = { completedAt: Date | null; amountCents: number };

const inWindow = (d: Date | null, w: Window): boolean =>
  d != null && d.getTime() >= w.from.getTime() && d.getTime() < w.toExclusive.getTime();

/** Fold pre-fetched rows into a rollup for one window (all filtering in memory). */
function rollupFor(scans: ScanRow[], invoices: InvoiceRow[], sessions: SessionRow[], payouts: PayoutRow[], w: Window): StaffRollup {
  const r = emptyRollup();
  // Per-day first/last scan — summed into a "sum of daily active windows" so a
  // multi-day window doesn't collapse to one giant first→last span.
  const dayFirst = new Map<string, number>();
  const dayLast = new Map<string, number>();
  for (const s of scans) {
    if (!inWindow(s.createdAt, w)) continue;
    const t = s.createdAt.getTime();
    const dk = resortDayKey(s.createdAt);
    if (!dayFirst.has(dk) || t < dayFirst.get(dk)!) dayFirst.set(dk, t);
    if (!dayLast.has(dk) || t > dayLast.get(dk)!) dayLast.set(dk, t);
    if (s.result === 'ADMITTED') {
      r.admittedScans += 1;
      r.admittedPeople += s.people;
      r.gateScans += 1;
    } else if (s.result === 'EXITED') {
      r.exitedScans += 1;
      r.gateScans += 1;
    } else if (s.result === 'DENIED') {
      r.deniedScans += 1;
      r.gateScans += 1;
    } else {
      // RECEPTION
      r.bookings += 1;
      r.cashCents += s.amountCents ?? 0;
    }
  }
  for (const inv of invoices) {
    if (!inWindow(inv.paidAt, w)) continue;
    r.revenueCents += splitPaidInvoice(inv.totalCents, inv.refunds, inv.insurance).serviceNetCents;
  }
  for (const p of payouts) {
    if (inWindow(p.completedAt, w)) r.depositPayoutCents += p.amountCents;
  }
  for (const s of sessions) r.workedMs += sessionMsInWindow(s, w);
  for (const [dk, first] of dayFirst) r.scanWindowMs += (dayLast.get(dk) ?? first) - first;
  return r;
}

// ─── Directory ──────────────────────────────────────────────────────────────

export interface StaffDirectoryRow {
  id: string;
  name: string;
  role: string;
  email: string | null;
  active: boolean;
  rollup: StaffRollup;
  lastActiveAt: Date | null;
}

/**
 * The staff roster with per-person metrics for `range`. One row per operational
 * (gate/reception) user, including those with zero activity, sorted by revenue
 * then activity so the top performers surface first.
 */
export async function getStaffDirectory(range: Window): Promise<StaffDirectoryRow[]> {
  const users = await prisma.user.findMany({
    where: { role: { in: STAFF_ROLES } },
    select: { id: true, name: true, email: true, role: true, deletedAt: true, blockedAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return [];

  const [scans, invoices, sessions, lastActive, payouts] = await Promise.all([
    prisma.gateScanEvent.findMany({
      where: { operatorId: { in: ids }, createdAt: { gte: range.from, lt: range.toExclusive } },
      select: { operatorId: true, createdAt: true, result: true, people: true, amountCents: true },
    }),
    prisma.invoice.findMany({
      where: {
        status: 'PAID',
        paidAt: { gte: range.from, lt: range.toExclusive },
        booking: { createdByStaffId: { in: ids } },
      },
      select: {
        paidAt: true,
        totalCents: true,
        refunds: { select: { amountCents: true, kind: true } },
        booking: { select: { createdByStaffId: true, insurance: { select: { amountCents: true, collectionStatus: true } } } },
      },
    }),
    prisma.workSession.findMany({
      where: {
        staffId: { in: ids },
        startedAt: { lt: range.toExclusive },
        OR: [{ endedAt: null }, { endedAt: { gte: range.from } }],
      },
      select: { staffId: true, startedAt: true, lastActivityAt: true, endedAt: true },
    }),
    prisma.gateScanEvent.groupBy({ by: ['operatorId'], where: { operatorId: { in: ids } }, _max: { createdAt: true } }),
    // Desk deposit payouts (cash leaving the drawer), by the staffer whose
    // checkout decision opened them. PROVIDER refunds are gateway money, not desk.
    prisma.insuranceRefund.findMany({
      where: {
        requestedById: { in: ids },
        status: 'COMPLETED',
        method: { in: ['CASH', 'INSTAPAY'] },
        completedAt: { gte: range.from, lt: range.toExclusive },
      },
      select: { requestedById: true, completedAt: true, amountCents: true },
    }),
  ]);

  const scansByStaff = new Map<string, ScanRow[]>();
  for (const s of scans) {
    const arr = scansByStaff.get(s.operatorId) ?? [];
    arr.push(s);
    scansByStaff.set(s.operatorId, arr);
  }
  const invByStaff = new Map<string, InvoiceRow[]>();
  for (const inv of invoices) {
    const sid = inv.booking?.createdByStaffId;
    if (!sid) continue;
    const arr = invByStaff.get(sid) ?? [];
    arr.push({ paidAt: inv.paidAt, totalCents: inv.totalCents, refunds: inv.refunds, insurance: inv.booking?.insurance ?? null });
    invByStaff.set(sid, arr);
  }
  const payoutsByStaff = new Map<string, PayoutRow[]>();
  for (const p of payouts) {
    const arr = payoutsByStaff.get(p.requestedById) ?? [];
    arr.push(p);
    payoutsByStaff.set(p.requestedById, arr);
  }
  const sessByStaff = new Map<string, SessionRow[]>();
  for (const s of sessions) {
    const arr = sessByStaff.get(s.staffId) ?? [];
    arr.push(s);
    sessByStaff.set(s.staffId, arr);
  }
  const lastByStaff = new Map(lastActive.map((l) => [l.operatorId, l._max.createdAt]));

  const rows: StaffDirectoryRow[] = users.map((u) => ({
    id: u.id,
    name: u.name ?? u.email ?? 'Staff',
    role: u.role,
    email: u.email,
    active: u.deletedAt == null && u.blockedAt == null,
    rollup: rollupFor(scansByStaff.get(u.id) ?? [], invByStaff.get(u.id) ?? [], sessByStaff.get(u.id) ?? [], payoutsByStaff.get(u.id) ?? [], range),
    lastActiveAt: lastByStaff.get(u.id) ?? null,
  }));

  rows.sort((a, b) => {
    if (b.rollup.revenueCents !== a.rollup.revenueCents) return b.rollup.revenueCents - a.rollup.revenueCents;
    const act = (r: StaffRollup) => r.gateScans + r.bookings;
    return act(b.rollup) - act(a.rollup);
  });
  return rows;
}

// ─── Single-staff profile ────────────────────────────────────────────────────

export interface StaffDay {
  /** UTC day key (YYYY-MM-DD). */
  date: string;
  workedMs: number;
  /** First→last scan span that day (activity-window reference). */
  firstScan: Date | null;
  lastScan: Date | null;
  revenueCents: number;
  cashCents: number;
  bookings: number;
  admittedPeople: number;
  admittedScans: number;
  deniedScans: number;
  exitedScans: number;
}

export interface StaffActivityEvent {
  id: string;
  createdAt: Date;
  result: 'ADMITTED' | 'EXITED' | 'DENIED' | 'RECEPTION';
  guestName: string;
  categoryName: string;
  reference: string | null;
  reason: string | null;
  people: number;
  amountCents: number | null;
}

export interface StaffSession {
  id: string;
  location: string;
  startedAt: Date;
  endedAt: Date | null;
  lastActivityAt: Date;
  open: boolean;
  workedMs: number;
}

export interface StaffPerformance {
  staff: { id: string; name: string; role: string; email: string | null; active: boolean };
  /** Current-period headline rollups (from `now`, independent of the filter). */
  windows: { today: StaffRollup; week: StaffRollup; month: StaffRollup };
  /** Totals for the selected filter range. */
  range: Window;
  ranged: StaffRollup;
  days: StaffDay[];
  sessions: StaffSession[];
  events: StaffActivityEvent[];
  eventLimit: number;
}

/**
 * Full performance profile for one staff member over `range` (activity, revenue,
 * hours, per-day breakdown, session log, activity trail) plus today/week/month
 * headline rollups computed from `now`. Returns `null` if the user doesn't exist.
 */
export async function getStaffPerformance(
  staffId: string,
  range: Window,
  locale: 'ar' | 'en' = 'en',
  now: Date = new Date(),
  eventLimit = 300,
): Promise<StaffPerformance | null> {
  const staff = await prisma.user.findUnique({
    where: { id: staffId },
    select: { id: true, name: true, email: true, role: true, deletedAt: true, blockedAt: true },
  });
  if (!staff) return null;

  const wins = currentWindows(now);
  // Fetch broadly enough to cover both the selected range AND the current-period
  // windows, then bucket everything in memory (one query per source).
  const lo = new Date(Math.min(range.from.getTime(), wins.month.from.getTime(), wins.week.from.getTime()));
  const hi = new Date(Math.max(range.toExclusive.getTime(), wins.month.toExclusive.getTime(), now.getTime() + 1000));

  const [scanRows, invoiceRaw, sessionRows, payoutRows] = await Promise.all([
    prisma.gateScanEvent.findMany({
      where: { operatorId: staffId, createdAt: { gte: lo, lt: hi } },
      include: {
        scannedUser: { select: { name: true, email: true } },
        booking: { select: { guestName: true } },
        category: { select: { nameEn: true, nameAr: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.invoice.findMany({
      where: { status: 'PAID', paidAt: { gte: lo, lt: hi }, booking: { createdByStaffId: staffId } },
      select: {
        paidAt: true,
        totalCents: true,
        refunds: { select: { amountCents: true, kind: true } },
        booking: { select: { insurance: { select: { amountCents: true, collectionStatus: true } } } },
      },
    }),
    prisma.workSession.findMany({
      where: { staffId, startedAt: { lt: hi }, OR: [{ endedAt: null }, { endedAt: { gte: lo } }] },
      orderBy: { startedAt: 'desc' },
      select: { id: true, location: true, startedAt: true, lastActivityAt: true, endedAt: true },
    }),
    prisma.insuranceRefund.findMany({
      where: {
        requestedById: staffId,
        status: 'COMPLETED',
        method: { in: ['CASH', 'INSTAPAY'] },
        completedAt: { gte: lo, lt: hi },
      },
      select: { completedAt: true, amountCents: true },
    }),
  ]);

  const scans: ScanRow[] = scanRows.map((s) => ({ createdAt: s.createdAt, result: s.result, people: s.people, amountCents: s.amountCents }));
  const invoiceRows: InvoiceRow[] = invoiceRaw.map((inv) => ({
    paidAt: inv.paidAt,
    totalCents: inv.totalCents,
    refunds: inv.refunds,
    insurance: inv.booking?.insurance ?? null,
  }));

  const roll = (w: Window) => rollupFor(scans, invoiceRows, sessionRows, payoutRows, w);

  // Per-day breakdown within the selected range only.
  const dayMap = new Map<string, StaffDay>();
  const ensureDay = (key: string): StaffDay => {
    let d = dayMap.get(key);
    if (!d) {
      d = { date: key, workedMs: 0, firstScan: null, lastScan: null, revenueCents: 0, cashCents: 0, bookings: 0, admittedPeople: 0, admittedScans: 0, deniedScans: 0, exitedScans: 0 };
      dayMap.set(key, d);
    }
    return d;
  };
  for (const s of scanRows) {
    if (!inWindow(s.createdAt, range)) continue;
    const key = resortDayKey(s.createdAt);
    const d = ensureDay(key);
    if (!d.firstScan || s.createdAt < d.firstScan) d.firstScan = s.createdAt;
    if (!d.lastScan || s.createdAt > d.lastScan) d.lastScan = s.createdAt;
    if (s.result === 'ADMITTED') {
      d.admittedScans += 1;
      d.admittedPeople += s.people;
    } else if (s.result === 'EXITED') {
      d.exitedScans += 1;
    } else if (s.result === 'DENIED') {
      d.deniedScans += 1;
    } else {
      d.bookings += 1;
      d.cashCents += s.amountCents ?? 0;
    }
  }
  for (const inv of invoiceRows) {
    if (!inWindow(inv.paidAt, range) || !inv.paidAt) continue;
    ensureDay(resortDayKey(inv.paidAt)).revenueCents += splitPaidInvoice(inv.totalCents, inv.refunds, inv.insurance).serviceNetCents;
  }
  for (const s of sessionRows) {
    // Attribute a session's worked time to the day it started (sessions rarely
    // span a UTC-day boundary; this keeps the per-day column readable).
    const dayWin = ((): Window => {
      const start = utcDayStart(s.startedAt);
      return { from: start, toExclusive: new Date(start.getTime() + 86_400_000) };
    })();
    const ms = sessionMsInWindow(s, range); // clip to the selected range first
    if (ms <= 0) continue;
    ensureDay(resortDayKey(s.startedAt)).workedMs += sessionMsInWindow(s, {
      from: new Date(Math.max(dayWin.from.getTime(), range.from.getTime())),
      toExclusive: new Date(Math.min(dayWin.toExclusive.getTime(), range.toExclusive.getTime())),
    });
  }
  const days = Array.from(dayMap.values()).sort((a, b) => (a.date < b.date ? 1 : -1));

  const sessions: StaffSession[] = sessionRows
    .filter((s) => sessionMsInWindow(s, range) > 0 || inWindow(s.startedAt, range))
    .map((s) => ({
      id: s.id,
      location: s.location,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      lastActivityAt: s.lastActivityAt,
      open: s.endedAt == null,
      workedMs: Math.max(0, (s.endedAt ?? s.lastActivityAt).getTime() - s.startedAt.getTime()),
    }));

  const events: StaffActivityEvent[] = scanRows
    .filter((s) => inWindow(s.createdAt, range))
    .slice(0, eventLimit)
    .map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      result: s.result,
      guestName: s.scannedUser?.name ?? s.scannedUser?.email ?? s.booking?.guestName ?? 'Unknown pass',
      categoryName: s.category ? (locale === 'ar' ? s.category.nameAr : s.category.nameEn) : '—',
      reference: s.reference,
      reason: s.reason,
      people: s.people,
      amountCents: s.amountCents,
    }));

  return {
    staff: { id: staff.id, name: staff.name ?? staff.email ?? 'Staff', role: staff.role, email: staff.email, active: staff.deletedAt == null && staff.blockedAt == null },
    windows: { today: roll(wins.day), week: roll(wins.week), month: roll(wins.month) },
    range,
    ranged: roll(range),
    days,
    sessions,
    events,
    eventLimit,
  };
}

/** Prisma where-fragment reused by the export layer to scope staff invoices. */
export const staffInvoiceWhere = (ids: string[], range: Window): Prisma.InvoiceWhereInput => ({
  status: 'PAID',
  paidAt: { gte: range.from, lt: range.toExclusive },
  booking: { createdByStaffId: { in: ids } },
});

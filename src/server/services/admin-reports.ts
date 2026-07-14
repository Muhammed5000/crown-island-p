import 'server-only';
import type { Prisma, BookingStatus, PaymentStatus, PaymentProvider } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { summarizeAuditChange } from '@/lib/audit-diff';
import { resolveAuditContext } from '@/server/audit/audit-context';
import { allocateInvoiceToPlaces, durationDays, mergedSpansMs, splitPaidInvoice, UNASSIGNED, type ReportRange } from './report-math';
import { resortDayKey } from '@/lib/date';

export async function getManagementSummary() {
  const now = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // All revenue figures are SERVICE-net and must match `splitPaidInvoice`
  // exactly: per-invoice GREATEST(total - collectedDeposit - serviceRefunded, 0).
  // The insurance deposit inside `Invoice.totalCents` is a liability while held
  // (docs/INSURANCE.md §7) so it is excluded, as are its payout RefundLines
  // (kind = INSURANCE). Historical rows (no BookingInsurance, all refunds
  // SERVICE) are arithmetically unchanged. Aggregation happens in SQL — the
  // previous implementation materialised EVERY paid invoice (plus its
  // booking/service/category) in memory on each dashboard view, which
  // grows without bound as the business accumulates history.
  const [totalsRows, byServiceRows, trendRows, bookingCounts, last30DaysBookings] =
    await Promise.all([
      // All-time paid-invoice count + net revenue.
      prisma.$queryRaw<{ invoices: number; netCents: bigint }[]>`
        SELECT COUNT(*)::int AS "invoices",
               COALESCE(SUM(GREATEST(i."totalCents" - COALESCE(ins."amountCents", 0) - COALESCE(r.refunded, 0), 0)), 0)::bigint AS "netCents"
        FROM "Invoice" i
        LEFT JOIN (SELECT "invoiceId", SUM("amountCents") AS refunded FROM "RefundLine" WHERE "kind" = 'SERVICE' GROUP BY 1) r
          ON r."invoiceId" = i.id
        LEFT JOIN "BookingInsurance" ins
          ON ins."bookingId" = i."bookingId" AND ins."collectionStatus" = 'COLLECTED'
        WHERE i.status = 'PAID'`,
      // All-time net revenue per (category, service) — both maps derive from this.
      prisma.$queryRaw<{ category: string; service: string; netCents: bigint }[]>`
        SELECT c."nameEn" AS "category", s."nameEn" AS "service",
               COALESCE(SUM(GREATEST(i."totalCents" - COALESCE(ins."amountCents", 0) - COALESCE(r.refunded, 0), 0)), 0)::bigint AS "netCents"
        FROM "Invoice" i
        JOIN "Booking" b ON b.id = i."bookingId"
        JOIN "Service" s ON s.id = b."serviceId"
        JOIN "Category" c ON c.id = s."categoryId"
        LEFT JOIN (SELECT "invoiceId", SUM("amountCents") AS refunded FROM "RefundLine" WHERE "kind" = 'SERVICE' GROUP BY 1) r
          ON r."invoiceId" = i.id
        LEFT JOIN "BookingInsurance" ins
          ON ins."bookingId" = b.id AND ins."collectionStatus" = 'COLLECTED'
        WHERE i.status = 'PAID'
        GROUP BY c."nameEn", s."nameEn"`,
      // Net revenue per resort-local (Cairo) day over the trailing 30 days
      // (paidAt-keyed). paidAt is a naive-UTC timestamp; the double AT TIME ZONE
      // reinterprets it as UTC then converts to Cairo before truncating (TIME-001).
      prisma.$queryRaw<{ day: string; netCents: bigint }[]>`
        SELECT to_char(date_trunc('day', i."paidAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo'), 'YYYY-MM-DD') AS "day",
               COALESCE(SUM(GREATEST(i."totalCents" - COALESCE(ins."amountCents", 0) - COALESCE(r.refunded, 0), 0)), 0)::bigint AS "netCents"
        FROM "Invoice" i
        LEFT JOIN (SELECT "invoiceId", SUM("amountCents") AS refunded FROM "RefundLine" WHERE "kind" = 'SERVICE' GROUP BY 1) r
          ON r."invoiceId" = i.id
        LEFT JOIN "BookingInsurance" ins
          ON ins."bookingId" = i."bookingId" AND ins."collectionStatus" = 'COLLECTED'
        WHERE i.status = 'PAID' AND i."paidAt" >= ${thirtyDaysAgo}
        GROUP BY 1`,
      prisma.booking.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      prisma.booking.count({
        where: { createdAt: { gte: thirtyDaysAgo } },
      }),
    ]);

  const totalRevenueCents = Number(totalsRows[0]?.netCents ?? 0);
  const totalInvoices = totalsRows[0]?.invoices ?? 0;

  // Same-name services/categories merge by display name, as before.
  const catMap = new Map<string, number>();
  const svcMap = new Map<string, number>();
  for (const row of byServiceRows) {
    const net = Number(row.netCents);
    catMap.set(row.category, (catMap.get(row.category) ?? 0) + net);
    svcMap.set(row.service, (svcMap.get(row.service) ?? 0) + net);
  }

  const trendMap = new Map(trendRows.map((r) => [r.day, Number(r.netCents)]));
  const last30DaysRevenueCents = trendRows.reduce((acc, r) => acc + Number(r.netCents), 0);

  const chartTrends = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    // TIME-001: the SQL trend buckets by Cairo civil day, so the axis key must too
    // (a UTC slice would drop the current Cairo day near the UTC/Cairo boundary).
    const day = resortDayKey(d);
    return {
      date: day,
      amount: (trendMap.get(day) ?? 0) / 100,
    };
  });

  const confirmedCount = bookingCounts.find(b => b.status === 'CONFIRMED')?._count._all ?? 0;
  const totalBookingsCount = bookingCounts.reduce((acc, b) => acc + b._count._all, 0);

  return {
    overview: {
      totalRevenueCents,
      totalInvoices,
      last30DaysRevenueCents,
      totalBookings: totalBookingsCount,
      confirmedBookings: confirmedCount,
      last30DaysBookings,
      avgBookingValueCents: confirmedCount > 0 ? totalRevenueCents / confirmedCount : 0,
    },
    categories: Array.from(catMap.entries()).map(([name, cents]) => ({ name, cents })),
    services: Array.from(svcMap.entries()).map(([name, cents]) => ({ name, cents })),
    trends: chartTrends,
    timestamp: now,
  };
}

export type ManagementSummary = Awaited<ReturnType<typeof getManagementSummary>>;

/* ────────────────────────────────────────────────────────────────────────────
 * Admin Reports tabs — parameterized aggregations.
 *
 * Conventions (matching the dashboard so numbers always agree):
 *   - Revenue = Invoice WHERE status='PAID' AND paidAt in range, SERVICE-net
 *     via splitPaidInvoice (collected insurance deposit excluded — it is a
 *     liability, not revenue — and only kind=SERVICE RefundLines netted).
 *     Never derived from Payment rows or Booking status.
 *   - Deposit figures come from the 1:1 BookingInsurance row + RefundLine
 *     kind=INSURANCE — never from InvoiceLine meta scans (docs/INSURANCE.md §7).
 *   - Day buckets are resort-local (Africa/Cairo) civil days (TIME-001), so a
 *     sale just after Cairo midnight counts on the correct business day. Both the
 *     JS bucketing (dayKey → resortDayKey) and the SQL day-series (date_trunc …
 *     AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo') use Cairo.
 *   - All money stays integer cents; pages format at the edge with formatMoney.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Resort-local (Cairo) civil-day key, e.g. "2026-06-10" (TIME-001). */
function dayKey(d: Date): string {
  return resortDayKey(d);
}

/** Every Cairo civil day in [from, toExclusive) so charts render gap-free axes. */
function eachDay(range: ReportRange): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let t = range.from.getTime(); t < range.toExclusive.getTime(); t += 86_400_000) {
    // Format at local noon so a DST ±1h shift never flips the civil day; dedupe
    // guards the rare 23h/25h DST-transition day.
    const key = resortDayKey(new Date(t + 43_200_000));
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  // Hard cap: a runaway custom range must not build a million-point chart.
  return out.length > 400 ? out.slice(out.length - 400) : out;
}

/**
 * System-wide outstanding balance (point-in-time, not ranged): for every
 * CONFIRMED booking, what its invoice still lacks in SUCCEEDED payments.
 * Mirrors the per-customer formula in admin-customers.ts.
 */
async function outstandingBalanceCents(): Promise<number> {
  const rows = await prisma.$queryRaw<{ cents: number }[]>`
    SELECT COALESCE(SUM(GREATEST(o.due, 0)), 0)::int AS cents FROM (
      SELECT i."totalCents" - COALESCE(SUM(p."amountCents") FILTER (WHERE p.status = 'SUCCEEDED'), 0) AS due
      FROM "Booking" b
      JOIN "Invoice" i ON i."bookingId" = b.id
      LEFT JOIN "Payment" p ON p."bookingId" = b.id
      WHERE b.status = 'CONFIRMED'
      GROUP BY b.id, i."totalCents"
    ) o`;
  return rows[0]?.cents ?? 0;
}

/** Live "currently out of service" place ids — same semantics as the gate pickers. */
async function currentlyOutPlaceIds(now: Date = new Date()): Promise<Set<string>> {
  const rows = await prisma.placeOutage.findMany({
    where: { startsAt: { lte: now }, endsAt: { gt: now } },
    select: { placeId: true },
  });
  return new Set(rows.map((r) => r.placeId));
}

// ── Overview ────────────────────────────────────────────────────────────────

export async function getReportOverview(range: ReportRange) {
  const { from, toExclusive } = range;
  const [paidInvoices, bookingsByStatus, channel, visits, totalCustomers, newCustomers, refunds, outstanding, outIds, offlinePlaces, depositsCollected, depositsRefunded, depositsRetained, depositsHeldRows] =
    await Promise.all([
      prisma.invoice.findMany({
        where: { status: 'PAID', paidAt: { gte: from, lt: toExclusive } },
        select: {
          totalCents: true,
          paidAt: true,
          refunds: { select: { amountCents: true, kind: true } },
          booking: {
            select: {
              service: { select: { category: { select: { id: true, nameEn: true, nameAr: true } } } },
              insurance: { select: { amountCents: true, collectionStatus: true } },
            },
          },
        },
      }),
      prisma.booking.groupBy({
        by: ['status'],
        where: { createdAt: { gte: from, lt: toExclusive } },
        _count: { _all: true },
      }),
      Promise.all([
        prisma.booking.count({ where: { createdAt: { gte: from, lt: toExclusive }, createdByStaffId: null } }),
        prisma.booking.count({ where: { createdAt: { gte: from, lt: toExclusive }, createdByStaffId: { not: null } } }),
      ]),
      prisma.booking.aggregate({
        where: { status: 'CONFIRMED', bookingDate: { gte: from, lt: toExclusive } },
        _count: { _all: true },
        _sum: { people: true },
      }),
      prisma.user.count({ where: { role: 'CUSTOMER', deletedAt: null } }),
      prisma.user.count({ where: { role: 'CUSTOMER', deletedAt: null, createdAt: { gte: from, lt: toExclusive } } }),
      // "Refunds" KPI = SERVICE (booking-money) refunds only; deposit payouts
      // are a liability being returned, reported in the deposits block below.
      prisma.refundLine.aggregate({
        where: { kind: 'SERVICE', createdAt: { gte: from, lt: toExclusive } },
        _count: { _all: true },
        _sum: { amountCents: true },
      }),
      outstandingBalanceCents(),
      currentlyOutPlaceIds(),
      prisma.servicePlace.count({ where: { isActive: false } }),
      // ── Insurance deposits (docs/INSURANCE.md §7) ─────────────────────────
      // collected in range (by collectedAt) / refunded in range (payout lines)
      // / retained in range (NO_REFUND decisions, by decidedAt).
      prisma.bookingInsurance.aggregate({
        where: { collectionStatus: 'COLLECTED', collectedAt: { gte: from, lt: toExclusive } },
        _count: { _all: true },
        _sum: { amountCents: true },
      }),
      prisma.refundLine.aggregate({
        where: { kind: 'INSURANCE', createdAt: { gte: from, lt: toExclusive } },
        _count: { _all: true },
        _sum: { amountCents: true },
      }),
      prisma.bookingInsurance.aggregate({
        where: { collectionStatus: 'COLLECTED', decision: 'NO_REFUND', decidedAt: { gte: from, lt: toExclusive } },
        _sum: { amountCents: true },
      }),
      // Held = GLOBAL outstanding liability right now (all-time collected −
      // refunded − retained) — point-in-time like outstandingCents, NOT ranged.
      prisma.$queryRaw<{ held: bigint }[]>`
        SELECT (SELECT COALESCE(SUM("amountCents"), 0) FROM "BookingInsurance" WHERE "collectionStatus" = 'COLLECTED')
             - (SELECT COALESCE(SUM("amountCents"), 0) FROM "RefundLine" WHERE "kind" = 'INSURANCE')
             - (SELECT COALESCE(SUM("amountCents"), 0) FROM "BookingInsurance" WHERE "collectionStatus" = 'COLLECTED' AND "decision" = 'NO_REFUND')
             AS held`,
    ]);

  let netRevenue = 0;
  const trendMap = new Map<string, number>();
  const catMap = new Map<string, { nameEn: string; nameAr: string; cents: number }>();
  for (const inv of paidInvoices) {
    const net = splitPaidInvoice(inv.totalCents, inv.refunds, inv.booking.insurance).serviceNetCents;
    netRevenue += net;
    if (inv.paidAt) {
      const day = dayKey(inv.paidAt);
      trendMap.set(day, (trendMap.get(day) ?? 0) + net);
    }
    const cat = inv.booking.service.category;
    const entry = catMap.get(cat.id) ?? { nameEn: cat.nameEn, nameAr: cat.nameAr, cents: 0 };
    entry.cents += net;
    catMap.set(cat.id, entry);
  }

  const statusCounts = Object.fromEntries(bookingsByStatus.map((s) => [s.status, s._count._all])) as Partial<
    Record<BookingStatus, number>
  >;
  const totalBookings = bookingsByStatus.reduce((a, s) => a + s._count._all, 0);

  return {
    netRevenueCents: netRevenue,
    paidInvoices: paidInvoices.length,
    avgInvoiceCents: paidInvoices.length > 0 ? Math.round(netRevenue / paidInvoices.length) : 0,
    refundCount: refunds._count._all,
    refundCents: refunds._sum.amountCents ?? 0,
    outstandingCents: outstanding,
    totalBookings,
    statusCounts,
    onlineBookings: channel[0],
    receptionBookings: channel[1],
    visitBookings: visits._count._all,
    visitGuests: visits._sum.people ?? 0,
    totalCustomers,
    newCustomers,
    placesOutNow: outIds.size,
    placesOffline: offlinePlaces,
    // Insurance-deposit ledger block. `heldCents` is the global outstanding
    // liability (point-in-time); the other figures are for the selected range.
    deposits: {
      collectedCents: depositsCollected._sum.amountCents ?? 0,
      collectedCount: depositsCollected._count._all,
      refundedCents: depositsRefunded._sum.amountCents ?? 0,
      refundedCount: depositsRefunded._count._all,
      retainedCents: depositsRetained._sum.amountCents ?? 0,
      heldCents: Number(depositsHeldRows[0]?.held ?? 0),
    },
    revenueTrend: eachDay(range).map((date) => ({ date, amount: (trendMap.get(date) ?? 0) / 100 })),
    topCategories: [...catMap.values()].sort((a, b) => b.cents - a.cents).slice(0, 6),
  };
}
export type ReportOverview = Awaited<ReturnType<typeof getReportOverview>>;

// ── Bookings ────────────────────────────────────────────────────────────────

export interface BookingsReportFilter extends ReportRange {
  status?: BookingStatus;
  serviceId?: string;
  /** Detail-table refinements (do NOT affect the KPI aggregates, like `status`). */
  channel?: 'online' | 'reception';
  checkedIn?: 'yes' | 'no';
  paymentStatus?: PaymentStatus;
  page?: number;
}

export async function getBookingsReport(filter: BookingsReportFilter) {
  const { from, toExclusive } = filter;
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = 20;
  const visitWhere: Prisma.BookingWhereInput = {
    bookingDate: { gte: from, lt: toExclusive },
    ...(filter.serviceId ? { serviceId: filter.serviceId } : {}),
  };
  const tableWhere: Prisma.BookingWhereInput = {
    ...visitWhere,
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.channel === 'online'
      ? { createdByStaffId: null }
      : filter.channel === 'reception'
        ? { createdByStaffId: { not: null } }
        : {}),
    ...(filter.checkedIn === 'yes'
      ? { checkedInAt: { not: null } }
      : filter.checkedIn === 'no'
        ? { checkedInAt: null }
        : {}),
    ...(filter.paymentStatus ? { payments: { some: { status: filter.paymentStatus } } } : {}),
  };

  const [byStatus, createdPerDay, visitsPerDay, channel, confirmed, total, items] = await Promise.all([
    prisma.booking.groupBy({ by: ['status'], where: visitWhere, _count: { _all: true } }),
    filter.serviceId
      ? prisma.$queryRaw<{ day: string; count: number }[]>`
          SELECT to_char(date_trunc('day', b."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo'), 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
          FROM "Booking" b
          WHERE b."createdAt" >= ${from} AND b."createdAt" < ${toExclusive} AND b."serviceId" = ${filter.serviceId}
          GROUP BY 1 ORDER BY 1`
      : prisma.$queryRaw<{ day: string; count: number }[]>`
          SELECT to_char(date_trunc('day', b."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo'), 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
          FROM "Booking" b
          WHERE b."createdAt" >= ${from} AND b."createdAt" < ${toExclusive}
          GROUP BY 1 ORDER BY 1`,
    prisma.booking.groupBy({
      by: ['bookingDate'],
      where: { ...visitWhere, status: 'CONFIRMED' },
      _count: { _all: true },
      _sum: { people: true },
    }),
    Promise.all([
      prisma.booking.count({ where: { ...visitWhere, createdByStaffId: null } }),
      prisma.booking.count({ where: { ...visitWhere, createdByStaffId: { not: null } } }),
    ]),
    prisma.booking.findMany({
      where: { ...visitWhere, status: 'CONFIRMED' },
      select: { bookingDate: true, endDate: true, checkedInAt: true },
    }),
    prisma.booking.count({ where: tableWhere }),
    prisma.booking.findMany({
      where: tableWhere,
      include: {
        user: { select: { name: true, email: true } },
        service: { select: { nameEn: true, nameAr: true, category: { select: { nameEn: true, nameAr: true } } } },
        invoice: { select: { totalCents: true, status: true } },
      },
      orderBy: [{ bookingDate: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const createdMap = new Map(createdPerDay.map((r) => [r.day, r.count]));
  const visitMap = new Map(visitsPerDay.map((r) => [dayKey(r.bookingDate), r._count._all]));
  const statusCounts = byStatus.map((s) => ({ status: s.status, count: s._count._all }));
  const totalInRange = byStatus.reduce((a, s) => a + s._count._all, 0);
  const cancelled = byStatus.find((s) => s.status === 'CANCELLED')?._count._all ?? 0;

  let totalDays = 0;
  let multiDay = 0;
  let checkedIn = 0;
  for (const b of confirmed) {
    const d = durationDays(b.bookingDate, b.endDate);
    totalDays += d;
    if (d > 1) multiDay += 1;
    if (b.checkedInAt) checkedIn += 1;
  }

  return {
    statusCounts,
    totalInRange,
    cancellationRatePct: totalInRange > 0 ? Math.round((cancelled / totalInRange) * 100) : 0,
    confirmedCount: confirmed.length,
    checkedInCount: checkedIn,
    showRatePct: confirmed.length > 0 ? Math.round((checkedIn / confirmed.length) * 100) : 0,
    totalBookedDays: totalDays,
    avgDurationDays: confirmed.length > 0 ? Math.round((totalDays / confirmed.length) * 10) / 10 : 0,
    multiDayCount: multiDay,
    onlineCount: channel[0],
    receptionCount: channel[1],
    createdPerDay: eachDay(filter).map((date) => ({ date, count: createdMap.get(date) ?? 0 })),
    visitsPerDay: eachDay(filter).map((date) => ({ date, count: visitMap.get(date) ?? 0 })),
    table: { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}
export type BookingsReport = Awaited<ReturnType<typeof getBookingsReport>>;

// ── Cabanas / place performance ─────────────────────────────────────────────

export interface PlaceReportFilter extends ReportRange {
  /** Most-specific filter wins: placeId → serviceId → categoryId → all. */
  serviceId?: string;
  categoryId?: string;
  placeId?: string;
}

/**
 * Per-place performance: bookings, booked days, attributed net revenue, outage
 * count + downtime, last activity, live status. Revenue uses the proportional
 * unit-day attribution from report-math (a NEW reporting convention — invoices
 * are per booking, places attach per unit-day).
 */
export async function getPlacePerformanceReport(filter: PlaceReportFilter) {
  const { from, toExclusive } = filter;
  const now = new Date();
  const rangeDays = Math.round((toExclusive.getTime() - from.getTime()) / 86_400_000);

  // The places list is the authoritative scope (most-specific filter wins);
  // the usage / revenue maps below are keyed by placeId and read per place, so
  // they may over-fetch harmlessly. `outageLogs` is scoped to match the list.
  const placeWhere: Prisma.ServicePlaceWhereInput = filter.placeId
    ? { id: filter.placeId }
    : filter.serviceId
      ? { serviceId: filter.serviceId }
      : filter.categoryId
        ? { service: { categoryId: filter.categoryId } }
        : { service: { placeAssignmentRequired: true } };
  const outageScope: Prisma.PlaceOutageLogWhereInput = filter.placeId
    ? { placeId: filter.placeId }
    : filter.serviceId
      ? { place: { serviceId: filter.serviceId } }
      : filter.categoryId
        ? { place: { service: { categoryId: filter.categoryId } } }
        : {};
  const revenueScope: Prisma.BookingWhereInput = filter.placeId
    ? { units: { some: { placeId: filter.placeId, date: { gte: from, lt: toExclusive } } } }
    : filter.serviceId
      ? { serviceId: filter.serviceId }
      : filter.categoryId
        ? { service: { categoryId: filter.categoryId } }
        : {};

  const [places, usage, revenueBookings, outageLogs, outNowRows] = await Promise.all([
    prisma.servicePlace.findMany({
      where: placeWhere,
      select: {
        id: true,
        label: true,
        zone: true,
        type: true,
        isActive: true,
        serviceId: true,
        service: {
          select: {
            nameEn: true,
            nameAr: true,
            category: { select: { nameEn: true, nameAr: true } },
          },
        },
      },
      orderBy: [{ serviceId: 'asc' }, { zone: 'asc' }, { position: 'asc' }, { label: 'asc' }],
    }),
    filter.serviceId
      ? prisma.$queryRaw<{ placeId: string; bookedDays: number; bookings: number; lastBookedAt: Date }[]>`
          SELECT bu."placeId" AS "placeId", COUNT(*)::int AS "bookedDays",
                 COUNT(DISTINCT bu."bookingId")::int AS "bookings", MAX(bu.date) AS "lastBookedAt"
          FROM "BookingUnit" bu JOIN "Booking" b ON b.id = bu."bookingId"
          WHERE bu."placeId" IS NOT NULL AND bu.date >= ${from} AND bu.date < ${toExclusive}
            AND b.status = 'CONFIRMED' AND b."serviceId" = ${filter.serviceId}
          GROUP BY bu."placeId"`
      : prisma.$queryRaw<{ placeId: string; bookedDays: number; bookings: number; lastBookedAt: Date }[]>`
          SELECT bu."placeId" AS "placeId", COUNT(*)::int AS "bookedDays",
                 COUNT(DISTINCT bu."bookingId")::int AS "bookings", MAX(bu.date) AS "lastBookedAt"
          FROM "BookingUnit" bu JOIN "Booking" b ON b.id = bu."bookingId"
          WHERE bu."placeId" IS NOT NULL AND bu.date >= ${from} AND bu.date < ${toExclusive}
            AND b.status = 'CONFIRMED'
          GROUP BY bu."placeId"`,
    prisma.booking.findMany({
      where: {
        status: 'CONFIRMED',
        invoice: { status: 'PAID' },
        units: { some: { date: { gte: from, lt: toExclusive } } },
        ...revenueScope,
      },
      select: {
        invoice: { select: { totalCents: true, refunds: { select: { amountCents: true, kind: true } } } },
        insurance: { select: { amountCents: true, collectionStatus: true } },
        units: { select: { placeId: true, date: true } },
      },
    }),
    prisma.placeOutageLog.findMany({
      where: {
        cancelled: false,
        startsAt: { lt: toExclusive },
        OR: [{ endsAt: null }, { endsAt: { gt: from } }],
        ...outageScope,
      },
      select: { placeId: true, kind: true, startsAt: true, endsAt: true },
    }),
    prisma.placeOutage.findMany({
      where: { startsAt: { lte: now }, endsAt: { gt: now } },
      select: { placeId: true },
    }),
  ]);

  const usageMap = new Map(usage.map((u) => [u.placeId, u]));
  const outNow = new Set(outNowRows.map((r) => r.placeId));

  // Attributed net revenue per place (plus the explicit unassigned bucket).
  // Service-only net: the held/collected deposit never attributes to a place.
  const revenueMap = new Map<string, number>();
  for (const b of revenueBookings) {
    if (!b.invoice) continue;
    const net = splitPaidInvoice(b.invoice.totalCents, b.invoice.refunds, b.insurance).serviceNetCents;
    for (const [key, cents] of allocateInvoiceToPlaces(b.units, net, filter)) {
      revenueMap.set(key, (revenueMap.get(key) ?? 0) + cents);
    }
  }

  // Outage count + clipped downtime per place. Count = scheduled OUTAGE windows;
  // downtime also includes open-ended INACTIVE (offline) spans. Spans are
  // MERGED per place so overlapping windows never double-count downtime.
  const spansByPlace = new Map<string, { kind: string; startsAt: Date; endsAt: Date | null }[]>();
  for (const log of outageLogs) {
    const list = spansByPlace.get(log.placeId) ?? [];
    list.push(log);
    spansByPlace.set(log.placeId, list);
  }
  const outageAgg = new Map<string, { count: number; downtimeMs: number; lastAt: Date | null }>();
  for (const [placeId, spans] of spansByPlace) {
    const count = spans.filter((s) => s.kind === 'OUTAGE').length;
    const lastAt = spans.reduce<Date | null>((a, s) => (!a || s.startsAt > a ? s.startsAt : a), null);
    outageAgg.set(placeId, { count, downtimeMs: mergedSpansMs(spans, filter, now), lastAt });
  }

  const rows = places.map((p) => {
    const u = usageMap.get(p.id);
    const o = outageAgg.get(p.id);
    const downtimeDays = (o?.downtimeMs ?? 0) / 86_400_000;
    const availableDays = Math.max(0, rangeDays - downtimeDays);
    const bookedDays = u?.bookedDays ?? 0;
    const revenueCents = revenueMap.get(p.id) ?? 0;
    return {
      id: p.id,
      label: p.label,
      zone: p.zone,
      type: p.type,
      serviceId: p.serviceId,
      serviceNameEn: p.service.nameEn,
      serviceNameAr: p.service.nameAr,
      categoryNameEn: p.service.category.nameEn,
      categoryNameAr: p.service.category.nameAr,
      bookings: u?.bookings ?? 0,
      bookedDays,
      revenueCents,
      avgPerBookingCents: u?.bookings ? Math.round(revenueCents / u.bookings) : 0,
      outageCount: o?.count ?? 0,
      downtimeHours: Math.round(((o?.downtimeMs ?? 0) / 3_600_000) * 10) / 10,
      lastBookedAt: u?.lastBookedAt ?? null,
      lastOutageAt: o?.lastAt ?? null,
      occupancyPct: availableDays > 0 ? Math.min(100, Math.round((bookedDays / availableDays) * 100)) : 0,
      status: (!p.isActive ? 'offline' : outNow.has(p.id) ? 'out' : 'online') as 'online' | 'offline' | 'out',
    };
  });
  rows.sort((a, b) => b.revenueCents - a.revenueCents || b.bookedDays - a.bookedDays || a.label.localeCompare(b.label));

  return {
    rows,
    rangeDays,
    unassignedRevenueCents: revenueMap.get(UNASSIGNED) ?? 0,
    totals: {
      revenueCents: rows.reduce((a, r) => a + r.revenueCents, 0),
      bookedDays: rows.reduce((a, r) => a + r.bookedDays, 0),
      bookings: rows.reduce((a, r) => a + r.bookings, 0),
      outages: rows.reduce((a, r) => a + r.outageCount, 0),
      downtimeHours: Math.round(rows.reduce((a, r) => a + r.downtimeHours, 0) * 10) / 10,
    },
  };
}
export type PlacePerformanceReport = Awaited<ReturnType<typeof getPlacePerformanceReport>>;

// ── Revenue ─────────────────────────────────────────────────────────────────

export interface RevenueReportFilter extends ReportRange {
  categoryId?: string;
}

export async function getRevenueReport(filter: RevenueReportFilter) {
  const { from, toExclusive } = filter;
  const [paidInvoices, methods, refunds, outstanding, depositCollected, depositRefunded] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        status: 'PAID',
        paidAt: { gte: from, lt: toExclusive },
        ...(filter.categoryId ? { booking: { service: { categoryId: filter.categoryId } } } : {}),
      },
      select: {
        totalCents: true,
        subtotalCents: true,
        taxCents: true,
        feeCents: true,
        paidAt: true,
        refunds: { select: { amountCents: true, kind: true } },
        booking: {
          select: {
            createdByStaffId: true,
            insurance: { select: { amountCents: true, collectionStatus: true } },
            service: {
              select: { id: true, nameEn: true, nameAr: true, category: { select: { id: true, nameEn: true, nameAr: true } } },
            },
          },
        },
      },
    }),
    // Collected by method — paidAt-not-null captures receipts that were later
    // refunded (their status flips to REFUNDED); refunds are netted separately.
    // Deliberately INCLUDES insurance deposits: this is money moved per channel
    // (cash-drawer/gateway reconciliation), not a revenue figure.
    prisma.payment.groupBy({
      by: ['provider'],
      where: { paidAt: { gte: from, lt: toExclusive } },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    // "Refunds" KPI = SERVICE (booking-money) refunds only; deposit payouts are
    // reported separately below so revenue netting and deposit flow never mix.
    prisma.refundLine.aggregate({
      where: { kind: 'SERVICE', createdAt: { gte: from, lt: toExclusive } },
      _count: { _all: true },
      _sum: { amountCents: true },
    }),
    outstandingBalanceCents(),
    prisma.bookingInsurance.aggregate({
      where: { collectionStatus: 'COLLECTED', collectedAt: { gte: from, lt: toExclusive } },
      _sum: { amountCents: true },
    }),
    prisma.refundLine.aggregate({
      where: { kind: 'INSURANCE', createdAt: { gte: from, lt: toExclusive } },
      _sum: { amountCents: true },
    }),
  ]);

  let net = 0;
  let gross = 0;
  let tax = 0;
  let fees = 0;
  let onlineNet = 0;
  let receptionNet = 0;
  const trendMap = new Map<string, number>();
  const catMap = new Map<string, { nameEn: string; nameAr: string; cents: number; invoices: number }>();
  const svcMap = new Map<string, { id: string; nameEn: string; nameAr: string; cents: number; invoices: number }>();
  for (const inv of paidInvoices) {
    // Gross/net are SERVICE money: the collected deposit inside totalCents is a
    // liability (returned or reported as "retained" separately), never revenue.
    const split = splitPaidInvoice(inv.totalCents, inv.refunds, inv.booking.insurance);
    const n = split.serviceNetCents;
    net += n;
    gross += split.serviceGrossCents;
    tax += inv.taxCents;
    fees += inv.feeCents;
    if (inv.booking.createdByStaffId) receptionNet += n;
    else onlineNet += n;
    if (inv.paidAt) {
      const day = dayKey(inv.paidAt);
      trendMap.set(day, (trendMap.get(day) ?? 0) + n);
    }
    const cat = inv.booking.service.category;
    const c = catMap.get(cat.id) ?? { nameEn: cat.nameEn, nameAr: cat.nameAr, cents: 0, invoices: 0 };
    c.cents += n;
    c.invoices += 1;
    catMap.set(cat.id, c);
    const svc = inv.booking.service;
    const s = svcMap.get(svc.id) ?? { id: svc.id, nameEn: svc.nameEn, nameAr: svc.nameAr, cents: 0, invoices: 0 };
    s.cents += n;
    s.invoices += 1;
    svcMap.set(svc.id, s);
  }

  return {
    netRevenueCents: net,
    grossRevenueCents: gross,
    taxCents: tax,
    feeCents: fees,
    paidInvoices: paidInvoices.length,
    avgInvoiceCents: paidInvoices.length > 0 ? Math.round(net / paidInvoices.length) : 0,
    onlineNetCents: onlineNet,
    receptionNetCents: receptionNet,
    refundCount: refunds._count._all,
    refundCents: refunds._sum.amountCents ?? 0,
    outstandingCents: outstanding,
    depositCollectedCents: depositCollected._sum.amountCents ?? 0,
    depositRefundedCents: depositRefunded._sum.amountCents ?? 0,
    trend: eachDay(filter).map((date) => ({ date, amount: (trendMap.get(date) ?? 0) / 100 })),
    byCategory: [...catMap.values()].sort((a, b) => b.cents - a.cents),
    byService: [...svcMap.values()].sort((a, b) => b.cents - a.cents).slice(0, 12),
    byMethod: methods
      .map((m) => ({ provider: m.provider, collectedCents: m._sum.amountCents ?? 0, payments: m._count._all }))
      .sort((a, b) => b.collectedCents - a.collectedCents),
  };
}
export type RevenueReport = Awaited<ReturnType<typeof getRevenueReport>>;

// ── Customers ───────────────────────────────────────────────────────────────

export async function getCustomersReport(range: ReportRange) {
  const { from, toExclusive } = range;
  const [totalCustomers, newCustomers, blockedCustomers, bookerSplit, topCustomers] = await Promise.all([
    prisma.user.count({ where: { role: 'CUSTOMER', deletedAt: null } }),
    prisma.user.count({ where: { role: 'CUSTOMER', deletedAt: null, createdAt: { gte: from, lt: toExclusive } } }),
    prisma.user.count({ where: { role: 'CUSTOMER', blockedAt: { not: null } } }),
    prisma.$queryRaw<{ bookers: number; newBookers: number }[]>`
      SELECT COUNT(DISTINCT b."userId")::int AS "bookers",
             COUNT(DISTINCT b."userId") FILTER (WHERE u."createdAt" >= ${from})::int AS "newBookers"
      FROM "Booking" b JOIN "User" u ON u.id = b."userId"
      WHERE b."createdAt" >= ${from} AND b."createdAt" < ${toExclusive} AND b."createdByStaffId" IS NULL`,
    // Top ONLINE customers by PAID-net spend in range. Reception walk-ins are
    // excluded — their userId is the staff member, not the guest. "Spend" is
    // SERVICE money only: the collected insurance deposit is held/returned, not
    // spent, so it is subtracted and deposit payout lines (kind=INSURANCE) are
    // excluded from the refund netting.
    prisma.$queryRaw<
      { userId: string; name: string | null; email: string | null; bookings: number; grossCents: number; refundCents: number }[]
    >`
      SELECT b."userId" AS "userId", u.name, u.email,
             COUNT(DISTINCT b.id)::int AS "bookings",
             COALESCE(SUM(i."totalCents" - COALESCE(ins."amountCents", 0)), 0)::int AS "grossCents",
             COALESCE(SUM(r.refunded), 0)::int AS "refundCents"
      FROM "Booking" b
      JOIN "Invoice" i ON i."bookingId" = b.id AND i.status = 'PAID'
        AND i."paidAt" >= ${from} AND i."paidAt" < ${toExclusive}
      LEFT JOIN (SELECT "invoiceId", SUM("amountCents") AS refunded FROM "RefundLine" WHERE "kind" = 'SERVICE' GROUP BY 1) r
        ON r."invoiceId" = i.id
      LEFT JOIN "BookingInsurance" ins
        ON ins."bookingId" = b.id AND ins."collectionStatus" = 'COLLECTED'
      JOIN "User" u ON u.id = b."userId"
      WHERE b."createdByStaffId" IS NULL
      GROUP BY b."userId", u.name, u.email
      ORDER BY (COALESCE(SUM(i."totalCents" - COALESCE(ins."amountCents", 0)), 0) - COALESCE(SUM(r.refunded), 0)) DESC
      LIMIT 20`,
  ]);

  return {
    totalCustomers,
    newCustomers,
    blockedCustomers,
    activeBookers: bookerSplit[0]?.bookers ?? 0,
    newBookers: bookerSplit[0]?.newBookers ?? 0,
    returningBookers: Math.max(0, (bookerSplit[0]?.bookers ?? 0) - (bookerSplit[0]?.newBookers ?? 0)),
    topCustomers: topCustomers.map((c) => ({
      userId: c.userId,
      name: c.name,
      email: c.email,
      bookings: c.bookings,
      netCents: Math.max(0, c.grossCents - c.refundCents),
    })),
  };
}
export type CustomersReport = Awaited<ReturnType<typeof getCustomersReport>>;

// ── Operations ──────────────────────────────────────────────────────────────

export async function getOperationsReport(range: ReportRange) {
  const { from, toExclusive } = range;
  const now = new Date();
  const [admittedByHour, scansByResult, outNow, offline, channel] = await Promise.all([
    prisma.$queryRaw<{ hour: number; scans: number; people: number }[]>`
      SELECT EXTRACT(HOUR FROM e."createdAt")::int AS hour, COUNT(*)::int AS scans,
             COALESCE(SUM(e.people), 0)::int AS people
      FROM "GateScanEvent" e
      WHERE e.result = 'ADMITTED' AND e."createdAt" >= ${from} AND e."createdAt" < ${toExclusive}
      GROUP BY 1 ORDER BY 1`,
    prisma.gateScanEvent.groupBy({
      by: ['result'],
      where: { createdAt: { gte: from, lt: toExclusive } },
      _count: { _all: true },
    }),
    prisma.placeOutage.findMany({
      where: { startsAt: { lte: now }, endsAt: { gt: now } },
      select: {
        reason: true,
        endsAt: true,
        place: {
          select: {
            label: true,
            service: { select: { nameEn: true, nameAr: true, category: { select: { nameEn: true, nameAr: true } } } },
          },
        },
      },
      orderBy: { endsAt: 'asc' },
      take: 50,
    }),
    prisma.servicePlace.findMany({
      where: { isActive: false },
      select: {
        label: true,
        service: { select: { nameEn: true, nameAr: true, category: { select: { nameEn: true, nameAr: true } } } },
      },
      orderBy: { label: 'asc' },
      take: 50,
    }),
    Promise.all([
      prisma.booking.count({ where: { createdAt: { gte: from, lt: toExclusive }, createdByStaffId: null } }),
      prisma.booking.count({ where: { createdAt: { gte: from, lt: toExclusive }, createdByStaffId: { not: null } } }),
    ]),
  ]);

  const hourMap = new Map(admittedByHour.map((h) => [h.hour, h]));
  return {
    admittedByHour: Array.from({ length: 24 }, (_, hour) => ({
      hour: `${String(hour).padStart(2, '0')}:00`,
      scans: hourMap.get(hour)?.scans ?? 0,
      people: hourMap.get(hour)?.people ?? 0,
    })),
    scansByResult: scansByResult.map((s) => ({ result: s.result, count: s._count._all })),
    placesOutNow: outNow.map((o) => ({
      label: o.place.label,
      serviceNameEn: o.place.service.nameEn,
      serviceNameAr: o.place.service.nameAr,
      categoryNameEn: o.place.service.category.nameEn,
      categoryNameAr: o.place.service.category.nameAr,
      reason: o.reason,
      until: o.endsAt,
    })),
    placesOffline: offline.map((p) => ({
      label: p.label,
      serviceNameEn: p.service.nameEn,
      serviceNameAr: p.service.nameAr,
      categoryNameEn: p.service.category.nameEn,
      categoryNameAr: p.service.category.nameAr,
    })),
    onlineBookings: channel[0],
    receptionBookings: channel[1],
  };
}
export type OperationsReport = Awaited<ReturnType<typeof getOperationsReport>>;

// ── Payments ──────────────────────────────────────────────────────────────────

export interface PaymentsReportFilter extends ReportRange {
  provider?: PaymentProvider;
  paymentStatus?: PaymentStatus;
}

/** Payment-level report: collected/refunded totals, split by status + method,
 * plus a preview of the most recent payments in range. */
export async function getPaymentsReport(filter: PaymentsReportFilter) {
  const { from, toExclusive } = filter;
  const where: Prisma.PaymentWhereInput = {
    createdAt: { gte: from, lt: toExclusive },
    ...(filter.provider ? { provider: filter.provider } : {}),
    ...(filter.paymentStatus ? { status: filter.paymentStatus } : {}),
  };
  const [byStatus, byProvider, collected, refunded, preview] = await Promise.all([
    prisma.payment.groupBy({ by: ['status'], where, _count: { _all: true }, _sum: { amountCents: true } }),
    prisma.payment.groupBy({ by: ['provider'], where, _count: { _all: true }, _sum: { amountCents: true } }),
    prisma.payment.aggregate({ where: { ...where, status: 'SUCCEEDED' }, _sum: { amountCents: true }, _count: { _all: true } }),
    prisma.payment.aggregate({ where: { ...where, status: 'REFUNDED' }, _sum: { amountCents: true }, _count: { _all: true } }),
    prisma.payment.findMany({
      where,
      select: {
        provider: true, status: true, amountCents: true, paidAt: true, createdAt: true,
        booking: { select: { reference: true, guestName: true, createdByStaffId: true, user: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
  ]);
  return {
    totalPayments: byStatus.reduce((a, s) => a + s._count._all, 0),
    collectedCents: collected._sum.amountCents ?? 0,
    collectedCount: collected._count._all,
    refundedCents: refunded._sum.amountCents ?? 0,
    refundedCount: refunded._count._all,
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all, cents: s._sum.amountCents ?? 0 })),
    byProvider: byProvider.map((p) => ({ provider: p.provider, count: p._count._all, cents: p._sum.amountCents ?? 0 })).sort((a, b) => b.cents - a.cents),
    preview: preview.map((p) => ({
      createdAt: p.createdAt,
      reference: p.booking?.reference ?? '—',
      customer: p.booking?.createdByStaffId ? (p.booking.guestName ?? '—') : (p.booking?.user?.name ?? '—'),
      provider: p.provider,
      status: p.status,
      amountCents: p.amountCents,
      paidAt: p.paidAt,
    })),
  };
}
export type PaymentsReport = Awaited<ReturnType<typeof getPaymentsReport>>;

// ── Cancellations & Refunds ────────────────────────────────────────────────────

export async function getCancellationsReport(range: ReportRange) {
  const { from, toExclusive } = range;
  const [byStatus, refunds, cancelledPreview] = await Promise.all([
    prisma.booking.groupBy({
      by: ['status'],
      where: { status: { in: ['CANCELLED', 'EXPIRED', 'FAILED'] }, cancelledAt: { gte: from, lt: toExclusive } },
      _count: { _all: true },
    }),
    // Booking-refund KPI = kind SERVICE only: this tab tracks the booking
    // cancellation/refund machine. Insurance-deposit payouts happen at checkout
    // (not cancellation) and are reported as deposit figures elsewhere.
    prisma.refundLine.aggregate({ where: { kind: 'SERVICE', createdAt: { gte: from, lt: toExclusive } }, _count: { _all: true }, _sum: { amountCents: true } }),
    prisma.booking.findMany({
      where: { status: { in: ['CANCELLED', 'EXPIRED', 'FAILED'] }, cancelledAt: { gte: from, lt: toExclusive } },
      select: {
        reference: true, status: true, bookingDate: true, cancelledAt: true, people: true, guestName: true, createdByStaffId: true,
        user: { select: { name: true } },
        service: { select: { nameEn: true, nameAr: true } },
        invoice: { select: { totalCents: true, refunds: { select: { amountCents: true } } } },
      },
      orderBy: { cancelledAt: 'desc' },
      take: 30,
    }),
  ]);
  return {
    cancelledCount: byStatus.reduce((a, s) => a + s._count._all, 0),
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
    refundCount: refunds._count._all,
    refundedCents: refunds._sum.amountCents ?? 0,
    preview: cancelledPreview.map((b) => ({
      reference: b.reference,
      status: b.status,
      bookingDate: b.bookingDate,
      cancelledAt: b.cancelledAt,
      people: b.people,
      customer: b.createdByStaffId ? (b.guestName ?? '—') : (b.user.name ?? '—'),
      serviceNameEn: b.service.nameEn,
      serviceNameAr: b.service.nameAr,
      totalCents: b.invoice?.totalCents ?? 0,
      // Per-booking "refunded" = TOTAL money returned (all kinds): it sits next
      // to the invoice total, which includes the deposit for insured bookings.
      refundedCents: b.invoice?.refunds.reduce((a, r) => a + r.amountCents, 0) ?? 0,
    })),
  };
}
export type CancellationsReport = Awaited<ReturnType<typeof getCancellationsReport>>;

// ── Sanctions ──────────────────────────────────────────────────────────────────

export async function getSanctionsReport(range: ReportRange) {
  const { from, toExclusive } = range;
  const [byStatus, activeAll, preview] = await Promise.all([
    prisma.sanction.groupBy({
      by: ['status'],
      where: { createdAt: { gte: from, lt: toExclusive } },
      _count: { _all: true },
      _sum: { amountCents: true },
    }),
    // Outstanding = ALL currently-active sanctions (point in time), not range-bound.
    prisma.sanction.aggregate({ where: { status: 'ACTIVE' }, _count: { _all: true }, _sum: { amountCents: true } }),
    prisma.sanction.findMany({
      where: { createdAt: { gte: from, lt: toExclusive } },
      select: {
        createdAt: true, amountCents: true, reason: true, status: true, settledAt: true,
        user: { select: { name: true, email: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
  ]);
  return {
    issuedCount: byStatus.reduce((a, s) => a + s._count._all, 0),
    issuedCents: byStatus.reduce((a, s) => a + (s._sum.amountCents ?? 0), 0),
    activeCount: activeAll._count._all,
    activeCents: activeAll._sum.amountCents ?? 0,
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all, cents: s._sum.amountCents ?? 0 })),
    preview: preview.map((s) => ({
      createdAt: s.createdAt,
      customer: s.user.name ?? s.user.email ?? '—',
      phone: s.user.phone ?? '—',
      amountCents: s.amountCents,
      reason: s.reason,
      status: s.status,
      settledAt: s.settledAt,
    })),
  };
}
export type SanctionsReport = Awaited<ReturnType<typeof getSanctionsReport>>;

// ── Audit / admin activity ─────────────────────────────────────────────────────

export async function getAuditReport(range: ReportRange, locale: 'ar' | 'en' = 'en') {
  const { from, toExclusive } = range;
  const [byAction, total, preview] = await Promise.all([
    prisma.auditLog.groupBy({ by: ['action'], where: { createdAt: { gte: from, lt: toExclusive } }, _count: { _all: true } }),
    prisma.auditLog.count({ where: { createdAt: { gte: from, lt: toExclusive } } }),
    prisma.auditLog.findMany({
      where: { createdAt: { gte: from, lt: toExclusive } },
      select: {
        id: true, createdAt: true, action: true, entityType: true, entityId: true, before: true, after: true,
        actor: { select: { name: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
    }),
  ]);
  const ctxMap = await resolveAuditContext(
    preview.map((a) => ({ id: a.id, entityType: a.entityType, entityId: a.entityId, before: a.before, after: a.after })),
    locale,
  );
  return {
    total,
    byAction: byAction.map((a) => ({ action: a.action, count: a._count._all })).sort((a, b) => b.count - a.count),
    preview: preview.map((a) => {
      const c = ctxMap.get(a.id);
      return {
        createdAt: a.createdAt,
        actor: a.actor?.name ?? a.actor?.email ?? 'System',
        role: a.actor?.role ?? '—',
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        category: c?.category ?? null,
        service: c?.service ?? null,
        item: c?.label ?? null,
        changes: summarizeAuditChange(a.before, a.after, 6, 40),
      };
    }),
  };
}
export type AuditReport = Awaited<ReturnType<typeof getAuditReport>>;

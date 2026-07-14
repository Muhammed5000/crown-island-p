import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { audit } from '@/server/audit/audit';
import { DomainError } from './errors';
import { userIdsWithActiveSanctions } from './sanctions';

/**
 * Admin Customer Profiles service — a 360° view of every registered customer.
 *
 * "Customer" = a `User` with role CUSTOMER (reception walk-ins have no account;
 * their details live on the booking). All money figures are computed from real
 * Invoice / Payment / RefundLine rows; nothing is denormalised or cached, so the
 * numbers always match the source records.
 *
 * Performance: the list page aggregates spend/booking-count/last-booking for the
 * CURRENT PAGE's users in a single grouped raw query (no N+1), and the detail
 * page loads one customer's bounded set of bookings and computes in memory.
 */

// ── List ───────────────────────────────────────────────────────────────────────

export type CustomerSort = 'recent' | 'name';

export interface TagChip {
  id: string;
  name: string;
  color: string;
}

export interface CustomerListItem {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  region: string | null;
  createdAt: Date;
  verified: boolean;
  /** Customer carries unpaid (ACTIVE) sanctions — surfaced as a red badge. */
  hasActiveSanctions: boolean;
  totalBookings: number;
  spentCents: number;
  lastBookingAt: Date | null;
  tags: TagChip[];
}

export interface CustomerListResult {
  items: CustomerListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function customerWhere(q?: string, tagId?: string): Prisma.UserWhereInput {
  // Exclude archived (soft-deleted) customers from all active listings.
  const where: Prisma.UserWhereInput = { role: 'CUSTOMER', deletedAt: null };
  const term = q?.trim();
  if (term) {
    where.OR = [
      { name: { contains: term, mode: 'insensitive' } },
      { email: { contains: term, mode: 'insensitive' } },
      { phone: { contains: term, mode: 'insensitive' } },
      { profile: { is: { fullName: { contains: term, mode: 'insensitive' } } } },
      { profile: { is: { nationalId: { contains: term, mode: 'insensitive' } } } },
      { profile: { is: { passportId: { contains: term, mode: 'insensitive' } } } },
    ];
  }
  // Manual segmentation: restrict to customers carrying the given tag.
  if (tagId) {
    where.tagAssignments = { some: { tagId } };
  }
  return where;
}

export async function adminListCustomers(input: {
  q?: string;
  sort?: CustomerSort;
  page?: number;
  pageSize?: number;
  tagId?: string;
}): Promise<CustomerListResult> {
  const where = customerWhere(input.q, input.tagId);
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
  const orderBy: Prisma.UserOrderByWithRelationInput =
    input.sort === 'name' ? { name: 'asc' } : { createdAt: 'desc' };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        emailVerified: true,
        phoneVerified: true,
        createdAt: true,
        profile: { select: { region: true, fullName: true } },
        tagAssignments: { select: { tag: { select: { id: true, name: true, color: true } } } },
      },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  // One grouped query for this page's spend / booking-count / last-booking —
  // no per-row queries (avoids the N+1 problem). Confirmed bookings count toward
  // spend; the booking count and last-booking span all statuses.
  const ids = users.map((u) => u.id);
  const aggMap = new Map<string, { bookings: number; spentCents: number; lastBookingAt: Date | null }>();
  if (ids.length) {
    const rows = await prisma.$queryRaw<
      { userId: string; bookings: number; spentCents: number; lastBookingAt: Date | null }[]
    >`
      SELECT b."userId"                                                            AS "userId",
             COUNT(*)::int                                                         AS "bookings",
             COALESCE(SUM(CASE WHEN b.status = 'CONFIRMED' THEN i."totalCents" ELSE 0 END), 0)::int AS "spentCents",
             MAX(b."bookingDate")                                                  AS "lastBookingAt"
      FROM "Booking" b
      LEFT JOIN "Invoice" i ON i."bookingId" = b.id
      WHERE b."userId" IN (${Prisma.join(ids)})
      GROUP BY b."userId"
    `;
    for (const r of rows) aggMap.set(r.userId, { bookings: r.bookings, spentCents: r.spentCents, lastBookingAt: r.lastBookingAt });
  }

  const sanctionedIds = await userIdsWithActiveSanctions(ids);

  const items: CustomerListItem[] = users.map((u) => {
    const agg = aggMap.get(u.id);
    return {
      id: u.id,
      name: u.name ?? u.profile?.fullName ?? null,
      email: u.email,
      phone: u.phone,
      region: u.profile?.region ?? null,
      createdAt: u.createdAt,
      verified: !!u.emailVerified || !!u.phoneVerified,
      hasActiveSanctions: sanctionedIds.has(u.id),
      totalBookings: agg?.bookings ?? 0,
      spentCents: agg?.spentCents ?? 0,
      lastBookingAt: agg?.lastBookingAt ?? null,
      tags: u.tagAssignments.map((a) => a.tag),
    };
  });

  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Unbounded list for CSV export (capped at 5,000 rows for safety). */
export async function adminExportCustomers(q?: string): Promise<CustomerListItem[]> {
  // Single pass: one findMany + one grouped aggregate. The previous
  // implementation paged through `adminListCustomers` 100 rows at a time,
  // which cost ~3 queries per page (~150 queries for a full export).
  const where = customerWhere(q);
  const users = await prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      emailVerified: true,
      phoneVerified: true,
      createdAt: true,
      profile: { select: { region: true, fullName: true } },
      tagAssignments: { select: { tag: { select: { id: true, name: true, color: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 5000,
  });

  const ids = users.map((u) => u.id);
  const aggMap = new Map<string, { bookings: number; spentCents: number; lastBookingAt: Date | null }>();
  if (ids.length) {
    const rows = await prisma.$queryRaw<
      { userId: string; bookings: number; spentCents: number; lastBookingAt: Date | null }[]
    >`
      SELECT b."userId"                                                            AS "userId",
             COUNT(*)::int                                                         AS "bookings",
             COALESCE(SUM(CASE WHEN b.status = 'CONFIRMED' THEN i."totalCents" ELSE 0 END), 0)::int AS "spentCents",
             MAX(b."bookingDate")                                                  AS "lastBookingAt"
      FROM "Booking" b
      LEFT JOIN "Invoice" i ON i."bookingId" = b.id
      WHERE b."userId" IN (${Prisma.join(ids)})
      GROUP BY b."userId"
    `;
    for (const r of rows) aggMap.set(r.userId, { bookings: r.bookings, spentCents: r.spentCents, lastBookingAt: r.lastBookingAt });
  }

  const sanctionedIds = await userIdsWithActiveSanctions(ids);

  return users.map((u) => {
    const agg = aggMap.get(u.id);
    return {
      id: u.id,
      name: u.name ?? u.profile?.fullName ?? null,
      email: u.email,
      phone: u.phone,
      region: u.profile?.region ?? null,
      createdAt: u.createdAt,
      verified: !!u.emailVerified || !!u.phoneVerified,
      hasActiveSanctions: sanctionedIds.has(u.id),
      totalBookings: agg?.bookings ?? 0,
      spentCents: agg?.spentCents ?? 0,
      lastBookingAt: agg?.lastBookingAt ?? null,
      tags: u.tagAssignments.map((a) => a.tag),
    };
  });
}

// ── Detail (360° profile) ────────────────────────────────────────────────────

const sumRefunds = (refunds: ReadonlyArray<{ amountCents: number }>) =>
  refunds.reduce((s, r) => s + r.amountCents, 0);

export type CustomerProfileView = NonNullable<Awaited<ReturnType<typeof adminGetCustomer>>>;

export async function adminGetCustomer(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: true,
      tagAssignments: { include: { tag: { select: { id: true, name: true, color: true } } } },
      bookings: {
        include: {
          // Slim projection — a full `service` include would carry the
          // long-form copy + gallery JSON for every booking row.
          service: {
            select: { kind: true, nameEn: true, nameAr: true, category: { select: { nameEn: true, nameAr: true } } },
          },
          invoice: { include: { refunds: true } },
          payments: { orderBy: { createdAt: 'desc' } },
          _count: { select: { guestIds: true } },
        },
        orderBy: { bookingDate: 'desc' },
        // Bound the history load (this include is folded in memory for the profile
        // stats). Covers any realistic customer; a >200-booking customer's headline
        // totals reflect the most recent 200 — see RISK_REGISTER A-14 for the exact
        // grouped-aggregate follow-up.
        take: 200,
      },
    },
  });
  if (!user || user.role !== 'CUSTOMER') return null;

  const bookings = user.bookings;
  const now = Date.now();
  const todayUtc = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());

  // Per-booking derived money.
  const rows = bookings.map((b) => {
    const total = b.invoice?.totalCents ?? 0;
    const refunded = b.invoice ? sumRefunds(b.invoice.refunds) : 0;
    const paid = b.payments.filter((p) => p.status === 'SUCCEEDED').reduce((s, p) => s + p.amountCents, 0);
    return { b, total, refunded, paid };
  });

  const confirmed = rows.filter((r) => r.b.status === 'CONFIRMED');

  // ── Financial summary ──
  const totalSpentCents = confirmed.reduce((s, r) => s + Math.max(0, r.total - r.refunded), 0);
  const totalPaidCents = rows.reduce((s, r) => s + r.paid, 0);
  const totalRefundCents = rows.reduce((s, r) => s + r.refunded, 0);
  const outstandingCents = confirmed.reduce((s, r) => s + Math.max(0, r.total - r.paid), 0);
  const confirmedTotals = confirmed.map((r) => r.total).filter((n) => n > 0);
  const financial = {
    totalSpentCents,
    totalPaidCents,
    totalRefundCents,
    outstandingCents,
    avgBookingCents: confirmedTotals.length ? Math.round(confirmedTotals.reduce((a, b) => a + b, 0) / confirmedTotals.length) : 0,
    highestBookingCents: confirmedTotals.length ? Math.max(...confirmedTotals) : 0,
    lowestBookingCents: confirmedTotals.length ? Math.min(...confirmedTotals) : 0,
    lifetimeValueCents: Math.max(0, totalPaidCents - totalRefundCents),
  };

  // ── Booking statistics ──
  const isPast = (b: (typeof bookings)[number]) => b.bookingDate.getTime() < todayUtc;
  const stats = {
    total: bookings.length,
    confirmed: confirmed.length,
    pending: bookings.filter((b) => b.status === 'PENDING_PAYMENT').length,
    cancelled: bookings.filter((b) => b.status === 'CANCELLED').length,
    expired: bookings.filter((b) => b.status === 'EXPIRED').length,
    failed: bookings.filter((b) => b.status === 'FAILED').length,
    refunded: rows.filter((r) => r.refunded > 0).length,
    upcoming: confirmed.filter((r) => !isPast(r.b)).length,
    checkedIn: bookings.filter((b) => b.checkedInCount > 0).length,
    totalGuests: bookings.reduce((s, b) => s + b.people, 0),
  };

  // ── Analytics ──
  const firstBooking = bookings.length ? bookings[bookings.length - 1]!.createdAt : null;
  const monthsActive = firstBooking ? Math.max(1, (now - firstBooking.getTime()) / (30 * 86_400_000)) : 1;
  const kindCount = new Map<string, number>();
  for (const b of bookings) kindCount.set(b.service.kind, (kindCount.get(b.service.kind) ?? 0) + 1);
  const mostCommonKind = [...kindCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const analytics = {
    revenueCents: financial.lifetimeValueCents,
    avgSpendCents: financial.avgBookingCents,
    bookingsPerMonth: Math.round((bookings.length / monthsActive) * 10) / 10,
    mostCommonKind,
    firstBookingAt: firstBooking,
    lastActivityAt: bookings[0]?.bookingDate ?? user.createdAt,
  };

  // ── Timeline (newest first) ──
  type TLType = 'registered' | 'created' | 'confirmed' | 'checkin' | 'cancelled' | 'expired' | 'payment' | 'refund';
  const timeline: { at: Date; type: TLType; label: string; bookingId?: string; reference?: string }[] = [];
  timeline.push({ at: user.createdAt, type: 'registered', label: 'Account registered' });
  for (const b of bookings) {
    const ref = { bookingId: b.id, reference: b.reference };
    timeline.push({ at: b.createdAt, type: 'created', label: 'Booking created', ...ref });
    if (b.confirmedAt) timeline.push({ at: b.confirmedAt, type: 'confirmed', label: 'Booking confirmed', ...ref });
    if (b.checkedInAt) timeline.push({ at: b.checkedInAt, type: 'checkin', label: `Checked in (${b.checkedInCount}/${b.people})`, ...ref });
    if (b.cancelledAt) timeline.push({ at: b.cancelledAt, type: 'cancelled', label: 'Booking cancelled', ...ref });
    if (b.expiredAt) timeline.push({ at: b.expiredAt, type: 'expired', label: 'Booking expired', ...ref });
    for (const p of b.payments) {
      if (p.paidAt) timeline.push({ at: p.paidAt, type: 'payment', label: `Payment received (${p.provider})`, ...ref });
      if (p.refundedAt) timeline.push({ at: p.refundedAt, type: 'refund', label: 'Payment refunded', ...ref });
    }
    if (b.invoice) for (const r of b.invoice.refunds) timeline.push({ at: r.createdAt, type: 'refund', label: 'Refund issued', ...ref });
  }
  timeline.sort((a, b) => b.at.getTime() - a.at.getTime());

  const tags: TagChip[] = user.tagAssignments.map((a) => a.tag);

  return { user, profile: user.profile, bookings, rows, financial, stats, analytics, timeline, tags };
}

/** Update the editable notes on a customer profile (audited). */
export async function adminUpdateCustomerNotes(
  userId: string,
  data: { notes?: string | null; adminNotes?: string | null },
  actorUserId: string,
) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
  if (!user) throw new DomainError('Customer not found', 'not_found', 404);

  return prisma.$transaction(async (tx) => {
    const before = { notes: user.profile?.notes ?? null, adminNotes: user.profile?.adminNotes ?? null };
    const updated = user.profile
      ? await tx.customerProfile.update({
          where: { userId },
          data: { notes: data.notes ?? null, adminNotes: data.adminNotes ?? null },
        })
      : await tx.customerProfile.create({
          data: {
            userId,
            fullName: user.name ?? user.email ?? 'Customer',
            phone: user.phone ?? '',
            notes: data.notes ?? null,
            adminNotes: data.adminNotes ?? null,
          },
        });
    await audit(tx, {
      actorUserId,
      action: 'UPDATE',
      entityType: 'CustomerProfile',
      entityId: userId,
      before,
      after: { notes: updated.notes, adminNotes: updated.adminNotes },
    });
    return updated;
  });
}

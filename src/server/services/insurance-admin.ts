import 'server-only';
import type {
  InsuranceChargeType,
  InsuranceCollectionStatus,
  InsuranceDecision,
  InsuranceRefundMethod,
  InsuranceRefundStatus,
  PaymentProvider,
} from '@prisma/client';
import { prisma } from '@/server/db/prisma';

/**
 * READ-ONLY admin views over the insurance-deposit refund workflow
 * (docs/INSURANCE.md §5). Deliberately no `assertNotLocalNode` — reads work on
 * both nodes; every mutation lives in `./insurance-refunds.ts`.
 *
 * `requestedById` / `approvedById` / `decidedById` are plain scalars (no Prisma
 * relation), so display names are resolved with one batched `user.findMany`.
 */

const PAGE_SIZE = 20;
/** Terminal rows appended to the DEFAULT (actionable-first) view. */
const RECENT_TERMINAL_CAP = 20;

/** Priority of the default queue view — most admin-actionable first. */
const ACTIONABLE_ORDER: readonly InsuranceRefundStatus[] = [
  'AWAITING_ADMIN',
  'MANUAL_ATTENTION',
  'PROCESSING',
  'PENDING_DESK',
];
const TERMINAL_STATUSES: readonly InsuranceRefundStatus[] = ['COMPLETED', 'FAILED', 'REJECTED'];

/** Resolve staff display names for plain-scalar user id columns (batched). */
async function userNamesById(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, email: true },
  });
  return new Map(users.map((u) => [u.id, u.name || u.email || u.id]));
}

const ROW_SELECT = {
  id: true,
  status: true,
  method: true,
  amountCents: true,
  attempt: true,
  failureMessage: true,
  proofUrl: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  requestedById: true,
  approvedById: true,
  bookingInsurance: {
    select: {
      paidVia: true,
      booking: {
        select: {
          id: true,
          reference: true,
          guestName: true,
          bookingDate: true,
          user: { select: { name: true, email: true } },
          service: { select: { nameEn: true, nameAr: true } },
        },
      },
    },
  },
} as const;

type RawRow = {
  id: string;
  status: InsuranceRefundStatus;
  method: InsuranceRefundMethod;
  amountCents: number;
  attempt: number;
  failureMessage: string | null;
  proofUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  requestedById: string;
  approvedById: string | null;
  bookingInsurance: {
    paidVia: PaymentProvider | null;
    booking: {
      id: string;
      reference: string;
      guestName: string | null;
      bookingDate: Date;
      user: { name: string | null; email: string | null };
      service: { nameEn: string; nameAr: string };
    };
  };
};

export interface AdminInsuranceRefundRow {
  id: string;
  status: InsuranceRefundStatus;
  method: InsuranceRefundMethod;
  amountCents: number;
  attempt: number;
  failureMessage: string | null;
  hasProof: boolean;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  /** Original payment channel of the deposit (drives the method badge context). */
  paidVia: PaymentProvider | null;
  booking: {
    id: string;
    reference: string;
    /** Walk-in guest name, else the account holder. */
    guestName: string | null;
    bookingDate: Date;
    service: { nameEn: string; nameAr: string };
  };
  requestedByName: string | null;
  approvedByName: string | null;
}

function toRow(raw: RawRow, names: Map<string, string>): AdminInsuranceRefundRow {
  const b = raw.bookingInsurance.booking;
  return {
    id: raw.id,
    status: raw.status,
    method: raw.method,
    amountCents: raw.amountCents,
    attempt: raw.attempt,
    failureMessage: raw.failureMessage,
    hasProof: !!raw.proofUrl,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    completedAt: raw.completedAt,
    paidVia: raw.bookingInsurance.paidVia,
    booking: {
      id: b.id,
      reference: b.reference,
      guestName: b.guestName ?? b.user.name ?? b.user.email,
      bookingDate: b.bookingDate,
      service: b.service,
    },
    requestedByName: names.get(raw.requestedById) ?? null,
    approvedByName: raw.approvedById ? (names.get(raw.approvedById) ?? null) : null,
  };
}

async function resolveRows(raws: RawRow[]): Promise<AdminInsuranceRefundRow[]> {
  const names = await userNamesById(raws.flatMap((r) => [r.requestedById, r.approvedById]));
  return raws.map((r) => toRow(r, names));
}

/** Queue filter: a concrete status, 'HISTORY' (terminal rows), or undefined = default actionable view. */
export type AdminInsuranceListStatus = InsuranceRefundStatus | 'HISTORY';

export interface AdminInsuranceList {
  items: AdminInsuranceRefundRow[];
  page: number;
  totalPages: number;
}

/**
 * Admin queue. DEFAULT (no status): actionable first — AWAITING_ADMIN
 * oldest-first, then MANUAL_ATTENTION, then PROCESSING, then PENDING_DESK —
 * with a capped tail of the most recent terminal rows. Explicit status /
 * 'HISTORY' filters are plain DB-paginated lists.
 */
export async function listInsuranceRefundsForAdmin(input: {
  status?: AdminInsuranceListStatus;
  method?: InsuranceRefundMethod;
  page?: number;
}): Promise<AdminInsuranceList> {
  const page = Math.max(1, input.page ?? 1);
  const methodWhere = input.method ? { method: input.method } : {};

  if (input.status) {
    const statusWhere =
      input.status === 'HISTORY'
        ? { status: { in: [...TERMINAL_STATUSES] } }
        : { status: input.status };
    const where = { ...statusWhere, ...methodWhere };
    const terminal =
      input.status === 'HISTORY' || TERMINAL_STATUSES.includes(input.status as InsuranceRefundStatus);
    const [raws, total] = await Promise.all([
      prisma.insuranceRefund.findMany({
        where,
        // Actionable queues are FIFO (oldest first); history reads newest-first.
        orderBy: { createdAt: terminal ? 'desc' : 'asc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: ROW_SELECT,
      }),
      prisma.insuranceRefund.count({ where }),
    ]);
    return {
      items: await resolveRows(raws),
      page,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    };
  }

  // Default view — the actionable set is small by nature (every row here is
  // work someone must do), so compose in memory: custom status priority, then
  // FIFO, then a capped newest-first terminal tail for context.
  const [actionableRaws, terminalRaws] = await Promise.all([
    prisma.insuranceRefund.findMany({
      where: { status: { in: [...ACTIONABLE_ORDER] }, ...methodWhere },
      orderBy: { createdAt: 'asc' },
      select: ROW_SELECT,
    }),
    prisma.insuranceRefund.findMany({
      where: { status: { in: [...TERMINAL_STATUSES] }, ...methodWhere },
      orderBy: { createdAt: 'desc' },
      take: RECENT_TERMINAL_CAP,
      select: ROW_SELECT,
    }),
  ]);
  actionableRaws.sort(
    (a, b) =>
      ACTIONABLE_ORDER.indexOf(a.status) - ACTIONABLE_ORDER.indexOf(b.status) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const composed = [...actionableRaws, ...terminalRaws];
  const totalPages = Math.max(1, Math.ceil(composed.length / PAGE_SIZE));
  const slice = composed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return { items: await resolveRows(slice), page, totalPages };
}

/** Counts per refund status — the queue header chips. */
export async function getInsuranceSummaryForAdmin(): Promise<
  Record<InsuranceRefundStatus, number>
> {
  const groups = await prisma.insuranceRefund.groupBy({ by: ['status'], _count: { _all: true } });
  const summary: Record<InsuranceRefundStatus, number> = {
    AWAITING_ADMIN: 0,
    PENDING_DESK: 0,
    PROCESSING: 0,
    COMPLETED: 0,
    FAILED: 0,
    REJECTED: 0,
    MANUAL_ATTENTION: 0,
  };
  for (const g of groups) summary[g.status] = g._count._all;
  return summary;
}

// ── Detail ────────────────────────────────────────────────────────────────────

export interface AdminInsuranceAttempt {
  id: string;
  status: InsuranceRefundStatus;
  method: InsuranceRefundMethod;
  amountCents: number;
  attempt: number;
  failureMessage: string | null;
  proofUrl: string | null;
  providerRefundRef: string | null;
  createdAt: Date;
  completedAt: Date | null;
  requestedByName: string | null;
  approvedByName: string | null;
}

export interface AdminInsuranceRefundDetail {
  id: string;
  status: InsuranceRefundStatus;
  method: InsuranceRefundMethod;
  amountCents: number;
  attempt: number;
  failureMessage: string | null;
  proofUrl: string | null;
  providerRefundRef: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  requestedByName: string | null;
  approvedByName: string | null;
  /** Full frozen deposit snapshot + both state machines. */
  insurance: {
    id: string;
    type: InsuranceChargeType;
    percent: number | null;
    fixedCents: number | null;
    baseCents: number;
    amountCents: number;
    collectionStatus: InsuranceCollectionStatus;
    collectedAt: Date | null;
    paidVia: PaymentProvider | null;
    decision: InsuranceDecision;
    decidedAt: Date | null;
    decidedByName: string | null;
    noRefundReason: string | null;
  };
  booking: {
    id: string;
    reference: string;
    status: string;
    bookingDate: Date;
    guestName: string | null;
    service: { nameEn: string; nameAr: string };
  };
  invoice: { totalCents: number } | null;
  /** Latest captured payment (what a PROVIDER refund would reverse into). */
  payment: {
    provider: PaymentProvider;
    status: string;
    amountCents: number;
    hasProviderOrder: boolean;
  } | null;
  /** Σ RefundLine(kind=INSURANCE) — deposit already returned. */
  insuranceRefundedCents: number;
  /** Σ RefundLine(kind=SERVICE) — whether a service refund already happened. */
  serviceRefundedCents: number;
  /** EVERY attempt for this deposit (incl. this row), oldest first. */
  attempts: AdminInsuranceAttempt[];
}

export async function getInsuranceRefundForAdmin(
  id: string,
): Promise<AdminInsuranceRefundDetail | null> {
  const row = await prisma.insuranceRefund.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      method: true,
      amountCents: true,
      attempt: true,
      failureMessage: true,
      proofUrl: true,
      providerRefundRef: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true,
      requestedById: true,
      approvedById: true,
      bookingInsurance: {
        select: {
          id: true,
          type: true,
          percent: true,
          fixedCents: true,
          baseCents: true,
          amountCents: true,
          collectionStatus: true,
          collectedAt: true,
          paidVia: true,
          decision: true,
          decidedAt: true,
          decidedById: true,
          noRefundReason: true,
          refunds: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              status: true,
              method: true,
              amountCents: true,
              attempt: true,
              failureMessage: true,
              proofUrl: true,
              providerRefundRef: true,
              createdAt: true,
              completedAt: true,
              requestedById: true,
              approvedById: true,
            },
          },
          booking: {
            select: {
              id: true,
              reference: true,
              status: true,
              bookingDate: true,
              guestName: true,
              user: { select: { name: true, email: true } },
              service: { select: { nameEn: true, nameAr: true } },
              invoice: { select: { id: true, totalCents: true } },
              payments: {
                where: { paidAt: { not: null } },
                orderBy: { paidAt: 'desc' },
                take: 1,
                select: {
                  provider: true,
                  status: true,
                  amountCents: true,
                  paymobOrderId: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!row) return null;

  const insurance = row.bookingInsurance;
  const booking = insurance.booking;
  const payment = booking.payments[0] ?? null;

  // Refunded-so-far by pool — Σ RefundLine per kind on this invoice.
  let insuranceRefundedCents = 0;
  let serviceRefundedCents = 0;
  if (booking.invoice) {
    const byKind = await prisma.refundLine.groupBy({
      by: ['kind'],
      where: { invoiceId: booking.invoice.id },
      _sum: { amountCents: true },
    });
    for (const g of byKind) {
      if (g.kind === 'INSURANCE') insuranceRefundedCents = g._sum.amountCents ?? 0;
      else serviceRefundedCents = g._sum.amountCents ?? 0;
    }
  }

  const names = await userNamesById([
    row.requestedById,
    row.approvedById,
    insurance.decidedById,
    ...insurance.refunds.flatMap((r) => [r.requestedById, r.approvedById]),
  ]);
  const nameOf = (userId: string | null): string | null =>
    userId ? (names.get(userId) ?? null) : null;

  return {
    id: row.id,
    status: row.status,
    method: row.method,
    amountCents: row.amountCents,
    attempt: row.attempt,
    failureMessage: row.failureMessage,
    proofUrl: row.proofUrl,
    providerRefundRef: row.providerRefundRef,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    requestedByName: nameOf(row.requestedById),
    approvedByName: nameOf(row.approvedById),
    insurance: {
      id: insurance.id,
      type: insurance.type,
      percent: insurance.percent,
      fixedCents: insurance.fixedCents,
      baseCents: insurance.baseCents,
      amountCents: insurance.amountCents,
      collectionStatus: insurance.collectionStatus,
      collectedAt: insurance.collectedAt,
      paidVia: insurance.paidVia,
      decision: insurance.decision,
      decidedAt: insurance.decidedAt,
      decidedByName: nameOf(insurance.decidedById),
      noRefundReason: insurance.noRefundReason,
    },
    booking: {
      id: booking.id,
      reference: booking.reference,
      status: booking.status,
      bookingDate: booking.bookingDate,
      guestName: booking.guestName ?? booking.user.name ?? booking.user.email,
      service: booking.service,
    },
    invoice: booking.invoice ? { totalCents: booking.invoice.totalCents } : null,
    payment: payment
      ? {
          provider: payment.provider,
          status: payment.status,
          amountCents: payment.amountCents,
          hasProviderOrder: !!payment.paymobOrderId,
        }
      : null,
    insuranceRefundedCents,
    serviceRefundedCents,
    attempts: insurance.refunds.map((r) => ({
      id: r.id,
      status: r.status,
      method: r.method,
      amountCents: r.amountCents,
      attempt: r.attempt,
      failureMessage: r.failureMessage,
      proofUrl: r.proofUrl,
      providerRefundRef: r.providerRefundRef,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      requestedByName: nameOf(r.requestedById),
      approvedByName: nameOf(r.approvedById),
    })),
  };
}

// ── Booking-detail panel ──────────────────────────────────────────────────────

export interface AdminBookingInsurancePanel {
  type: InsuranceChargeType;
  percent: number | null;
  fixedCents: number | null;
  baseCents: number;
  amountCents: number;
  collectionStatus: InsuranceCollectionStatus;
  collectedAt: Date | null;
  paidVia: PaymentProvider | null;
  decision: InsuranceDecision;
  decidedAt: Date | null;
  decidedByName: string | null;
  noRefundReason: string | null;
  attempts: {
    id: string;
    status: InsuranceRefundStatus;
    method: InsuranceRefundMethod;
    amountCents: number;
    createdAt: Date;
  }[];
  /** True when NO_REFUND may still be reopened (no completed/active payout). */
  canReopenDecision: boolean;
}

/** Insurance card data for `/admin/bookings/[id]` — null when the booking has no deposit. */
export async function getBookingInsuranceForAdmin(
  bookingId: string,
): Promise<AdminBookingInsurancePanel | null> {
  const insurance = await prisma.bookingInsurance.findUnique({
    where: { bookingId },
    select: {
      type: true,
      percent: true,
      fixedCents: true,
      baseCents: true,
      amountCents: true,
      collectionStatus: true,
      collectedAt: true,
      paidVia: true,
      decision: true,
      decidedAt: true,
      decidedById: true,
      noRefundReason: true,
      refunds: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, status: true, method: true, amountCents: true, createdAt: true },
      },
    },
  });
  if (!insurance) return null;
  const names = await userNamesById([insurance.decidedById]);
  const blocking = insurance.refunds.some((r) =>
    ['COMPLETED', 'AWAITING_ADMIN', 'PENDING_DESK', 'PROCESSING'].includes(r.status),
  );
  return {
    type: insurance.type,
    percent: insurance.percent,
    fixedCents: insurance.fixedCents,
    baseCents: insurance.baseCents,
    amountCents: insurance.amountCents,
    collectionStatus: insurance.collectionStatus,
    collectedAt: insurance.collectedAt,
    paidVia: insurance.paidVia,
    decision: insurance.decision,
    decidedAt: insurance.decidedAt,
    decidedByName: insurance.decidedById ? (names.get(insurance.decidedById) ?? null) : null,
    noRefundReason: insurance.noRefundReason,
    attempts: insurance.refunds,
    canReopenDecision: insurance.decision === 'NO_REFUND' && !blocking,
  };
}

import 'server-only';
import { prisma } from '@/server/db/prisma';
import { resortCivilDayUTC } from '@/lib/date';
import {
  allowedRefundMethods,
  refundableInsuranceCents,
  type InsuranceRefundMethod,
  type InsuranceRefundStatus,
  type PaidVia,
} from './insurance-core';

/**
 * Read-side projections for the reception deposit-checkout window
 * (docs/INSURANCE.md §5). READ-ONLY and deliberately NOT guarded by
 * `assertNotLocalNode`: the local venue mirror holds the pulled
 * BookingInsurance / InsuranceRefund rows, so the checkout window renders on
 * BOTH nodes — only the two mutations (decision + desk payout) proxy to online
 * (see features/reception/insurance-actions.ts).
 *
 * Dates are returned as ISO strings (civil days as `yyyy-mm-dd`, instants as
 * full ISO) so the payload crosses the server-action boundary untouched.
 */

export interface InsuranceAttemptView {
  id: string;
  method: InsuranceRefundMethod;
  status: InsuranceRefundStatus;
  amountCents: number;
  /** InstaPay payout proof (/api/secure-media URL) — staff-authz'd to view. */
  proofUrl: string | null;
  failureMessage: string | null;
  completedAt: string | null;
  createdAt: string;
  requestedByName: string | null;
  approvedByName: string | null;
}

export interface InsuranceCheckoutView {
  booking: {
    id: string;
    reference: string;
    status: string;
    guestName: string;
    phone: string;
    serviceNameAr: string;
    serviceNameEn: string;
    categoryNameAr: string;
    categoryNameEn: string;
    /** First visit day (yyyy-mm-dd); `endDate` null for single-day bookings. */
    date: string;
    endDate: string | null;
    people: number;
    adults: number;
    children: number;
    channel: 'RECEPTION' | 'ONLINE';
  };
  insurance: {
    type: 'PERCENT' | 'FIXED';
    percent: number | null;
    fixedCents: number | null;
    baseCents: number;
    amountCents: number;
    collectionStatus: 'PENDING' | 'COLLECTED' | 'VOIDED';
    collectedAt: string | null;
    paidVia: string | null;
    decision: 'UNDECIDED' | 'REFUND' | 'NO_REFUND';
    decidedAt: string | null;
    decidedByName: string | null;
    noRefundReason: string | null;
  };
  invoice: { totalCents: number; subtotalCents: number } | null;
  /** Latest captured payment — the deposit's collection channel evidence. */
  payment: { provider: string; amountCents: number; proofUrl: string | null } | null;
  /** ALL refund attempts, newest first (append-only history, incl. rejections). */
  attempts: InsuranceAttemptView[];
  /** collected − Σ RefundLine(kind=INSURANCE) — the max still returnable now. */
  refundableCents: number;
  /** Refund methods legal for the ORIGINAL payment channel (server truth). */
  allowedMethods: InsuranceRefundMethod[];
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Everything the reception checkout window shows for one booking's deposit.
 * Returns null when the booking has no insurance row (absence = not applicable).
 */
export async function getInsuranceCheckoutForReception(
  bookingId: string,
): Promise<InsuranceCheckoutView | null> {
  const insurance = await prisma.bookingInsurance.findUnique({
    where: { bookingId },
    include: {
      booking: {
        select: {
          id: true,
          reference: true,
          status: true,
          guestName: true,
          guestPhone: true,
          bookingDate: true,
          endDate: true,
          people: true,
          adults: true,
          children: true,
          createdByStaffId: true,
          user: { select: { name: true, phone: true } },
          service: {
            select: {
              nameAr: true,
              nameEn: true,
              category: { select: { nameAr: true, nameEn: true } },
            },
          },
          invoice: { select: { id: true, totalCents: true, subtotalCents: true } },
          payments: {
            where: { paidAt: { not: null } },
            orderBy: { paidAt: 'desc' },
            take: 1,
            select: { provider: true, amountCents: true, proofUrl: true },
          },
        },
      },
      refunds: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!insurance) return null;
  const b = insurance.booking;

  // Σ RefundLine(kind=INSURANCE) — the single source of refunded-deposit truth.
  const refundedCents = b.invoice
    ? ((
        await prisma.refundLine.aggregate({
          where: { invoiceId: b.invoice.id, kind: 'INSURANCE' },
          _sum: { amountCents: true },
        })
      )._sum.amountCents ?? 0)
    : 0;

  // Staff display names (decider / requesters / approvers). Plain-scalar ids —
  // a proxied staff id may point at a minimal User row, so names are best-effort.
  const staffIds = [
    insurance.decidedById,
    ...insurance.refunds.flatMap((r) => [r.requestedById, r.approvedById]),
  ].filter((id): id is string => !!id);
  const staff = staffIds.length
    ? await prisma.user.findMany({
        where: { id: { in: [...new Set(staffIds)] } },
        select: { id: true, name: true },
      })
    : [];
  const nameOf = (id: string | null): string | null =>
    id ? (staff.find((u) => u.id === id)?.name ?? null) : null;

  // Walk-in bookings carry the real guest on the booking row; for online ones
  // `user` IS the customer (mirrors mapTodayBookingRow in reception.ts).
  const isReception = !!b.createdByStaffId;
  const channel: PaidVia = insurance.paidVia === 'CREDIT_AGRICOLE' ? 'CREDIT_AGRICOLE' : 'CASH';

  return {
    booking: {
      id: b.id,
      reference: b.reference,
      status: b.status,
      guestName: (isReception ? b.guestName : (b.user.name ?? b.guestName)) ?? 'Guest',
      phone: (isReception ? b.guestPhone : (b.user.phone ?? b.guestPhone)) ?? '—',
      serviceNameAr: b.service.nameAr,
      serviceNameEn: b.service.nameEn,
      categoryNameAr: b.service.category.nameAr,
      categoryNameEn: b.service.category.nameEn,
      date: isoDay(b.bookingDate),
      endDate: b.endDate ? isoDay(b.endDate) : null,
      people: b.people,
      adults: b.adults,
      children: b.children,
      channel: isReception ? 'RECEPTION' : 'ONLINE',
    },
    insurance: {
      type: insurance.type,
      percent: insurance.percent,
      fixedCents: insurance.fixedCents,
      baseCents: insurance.baseCents,
      amountCents: insurance.amountCents,
      collectionStatus: insurance.collectionStatus,
      collectedAt: insurance.collectedAt?.toISOString() ?? null,
      paidVia: insurance.paidVia,
      decision: insurance.decision,
      decidedAt: insurance.decidedAt?.toISOString() ?? null,
      decidedByName: nameOf(insurance.decidedById),
      noRefundReason: insurance.noRefundReason,
    },
    invoice: b.invoice
      ? { totalCents: b.invoice.totalCents, subtotalCents: b.invoice.subtotalCents }
      : null,
    payment: b.payments[0]
      ? {
          provider: b.payments[0].provider,
          amountCents: b.payments[0].amountCents,
          proofUrl: b.payments[0].proofUrl,
        }
      : null,
    attempts: insurance.refunds.map((r) => ({
      id: r.id,
      method: r.method,
      status: r.status,
      amountCents: r.amountCents,
      proofUrl: r.proofUrl,
      failureMessage: r.failureMessage,
      completedAt: r.completedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      requestedByName: nameOf(r.requestedById),
      approvedByName: nameOf(r.approvedById),
    })),
    refundableCents: refundableInsuranceCents({
      collectionStatus: insurance.collectionStatus,
      amountCents: insurance.amountCents,
      refundedCents,
    }),
    allowedMethods: allowedRefundMethods(channel),
  };
}

// ── Pending-deposits worklist ─────────────────────────────────────────────────

export interface PendingDepositRow {
  /** FORGOTTEN = collected + undecided past visit end; DESK_PAYOUT = decided, cash/InstaPay payout still owed. */
  kind: 'FORGOTTEN' | 'DESK_PAYOUT';
  bookingId: string;
  reference: string;
  guestName: string;
  amountCents: number;
  /** ISO instant the item started waiting (visit end / attempt creation) — drives the age display. */
  sinceIso: string;
}

const worklistBookingSelect = {
  id: true,
  reference: true,
  guestName: true,
  bookingDate: true,
  endDate: true,
  createdByStaffId: true,
  user: { select: { name: true } },
} as const;

type WorklistBooking = {
  id: string;
  reference: string;
  guestName: string | null;
  bookingDate: Date;
  endDate: Date | null;
  createdByStaffId: string | null;
  user: { name: string | null };
};

const worklistGuestName = (b: WorklistBooking): string =>
  (b.createdByStaffId ? b.guestName : (b.user.name ?? b.guestName)) ?? 'Guest';

/**
 * The reception "forgotten deposits" worklist: every COLLECTED + UNDECIDED
 * deposit whose visit already ended (resort civil day), plus every PENDING_DESK
 * payout still owed over the desk. Newest first, capped at 100.
 */
export async function listPendingDeposits(): Promise<PendingDepositRow[]> {
  const today = new Date(resortCivilDayUTC());

  const [forgotten, deskPayouts] = await Promise.all([
    prisma.bookingInsurance.findMany({
      where: {
        collectionStatus: 'COLLECTED',
        decision: 'UNDECIDED',
        booking: {
          OR: [
            { endDate: { lt: today } },
            { endDate: null, bookingDate: { lt: today } },
          ],
        },
      },
      select: { amountCents: true, booking: { select: worklistBookingSelect } },
      orderBy: { collectedAt: 'desc' },
      take: 100,
    }),
    prisma.insuranceRefund.findMany({
      where: { status: 'PENDING_DESK' },
      select: {
        amountCents: true,
        createdAt: true,
        bookingInsurance: { select: { booking: { select: worklistBookingSelect } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  ]);

  const rows: PendingDepositRow[] = [
    ...forgotten.map((i): PendingDepositRow => ({
      kind: 'FORGOTTEN',
      bookingId: i.booking.id,
      reference: i.booking.reference,
      guestName: worklistGuestName(i.booking),
      amountCents: i.amountCents,
      // The deposit became "forgotten" when the visit ended (last day + 1).
      sinceIso: new Date(
        (i.booking.endDate ?? i.booking.bookingDate).getTime() + 86_400_000,
      ).toISOString(),
    })),
    ...deskPayouts.map((r): PendingDepositRow => ({
      kind: 'DESK_PAYOUT',
      bookingId: r.bookingInsurance.booking.id,
      reference: r.bookingInsurance.booking.reference,
      guestName: worklistGuestName(r.bookingInsurance.booking),
      amountCents: r.amountCents,
      sinceIso: r.createdAt.toISOString(),
    })),
  ];

  return rows
    .sort((a, b) => (a.sinceIso < b.sinceIso ? 1 : -1))
    .slice(0, 100);
}

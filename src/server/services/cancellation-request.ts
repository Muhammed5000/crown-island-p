import 'server-only';
import type { CancellationRequestStatus } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { auditStandalone } from '@/server/audit/audit';
import { DomainError } from './errors';
import { notifyCustomer } from './customer-notifications';
import { adminRefundBooking } from './admin-bookings';
import { getRefundTiers } from '@/server/settings/settings';
import { computeTieredRefund, refundableBaseCents } from '@/lib/refund-policy';
import { formatMoney } from '@/lib/money';
import { log, errFields } from '@/lib/log';
import { isCancellationRefundComplete } from './cancellation-request-core';

/**
 * Cancellation-request service — how an account customer asks to cancel their
 * OWN paid booking. Self-cancel of a PAID booking is otherwise reception-only
 * (see `RefundPolicyNotice` / `adminRefundBooking`'s reception routing), so this
 * is the in-app channel for it.
 *
 * THE KEY RULE — the refund tier is FROZEN at request time. When the customer
 * submits, we compute `computeTieredRefund({ now: requestedAt })` and persist
 * the resolved percent + cents. On approval the admin refunds EXACTLY that
 * locked amount (passed as `overrideAmountCents`), never a value re-derived from
 * the processing time. So a request made 7+ days out is refunded 100% even if
 * the admin gets to it 4 days before the visit.
 */

export const MAX_REASON = 500;

/**
 * How long a claim (processedAt stamped while still PENDING) is honored before
 * it is considered ABANDONED and re-claimable. A crash between the refund and
 * the final APPROVED write leaves a request claimed-but-PENDING; after this
 * window an admin can retry, and `adminRefundBooking`'s idempotency makes the
 * retry safe (no double refund). (BUS-001)
 */
const CLAIM_STALE_MS = 2 * 60_000;

function refundReasonPrefix(requestId: string): string {
  return `cancellation_request:${requestId}:`;
}

// ── Customer: submit / withdraw / read own ───────────────────────────────────

export interface MyCancellationRequest {
  id: string;
  status: CancellationRequestStatus;
  requestedAt: Date;
  reason: string | null;
  lockedRefundPercent: number;
  lockedRefundCents: number;
  adminNote: string | null;
}

/** The customer's own request for a booking (drives the booking-detail card). */
export async function getMyCancellationRequest(
  bookingId: string,
  userId: string,
): Promise<MyCancellationRequest | null> {
  return prisma.cancellationRequest.findFirst({
    where: { bookingId, userId },
    select: {
      id: true,
      status: true,
      requestedAt: true,
      reason: true,
      lockedRefundPercent: true,
      lockedRefundCents: true,
      adminNote: true,
    },
  });
}

/** Alert managers/admins that a cancellation request is waiting (best-effort). */
async function alertStaffNewRequest(input: {
  reference: string;
  guestName: string | null;
  percent: number;
}): Promise<void> {
  try {
    const staff = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN', 'MANAGER', 'DIRECTOR'] }, deletedAt: null },
      select: { id: true },
    });
    if (staff.length === 0) return;
    await prisma.staffNotification.createMany({
      data: staff.map((s) => ({
        userId: s.id,
        kind: 'cancellation_request',
        title: `Cancellation request — booking ${input.reference} (${input.percent}% refund)`,
        body: input.guestName ? `From ${input.guestName}` : null,
      })),
    });
  } catch (err) {
    log.error('cancellation staff alert failed', { ...errFields(err) });
  }
}

/**
 * Submit (or re-submit) a cancellation request for a PAID booking. Idempotent
 * while a request is already PENDING; a WITHDRAWN/REJECTED request is revived
 * with a fresh clock + fresh lock.
 */
export async function requestCancellation(input: {
  bookingId: string;
  userId: string;
  reason?: string | null;
}): Promise<{ id: string; lockedRefundPercent: number; lockedRefundCents: number }> {
  const booking = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    select: {
      id: true,
      reference: true,
      userId: true,
      status: true,
      bookingDate: true,
      user: { select: { name: true } },
      invoice: { select: { id: true, totalCents: true } },
      cancellationRequest: {
        select: { id: true, status: true, lockedRefundPercent: true, lockedRefundCents: true },
      },
    },
  });
  if (!booking) throw new DomainError('Booking not found', 'not_found', 404);
  // Ownership — a customer may only request cancellation of THEIR OWN booking.
  if (booking.userId !== input.userId) throw new DomainError('Not authorized', 'forbidden', 403);
  // Paid bookings only. An unpaid (PENDING_PAYMENT) booking is self-cancelled
  // directly via CancelButton; terminal ones can't be cancelled at all.
  if (booking.status !== 'CONFIRMED') {
    throw new DomainError('Booking not cancellable', 'not_cancellable', 400);
  }
  // Idempotent — a live PENDING request keeps its original lock + timestamp.
  if (booking.cancellationRequest?.status === 'PENDING') {
    return {
      id: booking.cancellationRequest.id,
      lockedRefundPercent: booking.cancellationRequest.lockedRefundPercent,
      lockedRefundCents: booking.cancellationRequest.lockedRefundCents,
    };
  }

  const totalCents = booking.invoice?.totalCents ?? 0;
  // Net out anything already refunded from the SERVICE pool so a re-request
  // never over-promises. INSURANCE-pool payouts are excluded on BOTH sides of
  // the freeze (below): the deposit returns in full via its own workflow and
  // must never be halved by the tier nor double-promised here.
  const alreadyRefunded = booking.invoice
    ? (
        await prisma.refundLine.aggregate({
          where: { invoiceId: booking.invoice.id, kind: 'SERVICE' },
          _sum: { amountCents: true },
        })
      )._sum.amountCents ?? 0
    : 0;

  // Settled fines (SANCTION invoice lines) are RETAINED on cancellation — freeze the
  // tier against the service-only base, matching adminRefundBooking's eligibility.
  const sanctionCents = booking.invoice
    ? (
        await prisma.invoiceLine.aggregate({
          where: { invoiceId: booking.invoice.id, meta: { path: ['kind'], equals: 'SANCTION' } },
          _sum: { totalCents: true },
        })
      )._sum.totalCents ?? 0
    : 0;

  // A COLLECTED insurance deposit is outside the tier (docs/INSURANCE.md §6):
  // subtract it from the frozen base exactly like adminRefundBooking does.
  const collectedInsurance = await prisma.bookingInsurance.findUnique({
    where: { bookingId: booking.id },
    select: { amountCents: true, collectionStatus: true },
  });
  const insuranceCents =
    collectedInsurance?.collectionStatus === 'COLLECTED' ? collectedInsurance.amountCents : 0;
  const net = Math.max(0, Math.max(0, totalCents - insuranceCents) - alreadyRefunded);

  // FREEZE the tier at this instant, on the service-only base net of prior refunds.
  const now = new Date();
  const tiers = await getRefundTiers();
  const locked = computeTieredRefund({
    bookingDate: booking.bookingDate,
    totalCents: refundableBaseCents(net, sanctionCents),
    tiers,
    now,
  });
  const hoursBeforeStart = Math.floor(locked.hoursUntilStart);
  const reason = input.reason?.trim() ? input.reason.trim().slice(0, MAX_REASON) : null;

  const request = await prisma.cancellationRequest.upsert({
    where: { bookingId: booking.id },
    create: {
      bookingId: booking.id,
      userId: input.userId,
      requestedAt: now,
      reason,
      lockedRefundPercent: locked.percent,
      lockedRefundCents: locked.refundCents,
      hoursBeforeStart,
      totalCentsAtRequest: net,
      status: 'PENDING',
    },
    update: {
      requestedAt: now,
      reason,
      lockedRefundPercent: locked.percent,
      lockedRefundCents: locked.refundCents,
      hoursBeforeStart,
      totalCentsAtRequest: net,
      status: 'PENDING',
      adminNote: null,
      processedById: null,
      processedAt: null,
    },
  });

  await auditStandalone({
    actorUserId: input.userId,
    action: 'CREATE',
    entityType: 'CancellationRequest',
    entityId: request.id,
    after: {
      bookingId: booking.id,
      lockedRefundPercent: locked.percent,
      lockedRefundCents: locked.refundCents,
      hoursBeforeStart,
      reason,
    },
  });

  await alertStaffNewRequest({
    reference: booking.reference,
    guestName: booking.user.name,
    percent: locked.percent,
  });

  return { id: request.id, lockedRefundPercent: locked.percent, lockedRefundCents: locked.refundCents };
}

/** Customer pulls back a still-pending request (frees them to keep the booking). */
export async function withdrawCancellationRequest(input: {
  bookingId: string;
  userId: string;
}): Promise<void> {
  const res = await prisma.cancellationRequest.updateMany({
    where: { bookingId: input.bookingId, userId: input.userId, status: 'PENDING' },
    data: { status: 'WITHDRAWN' },
  });
  if (res.count === 0) throw new DomainError('No pending request', 'not_pending', 409);
  await auditStandalone({
    actorUserId: input.userId,
    action: 'STATUS_CHANGE',
    entityType: 'CancellationRequest',
    entityId: input.bookingId,
    after: { bookingId: input.bookingId, status: 'WITHDRAWN' },
  });
}

// ── Admin: queue / detail / process ──────────────────────────────────────────

export interface AdminCancellationRow {
  id: string;
  status: CancellationRequestStatus;
  requestedAt: Date;
  lockedRefundPercent: number;
  lockedRefundCents: number;
  hoursBeforeStart: number;
  booking: {
    id: string;
    reference: string;
    bookingDate: Date;
    status: string;
    service: { nameEn: string; nameAr: string };
  };
  user: { name: string | null; email: string | null };
}

const ADMIN_ROW_SELECT = {
  id: true,
  status: true,
  requestedAt: true,
  lockedRefundPercent: true,
  lockedRefundCents: true,
  hoursBeforeStart: true,
  booking: {
    select: {
      id: true,
      reference: true,
      bookingDate: true,
      status: true,
      service: { select: { nameEn: true, nameAr: true } },
    },
  },
  user: { select: { name: true, email: true } },
} as const;

const ADMIN_PAGE_SIZE = 20;

/** Admin queue — PENDING first, then oldest-first (FIFO). Optional status filter. */
export async function listCancellationRequests(input: {
  status?: CancellationRequestStatus;
  page?: number;
}): Promise<{
  items: AdminCancellationRow[];
  page: number;
  totalPages: number;
  pendingCount: number;
}> {
  const page = Math.max(1, input.page ?? 1);
  const where = input.status ? { status: input.status } : {};
  const [items, total, pendingCount] = await Promise.all([
    prisma.cancellationRequest.findMany({
      where,
      // Enum sorts by declared order (PENDING first); then oldest request first.
      orderBy: [{ status: 'asc' }, { requestedAt: 'asc' }],
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      select: ADMIN_ROW_SELECT,
    }),
    prisma.cancellationRequest.count({ where }),
    prisma.cancellationRequest.count({ where: { status: 'PENDING' } }),
  ]);
  return {
    items,
    page,
    totalPages: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)),
    pendingCount,
  };
}

export interface AdminCancellationDetail {
  id: string;
  status: CancellationRequestStatus;
  requestedAt: Date;
  reason: string | null;
  lockedRefundPercent: number;
  lockedRefundCents: number;
  hoursBeforeStart: number;
  totalCentsAtRequest: number;
  adminNote: string | null;
  processedById: string | null;
  processedAt: Date | null;
  booking: {
    id: string;
    reference: string;
    bookingDate: Date;
    status: string;
    invoice: { totalCents: number } | null;
    service: { nameEn: string; nameAr: string };
  };
  user: { name: string | null; email: string | null };
}

export async function getCancellationRequestForAdmin(
  id: string,
): Promise<AdminCancellationDetail | null> {
  return prisma.cancellationRequest.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      requestedAt: true,
      reason: true,
      lockedRefundPercent: true,
      lockedRefundCents: true,
      hoursBeforeStart: true,
      totalCentsAtRequest: true,
      adminNote: true,
      processedById: true,
      processedAt: true,
      booking: {
        select: {
          id: true,
          reference: true,
          bookingDate: true,
          status: true,
          invoice: { select: { totalCents: true } },
          service: { select: { nameEn: true, nameAr: true } },
        },
      },
      user: { select: { name: true, email: true } },
    },
  });
}

/**
 * Approve or reject a pending request.
 *  - APPROVE → refund the LOCKED amount via the hardened `adminRefundBooking`
 *    path (which cancels the booking, releases capacity + place, reverses money
 *    through the gateway, and handles idempotency / sanctions / promo). The
 *    refund amount is the request-time lock, NOT a re-computed tier.
 *  - REJECT  → the booking stands; the customer is told (with an optional note).
 */
export async function processCancellationRequest(input: {
  requestId: string;
  adminUserId: string;
  decision: 'APPROVE' | 'REJECT';
  adminNote?: string | null;
}): Promise<{ status: CancellationRequestStatus; refundedCents: number }> {
  const note = input.adminNote?.trim() ? input.adminNote.trim().slice(0, MAX_REASON) : null;

  // BUS-001: atomically CLAIM the request before doing anything. This is a
  // compare-and-swap — we stamp processedBy/processedAt while the row is still
  // PENDING and NOT already freshly claimed. Exactly one caller wins (count 1);
  // a concurrent approve+reject (or a double-click) makes the loser get count 0.
  // A claim older than CLAIM_STALE_MS is treated as abandoned (a crash mid-
  // approve) and may be re-claimed, so a stuck request is recoverable.
  const now = new Date();
  const staleBefore = new Date(now.getTime() - CLAIM_STALE_MS);
  const claim = await prisma.cancellationRequest.updateMany({
    where: {
      id: input.requestId,
      status: 'PENDING',
      OR: [{ processedAt: null }, { processedAt: { lt: staleBefore } }],
    },
    data: { processedById: input.adminUserId, processedAt: now },
  });
  if (claim.count !== 1) {
    const exists = await prisma.cancellationRequest.findUnique({
      where: { id: input.requestId },
      select: { id: true },
    });
    if (!exists) throw new DomainError('not_found', 'not_found', 404);
    // Not PENDING (already APPROVED/REJECTED/WITHDRAWN) or another worker holds a
    // fresh claim — either way this caller must not proceed.
    throw new DomainError('Already processed', 'already_processed', 409);
  }

  // Re-read the now-claimed request for the fields the decision needs.
  const request = await prisma.cancellationRequest.findUnique({
    where: { id: input.requestId },
    select: {
      id: true,
      bookingId: true,
      userId: true,
      lockedRefundPercent: true,
      lockedRefundCents: true,
      booking: { select: { reference: true } },
    },
  });
  // Defensive: the row can't vanish between claim and re-read, but keep TS + the
  // invariant honest.
  if (!request) throw new DomainError('not_found', 'not_found', 404);

  if (input.decision === 'REJECT') {
    await prisma.cancellationRequest.update({
      where: { id: request.id },
      data: { status: 'REJECTED', adminNote: note },
    });
    await auditStandalone({
      actorUserId: input.adminUserId,
      action: 'STATUS_CHANGE',
      entityType: 'CancellationRequest',
      entityId: request.id,
      after: { bookingId: request.bookingId, status: 'REJECTED', note },
    });
    await notifyCustomer({
      userId: request.userId,
      kind: 'cancellation_rejected',
      titleEn: 'Cancellation request declined',
      titleAr: 'تم رفض طلب الإلغاء',
      bodyEn: note ?? `Your cancellation request for booking ${request.booking.reference} was declined.`,
      bodyAr: note ?? `تم رفض طلب إلغاء الحجز ${request.booking.reference}.`,
      url: `/bookings/${request.bookingId}`,
    });
    return { status: 'REJECTED', refundedCents: 0 };
  }

  // A prior attempt may have committed the refund + cancellation before the
  // final APPROVED write. Recover only from ledger rows tagged with this exact
  // request id; never infer completion from an unrelated refund.
  const recovery = await prisma.booking.findUnique({
    where: { id: request.bookingId },
    select: {
      status: true,
      invoice: {
        select: {
          refunds: {
            where: { reason: { startsWith: refundReasonPrefix(request.id) } },
            select: { amountCents: true },
          },
        },
      },
    },
  });
  const recoveredCents =
    recovery?.invoice?.refunds.reduce((sum, row) => sum + row.amountCents, 0) ?? 0;
  if (
    recovery &&
    isCancellationRefundComplete({
      lockedRefundCents: request.lockedRefundCents,
      matchedRefundCents: recoveredCents,
      bookingStatus: recovery.status,
    })
  ) {
    await prisma.cancellationRequest.update({
      where: { id: request.id },
      data: { status: 'APPROVED', adminNote: note },
    });
    await auditStandalone({
      actorUserId: input.adminUserId,
      action: 'STATUS_CHANGE',
      entityType: 'CancellationRequest',
      entityId: request.id,
      after: {
        bookingId: request.bookingId,
        status: 'APPROVED',
        refundedCents: recoveredCents,
        cause: 'recovered_completed_refund',
      },
    });
    return { status: 'APPROVED', refundedCents: recoveredCents };
  }

  // APPROVE — refund the frozen amount, then finalize APPROVED. If the refund
  // (or the finalize) throws, RELEASE the claim so an admin can retry: we clear
  // processedAt back to PENDING/unclaimed. `adminRefundBooking` is idempotent,
  // so a retry after a partial failure never double-refunds.
  try {
    // Reason is required by adminRefundBooking whenever the override differs
    // from the current-time tier (the whole point of the frozen lock).
    const reason =
      `${refundReasonPrefix(request.id)}locked=${request.lockedRefundPercent}%` +
      `${note ? ` — ${note}` : ''}`;
    const refund = await adminRefundBooking({
      bookingId: request.bookingId,
      adminUserId: input.adminUserId,
      reason,
      overrideAmountCents: request.lockedRefundCents,
    });

    await prisma.cancellationRequest.update({
      where: { id: request.id },
      data: { status: 'APPROVED', adminNote: note },
    });
    await auditStandalone({
      actorUserId: input.adminUserId,
      action: 'STATUS_CHANGE',
      entityType: 'CancellationRequest',
      entityId: request.id,
      after: { bookingId: request.bookingId, status: 'APPROVED', refundedCents: refund.refundedCents },
    });

    await notifyCustomer({
      userId: request.userId,
      kind: 'cancellation_approved',
      titleEn: 'Booking cancelled — refund on the way',
      titleAr: 'تم إلغاء الحجز — جارٍ رد المبلغ',
      bodyEn: `Booking ${request.booking.reference} cancelled. Refund: ${formatMoney(refund.refundedCents, { locale: 'en', currency: 'EGP' })}.`,
      bodyAr: `تم إلغاء الحجز ${request.booking.reference}. المبلغ المسترد: ${formatMoney(refund.refundedCents, { locale: 'ar', currency: 'EGP' })}.`,
      url: `/bookings/${request.bookingId}`,
    });

    return { status: 'APPROVED', refundedCents: refund.refundedCents };
  } catch (err) {
    // Release the claim (stay PENDING) so the decision can be retried. Best-effort
    // — only unclaim a row we still hold and that hasn't reached a terminal state.
    await prisma.cancellationRequest
      .updateMany({
        where: { id: request.id, status: 'PENDING' },
        data: { processedById: null, processedAt: null },
      })
      .catch(() => {});
    throw err;
  }
}

import 'server-only';
import { prisma } from '@/server/db/prisma';
import type { Prisma, BookingStatus } from '@prisma/client';
import { resortCivilDayUTC } from '@/lib/date';
import { checkUploadRate } from '@/lib/upload-rate-limit';
import { getSettings } from '@/server/settings/settings';
import { releaseSanctionsForBooking } from './sanctions';
import {
  AuthorizationError,
  CancellationCutoffError,
  DomainError,
} from './errors';
import { log, errFields } from '@/lib/log';

/**
 * Read-side booking helpers used by the user-facing history + detail views.
 *
 * Includes a *lazy* expiry transition: a CONFIRMED booking whose date has
 * passed is updated to EXPIRED the next time it is read. This keeps the UI
 * truthful even if the periodic cleanup job hasn't run yet.
 */

export type HistoryFilter = 'all' | 'upcoming' | 'past';

export interface UpcomingBookingNotification {
  id: string;
  reference: string;
  status: BookingStatus;
  serviceNameEn: string;
  serviceNameAr: string;
  categoryNameEn: string;
  categoryNameAr: string;
  /** ISO string of the booking date at the service's opening time, or midnight if unset. */
  bookingAtIso: string;
}

/**
 * Lightweight projection of the user's CONFIRMED + PENDING_PAYMENT bookings
 * whose date is today or later. Used by the in-app notification bell:
 *  - the panel lists these as scheduled reminders
 *  - the client polls and, when a booking's time arrives, fires a browser
 *    Notification and adds an in-panel entry
 *
 * `bookingAtIso` is the booking date combined with the service's `openTime`
 * (defaulting to 09:00). The schema stores no time component on Booking, so
 * the service opening hour is the closest "when does this experience start"
 * proxy we have.
 */
export async function listUpcomingBookingsForNotifications(
  userId: string,
): Promise<UpcomingBookingNotification[]> {
  const now = new Date();
  const today = new Date(resortCivilDayUTC(now));

  const bookings = await prisma.booking.findMany({
    where: {
      userId,
      status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] },
      bookingDate: { gte: today },
    },
    include: { service: { include: { category: true } } },
    orderBy: { bookingDate: 'asc' },
    take: 20,
  });

  return bookings.map((b) => {
    const date = new Date(b.bookingDate);
    const open = b.service.openTime ?? '09:00';
    const [hStr, mStr] = open.split(':');
    const hours = Number(hStr) || 9;
    const minutes = Number(mStr) || 0;
    date.setHours(hours, minutes, 0, 0);
    return {
      id: b.id,
      reference: b.reference,
      status: b.status,
      serviceNameEn: b.service.nameEn,
      serviceNameAr: b.service.nameAr,
      categoryNameEn: b.service.category.nameEn,
      categoryNameAr: b.service.category.nameAr,
      bookingAtIso: date.toISOString(),
    };
  });
}

export async function listUserBookings(userId: string, filter: HistoryFilter = 'all') {
  const now = new Date();
  const today = new Date(resortCivilDayUTC(now));

  // Step 1 — lazy expiry. A booking is only past once its LAST covered day is
  // behind us: a multi-day stay runs to endDate (inclusive), a single-day one to
  // bookingDate. Expiring on bookingDate alone killed a multi-day booking on day
  // 2+, locking the guest out at the gate mid-stay. Mirrors zk/reconcile.ts.
  await prisma.booking.updateMany({
    where: {
      userId,
      status: 'CONFIRMED',
      OR: [{ endDate: { lt: today } }, { endDate: null, bookingDate: { lt: today } }],
    },
    data: { status: 'EXPIRED', expiredAt: now },
  });

  // Step 2 — apply the active filter. "Upcoming/past" is decided by the LAST day
  // (endDate ?? bookingDate), so a multi-day booking stays "upcoming" for its whole
  // span, not only its first day.
  const where: Parameters<typeof prisma.booking.findMany>[0] = { where: { userId } };
  const filterClause =
    filter === 'upcoming'
      ? {
          status: { in: ['PENDING_PAYMENT' as const, 'CONFIRMED' as const] },
          OR: [{ endDate: { gte: today } }, { endDate: null, bookingDate: { gte: today } }],
        }
      : filter === 'past'
        ? {
            OR: [
              { status: { in: ['EXPIRED' as const, 'CANCELLED' as const, 'FAILED' as const] } },
              {
                status: 'CONFIRMED' as const,
                OR: [{ endDate: { lt: today } }, { endDate: null, bookingDate: { lt: today } }],
              },
            ],
          }
        : undefined;

  if (filterClause) {
    where.where = { userId, ...filterClause };
  }

  return prisma.booking.findMany({
    ...where,
    include: {
      service: { include: { category: true } },
      invoice: true,
      // Tiny deposit chip on history rows — minimal projection, no amounts.
      insurance: {
        select: {
          collectionStatus: true,
          decision: true,
          refunds: { select: { status: true, method: true, completedAt: true } },
        },
      },
    },
    // Newest booking first → oldest last. Ordered by when the booking was MADE
    // (createdAt), not by visit date, so the most recently created booking
    // always sits at the top of the history list. `id` is a stable tiebreak
    // for the rare case of two bookings sharing a createdAt instant.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 50,
  });
}

/**
 * Booking detail with lazy expiry + ownership check + a "QR is renderable now" flag.
 */
export async function getBookingDetail(bookingId: string, userId: string) {
  const now = new Date();
  const today = new Date(resortCivilDayUTC(now));

  const detailInclude = {
    user: { select: { id: true, name: true, email: true, phone: true } },
    service: { include: { category: true } },
    invoice: { include: { lines: true, refunds: true } },
    payments: { orderBy: { createdAt: 'desc' } },
    units: { include: { place: true }, orderBy: [{ date: 'asc' }, { unitIndex: 'asc' }] },
    // Customer-facing deposit visibility (read-only; docs/INSURANCE.md §10).
    insurance: { include: { refunds: { orderBy: { createdAt: 'asc' } } } },
  } satisfies Prisma.BookingInclude;

  let booking = await prisma.booking.findFirst({
    where: { id: bookingId, userId },
    include: detailInclude,
  });
  if (!booking) return null;

  // VERIFY-ON-VIEW: if the customer is looking at a PENDING_PAYMENT booking whose
  // Crédit Agricole order is RECENT, re-check the authoritative gateway state once
  // so a capture whose browser closed mid-redirect confirms the moment they reopen
  // the booking (instead of waiting for the reconciler). Bounded to a recent order
  // (24h) so passively viewing an old/abandoned pending booking in history never
  // triggers a gateway round-trip per view; anything older is still recovered by
  // the reconciler (≤72h). Idempotent + one gateway read; dynamic-import keeps the
  // MPGS graph out of cash-only reads. (The payment PAGE verify-on-return is
  // deliberately UNBOUNDED — that's an explicit "I'm trying to pay" action.)
  const VERIFY_ON_VIEW_WINDOW_MS = 24 * 60 * 60_000;
  const recentCaOrder = booking.payments.some(
    (p) =>
      p.provider === 'CREDIT_AGRICOLE' &&
      p.paymobOrderId &&
      now.getTime() - p.createdAt.getTime() < VERIFY_ON_VIEW_WINDOW_MS,
  );
  // One authoritative read per booking per minute is enough to make reopen
  // recovery immediate without amplifying repeated detail views into gateway
  // traffic. The reconciler remains the durable multi-instance backstop.
  const verifyCooldown = checkUploadRate(`booking-verify-on-view:${bookingId}`, 1, 60_000);
  if (booking.status === 'PENDING_PAYMENT' && recentCaOrder && verifyCooldown.ok) {
    try {
      const { verifyAndConfirmOrder } = await import('@/server/credit-agricole/verify');
      await verifyAndConfirmOrder(bookingId, { attempts: 1 });
      const fresh = await prisma.booking.findFirst({
        where: { id: bookingId, userId },
        include: detailInclude,
      });
      if (fresh) booking = fresh;
    } catch (err) {
      const { MpgsNotConfiguredError } = await import('@/server/credit-agricole/client');
      if (!(err instanceof MpgsNotConfiguredError)) {
        log.error('booking detail verify-on-view failed', { bookingId, ...errFields(err) });
      }
    }
  }

  // Lazy expiry — silently update the row before returning. Use the LAST covered
  // day (endDate ?? bookingDate) so a multi-day booking isn't expired mid-stay.
  if (booking.status === 'CONFIRMED' && (booking.endDate ?? booking.bookingDate) < today) {
    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'EXPIRED', expiredAt: now },
      include: detailInclude,
    });
    return updated;
  }

  return booking;
}

/**
 * Cancel a booking.
 *
 * Scope:
 *  - `PENDING_PAYMENT` → CANCELLED; hold released; payment marked FAILED.
 *  - `CONFIRMED` with `bookingDate >= today` → CANCELLED; slot counter decremented.
 *    A Paymob refund is NOT triggered here — that's a separate admin-only flow.
 *
 * Common gates applied to BOTH states (read once, up-front):
 *  - Past-date guard: a booking whose day has already passed is refused
 *    with `booking_already_used` so users can't try to retroactively
 *    cancel something they used.
 *  - Cancellation-cutoff guard: when `Settings.cancellationCutoffHours > 0`,
 *    the booking date must be more than that many hours from "now". This
 *    applies uniformly — the admin sets the rule once and it covers both
 *    paid and unpaid bookings.
 *
 * Anything else (already CANCELLED, EXPIRED, FAILED) refuses with
 * `booking_not_cancellable` so the UI never offers stale actions.
 */
export async function cancelBooking(bookingId: string, userId: string) {
  // Read settings ONCE outside the transaction. Fresh DB read via the
  // request-scoped accessor — never a stale module-level cache.
  const settings = await getSettings();

  const result = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findFirst({
      where: { id: bookingId, userId },
      include: { invoice: true, service: { select: { kind: true } } },
    });
    if (!booking) throw new AuthorizationError();

    // Only PENDING_PAYMENT and CONFIRMED are cancellable; reject early.
    if (booking.status !== 'PENDING_PAYMENT' && booking.status !== 'CONFIRMED') {
      throw new DomainError('booking_not_cancellable', 'booking_not_cancellable', 409);
    }

    // Past-date guard — applies to any status. Resort-LOCAL civil day
    // (TZ-independent), consistent with the gate/engine.
    const todayUtc = new Date(resortCivilDayUTC());
    if (booking.bookingDate < todayUtc) {
      throw new DomainError('booking_already_used', 'booking_already_used', 409);
    }

    // Cancellation-cutoff guard — admin-configured, uniform across states.
    // Once we're within `cancellationCutoffHours` of the booking date,
    // self-cancel is closed and the customer must contact the operator.
    if (settings.cancellationCutoffHours > 0) {
      const cutoffMoment = new Date(
        booking.bookingDate.getTime()
          - settings.cancellationCutoffHours * 60 * 60 * 1000,
      );
      if (Date.now() > cutoffMoment.getTime()) {
        throw new CancellationCutoffError(settings.cancellationCutoffHours);
      }
    }

    if (booking.status === 'PENDING_PAYMENT') {
      await tx.payment.updateMany({
        where: { bookingId: booking.id, status: 'PENDING' },
        data: { status: 'FAILED', failureCode: 'user_cancelled' },
      });
      if (booking.invoice) {
        await tx.invoice.update({
          where: { id: booking.invoice.id },
          data: { status: 'CANCELLED' },
        });
      }
      await tx.booking.update({
        where: { id: booking.id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      // A never-collected insurance deposit dies with the unpaid booking.
      await tx.bookingInsurance.updateMany({
        where: { bookingId: booking.id, collectionStatus: 'PENDING' },
        data: { collectionStatus: 'VOIDED' },
      });
      // Unpaid booking dies → free the sanctions it had reserved.
      await releaseSanctionsForBooking(tx, booking.id);
      return;
    }

    // booking.status === 'CONFIRMED' — this booking is PAID. Self-service
    // cancellation is intentionally DISABLED: silently voiding a paid booking
    // would free the slot while returning NO money, forfeiting the guest's
    // policy-based refund. Paid cancellations go through reception, which cancels
    // AND applies the tiered refund (see adminRefundBooking). This throw is
    // defence-in-depth — the customer UI hides the button for paid bookings and
    // shows the refund policy instead.
    throw new DomainError(
      'Paid bookings are cancelled by the resort per the refund policy',
      'paid_cancellation_requires_reception',
      409,
    );
  });

  // Revoke physical (ZK) access promptly on a self-cancel — best-effort,
  // post-commit. No-op for non-ZK bookings; the ZK reconciler backstops the
  // admin/refund cancel paths (and expiry) within its sweep.
  const { safeRevokeBookingZkAccess } = await import('@/server/zk/provision');
  await safeRevokeBookingZkAccess(bookingId);

  return result;
}

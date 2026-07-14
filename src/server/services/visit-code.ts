import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { visitQrToken } from '@/lib/qr';
import {
  generateVisitCodeString,
  visitIdentityKey,
  visitLastDay,
} from './visit-code-core';

/**
 * Visit codes — the DAILY ROOT CODE grouping all of one customer's bookings
 * for one visit day (see `visit-code-core.ts` for the identity rule).
 *
 * Lifecycle:
 *   - `ensureVisitForBooking` is called when a booking is created (online +
 *     reception) AND lazily from every QR / print / scan path, so legacy
 *     bookings self-link the first time they're touched and a booking whose
 *     date or identity changed self-heals onto the right group.
 *   - The QR/barcode encodes a SIGNED token over `VisitCode.code` (see
 *     `visitQrToken`) — the raw code itself is opaque and never shown to
 *     customers; reception prints it only inside the QR.
 *   - The group's status is always derived live from its bookings (each
 *     booking keeps its own verdict at the gate) — the visit row itself
 *     carries no status to drift out of sync.
 */

type TxOrClient = Prisma.TransactionClient | typeof prisma;

const BOOKING_IDENTITY_SELECT = {
  id: true,
  userId: true,
  createdByStaffId: true,
  guestPhone: true,
  guestName: true,
  bookingDate: true,
  endDate: true,
  visitCodeId: true,
  user: { select: { name: true, phone: true } },
} satisfies Prisma.BookingSelect;

export interface VisitRecord {
  id: string;
  code: string;
  visitDate: Date;
  identityKey: string;
  userId: string | null;
  guestName: string | null;
  guestPhone: string | null;
  scanCount: number;
}

/**
 * Get-or-create the visit group for a booking and make sure the booking is
 * linked to it. Idempotent and self-healing: if the booking already points at
 * a group whose identity/date no longer match (date edit, etc.), it is moved
 * to the correct group. Race-safe via the `(identityKey, visitDate)` unique
 * (concurrent creates collapse onto one row).
 */
export async function ensureVisitForBooking(
  db: TxOrClient,
  bookingId: string,
): Promise<VisitRecord> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: BOOKING_IDENTITY_SELECT,
  });
  if (!booking) throw new Error(`ensureVisitForBooking: booking ${bookingId} not found`);

  const identityKey = visitIdentityKey(booking);
  const visitDate = booking.bookingDate;
  const isWalkIn = !!booking.createdByStaffId;

  // Fast path: already linked to the right group.
  if (booking.visitCodeId) {
    const current = await db.visitCode.findUnique({ where: { id: booking.visitCodeId } });
    if (
      current &&
      current.identityKey === identityKey &&
      current.visitDate.getTime() === visitDate.getTime()
    ) {
      return current;
    }
  }

  // Find-or-create the correct group. Retry once on either unique race:
  // (identityKey, visitDate) — concurrent ensure for the same customer/day —
  // or the (astronomically unlikely) code collision.
  let visit = await db.visitCode.findUnique({
    where: { identityKey_visitDate: { identityKey, visitDate } },
  });
  if (!visit) {
    for (let attempt = 0; ; attempt++) {
      try {
        visit = await db.visitCode.create({
          data: {
            code: generateVisitCodeString(),
            visitDate,
            identityKey,
            userId: isWalkIn ? null : booking.userId,
            guestName: isWalkIn ? booking.guestName : (booking.user.name ?? null),
            guestPhone: isWalkIn ? booking.guestPhone : (booking.user.phone ?? null),
          },
        });
        break;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && attempt < 2) {
          const existing = await db.visitCode.findUnique({
            where: { identityKey_visitDate: { identityKey, visitDate } },
          });
          if (existing) {
            visit = existing;
            break;
          }
          continue; // code collision — regenerate
        }
        throw err;
      }
    }
  }

  if (booking.visitCodeId !== visit!.id) {
    await db.booking.update({ where: { id: booking.id }, data: { visitCodeId: visit!.id } });
  }
  return visit!;
}

/** Relations every visit-group consumer needs alongside each booking. */
export const VISIT_BOOKINGS_ORDER = [
  { createdAt: 'asc' },
] satisfies Prisma.BookingOrderByWithRelationInput[];

/**
 * The signed visit token for a booking's group — THE value every QR encodes.
 * Ensures the group exists (legacy bookings self-link here), then signs over
 * the group's code with an expiry covering the whole visit.
 */
export async function visitTokenForBooking(
  db: TxOrClient,
  bookingId: string,
): Promise<{ token: string; visit: VisitRecord }> {
  const visit = await ensureVisitForBooking(db, bookingId);
  const siblings = await db.booking.findMany({
    where: { visitCodeId: visit.id },
    select: { bookingDate: true, endDate: true },
  });
  const lastDay = visitLastDay(siblings.length ? siblings : [{ bookingDate: visit.visitDate, endDate: null }]);
  return { token: visitQrToken(visit, lastDay), visit };
}

/** Look a visit up by its raw code (barcode / manual fallback). */
export async function findVisitByCode(code: string): Promise<VisitRecord | null> {
  return prisma.visitCode.findUnique({ where: { code: code.trim().toUpperCase() } });
}

/** Stamp a successful scan (count + timestamp) — display/forensics only. */
export async function recordVisitScan(visitId: string): Promise<void> {
  await prisma.visitCode.update({
    where: { id: visitId },
    data: { scanCount: { increment: 1 }, lastScannedAt: new Date() },
  });
}

/** Stamp the reception print (first time only is fine to overwrite). */
export async function recordVisitPrinted(visitId: string): Promise<void> {
  await prisma.visitCode.update({ where: { id: visitId }, data: { printedAt: new Date() } });
}

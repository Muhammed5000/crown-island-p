import 'server-only';
import { prisma } from '@/server/db/prisma';
import { audit } from '@/server/audit/audit';
import { unitCapacityCost, eachDay, releaseBookingSlotCapacity } from './capacity-cost';
import { quote } from './pricing';
import { settleSanctionsForBooking } from './sanctions';
import { AuthorizationError, DomainError } from './errors';

/**
 * Developer-only service for sandbox operations and virtual payments.
 */

export async function confirmVirtualPayment(bookingId: string, actorUserId: string) {
  return await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      include: {
        invoice: true,
        payments: { where: { status: 'PENDING' }, take: 1 },
        service: { select: { kind: true } },
      },
    });

    if (!booking) throw new DomainError('booking_not_found', 'booking_not_found', 404);
    // Defense-in-depth: virtualPayAction already gates on the TESTER/DEVELOPER
    // role + sandbox mode, but a tester may only virtually-pay their OWN booking
    // — never confirm someone else's via a guessed booking id.
    if (booking.userId !== actorUserId) throw new AuthorizationError();
    if (booking.status !== 'PENDING_PAYMENT') return;

    // ─── RE-VERIFY AVAILABILITY ───
    // Even in sandbox, we should respect capacity and working hours to
    // simulate real-world conditions.
    await quote({
      serviceId: booking.serviceId,
      date: booking.bookingDate,
      people: booking.people,
      cars: booking.cars,
    }, tx);

    const payment = booking.payments[0];
    // A PENDING_PAYMENT booking with no pending Payment row is a data
    // inconsistency — surface it instead of silently confirming nothing.
    if (!payment) throw new DomainError('no_pending_payment', 'no_pending_payment', 409);

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCEEDED',
        paidAt: new Date(),
        provider: 'CREDIT_AGRICOLE', // Mock the card provider; no upstream call is made.
        failureMessage: 'VIRTUAL_PAYMENT_SANDBOX',
      },
    });

    if (booking.invoice) {
      await tx.invoice.update({
        where: { id: booking.invoice.id },
        data: { status: 'PAID', paidAt: new Date() },
      });
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    });

    // Mirror the real webhook: the paid invoice carried the user's reserved
    // sanctions — settle them now.
    await settleSanctionsForBooking(tx, booking.id, actorUserId);

    // Update confirmed capacity counters — match the real webhook/reception
    // commit EXACTLY (src/server/payments/sync.ts): one BookingSlot PER DAY, each
    // incremented by the per-day unit cost (EVENT reserves headcount, other kinds
    // reserve the ticket count `unitsPerDay`). Cars + handicap are reserved on
    // EVERY day — they occupy their resource for the whole stay and the shared
    // release path (`releaseBookingSlotCapacity`) decrements them on every day, so
    // reserving them on day 0 only would make a later refund drive days 2..N
    // negative and over-sell those days. See `unitCapacityCost` / `eachDay`.
    const { serviceId, bookingDate, endDate, people, cars, handicapPeople, unitsPerDay } = booking;
    const perDayCost = unitCapacityCost(booking.service.kind, unitsPerDay, people);
    const days = eachDay(bookingDate, endDate);
    for (const date of days) {
      await tx.bookingSlot.upsert({
        where: { serviceId_date: { serviceId, date } },
        create: {
          serviceId,
          date,
          reservedPeople: perDayCost,
          reservedCars: cars,
          reservedHandicap: handicapPeople,
        },
        update: {
          reservedPeople: { increment: perDayCost },
          reservedCars: { increment: cars },
          reservedHandicap: { increment: handicapPeople },
        },
      });
    }

    await audit(tx, {
      actorUserId,
      action: 'STATUS_CHANGE',
      entityType: 'Booking',
      entityId: bookingId,
      after: { status: 'CONFIRMED', virtual: true },
    });
  });
}

/**
 * Delete all data associated with TESTER users.
 */
export async function cleanupTesterData() {
  return await prisma.$transaction(async (tx) => {
    // 1. Find all users with role TESTER
    const testers = await tx.user.findMany({
      where: { role: 'TESTER' },
      select: { id: true },
    });
    const testerIds = testers.map((t) => t.id);

    if (testerIds.length === 0) return { deletedBookings: 0 };

    // 2. Find all bookings for these testers (with the fields needed to reverse
    //    any CONFIRMED capacity reservation before the row is deleted).
    const bookings = await tx.booking.findMany({
      where: { userId: { in: testerIds } },
      select: {
        id: true,
        status: true,
        serviceId: true,
        bookingDate: true,
        endDate: true,
        people: true,
        cars: true,
        handicapPeople: true,
        unitsPerDay: true,
        service: { select: { kind: true } },
      },
    });
    const bookingIds = bookings.map((b) => b.id);

    // 2b. Release reserved capacity for every CONFIRMED tester booking via the
    //     canonical helper — one BookingSlot per day, cars/handicap on EVERY day
    //     (matching the reserve path + clamp). The old hand-rolled loop released
    //     cars/handicap on day 0 only, leaving phantom multi-day occupancy after
    //     the rows were deleted, silently shrinking real availability on days 2..N.
    for (const b of bookings) {
      if (b.status !== 'CONFIRMED') continue;
      await releaseBookingSlotCapacity(tx, b);
    }

    // 3. Delete related records first (some relations cascade, some don't), then
    //    the bookings themselves.
    // Deleting payments
    await tx.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
    
    // Deleting invoice lines and refunds
    const invoices = await tx.invoice.findMany({ where: { bookingId: { in: bookingIds } }, select: { id: true } });
    const invoiceIds = invoices.map(i => i.id);
    await tx.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await tx.refundLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await tx.invoice.deleteMany({ where: { id: { in: invoiceIds } } });

    // Delete bookings
    const deleted = await tx.booking.deleteMany({ where: { id: { in: bookingIds } } });

    return { deletedBookings: deleted.count };
  });
}

export async function setSandboxMode(enabled: boolean) {
  return await prisma.settings.update({
    where: { id: 'default' },
    data: { sandboxMode: enabled },
  });
}

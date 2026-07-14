import 'server-only';
import { prisma } from '@/server/db/prisma';
import { AuthorizationError, DomainError } from '@/server/services/errors';
import { calcBooking } from '@/server/services/booking-calc';
import { expandDateRange } from '@/server/services/booking';

/**
 * Load a booking's pending payment and re-verify availability + price before
 * handing off to a payment provider.
 *
 * Shared by every provider's `ensure…Intention` (Paymob, Crédit Agricole) so
 * the safety re-check is defined exactly once and can never drift between
 * providers. The checks mirror what the invoice was built from:
 *
 *  - Re-price with the SAME engine the invoice used (`calcBooking`), NOT the
 *    single-unit `quote()`, which would re-quote a multi-unit/day booking LOWER
 *    than its stored invoice and spuriously trip `price_changed`.
 *  - `calcBooking({ checkAvailability: true })` also re-checks capacity + working
 *    hours, throwing CapacityError / WorkingHoursError / PastDateError.
 *  - Compare against the invoice SUBTOTAL (booking-only price), not the grand
 *    total — the total also carries frozen sanction/penalty lines that
 *    `calcBooking` doesn't reproduce. The grand total is still verified at
 *    capture time (webhook amount-check vs `payment.amountCents`).
 */
export async function loadAndReverifyPendingPayment(userId: string, bookingId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, userId },
    include: {
      invoice: true,
      payments: { where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' }, take: 1 },
      user: { select: { name: true, email: true, phone: true } },
    },
  });
  if (!booking || !booking.invoice) throw new AuthorizationError();
  if (booking.status !== 'PENDING_PAYMENT') {
    throw new DomainError('booking_not_payable', 'booking_not_payable', 409);
  }
  const payment = booking.payments[0];
  if (!payment) throw new DomainError('no_pending_payment', 'no_pending_payment', 409);

  const recheck = await calcBooking({
    serviceId: booking.serviceId,
    adults: booking.adults,
    children: booking.children,
    cars: booking.cars,
    // The paid "Extra Person" add-on is part of the stored invoice subtotal, so
    // it MUST ride through the re-price too — omitting it makes `recheck.totalCents`
    // short by the add-on charge and trips `price_changed`, permanently blocking
    // checkout for any booking that bought extra persons. (Engine ignores it unless
    // the service enables `allowExtraPeople`, so it's safe for every kind.)
    extraPersons: booking.extraPersons,
    dates: expandDateRange(
      booking.bookingDate.toISOString().slice(0, 10),
      booking.endDate ? booking.endDate.toISOString().slice(0, 10) : null,
    ),
    checkAvailability: true,
  });

  // Service-only vs service-only: `invoice.subtotalCents` never contains the
  // insurance deposit or penalties, and `recheck.totalCents` is likewise the
  // service total. `recheck.insuranceCents` is DELIBERATELY ignored here — the
  // deposit was snapshotted at commit (BookingInsurance), so an admin editing
  // the service's insurance config after the booking was created must NOT trip
  // price_changed on a pending payment (docs/INSURANCE.md §4).
  if (recheck.totalCents !== booking.invoice.subtotalCents) {
    throw new DomainError('price_changed', 'price_changed', 409);
  }

  return { booking, payment, invoice: booking.invoice };
}

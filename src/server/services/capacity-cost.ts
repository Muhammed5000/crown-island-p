import type { Prisma, ServiceKind } from '@prisma/client';

/**
 * Capacity bookkeeping rule.
 *
 *  - For EVENT services, capacity is measured in PEOPLE: a single event
 *    booking for 3 people consumes 3 slots out of the daily headcount.
 *  - For every other service kind (DAY_USE, CABANA, OTHER), capacity is
 *    measured in BOOKINGS: any booking, regardless of party size, consumes
 *    exactly 1 slot out of the daily limit.
 *
 * This helper centralises the rule so the create-booking, webhook
 * confirm/refund, cancel, and dashboard read-paths all stay aligned. It
 * deliberately takes the booking's raw `people` count and the service's
 * `kind`; nothing else is consulted.
 */
export function capacityCostFor(kind: ServiceKind, people: number): number {
  return kind === 'EVENT' ? people : 1;
}

/**
 * Multi-unit aware capacity cost for one day.
 *
 * Generalises {@link capacityCostFor} for the per-unit booking model: a single
 * booking can now consume several physical units in a day (e.g. 6 people → 2
 * cabanas). EVENT services still bill capacity in PEOPLE; every other kind bills
 * in UNITS — which is `1` for a legacy single-unit booking and matches the
 * original behaviour exactly when `unitsPerDay === 1`.
 */
export function unitCapacityCost(
  kind: ServiceKind,
  unitsPerDay: number,
  people: number,
): number {
  return kind === 'EVENT' ? people : Math.max(1, unitsPerDay);
}

/**
 * Clamped capacity comparison: does adding `add` on top of the stored counter
 * `used` exceed `cap`?
 *
 * A NEGATIVE stored counter (pre-existing corruption from an out-of-band
 * under-reserve; see {@link clampSlotCapacity}) must count as 0 — otherwise it
 * silently widens the capacity check and allows overbooking. The quote paths
 * (`booking-calc`, `pricing`) already clamp their reads; this helper gives the
 * confirm-time C-1 re-check (payment sync) the same behaviour. `cap === null`
 * means unlimited and never exceeds.
 */
export function capacityExceeded(used: number, add: number, cap: number | null): boolean {
  return cap != null && Math.max(0, used) + add > cap;
}

/**
 * Inclusive list of UTC-midnight days a booking covers, from `start` to `end`.
 * `end` null (or not after `start`) means a single-day booking.
 *
 * Capacity is reserved — and therefore must be released — one `BookingSlot`
 * PER returned day. The confirm/reserve path (webhook + reception) and the
 * release paths (refund + cancel) MUST expand the range identically, so they
 * all share this one helper. A divergence here is exactly what caused multi-day
 * bookings to leak capacity on days 2..N.
 */
export function eachDay(start: Date, end: Date | null): Date[] {
  if (!end || end.getTime() <= start.getTime()) return [start];
  const days: Date[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    days.push(new Date(t));
    if (days.length > 60) break; // safety cap, mirrors createBooking
  }
  return days;
}

/**
 * Defense-in-depth: clamp any `BookingSlot` capacity counter that a release drove
 * below zero back to zero, across the given days of one service.
 *
 * Capacity is released with an atomic `{ decrement }` (the race-free mirror of
 * the reserve side's atomic `{ increment }`). On a perfectly-consistent DB a
 * booking only ever releases exactly what it reserved, so a counter can't go
 * negative — but if pre-existing data is inconsistent (e.g. a counter was under-
 * reserved out-of-band) a decrement could underflow, and a NEGATIVE
 * `reservedPeople` would make `booking-calc`'s `used + cost > capacity` check
 * pass spuriously and ALLOW overbooking. These three updates fix that; each is a
 * single atomic statement whose `WHERE` matches nothing in the normal case, so
 * it's a no-op there and never masks a correct release.
 */
export async function clampSlotCapacity(
  tx: Prisma.TransactionClient,
  serviceId: string,
  days: Date[],
): Promise<void> {
  if (days.length === 0) return;
  const where = { serviceId, date: { in: days } };
  await tx.bookingSlot.updateMany({
    where: { ...where, reservedPeople: { lt: 0 } },
    data: { reservedPeople: 0 },
  });
  await tx.bookingSlot.updateMany({
    where: { ...where, reservedCars: { lt: 0 } },
    data: { reservedCars: 0 },
  });
  await tx.bookingSlot.updateMany({
    where: { ...where, reservedHandicap: { lt: 0 } },
    data: { reservedHandicap: 0 },
  });
}

/** Minimal booking shape needed to release a confirmed booking's slot capacity. */
export interface CapacityReleaseBooking {
  serviceId: string;
  bookingDate: Date;
  endDate: Date | null;
  people: number;
  cars: number;
  handicapPeople: number;
  unitsPerDay: number;
  service: { kind: ServiceKind };
}

/**
 * Release a CONFIRMED booking's reserved `BookingSlot` capacity — the exact
 * mirror of the reserve path (webhook confirm / reception). Loops EVERY day in
 * the inclusive range, decrementing each by the per-day unit cost AND the full
 * cars/handicap (they occupy their resource on every day of the stay — a car
 * parks each day, priced per-day too), then clamps.
 *
 * Centralised so the refund path (`applyRefundToDb`) and the admin cancel/refund
 * paths can never drift: a divergence leaks capacity on days 2..N, which is the
 * precise bug this guards (see capacity-cost tests + reserve/release symmetry).
 */
export async function releaseBookingSlotCapacity(
  tx: Prisma.TransactionClient,
  booking: CapacityReleaseBooking,
): Promise<void> {
  const perDayCost = unitCapacityCost(booking.service.kind, booking.unitsPerDay, booking.people);
  const days = eachDay(booking.bookingDate, booking.endDate);
  for (const date of days) {
    await tx.bookingSlot.updateMany({
      where: { serviceId: booking.serviceId, date },
      data: {
        reservedPeople: { decrement: perDayCost },
        reservedCars: { decrement: booking.cars },
        reservedHandicap: { decrement: booking.handicapPeople },
      },
    });
  }
  await clampSlotCapacity(tx, booking.serviceId, days);
}

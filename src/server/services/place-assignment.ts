import 'server-only';
import { Prisma, type PlaceType, type PlacementStatus } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { resortCivilDayUTC } from '@/lib/date';
import { audit } from '@/server/audit/audit';
import { DomainError } from './errors';
import { pickAdjacent } from './place-adjacency';
import { firstUnavailablePlace } from './place-capacity-core';
import { enqueueBookingLocalState, enqueueUnitPlacements } from '@/server/sync/booking-local-state';

/**
 * Live physical-place assignment for reception & gate.
 *
 * A booking on a per-unit, place-required service has `unitsPerDay` physical
 * units. A unit keeps the SAME place for every day of the booking (you keep your
 * cabana for the whole stay), so the operator picks `unitsPerDay` places once and
 * each is applied to that unit index across all the booking's dates.
 *
 * Concurrency: the `BookingUnit @@unique([placeId, date])` constraint is the
 * authoritative guard — two operators racing to grab the same place on the same
 * day collide on the unique index (P2002), surfaced as `place_taken`.
 */

export interface AvailablePlace {
  id: string;
  label: string;
  type: PlaceType;
  zone: string | null;
  position: number;
  gridX: number;
  gridY: number;
  isAvailable: boolean;
  /** Accessibility (handicap) cell — staff steer guests who need it here. */
  isHandicap: boolean;
  /** True when blocked by a scheduled out-of-service window (not just taken). */
  outOfService?: boolean;
  /** Operator's reason for the outage (e.g. "deep clean"), when out of service. */
  outageReason?: string | null;
  /** ISO instant the outage ends (when the place returns), when out of service. */
  outageUntil?: string;
}

export interface PlacementUnit {
  unitIndex: number;
  placeId: string | null;
  placeLabel: string | null;
}

export interface PlacementView {
  bookingId: string;
  reference: string;
  serviceId: string;
  placeType: PlaceType;
  required: boolean;
  status: PlacementStatus;
  unitsPerDay: number;
  /** Distinct sorted ISO days the booking covers. */
  dates: string[];
  /** One entry per unit index (deduped across days — same place all days). */
  units: PlacementUnit[];
  /** Active places free on EVERY day of the booking (assignable now). */
  available: AvailablePlace[];
  /** Suggested ids for the still-unplaced units, adjacent where possible. */
  recommended: string[];
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function computeStatus(required: boolean, total: number, placed: number): PlacementStatus {
  if (!required) return 'NOT_REQUIRED';
  if (placed === 0) return 'PENDING';
  if (placed >= total) return 'COMPLETE';
  return 'PARTIAL';
}

type TxOrClient = Prisma.TransactionClient | typeof prisma;

/**
 * Places of a service that are free on every one of `dates`, excluding those
 * already held by `excludeBookingId` (so a booking's own places stay visible).
 */
export async function getAvailablePlaces(
  serviceId: string,
  dates: Date[],
  excludeBookingId: string | null,
  db: TxOrClient = prisma,
): Promise<AvailablePlace[]> {
  const places = await db.servicePlace.findMany({
    where: { serviceId, isActive: true },
    orderBy: [{ zone: 'asc' }, { position: 'asc' }, { label: 'asc' }],
  });

  // Only LIVE (CONFIRMED) bookings hold a place. Without the status filter a
  // CANCELLED / EXPIRED / REFUNDED booking — whose `placeId` is never cleared on
  // release — would keep its place marked busy forever, silently eroding bookable
  // inventory. Scoping to CONFIRMED also self-heals every historical stuck row.
  const taken = await db.bookingUnit.findMany({
    where: {
      placeId: { not: null },
      date: { in: dates },
      booking: { status: 'CONFIRMED' },
      ...(excludeBookingId ? { bookingId: { not: excludeBookingId } } : {}),
    },
    select: { placeId: true },
  });
  const takenIds = new Set(taken.map((t) => t.placeId).filter(Boolean) as string[]);

  // Places with an out-of-service window overlapping ANY of the booking's days
  // can't be assigned (the unit holds the same place for every day).
  const outaged = await outagedPlaceIds(serviceId, dates, db);

  return places.map((p) => {
    const out = outaged.get(p.id);
    return {
      id: p.id,
      label: p.label,
      type: p.type,
      zone: p.zone,
      position: p.position,
      gridX: p.gridX,
      gridY: p.gridY,
      isAvailable: !takenIds.has(p.id) && !out,
      isHandicap: p.isHandicap,
      outOfService: !!out,
      outageReason: out?.reason ?? null,
      outageUntil: out?.until.toISOString(),
    };
  });
}

const DAY_MS = 86_400_000;

export interface OutageInfo {
  reason: string | null;
  /** When the place returns to service (latest overlapping window's end). */
  until: Date;
}

/**
 * Map of a service's place ids that are OUT OF SERVICE on at least one of
 * `dates` → the blocking outage's reason + end time. An outage `[startsAt,
 * endsAt)` blocks a whole UTC day `d` when it overlaps `[d, d + 1 day)`. When a
 * place has several overlapping windows, the one ending LAST wins (its `until`
 * is when the place is truly free again). `.has(id)` keeps the booking-gate
 * call sites working unchanged.
 */
export async function outagedPlaceIds(
  serviceId: string,
  dates: Date[],
  db: TxOrClient = prisma,
): Promise<Map<string, OutageInfo>> {
  const blocked = new Map<string, OutageInfo>();
  if (dates.length === 0) return blocked;
  const now = Date.now();
  const times = dates.map((d) => d.getTime());
  const min = new Date(Math.min(...times));
  const maxPlus = new Date(Math.max(...times) + DAY_MS);
  // An outage that has ALREADY ENDED (relative to now) no longer blocks anything
  // — a place whose downtime finished earlier today is bookable again, even
  // though that window still "touches" today's calendar day. So only consider
  // outages ending after max(first booking day, now).
  const cutoff = new Date(Math.max(min.getTime(), now));

  const outages = await db.placeOutage.findMany({
    where: {
      place: { serviceId },
      startsAt: { lt: maxPlus },
      endsAt: { gt: cutoff },
    },
    select: { placeId: true, startsAt: true, endsAt: true, reason: true },
  });

  for (const o of outages) {
    const s = o.startsAt.getTime();
    const e = o.endsAt.getTime();
    // Still in the future relative to now, AND overlaps one of the booking days.
    if (e <= now) continue;
    const overlaps = times.some((t) => s < t + DAY_MS && e > t);
    if (!overlaps) continue;
    const existing = blocked.get(o.placeId);
    if (!existing || e > existing.until.getTime()) {
      blocked.set(o.placeId, { reason: o.reason, until: o.endsAt });
    }
  }
  return blocked;
}

/** Full placement view for a booking — drives the reception/gate picker. */
export async function getBookingPlacement(
  bookingId: string,
  db: TxOrClient = prisma,
): Promise<PlacementView | null> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      service: { select: { id: true, placeType: true, placeAssignmentRequired: true } },
      units: { include: { place: true }, orderBy: [{ unitIndex: 'asc' }, { date: 'asc' }] },
    },
  });
  if (!booking) return null;

  const required = booking.service.placeAssignmentRequired;
  const dateSet = new Map<number, Date>();
  for (const u of booking.units) dateSet.set(u.date.getTime(), u.date);
  const dates = Array.from(dateSet.values()).sort((a, b) => a.getTime() - b.getTime());

  // Collapse units to one row per unitIndex (same place across days).
  const byIndex = new Map<number, PlacementUnit>();
  for (const u of booking.units) {
    const existing = byIndex.get(u.unitIndex);
    if (!existing) {
      byIndex.set(u.unitIndex, {
        unitIndex: u.unitIndex,
        placeId: u.placeId,
        placeLabel: u.place?.label ?? null,
      });
    } else if (!existing.placeId && u.placeId) {
      existing.placeId = u.placeId;
      existing.placeLabel = u.place?.label ?? null;
    }
  }
  const units = Array.from(byIndex.values()).sort((a, b) => a.unitIndex - b.unitIndex);
  const placedCount = units.filter((u) => u.placeId).length;

  const allPlaces = await getAvailablePlaces(booking.service.id, dates, booking.id, db);
  const availableOnly = allPlaces.filter((p) => p.isAvailable);
  const unplacedCount = units.length - placedCount;
  const recommended = unplacedCount > 0 ? pickAdjacent(availableOnly, unplacedCount) : [];

  return {
    bookingId: booking.id,
    reference: booking.reference,
    serviceId: booking.service.id,
    placeType: booking.service.placeType,
    required,
    status: computeStatus(required, units.length, placedCount),
    unitsPerDay: booking.unitsPerDay,
    dates: dates.map(isoDay),
    units,
    available: allPlaces,
    recommended,
  };
}

/** Recompute + persist `Booking.placementStatus` from its units. Returns the new status. */
export async function recomputePlacementStatus(
  bookingId: string,
  db: TxOrClient,
): Promise<PlacementStatus> {
  const booking = await db.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: {
      service: { select: { placeAssignmentRequired: true } },
      units: { select: { unitIndex: true, placeId: true } },
    },
  });
  const byIndex = new Map<number, boolean>();
  for (const u of booking.units) {
    byIndex.set(u.unitIndex, byIndex.get(u.unitIndex) || !!u.placeId);
  }
  const total = byIndex.size;
  const placed = Array.from(byIndex.values()).filter(Boolean).length;
  const status = computeStatus(booking.service.placeAssignmentRequired, total, placed);
  await db.booking.update({ where: { id: bookingId }, data: { placementStatus: status } });
  return status;
}

export interface AssignPlacesInput {
  bookingId: string;
  staffId: string;
  /** Map of unitIndex → placeId to assign (applied to every day of the booking). */
  assignments: { unitIndex: number; placeId: string }[];
}

export interface AssignPlacesResult {
  status: PlacementStatus;
}

/**
 * Assign places to a booking's units, transactionally. Each (unitIndex, placeId)
 * is applied to that unit on EVERY day of the booking. Validates the place
 * belongs to the service and is active; the DB unique index defeats concurrent
 * double-assignment.
 */
export async function assignPlaces(input: AssignPlacesInput): Promise<AssignPlacesResult> {
  if (input.assignments.length === 0) {
    throw new DomainError('No assignments provided', 'invalid_input', 400);
  }
  // Reject duplicate place ids within the same request up front.
  const placeIds = input.assignments.map((a) => a.placeId);
  if (new Set(placeIds).size !== placeIds.length) {
    throw new DomainError('Duplicate place in request', 'duplicate_place', 409);
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id: input.bookingId },
          include: {
            service: { select: { id: true, placeAssignmentRequired: true } },
            units: { select: { id: true, unitIndex: true, date: true, placeId: true } },
          },
        });
        if (!booking) throw new DomainError('not_found', 'not_found', 404);

        // Guard the booking STATE before mutating placements. This service is a
        // server-side trust boundary: it is reached only via the gate route,
        // which only offers the place picker after a `valid` scan — but the
        // endpoint is independently callable by any gate-role user, so it must
        // enforce the same invariants itself. Refuse anything that isn't a live,
        // not-yet-expired booking (CANCELLED / EXPIRED / FAILED / PENDING_PAYMENT
        // or a booking whose last day has already passed) so place assignments
        // can never be written onto archived/used bookings and pollute the audit
        // trail. Date math uses the RESORT-LOCAL civil day (mirrors gate-scan):
        // today's LOCAL parts vs the stored UTC-midnight-of-local-day booking
        // date, and respects `endDate` so multi-day bookings stay assignable on
        // their later days.
        if (booking.status !== 'CONFIRMED') {
          throw new DomainError('Booking is not confirmed', 'booking_not_assignable', 409);
        }
        // Resort-LOCAL civil day (TZ-independent), matching the gate/engine.
        const todayCivil = resortCivilDayUTC();
        const lastDay = booking.endDate ?? booking.bookingDate;
        const lastCivil = Date.UTC(
          lastDay.getUTCFullYear(),
          lastDay.getUTCMonth(),
          lastDay.getUTCDate(),
        );
        if (lastCivil < todayCivil) {
          throw new DomainError('Booking date has passed', 'booking_expired', 409);
        }

        // Validate the chosen places belong to this service and are active.
        const places = await tx.servicePlace.findMany({
          where: { id: { in: placeIds }, serviceId: booking.service.id, isActive: true },
          select: { id: true },
        });
        if (places.length !== placeIds.length) {
          throw new DomainError('Place not in this service', 'invalid_place', 400);
        }

        // Reject any place that is out of service on one of the booking's days.
        const bookingDates = Array.from(new Set(booking.units.map((u) => u.date.getTime()))).map(
          (t) => new Date(t),
        );
        const outaged = await outagedPlaceIds(booking.service.id, bookingDates, tx);
        if (placeIds.some((id) => outaged.has(id))) {
          throw new DomainError('Place is out of service', 'place_out_of_service', 409);
        }

        const validIndexes = new Set(booking.units.map((u) => u.unitIndex));
        for (const a of input.assignments) {
          if (!validIndexes.has(a.unitIndex)) {
            throw new DomainError('Unknown unit', 'invalid_unit', 400);
          }
        }

        // PREVENTIVE freedom check: reject a place already held by ANOTHER live
        // booking on any of this booking's days, BEFORE writing — a clean typed
        // error instead of a late unique-constraint collision, and it can never
        // silently overwrite a not-yet-arrived guest's place. `getAvailablePlaces`
        // excludes this booking's own units + counts CONFIRMED holds + outages.
        const availablePlaces = await getAvailablePlaces(
          booking.service.id,
          bookingDates,
          input.bookingId,
          tx,
        );
        const freeIds = new Set(availablePlaces.filter((p) => p.isAvailable).map((p) => p.id));
        const taken = firstUnavailablePlace(placeIds, freeIds);
        if (taken) {
          throw new DomainError('Place already taken', 'place_taken', 409);
        }

        // Apply each assignment to that unit index on every day of the booking.
        for (const a of input.assignments) {
          const rows = booking.units.filter((u) => u.unitIndex === a.unitIndex);
          for (const row of rows) {
            await tx.bookingUnit.update({
              where: { id: row.id },
              data: { placeId: a.placeId, assignedById: input.staffId, assignedAt: new Date() },
            });
          }
        }

        const status = await recomputePlacementStatus(input.bookingId, tx);

        await audit(tx, {
          actorUserId: input.staffId,
          action: 'UPDATE',
          entityType: 'Booking',
          entityId: input.bookingId,
          after: { placement: input.assignments, status },
        });

        // Sync (local→online): queue the units' placement + the booking's
        // placement-status roll-up. Both no-op off-local.
        await enqueueUnitPlacements(tx, input.bookingId);
        await enqueueBookingLocalState(tx, input.bookingId);

        return { status };
      },
      { maxWait: 5_000, timeout: 15_000 },
    );

    // A newly-assigned cabin changes which door the guest must open — re-sync ZK
    // (best-effort, post-commit). No-op for non-ZK services / when ZK is off.
    const { safeSyncBookingZkAccess } = await import('@/server/zk/provision');
    await safeSyncBookingZkAccess(input.bookingId);

    return result;
  } catch (err) {
    // Unique (placeId, date) collision → another operator grabbed it first.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DomainError('Place was just taken', 'place_taken', 409);
    }
    throw err;
  }
}

/** Release a unit's place (clears it across all days of the booking). */
export async function releaseUnitPlace(
  bookingId: string,
  unitIndex: number,
  staffId: string,
): Promise<AssignPlacesResult> {
  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.bookingUnit.findMany({
      where: { bookingId, unitIndex },
      select: { id: true, checkedInAt: true },
    });
    if (rows.length === 0) throw new DomainError('Unknown unit', 'invalid_unit', 400);
    if (rows.some((r) => r.checkedInAt)) {
      throw new DomainError('Unit already checked in', 'unit_checked_in', 409);
    }
    await tx.bookingUnit.updateMany({
      where: { bookingId, unitIndex },
      data: { placeId: null, assignedById: null, assignedAt: null },
    });
    const status = await recomputePlacementStatus(bookingId, tx);
    await audit(tx, {
      actorUserId: staffId,
      action: 'UPDATE',
      entityType: 'Booking',
      entityId: bookingId,
      after: { released: unitIndex, status },
    });

    // Sync (local→online): queue the cleared placement + status roll-up. No-op off-local.
    await enqueueUnitPlacements(tx, bookingId);
    await enqueueBookingLocalState(tx, bookingId);

    return { status };
  });

  // Releasing a cabin removes that door from the guest's grant — re-sync ZK
  // (best-effort, post-commit). No-op for non-ZK services / when ZK is off.
  const { safeSyncBookingZkAccess } = await import('@/server/zk/provision');
  await safeSyncBookingZkAccess(bookingId);

  return result;
}

import 'server-only';
import { prisma } from '@/server/db/prisma';
import { parseIsoDateUTC, resortCivilDayUTC } from '@/lib/date';
import { effectiveDailyCap } from './place-capacity-core';
import { unitCapacityCost } from './capacity-cost';

/**
 * Reusable per-day capacity snapshot for one service — the data behind the admin
 * "Capacity Preview" page, exposed as a function so the reception desk's
 * Capacity quick-view renders the IDENTICAL picture.
 *
 * It is driven by the AUTHORITATIVE sources, the same the booking engine uses:
 *   • `BookingSlot.reservedPeople` = the confirmed units sold that day (the cap
 *     is measured against this exact number), and
 *   • `BookingUnit` rows (one per physical unit per day) for the per-place map.
 *
 * Confirmed bookings that haven't been given a place yet ("awaiting placement"
 * — the normal state for an online booking before reception check-in) borrow the
 * next free cell in amber so a fully-booked day never looks empty on the map.
 */

export type CapacityCellStatus = 'booked' | 'awaiting' | 'available';

export interface CapacityCell {
  id: string;
  label: string;
  status: CapacityCellStatus;
  /** Booking reference occupying / awaiting this cell (for a tooltip). */
  reference: string | null;
}

export interface CapacitySnapshot {
  serviceId: string;
  serviceName: string;
  kind: 'DAY_USE' | 'CABANA' | 'EVENT' | 'OTHER';
  /** True when this service assigns real physical places (cells map 1:1 to them). */
  placeRequired: boolean;
  /** Finite ceiling (explicit cap, else physical-place count). Null = unlimited. */
  capacity: number | null;
  /** Units sold today (authoritative `reservedPeople`). */
  totalBooked: number;
  /** Remaining when there's a finite cap, else null (unlimited). */
  available: number | null;
  /** Confirmed units not yet pinned to a specific place. */
  unplaced: number;
  cells: CapacityCell[];
}

/**
 * Build the capacity snapshot for `serviceId` on the civil day `dateStr`
 * (yyyy-mm-dd). Returns null for an unknown service or a malformed date.
 */
export async function getServiceCapacitySnapshot(
  serviceId: string,
  dateStr: string,
  locale: 'ar' | 'en' = 'en',
): Promise<CapacitySnapshot | null> {
  const dayStart = parseIsoDateUTC(dateStr);
  if (!dayStart) return null;
  const nextDay = new Date(dayStart.getTime() + 86_400_000);

  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: {
      id: true,
      nameEn: true,
      nameAr: true,
      kind: true,
      placeAssignmentRequired: true,
      dailyCapacityPeople: true,
      places: {
        where: { isActive: true },
        orderBy: [{ gridY: 'asc' }, { gridX: 'asc' }, { position: 'asc' }, { label: 'asc' }],
        select: { id: true, label: true },
      },
    },
  });
  if (!service) return null;

  const placeRequired = service.placeAssignmentRequired && service.places.length > 0;

  const [units, slot] = await Promise.all([
    prisma.bookingUnit.findMany({
      where: { date: { gte: dayStart, lt: nextDay }, booking: { serviceId, status: 'CONFIRMED' } },
      select: { placeId: true, booking: { select: { reference: true } } },
      orderBy: [{ unitIndex: 'asc' }],
    }),
    prisma.bookingSlot.findUnique({ where: { serviceId_date: { serviceId, date: dayStart } } }),
  ]);

  const placedRef = new Map<string, string>();
  for (const u of units) if (u.placeId) placedRef.set(u.placeId, u.booking.reference);
  const unplacedUnits = units.filter((u) => !u.placeId);

  // Real ceiling: for a UNIT-based place service the physical-place count is an
  // ABSOLUTE cap (an explicit `dailyCapacityPeople` set higher than the inventory
  // is clamped down to it — matches what booking actually enforces). EVENT is
  // excluded (its counter holds PEOPLE, not units, so place count isn't its
  // ceiling); a non-place service keeps its explicit cap (null = unlimited).
  const capacity = effectiveDailyCap(
    service.dailyCapacityPeople,
    placeRequired && service.kind !== 'EVENT',
    service.places.length,
  );
  // Authoritative booked count from the confirmed slot counter (units for
  // non-EVENT, people for EVENT) — falls back to the raw unit count.
  const totalBooked = slot?.reservedPeople ?? units.length;

  let awaitingFilled = 0;
  const cells: CapacityCell[] = placeRequired
    ? service.places.map((p) => {
        if (placedRef.has(p.id)) {
          return { id: p.id, label: p.label, status: 'booked' as const, reference: placedRef.get(p.id) ?? null };
        }
        const pending = awaitingFilled < unplacedUnits.length ? unplacedUnits[awaitingFilled++] : undefined;
        return {
          id: p.id,
          label: p.label,
          status: pending ? ('awaiting' as const) : ('available' as const),
          reference: pending?.booking.reference ?? null,
        };
      })
    : Array.from({ length: Math.max(capacity ?? 0, totalBooked) }, (_, i) => ({
        id: `slot-${i}`,
        label: String(i + 1),
        status: (i < totalBooked ? 'booked' : 'available') as CapacityCellStatus,
        reference: i < totalBooked ? (units[i]?.booking.reference ?? null) : null,
      }));

  return {
    serviceId: service.id,
    serviceName: locale === 'ar' ? service.nameAr : service.nameEn,
    kind: service.kind,
    placeRequired,
    capacity,
    totalBooked,
    available: capacity != null ? Math.max(0, capacity - totalBooked) : null,
    unplaced: unplacedUnits.length,
    cells,
  };
}

// ── Reception status overview (the live desk status bar) ────────────────────--

export type CapacityLevel = 'open' | 'filling' | 'full';

export interface ServiceCapacityStatus {
  id: string;
  name: string;
  category: string;
  capacity: number;
  booked: number;
  level: CapacityLevel;
}

export interface ReceptionStatusOverview {
  /** Finite-capacity services, sold-out / filling first. */
  services: ServiceCapacityStatus[];
  /** How many of the above are sold out today. */
  soldOut: number;
  /** Confirmed guests covering today who haven't fully checked in. */
  arrivalsWaiting: number;
  /** Places currently out of service (an active outage window). */
  placesOffline: number;
  /** Confirmed bookings covering today. */
  bookingsToday: number;
}

const LEVEL_RANK: Record<CapacityLevel, number> = { full: 0, filling: 1, open: 2 };

/**
 * At-a-glance operational state for the reception status bar: per-service
 * occupancy (finite-capacity services only), plus how many are sold out, how
 * many guests are still waiting to enter, and how many places are offline.
 * Uses the authoritative `BookingSlot` counter, so it agrees with what sells.
 */
export async function getReceptionStatusOverview(locale: 'ar' | 'en'): Promise<ReceptionStatusOverview> {
  const ar = locale === 'ar';
  const todayStart = new Date(resortCivilDayUTC());
  const todayEnd = new Date(resortCivilDayUTC() + 86_400_000);
  const now = new Date();

  const [services, slots, todays, placesOffline] = await Promise.all([
    prisma.service.findMany({
      where: { isActive: true, category: { isActive: true } },
      select: {
        id: true,
        nameEn: true,
        nameAr: true,
        dailyCapacityPeople: true,
        placeAssignmentRequired: true,
        category: { select: { nameEn: true, nameAr: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    }),
    prisma.bookingSlot.findMany({
      where: { date: { gte: todayStart, lt: todayEnd } },
      select: { serviceId: true, reservedPeople: true },
    }),
    prisma.booking.findMany({
      where: {
        status: 'CONFIRMED',
        OR: [
          { bookingDate: todayStart },
          { AND: [{ bookingDate: { lte: todayStart } }, { endDate: { gte: todayStart } }] },
        ],
      },
      // `serviceId`/`unitsPerDay`/`service.kind` feed the local-mirror capacity
      // fallback below (BookingSlot counters aren't synced to local); the rest
      // drive arrivalsWaiting / bookingsToday.
      select: {
        checkedInCount: true,
        people: true,
        extraPersons: true,
        serviceId: true,
        unitsPerDay: true,
        service: { select: { kind: true } },
      },
    }),
    prisma.placeOutage.count({ where: { startsAt: { lte: now }, endsAt: { gt: now } } }),
  ]);

  const bookedByService = new Map(slots.map((s) => [s.serviceId, s.reservedPeople]));

  // Local-mirror fallback: `BookingSlot` counters are online-authoritative and are
  // NOT part of the pull bundle, so on the LOCAL node `slots` is empty and every
  // service would read 0 booked ("no one" while the venue is occupied). Re-derive
  // the per-service booked count from the confirmed bookings already loaded above,
  // using the SAME per-day cost the reserve path writes (`unitCapacityCost`: EVENT
  // → people, else → units). Used only when the authoritative slot counter is
  // absent, so the online node — where `slots` is populated — is unaffected.
  const liveByService = new Map<string, number>();
  for (const b of todays) {
    liveByService.set(
      b.serviceId,
      (liveByService.get(b.serviceId) ?? 0) + unitCapacityCost(b.service.kind, b.unitsPerDay, b.people),
    );
  }

  // Physical place counts only for place-required services with no explicit cap.
  const needPlaceCount = services
    .filter((s) => s.dailyCapacityPeople == null && s.placeAssignmentRequired)
    .map((s) => s.id);
  const placeCounts = new Map<string, number>();
  if (needPlaceCount.length) {
    const grouped = await prisma.servicePlace.groupBy({
      by: ['serviceId'],
      where: { serviceId: { in: needPlaceCount }, isActive: true },
      _count: { _all: true },
    });
    for (const g of grouped) placeCounts.set(g.serviceId, g._count._all);
  }

  const out: ServiceCapacityStatus[] = [];
  for (const s of services) {
    const cap = s.dailyCapacityPeople ?? (s.placeAssignmentRequired ? placeCounts.get(s.id) ?? 0 : null);
    if (cap == null || cap <= 0) continue; // only finite-capacity services in the strip
    const booked = Math.max(0, bookedByService.get(s.id) ?? liveByService.get(s.id) ?? 0);
    const level: CapacityLevel = booked >= cap ? 'full' : booked / cap > 0.85 ? 'filling' : 'open';
    out.push({
      id: s.id,
      name: ar ? s.nameAr : s.nameEn,
      category: ar ? s.category.nameAr : s.category.nameEn,
      capacity: cap,
      booked,
      level,
    });
  }
  out.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || b.booked - a.booked);

  return {
    services: out,
    soldOut: out.filter((s) => s.level === 'full').length,
    arrivalsWaiting: todays.filter((b) => b.checkedInCount < b.people + b.extraPersons).length,
    placesOffline,
    bookingsToday: todays.length,
  };
}

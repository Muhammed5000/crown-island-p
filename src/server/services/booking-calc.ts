import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { quote, type PriceLine } from './pricing';
import { unitCapacityCost } from './capacity-cost';
import { effectiveDailyCap } from './place-capacity-core';
import {
  ServiceInactiveError,
  PastDateError,
  WorkingHoursError,
  CapacityError,
  DomainError,
} from './errors';
import { parseIsoDateUTC, resortCivilDayUTC, resortHourMinute } from '@/lib/date';
import {
  allocateUnits,
  behaviorFor,
  exceedsChildrenCap,
  exceedsPeopleCap,
  cabanaTicketCapacity,
  maxExtraPersonsFor,
  priceUnitDay,
  aggregateLines,
  type ServiceRules,
  type PerDayCost,
} from './booking-calc-core';
import { buildInsuranceSnapshot, type InsuranceSnapshot } from './insurance-core';

/**
 * Booking calculation engine — the single source of truth for "how many units,
 * how many extra people/children, and what does it cost" across every channel
 * (customer page, reception, checkout, gate, confirmation).
 *
 * The regime is chosen **by `service.kind`** via {@link behaviorFor} — each
 * category owns its own capacity + pricing logic (see that helper):
 *
 *   • EVENT  — every guest billed individually (per-person + per-child).
 *   • CABANA — ticket of N adults + M children; extras open more tickets.
 *   • DAY_USE (beach) — one umbrella (ticket) covers N ADULTS; children never use
 *     umbrella space. Adults drive the count: requiredUmbrellas = ceil(adults / N).
 *     "Maximum children" is PER UMBRELLA (× umbrellas). Price = umbrellas × base.
 *   • OTHER  — legacy head-count, delegated to {@link quote}; single-day,
 *     adults-only, EXACT original behaviour so nothing about those bookings
 *     changes.
 *
 * The structured (non-legacy) regimes split the party into one or more tickets
 * (“units”) per day and may span a contiguous range of days.
 *
 * Money is always recomputed server-side; the client never supplies a price.
 *
 * Pure helpers (allocation, per-day pricing) live in `booking-calc-core` so they
 * can be unit-tested without the database; they are re-exported here.
 */

export * from './booking-calc-core';

export interface BookingCalcResult {
  serviceId: string;
  /** True when the per-unit regime applies (vs the legacy head-count regime). */
  unitModel: boolean;
  unitsPerDay: number;
  includedPersonsPerUnit: number;
  includedPersons: number;
  extraPersons: number;
  includedChildren: number;
  extraChildren: number;
  adults: number;
  children: number;
  cars: number;
  /** Sorted ISO yyyy-mm-dd days covered. Length 1 for single-day bookings. */
  dates: string[];
  days: number;
  /** Total physical units across the whole booking (unitsPerDay × days). */
  totalUnits: number;
  perDay: PerDayCost[];
  /** Aggregated invoice lines (merged across days). */
  lines: PriceLine[];
  currency: 'EGP';
  subtotalCents: number;
  taxCents: number;
  feeCents: number;
  totalCents: number;
  /**
   * Insurance deposit owed for this booking (docs/INSURANCE.md). Computed from
   * `subtotalCents` (the PRE-DISCOUNT eligible service total) and the service's
   * insurance config. DELIBERATELY NOT part of `subtotalCents`/`totalCents` —
   * those stay service-only so discount bases and the payment reverify guard
   * are structurally unable to touch the deposit. Callers assemble grand totals
   * via `assembleFinalTotalCents`. 0 when the service has no insurance.
   */
  insuranceCents: number;
  /** Frozen config snapshot to persist on the booking, or null when none applies. */
  insuranceSnapshot: InsuranceSnapshot | null;
}

type TxOrClient = Prisma.TransactionClient | typeof prisma;

function parseDateOnly(iso: string): Date {
  const d = parseIsoDateUTC(iso);
  if (!d) throw new PastDateError();
  return d;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface CalcBookingInput {
  serviceId: string;
  adults: number;
  children?: number;
  cars?: number;
  /** Optional paid "Extra Person" add-ons (see `Service.allowExtraPeople`).
   * Billed separately; never affects units or capacity. Honoured only when the
   * service enables the add-on and uses a grouped-ticket regime. */
  extraPersons?: number;
  /** One date for single-day, or several (contiguous) for multi-day. */
  dates: string[];
  /** When true, validate per-day availability against confirmed counters. */
  checkAvailability?: boolean;
}

/**
 * Compute the full booking calculation. Throws typed domain errors on invalid
 * input / unavailability so the action layer can map them to translated UI
 * messages, identical to {@link quote}.
 */
export async function calcBooking(
  input: CalcBookingInput,
  db: TxOrClient = prisma,
): Promise<BookingCalcResult> {
  const adults = Math.max(0, Math.trunc(input.adults));
  const children = Math.max(0, Math.trunc(input.children ?? 0));
  const cars = Math.max(0, Math.trunc(input.cars ?? 0));
  const extraPersons = Math.max(0, Math.trunc(input.extraPersons ?? 0));

  if (adults + children < 1) {
    throw new DomainError('At least one guest required', 'invalid_input', 400);
  }

  const service = await db.service.findUnique({
    where: { id: input.serviceId },
    include: {
      category: { select: { isActive: true } },
      priceRules: { where: { isActive: true }, orderBy: { priority: 'asc' } },
    },
  });
  if (!service || !service.isActive || !service.category.isActive) {
    throw new ServiceInactiveError();
  }

  const rules: ServiceRules = service;

  // Normalise dates: parse, sort ascending, de-dupe.
  const uniqueIso = Array.from(new Set(input.dates)).sort();
  if (uniqueIso.length === 0) throw new PastDateError();
  const days = uniqueIso.map(parseDateOnly);

  if (days.length > 1) {
    if (!rules.allowMultiDay) {
      throw new DomainError('Multi-day not allowed', 'multi_day_not_allowed', 400);
    }
    if (rules.maxBookingDays != null && days.length > rules.maxBookingDays) {
      throw new DomainError('Too many days', 'too_many_days', 400);
    }
  }

  if (children > 0 && !rules.allowChildren) {
    throw new DomainError('Children not allowed', 'children_not_allowed', 400);
  }

  const behavior = behaviorFor(rules.kind);
  const totalPersons = adults + children;
  // Pure allocation (no DB) — computed up-front so the beach caps below can use
  // the umbrella count. Every channel (web, mobile, reception) funnels through
  // calcBooking, so these checks can't be bypassed by client tampering.
  // `extraPersons` rides through as a standalone paid add-on (gated by the
  // service's `allowExtraPeople`); it never changes the unit/umbrella count.
  const allocation = allocateUnits(rules, adults, children, extraPersons);

  // ── "Maximum children" ──
  if (behavior === 'BEACH_TICKET') {
    // Beach: the cap is PER UMBRELLA, so the whole-booking limit scales with the
    // umbrellas the ADULTS opened (e.g. 3/umbrella × 2 umbrellas = 6 children).
    // Children never count toward the adult/umbrella maths, so the umbrella count
    // here (`allocation.unitsPerDay`) is already adults-only.
    if (
      rules.maxChildrenPerBooking != null &&
      children > rules.maxChildrenPerBooking * allocation.unitsPerDay
    ) {
      throw new CapacityError('max_children');
    }
  } else if (behavior === 'CABANA_TICKET') {
    // Cabana: the cap is PER CABANA, so the whole-booking limit scales with the
    // cabanas the ADULTS opened (e.g. 2/cabana × 2 cabanas = 4 children) — the
    // same grouped-ticket rule as beach. Driven by ADULTS only (NOT
    // `allocation.unitsPerDay`, which children can inflate) so a party can never
    // enlarge its own child ceiling by adding children. See cabanaTicketCapacity.
    const { maxChildren } = cabanaTicketCapacity({
      adults,
      ticketCapacity: rules.includedPersonsPerUnit,
      maxChildrenPerCabana: rules.maxChildrenPerBooking,
    });
    if (maxChildren != null && children > maxChildren) {
      throw new CapacityError('max_children');
    }
  } else if (exceedsChildrenCap(rules, children)) {
    throw new CapacityError('max_children');
  }

  // ── "Maximum extra persons" (the paid add-on, PER UNIT) ──
  // Only meaningful when the service offers the add-on (allocation.extraPersons
  // is non-zero only for beach / cabana with `allowExtraPeople`). The ceiling
  // scales with the ADULTS-driven unit count, mirroring the children cap.
  if (allocation.extraPersons > 0) {
    const maxExtra = maxExtraPersonsFor({
      adults,
      ticketCapacity: rules.includedPersonsPerUnit,
      maxExtraPersonsPerUnit: rules.maxExtraPersonsPerUnit,
    });
    if (maxExtra != null && allocation.extraPersons > maxExtra) {
      throw new CapacityError('max_extra_persons');
    }
  }

  // ── Per-booking people cap (ADULTS only — children never count; see
  //    exceedsPeopleCap). A "12 people" service admits 12 adults + their kids. ──
  if (exceedsPeopleCap(rules, adults)) {
    throw new CapacityError('max_per_booking_people');
  }
  if (rules.maxCarsPerBooking != null && cars > rules.maxCarsPerBooking) {
    throw new CapacityError('max_per_booking_cars');
  }

  // ── Legacy regime (OTHER): delegate entirely to quote() (single day, adults-only). ──
  if (behavior === 'LEGACY') {
    if (days.length > 1) {
      throw new DomainError('Multi-day not allowed', 'multi_day_not_allowed', 400);
    }
    const q = await quote(
      { serviceId: service.id, date: days[0]!, people: adults, cars },
      db,
    );
    const legacyInsurance = buildInsuranceSnapshot(service, q.subtotalCents);
    return {
      serviceId: service.id,
      unitModel: false,
      unitsPerDay: 1,
      includedPersonsPerUnit: rules.includedPersonsPerUnit,
      includedPersons: adults,
      extraPersons: 0,
      includedChildren: 0,
      extraChildren: 0,
      adults,
      children,
      cars,
      dates: [q.date],
      days: 1,
      totalUnits: 1,
      perDay: [{ date: q.date, lines: q.lines, subtotalCents: q.subtotalCents }],
      lines: q.lines,
      currency: 'EGP',
      subtotalCents: q.subtotalCents,
      taxCents: q.taxCents,
      feeCents: q.feeCents,
      totalCents: q.totalCents,
      insuranceCents: legacyInsurance?.amountCents ?? 0,
      insuranceSnapshot: legacyInsurance,
    };
  }

  // ── Unit regime ──────────────────────────────────────────────────────────────
  // "Today" is the resort (Africa/Cairo) civil day so the past-date and
  // working-hours gates agree with the gate scanner's admissibility window.
  const now = new Date();
  const todayUtc = resortCivilDayUTC(now);
  const currentHM = resortHourMinute(now);

  // Effective people/unit cap. For a UNIT-based place-required service the ACTIVE
  // physical-place count is an ABSOLUTE ceiling: the daily counter holds UNITS for
  // these services, so a `dailyCapacityPeople` left blank OR set larger than the
  // real number of places would let the service oversell past its inventory.
  // Clamping to the place count (via effectiveDailyCap) closes that hole for every
  // channel that funnels through calcBooking (online quote/create + reception).
  // EVENT is EXCLUDED: its counter holds PEOPLE (not units), so the place count is
  // not its ceiling — clamping a >places people-cap would wrongly reject a valid
  // headcount booking. (EVENT + place assignment is a nonsensical but unforbidden
  // combo.) The extra count query runs only for unit-based place services under an
  // availability check, so the common path pays nothing.
  let effectivePeopleCap = service.dailyCapacityPeople;
  if (input.checkAvailability && rules.placeAssignmentRequired && service.kind !== 'EVENT') {
    const placeCount = await db.servicePlace.count({
      where: { serviceId: service.id, isActive: true },
    });
    effectivePeopleCap = effectiveDailyCap(service.dailyCapacityPeople, true, placeCount);
  }

  const perDay: PerDayCost[] = [];
  for (const day of days) {
    if (day.getTime() < todayUtc) throw new PastDateError();
    const isToday = day.getTime() === todayUtc;
    if (isToday && service.closeTime && currentHM > service.closeTime) {
      throw new WorkingHoursError();
    }

    // Availability — confirmed counters only (mirrors quote()). Reads are floored
    // at zero so a pre-existing NEGATIVE counter (from any historical release
    // underflow) can never shrink `used` and let the cap check pass spuriously.
    if (input.checkAvailability) {
      const slot = await db.bookingSlot.findUnique({
        where: { serviceId_date: { serviceId: service.id, date: day } },
      });
      const usedPeople = Math.max(0, slot?.reservedPeople ?? 0);
      const usedCars = Math.max(0, slot?.reservedCars ?? 0);
      const cost = unitCapacityCost(service.kind, allocation.unitsPerDay, totalPersons);
      if (effectivePeopleCap != null && usedPeople + cost > effectivePeopleCap) {
        throw new CapacityError('people');
      }
      if (service.dailyCapacityCars != null && usedCars + cars > service.dailyCapacityCars) {
        throw new CapacityError('cars');
      }
    }

    const lines = priceUnitDay(rules, service.priceRules, day, allocation, cars);
    const subtotalCents = lines.reduce((s, l) => s + l.totalCents, 0);
    perDay.push({ date: isoDay(day), lines, subtotalCents });
  }

  const lines = aggregateLines(perDay);
  const subtotalCents = perDay.reduce((s, d) => s + d.subtotalCents, 0);
  const insuranceSnapshot = buildInsuranceSnapshot(service, subtotalCents);

  return {
    serviceId: service.id,
    // Ticket regimes (CABANA / BEACH) expose a per-unit breakdown to the UI;
    // EVENT is per-person, so it reads as a head-count (non-unit) quote.
    unitModel: behavior !== 'EVENT_PER_PERSON',
    unitsPerDay: allocation.unitsPerDay,
    includedPersonsPerUnit: rules.includedPersonsPerUnit,
    includedPersons: allocation.includedPersons,
    extraPersons: allocation.extraPersons,
    includedChildren: allocation.includedChildren,
    extraChildren: allocation.extraChildren,
    adults,
    children,
    cars,
    dates: perDay.map((d) => d.date),
    days: days.length,
    totalUnits: allocation.unitsPerDay * days.length,
    perDay,
    lines,
    currency: 'EGP',
    subtotalCents,
    taxCents: 0,
    feeCents: 0,
    totalCents: subtotalCents,
    insuranceCents: insuranceSnapshot?.amountCents ?? 0,
    insuranceSnapshot,
  };
}

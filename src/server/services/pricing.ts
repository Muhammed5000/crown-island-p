import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { capacityCostFor } from './capacity-cost';
import {
  ServiceInactiveError,
  PastDateError,
  WorkingHoursError,
  CapacityError,
} from './errors';
import { resortCivilDayUTC, resortHourMinute } from '@/lib/date';

/**
 * Pricing — the *only* source of monetary truth.
 *
 * The client never sends a price. Every call to `quote()` recomputes the total
 * from `PriceRule` rows attached to the service, so a price drift between
 * "review" and "commit" is impossible: the commit re-runs the same function
 * inside the create-booking transaction and the result is what gets persisted.
 */

export type PriceLineKind =
  | 'BASE'
  | 'PER_PERSON'
  | 'EXTRA_CHILD'
  | 'PER_CAR'
  | 'FLAT'
  | 'WEEKEND_SURCHARGE'
  | 'DATE_OVERRIDE'
  | 'TAX'
  | 'FEE';

export interface PriceLine {
  kind: PriceLineKind;
  /** Translation key the UI can resolve, e.g. 'services.perPerson'. */
  labelKey: string;
  unitCents: number;
  quantity: number;
  totalCents: number;
}

export interface PriceQuote {
  serviceId: string;
  date: string; // ISO yyyy-mm-dd
  people: number;
  cars: number;
  currency: 'EGP';
  lines: PriceLine[];
  subtotalCents: number;
  taxCents: number;
  feeCents: number;
  totalCents: number;
}

interface QuoteInput {
  serviceId: string;
  date: Date;
  people: number;
  cars: number;
}

type TxOrClient = Prisma.TransactionClient | typeof prisma;

/**
 * Compute the price for a booking proposal.
 *
 * Accepts an optional `tx` so the same function can be reused inside the
 * create-booking transaction without opening a nested transaction.
 */
export async function quote(input: QuoteInput, db: TxOrClient = prisma): Promise<PriceQuote> {
  const { serviceId, date, people, cars } = input;

  const service = await db.service.findUnique({
    where: { id: serviceId },
    include: {
      category: { select: { isActive: true } },
      priceRules: { where: { isActive: true }, orderBy: { priority: 'asc' } },
    },
  });

  if (!service || !service.isActive || !service.category.isActive) {
    throw new ServiceInactiveError();
  }

  // Past-date check — server-side, never trust the client. "Today" is the resort
  // (Africa/Cairo) civil day so it agrees with the gate's admissibility window.
  const now = new Date();
  const todayUtc = resortCivilDayUTC(now);
  const dayOnly = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  if (dayOnly.getTime() < todayUtc) {
    throw new PastDateError();
  }

  // Operational hours check for same-day bookings
  const isSameDay = dayOnly.getTime() === todayUtc;
  if (isSameDay && service.closeTime) {
    const currentHM = resortHourMinute(now);
    // If it's currently later than the closing time, it's too late to book for today.
    if (currentHM > service.closeTime) {
      throw new WorkingHoursError();
    }
  }

  // Capacity check: confirmed slot counters only.
  // We no longer include PENDING_PAYMENT bookings (holds) in the used capacity.
  const slot = await db.bookingSlot.findUnique({
    where: { serviceId_date: { serviceId: service.id, date: dayOnly } },
  });

  // Floor at zero so a pre-existing negative counter can't shrink `used` and
  // let the cap check pass spuriously (mirrors booking-calc).
  const usedPeople = Math.max(0, slot?.reservedPeople ?? 0);
  const usedCars = Math.max(0, slot?.reservedCars ?? 0);
  const requiredPeople = capacityCostFor(service.kind, people);

  if (
    service.dailyCapacityPeople != null &&
    usedPeople + requiredPeople > service.dailyCapacityPeople
  ) {
    throw new CapacityError('people');
  }
  if (service.dailyCapacityCars != null && usedCars + cars > service.dailyCapacityCars) {
    throw new CapacityError('cars');
  }

  const lines: PriceLine[] = [];

  // `basePriceCents` is the single source of truth for the base ticket price; it
  // is added below unless a DATE_OVERRIDE (a deliberate dated exception) replaces
  // the day's base. FLAT rules are no longer honoured — they used to silently
  // override the admin-set base price.
  let baseOverridden = false;

  for (const rule of service.priceRules) {
    // Date-range filter (applies to DATE_OVERRIDE and WEEKEND_SURCHARGE when set).
    if (rule.startDate && dayOnly < rule.startDate) continue;
    if (rule.endDate && dayOnly > rule.endDate) continue;

    switch (rule.kind) {
      case 'PER_PERSON': {
        const extraPeople = people - 1;
        if (extraPeople > 0) {
          lines.push({
            kind: 'PER_PERSON',
            labelKey: 'services.extraPerson',
            unitCents: rule.amountCents,
            quantity: extraPeople,
            totalCents: rule.amountCents * extraPeople,
          });
        }
        break;
      }
      case 'PER_CAR': {
        if (cars > 0) {
          lines.push({
            kind: 'PER_CAR',
            labelKey: 'services.perCar',
            unitCents: rule.amountCents,
            quantity: cars,
            totalCents: rule.amountCents * cars,
          });
        }
        break;
      }
      case 'WEEKEND_SURCHARGE': {
        const dow = dayOnly.getUTCDay();
        if (rule.weekdayMask != null && (rule.weekdayMask & (1 << dow)) !== 0) {
          lines.push({
            kind: 'WEEKEND_SURCHARGE',
            labelKey: 'booking.fee',
            unitCents: rule.amountCents,
            quantity: 1,
            totalCents: rule.amountCents,
          });
        }
        break;
      }
      case 'DATE_OVERRIDE': {
        // DATE_OVERRIDE replaces the day's base price entirely — a deliberate
        // dated exception, and the ONLY rule allowed to override basePriceCents.
        lines.length = 0;
        lines.push({
          kind: 'DATE_OVERRIDE',
          labelKey: 'services.flat',
          unitCents: rule.amountCents,
          quantity: 1,
          totalCents: rule.amountCents,
        });
        baseOverridden = true;
        break;
      }
    }
  }

  // basePriceCents is the base ticket price (covers the first person) unless a
  // DATE_OVERRIDE replaced it above; PER_PERSON rules cover additional people.
  if (!baseOverridden && service.basePriceCents > 0) {
    lines.unshift({
      kind: 'BASE',
      labelKey: 'services.baseTicket',
      unitCents: service.basePriceCents,
      quantity: 1,
      totalCents: service.basePriceCents,
    });
  }

  const subtotalCents = lines.reduce((s, l) => s + l.totalCents, 0);
  const taxCents = 0;
  const feeCents = 0;
  const totalCents = subtotalCents + taxCents + feeCents;

  return {
    serviceId,
    date: dayOnly.toISOString().slice(0, 10),
    people,
    cars,
    currency: 'EGP',
    lines,
    subtotalCents,
    taxCents,
    feeCents,
    totalCents,
  };
}

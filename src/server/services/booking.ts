import 'server-only';
import { prisma } from '@/server/db/prisma';
import { generateBookingReference } from '@/lib/reference';
import { parseIsoDateUTC } from '@/lib/date';
import { assertBookingWritesEnabled, getSettings } from '@/server/settings/settings';
import { calcBooking, type BookingCalcResult } from './booking-calc';
import { ensureVisitForBooking } from './visit-code';
import { claimSanctionsForBooking, getPayableSanctionsForUser } from './sanctions';
import {
  LeadTimeError,
  PastDateError,
  PriceChangedError,
} from './errors';
import { assembleFinalTotalCents } from './insurance-core';

/**
 * Booking service — owns the transactional create-booking workflow.
 *
 * Invariants enforced here (see docs/booking-flow.md):
 *   - No double charge: `UNIQUE(userId, clientRequestId)` collapses retries.
 *   - No double booking: capacity is recomputed inside the transaction by
 *     `calcBooking({ checkAvailability: true })` and compared against
 *     `BookingSlot.reservedX` for every day of the booking.
 *   - No price drift: `calcBooking()` runs inside the same transaction; if the
 *     caller supplied an `expectedTotalCents` and it differs, we throw
 *     `PriceChangedError` and the user is sent back to review.
 *   - Per-unit model: the booking is split into `BookingUnit` rows (units/day ×
 *     days). Place assignment is left to reception/gate (Phase 3); the booking
 *     is created with `placementStatus = PENDING` when the service requires it.
 */

export interface CreateBookingInput {
  userId: string;
  serviceId: string;
  /** First day (yyyy-mm-dd) in the user's timezone. */
  date: string;
  /** Last day (yyyy-mm-dd, inclusive) for a multi-day booking. */
  endDate?: string;
  /** Adult / primary persons. */
  adults: number;
  /** Children (age ≤ service.maxChildAge). */
  children?: number;
  /** Optional paid "Extra Person" add-ons (see `Service.allowExtraPeople`).
   * Billed separately; never opens units or counts toward capacity. */
  extraPersons?: number;
  cars: number;
  /** Per-request idempotency key supplied by the client. */
  clientRequestId: string;
  locale: 'ar' | 'en';
  /**
   * Total the user was last shown. If provided, mismatched re-quotes throw
   * `PriceChangedError` so the UI can re-render the review screen instead of
   * silently charging the new amount.
   */
  expectedTotalCents?: number;
}

export interface CreateBookingResult {
  bookingId: string;
  reference: string;
  invoiceId: string;
  paymentId: string;
  calc: Pick<BookingCalcResult, 'totalCents' | 'unitsPerDay' | 'totalUnits' | 'dates'>;
}

function parseDateOnly(iso: string): Date {
  const d = parseIsoDateUTC(iso);
  if (!d) throw new PastDateError();
  return d;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Expand an inclusive [start, end] range into a list of yyyy-mm-dd days. */
export function expandDateRange(startIso: string, endIso?: string | null): string[] {
  const start = parseDateOnly(startIso);
  if (!endIso || endIso === startIso) return [isoDay(start)];
  const end = parseDateOnly(endIso);
  if (end.getTime() < start.getTime()) throw new PastDateError();
  const days: string[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    days.push(isoDay(new Date(t)));
    if (days.length > 60) throw new PastDateError(); // safety cap
  }
  return days;
}

/** Distribute `total` as evenly as possible across `parts` buckets. */
function distribute(total: number, parts: number): number[] {
  const out = new Array(parts).fill(0) as number[];
  for (let i = 0; i < total; i++) out[i % parts]! += 1;
  return out;
}

export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  await assertBookingWritesEnabled();
  const settings = await getSettings();

  const dates = expandDateRange(input.date, input.endDate);
  const firstDay = parseDateOnly(dates[0]!);
  const lastDay = parseDateOnly(dates[dates.length - 1]!);

  // Lead-time gate — measured against the FIRST day of the booking.
  if (settings.bookingLeadTimeHours > 0) {
    const requiredMs = settings.bookingLeadTimeHours * 60 * 60 * 1000;
    const gapMs = firstDay.getTime() - Date.now();
    if (gapMs < requiredMs) {
      throw new LeadTimeError(settings.bookingLeadTimeHours);
    }
  }

  const adults = Math.max(1, Math.trunc(input.adults));
  const children = Math.max(0, Math.trunc(input.children ?? 0));
  const extraPersons = Math.max(0, Math.trunc(input.extraPersons ?? 0));
  const cars = Math.max(0, Math.trunc(input.cars));

  return prisma.$transaction(
    async (tx) => {
      // ── 1. Idempotency: a retried (userId, clientRequestId) returns the row. ──
      const existing = await tx.booking.findUnique({
        where: {
          userId_clientRequestId: {
            userId: input.userId,
            clientRequestId: input.clientRequestId,
          },
        },
        include: { invoice: true, payments: true },
      });
      if (existing && existing.invoice && existing.payments[0]) {
        return {
          bookingId: existing.id,
          reference: existing.reference,
          invoiceId: existing.invoice.id,
          paymentId: existing.payments[0].id,
          calc: {
            totalCents: existing.invoice.totalCents,
            unitsPerDay: existing.unitsPerDay,
            totalUnits: existing.unitsPerDay * dates.length,
            dates,
          },
        };
      }

      // ── 2. Authoritative calculation + capacity check (inside the tx). ──
      const calc = await calcBooking(
        {
          serviceId: input.serviceId,
          adults,
          children,
          extraPersons,
          cars,
          dates,
          checkAvailability: true,
        },
        tx,
      );

      // ── 2b. Outstanding penalties ride on this booking's invoice. Read them
      // inside the tx; they're claimed (reserved) right after the booking row
      // exists — the conditional claim re-verifies and rolls everything back
      // if a concurrent booking/settlement took any of them in between.
      const penalties = await getPayableSanctionsForUser(input.userId, tx);
      // Grand total = discounted service (no online discounts today) + penalties
      // + FULL insurance deposit. Single assembly point — the deposit can never
      // be discounted because it never enters any discountable figure.
      const grandTotalCents = assembleFinalTotalCents({
        serviceTotalCents: calc.totalCents,
        discountCents: 0,
        penaltiesCents: penalties.totalCents,
        insuranceCents: calc.insuranceCents,
      });

      if (
        typeof input.expectedTotalCents === 'number' &&
        input.expectedTotalCents !== grandTotalCents
      ) {
        throw new PriceChangedError(input.expectedTotalCents, grandTotalCents);
      }

      const service = await tx.service.findUniqueOrThrow({
        where: { id: input.serviceId },
        select: { placeAssignmentRequired: true },
      });

      // ── 3. Persist Booking + Invoice + InvoiceLines + BookingUnits + Payment. ──
      const reference = generateBookingReference();
      const totalPeople = adults + children;
      const booking = await tx.booking.create({
        data: {
          reference,
          userId: input.userId,
          serviceId: input.serviceId,
          bookingDate: firstDay,
          endDate: dates.length > 1 ? lastDay : null,
          people: totalPeople,
          adults,
          children,
          // Authoritative add-on count from the engine (0 unless the service
          // enables the add-on and uses a grouped-ticket regime). Stored
          // separately — never folded into `people` / units / capacity.
          extraPersons: calc.extraPersons,
          unitsPerDay: calc.unitsPerDay,
          cars,
          // Handicap count was removed from the booking flow; legacy column is
          // kept for backward compatibility and always persisted as 0.
          handicapPeople: 0,
          clientRequestId: input.clientRequestId,
          locale: input.locale,
          status: 'PENDING_PAYMENT',
          placementStatus: service.placeAssignmentRequired ? 'PENDING' : 'NOT_REQUIRED',
        },
      });

      // Link the booking to the customer's DAILY VISIT GROUP (one root code per
      // user per day) — every QR is generated from the group, so all of the
      // day's bookings share one scannable pass. Created even while
      // PENDING_PAYMENT; the gate's per-booking verdict still refuses unpaid.
      await ensureVisitForBooking(tx, booking.id);

      // Reserve the penalties for THIS booking (conditional, count-checked).
      await claimSanctionsForBooking(tx, penalties.sanctions, booking.id);

      // Sanctions mirror the reception-discount convention: the booking-only
      // figure stays in `subtotalCents`, each penalty is its own line, and the
      // grand total carries them (lines sum == totalCents).
      const invoice = await tx.invoice.create({
        data: {
          bookingId: booking.id,
          status: 'ISSUED',
          currency: 'EGP',
          subtotalCents: calc.subtotalCents,
          taxCents: calc.taxCents,
          feeCents: calc.feeCents,
          totalCents: grandTotalCents,
          issuedAt: new Date(),
          lines: {
            create: [
              ...calc.lines.map((l) => ({
                label: l.labelKey,
                quantity: l.quantity,
                unitCents: l.unitCents,
                totalCents: l.totalCents,
                meta: { kind: l.kind },
              })),
              ...penalties.sanctions.map((s) => ({
                label: 'services.sanction',
                quantity: 1,
                unitCents: s.amountCents,
                totalCents: s.amountCents,
                meta: { kind: 'SANCTION', sanctionId: s.id, reason: s.reason },
              })),
              // Insurance deposit line (docs/INSURANCE.md) — same convention as
              // SANCTION: outside `subtotalCents`, rides the grand total.
              ...(calc.insuranceSnapshot
                ? [
                    {
                      label: 'services.insurance',
                      quantity: 1,
                      unitCents: calc.insuranceSnapshot.amountCents,
                      totalCents: calc.insuranceSnapshot.amountCents,
                      meta: { kind: 'INSURANCE' },
                    },
                  ]
                : []),
            ],
          },
        },
      });

      // Frozen insurance snapshot — collection stays PENDING until the payment
      // provider confirms capture (handleSucceeded flips it COLLECTED).
      if (calc.insuranceSnapshot) {
        await tx.bookingInsurance.create({
          data: {
            bookingId: booking.id,
            type: calc.insuranceSnapshot.type,
            percent: calc.insuranceSnapshot.percent,
            fixedCents: calc.insuranceSnapshot.fixedCents,
            baseCents: calc.insuranceSnapshot.baseCents,
            amountCents: calc.insuranceSnapshot.amountCents,
            collectionStatus: 'PENDING',
          },
        });
      }

      // One BookingUnit per physical unit per day; party split evenly across units.
      const adultsByUnit = distribute(adults, calc.unitsPerDay);
      const childrenByUnit = distribute(children, calc.unitsPerDay);
      const unitRows = dates.flatMap((iso) => {
        const day = parseDateOnly(iso);
        return Array.from({ length: calc.unitsPerDay }, (_, idx) => ({
          bookingId: booking.id,
          date: day,
          unitIndex: idx,
          adults: adultsByUnit[idx] ?? 0,
          children: childrenByUnit[idx] ?? 0,
        }));
      });
      if (unitRows.length) {
        await tx.bookingUnit.createMany({ data: unitRows });
      }

      const payment = await tx.payment.create({
        data: {
          bookingId: booking.id,
          provider: 'CREDIT_AGRICOLE',
          status: 'PENDING',
          amountCents: grandTotalCents,
          currency: 'EGP',
        },
      });

      return {
        bookingId: booking.id,
        reference: booking.reference,
        invoiceId: invoice.id,
        paymentId: payment.id,
        calc: {
          totalCents: grandTotalCents,
          unitsPerDay: calc.unitsPerDay,
          totalUnits: calc.totalUnits,
          dates,
        },
      };
    },
    { maxWait: 5_000, timeout: 15_000 },
  );
}

/**
 * Read a booking — ownership-checked. Admin reads should go through a different path.
 */
export async function getBookingForUser(bookingId: string, userId: string) {
  return prisma.booking.findFirst({
    where: { id: bookingId, userId },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true } },
      service: { include: { category: true } },
      invoice: { include: { lines: true } },
      payments: { orderBy: { createdAt: 'desc' } },
      units: { include: { place: true }, orderBy: [{ date: 'asc' }, { unitIndex: 'asc' }] },
      // Customer-facing deposit visibility (read-only; docs/INSURANCE.md §10).
      insurance: { include: { refunds: { orderBy: { createdAt: 'asc' } } } },
    },
  });
}

'use server';

import { z } from 'zod';
import { headers } from 'next/headers';
import { requireUser, getSessionUser } from '@/server/auth/guards';
import { calcBooking } from '@/server/services/booking-calc';
import { createBooking, expandDateRange } from '@/server/services/booking';
import { getPayableSanctionsForUser } from '@/server/services/sanctions';
import { DomainError } from '@/server/services/errors';
import { prisma } from '@/server/db/prisma';
import { hasAcceptedCurrentTerms } from '@/server/auth/terms';
import { hasAcceptedCurrentRefundPolicy } from '@/server/auth/refund-policy';

/**
 * Server actions exposed to the booking wizard.
 *
 * Every action does its own server-side authentication + Zod validation +
 * service-layer call. Domain errors are converted to discriminated-union return
 * values so the client can render translated messages without sniffing strings.
 *
 * All pricing flows through the booking calculation engine (`calcBooking`):
 * legacy head-count services are byte-for-byte unchanged, per-unit services get
 * the units/extra-people/children/multi-day breakdown.
 */

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

/** Resolve a request into the [adults, children, dates] the engine consumes. */
const calcInputSchema = z.object({
  serviceId: z.string().min(1),
  date: z.string().regex(dateRe),
  /** Optional last day (inclusive) for multi-day services. */
  endDate: z.string().regex(dateRe).optional(),
  /** New-style adult count. Falls back to `people` for legacy callers. */
  adults: z.number().int().min(1).max(200).optional(),
  /** Legacy alias — total persons treated as adults. */
  people: z.number().int().min(1).max(200).optional(),
  children: z.number().int().min(0).max(200).optional().default(0),
  /** Optional paid "Extra Person" add-ons — separate from adults. */
  extraPersons: z.number().int().min(0).max(200).optional().default(0),
  cars: z.number().int().min(0).max(100).optional().default(0),
});

export interface QuoteLine {
  kind: string;
  labelKey: string;
  unitCents: number;
  quantity: number;
  totalCents: number;
}

export type QuoteResult =
  | {
      ok: true;
      totalCents: number;
      subtotalCents: number;
      taxCents: number;
      feeCents: number;
      lines: QuoteLine[];
      currency: 'EGP';
      // Per-unit breakdown (also present for legacy services, where unitsPerDay=1).
      unitModel: boolean;
      unitsPerDay: number;
      totalUnits: number;
      includedPersonsPerUnit: number;
      includedPersons: number;
      extraPersons: number;
      includedChildren: number;
      extraChildren: number;
      days: number;
      dates: string[];
      /**
       * Outstanding penalty total (piastres) for the signed-in user; 0 when none
       * or for a guest. createBooking adds penalties to the grand total and
       * rejects a mismatch, so callers MUST include this in `expectedTotalCents`
       * or a penalized user is permanently blocked with `price_changed`.
       */
      pendingPenaltyCents: number;
      /**
       * Refundable insurance deposit (piastres); 0 when the service has none.
       * SAME contract as `pendingPenaltyCents`: createBooking adds it to the
       * grand total and rejects a mismatch, so every caller MUST include it in
       * `expectedTotalCents` — grand = totalCents + pendingPenaltyCents +
       * insuranceCents (docs/INSURANCE.md). Displayed as its own line; it is
       * never part of `totalCents`/`subtotalCents` and can never be discounted.
       */
      insuranceCents: number;
    }
  | { ok: false; code: string };

function resolveCalcArgs(data: z.infer<typeof calcInputSchema>) {
  const adults = data.adults ?? data.people ?? 1;
  const dates = expandDateRange(data.date, data.endDate);
  return {
    serviceId: data.serviceId,
    adults,
    children: data.children,
    extraPersons: data.extraPersons,
    cars: data.cars,
    dates,
  };
}

/**
 * Full unit-aware quote — drives the customer booking page's live preview.
 * Checks availability so capacity problems surface before review.
 */
export async function calcQuote(input: unknown): Promise<QuoteResult> {
  const parsed = calcInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  try {
    const c = await calcBooking({ ...resolveCalcArgs(parsed.data), checkAvailability: true });
    // Outstanding penalties are added to the price the user must pay and enforced
    // server-side in createBooking; surface them so the wizard's expectedTotalCents
    // equals the server's grand total (else penalized users get price_changed forever).
    let pendingPenaltyCents = 0;
    const user = await getSessionUser();
    if (user) {
      pendingPenaltyCents = (await getPayableSanctionsForUser(user.id)).totalCents;
    }
    return {
      ok: true,
      totalCents: c.totalCents,
      subtotalCents: c.subtotalCents,
      taxCents: c.taxCents,
      feeCents: c.feeCents,
      lines: c.lines.map((l) => ({
        kind: l.kind,
        labelKey: l.labelKey,
        unitCents: l.unitCents,
        quantity: l.quantity,
        totalCents: l.totalCents,
      })),
      currency: c.currency,
      unitModel: c.unitModel,
      unitsPerDay: c.unitsPerDay,
      totalUnits: c.totalUnits,
      includedPersonsPerUnit: c.includedPersonsPerUnit,
      includedPersons: c.includedPersons,
      extraPersons: c.extraPersons,
      includedChildren: c.includedChildren,
      extraChildren: c.extraChildren,
      days: c.days,
      dates: c.dates,
      pendingPenaltyCents,
      insuranceCents: c.insuranceCents,
    };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

/** Backward-compatible alias retained for existing callers. */
export const quotePrice = calcQuote;

const createSchema = z.object({
  serviceId: z.string().min(1),
  date: z.string().regex(dateRe),
  endDate: z.string().regex(dateRe).optional(),
  adults: z.number().int().min(1).max(200).optional(),
  people: z.number().int().min(1).max(200).optional(),
  children: z.number().int().min(0).max(200).optional().default(0),
  extraPersons: z.number().int().min(0).max(200).optional().default(0),
  cars: z.number().int().min(0).max(100),
  clientRequestId: z.string().min(8).max(64),
  expectedTotalCents: z.number().int().nonnegative().optional(),
  locale: z.enum(['ar', 'en']).default('ar'),
});

export type CreateResult =
  | { ok: true; bookingId: string; reference: string }
  | { ok: false; code: string; expectedCents?: number; actualCents?: number };

export async function commitBooking(input: unknown): Promise<CreateResult> {
  const user = await requireUser();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  // Touch headers() so this action can never be cached as static.
  await headers();

  // Re-enforce the same gates the (app) layout applies — a direct server-action
  // call (bypassing the layout redirect) must not create a booking without
  // accepting the current terms + refund policy and completing the identity
  // profile. (Capacity / price / ownership are already enforced in createBooking.)
  const [termsOk, refundOk, profile] = await Promise.all([
    hasAcceptedCurrentTerms(),
    hasAcceptedCurrentRefundPolicy(),
    prisma.customerProfile.findUnique({
      where: { userId: user.id },
      select: { region: true, nationalId: true, passportId: true },
    }),
  ]);
  if (!termsOk) return { ok: false, code: 'terms_required' };
  if (!refundOk) return { ok: false, code: 'refund_required' };
  if (!profile?.region || !(profile.nationalId || profile.passportId)) {
    return { ok: false, code: 'profile_incomplete' };
  }

  const adults = parsed.data.adults ?? parsed.data.people ?? 1;

  try {
    const result = await createBooking({
      userId: user.id,
      serviceId: parsed.data.serviceId,
      date: parsed.data.date,
      endDate: parsed.data.endDate,
      adults,
      children: parsed.data.children,
      extraPersons: parsed.data.extraPersons,
      cars: parsed.data.cars,
      clientRequestId: parsed.data.clientRequestId,
      locale: parsed.data.locale,
      expectedTotalCents: parsed.data.expectedTotalCents,
    });
    return { ok: true, bookingId: result.bookingId, reference: result.reference };
  } catch (err) {
    if (err instanceof DomainError) {
      const extra: { expectedCents?: number; actualCents?: number } = {};
      if ('expectedCents' in err && 'actualCents' in err) {
        extra.expectedCents = (err as { expectedCents: number }).expectedCents;
        extra.actualCents = (err as { actualCents: number }).actualCents;
      }
      return { ok: false, code: err.code, ...extra };
    }
    return { ok: false, code: 'unknown' };
  }
}

/**
 * Read-side helper used by the review screen so the client doesn't have to
 * pass selections through the URL when the user lands from history etc.
 */
export async function getInvoicePreview(bookingId: string) {
  const user = await requireUser();
  return prisma.invoice.findFirst({
    where: { booking: { id: bookingId, userId: user.id } },
    include: { lines: true, booking: { include: { service: { include: { category: true } } } } },
  });
}

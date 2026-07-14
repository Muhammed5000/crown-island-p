'use server';

import { z } from 'zod';
import { getSessionUser } from '@/server/auth/guards';
import { canAccessReception } from '@/server/auth/roles';
import { isStoredMediaUrl } from '@/lib/upload-paths';
import { searchTodayBookings, listTodayBookings, type ReceptionSearchRow } from '@/server/services/reception';
import { commitReceptionBooking } from '@/server/services/reception-commit';
import { isLocal, onlineApiUrl, SYNC_SECRET_HEADER, syncScopeSecret, SYNC_TRANSFER_TIMEOUT_MS } from '@/server/sync/config';
import { pullAll } from '@/server/sync/pull';
import { getPayableSanctionsByPhone, listSanctionedGuests, type SanctionedGuest } from '@/server/services/sanctions';
import {
  getServiceCapacitySnapshot,
  getReceptionStatusOverview,
  type CapacitySnapshot,
  type ReceptionStatusOverview,
} from '@/server/services/capacity-view';
import {
  searchCustomersForReception,
  getCustomerProfileForReception,
  getReceptionPrefill,
  type CustomerCandidate,
  type CustomerProfile,
  type ReceptionPrefill,
} from '@/server/services/customer-360';
import { prisma } from '@/server/db/prisma';
import { authorizeByPin } from '@/server/services/staff-discount';
import { consumeAttempt } from '@/server/auth/rate-limit';
import { assertPromoUsable, normalizeCode, promoRedemptionKey } from '@/server/services/promo';
import { DomainError } from '@/server/services/errors';
import { isValidPhoneNumber, parsePhoneNumber, type CountryCode } from 'libphonenumber-js';

/**
 * Reception desk server actions. Every action re-checks that the caller is a
 * reception-authorised staff member (STAFF / admin tiers, never SECURITY) on
 * the server — the UI gating is convenience only.
 */

const schema = z.object({
  serviceId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  people: z.number().int().min(1).max(200),
  adults: z.number().int().min(1).max(200).optional(),
  children: z.number().int().min(0).max(200).optional().default(0),
  extraPersons: z.number().int().min(0).max(200).optional().default(0),
  cars: z.number().int().min(0).max(100),
  guestName: z.string().trim().min(2).max(120),
  guestPhone: z.string().trim().min(4).max(30),
  countryCode: z.string().min(2).max(3).default('EG'),
  paymentMethod: z.enum(['CASH', 'INSTAPAY']),
  proofUrl: z
    .string()
    .trim()
    .max(2000)
    .refine(isStoredMediaUrl, { message: 'invalid_image_url' })
    .optional()
    .nullable(),
  promoCode: z.string().trim().max(40).optional().nullable(),
  manualDiscount: z
    .object({
      pin: z.string().trim().regex(/^\d{4,8}$/),
      percent: z.number().int().min(1).max(100),
    })
    .optional()
    .nullable(),
  locale: z.enum(['ar', 'en']).default('ar'),
  /** Per-attempt idempotency key (reused on retry) — see createReceptionBooking. */
  clientRequestId: z.string().min(8).max(64),
  guestIds: z
    .array(
      z.object({
        guestSeq: z.number().int().min(1).max(200),
        imageUrl: z.string().trim().min(1).max(2000).refine(isStoredMediaUrl, {
          message: 'invalid_image_url',
        }),
        fileName: z.string().trim().min(1).max(255),
        guestName: z.string().trim().max(80).optional().nullable(),
        // Returning-guest reuse handle — ownership is verified server-side
        // against the booking's guest phone (see createReceptionBooking).
        sourceDocumentId: z.string().trim().min(1).max(64).optional().nullable(),
      }),
    )
    .max(200)
    .optional(),
  placements: z
    .array(z.object({ unitIndex: z.number().int().min(0).max(200), placeId: z.string().min(1) }))
    .max(200)
    .optional(),
}).refine((data) => {
  try {
    return isValidPhoneNumber(data.guestPhone, data.countryCode as CountryCode);
  } catch {
    return false;
  }
}, {
  message: 'invalid_phone',
  path: ['guestPhone'],
});

export type ReceptionBookingResult =
  | {
      ok: true;
      bookingId: string;
      reference: string;
      totalCents: number;
      /**
       * Inline SVG of the booking's DAILY VISIT QR (the per-customer-per-day
       * root pass) — shown on the desk's success "entry pass" ticket. Null if
       * rendering failed (the success screen degrades gracefully).
       */
      qrSvg: string | null;
    }
  | { ok: false; code: string };

export async function createReceptionBookingAction(
  input: unknown,
): Promise<ReceptionBookingResult> {
  const user = await getSessionUser();
  if (!user || !canAccessReception(user.role)) {
    return { ok: false, code: 'forbidden' };
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  // InstaPay proof is required.
  if (parsed.data.paymentMethod === 'INSTAPAY' && !parsed.data.proofUrl) {
    return { ok: false, code: 'invalid_input' };
  }
  const proofUrl =
    parsed.data.paymentMethod === 'INSTAPAY' ? parsed.data.proofUrl : null;

  let formattedPhone = parsed.data.guestPhone;
  try {
    formattedPhone = parsePhoneNumber(parsed.data.guestPhone, parsed.data.countryCode as CountryCode).format('E.164');
  } catch {
    // Fallback if parsing fails for some reason
    formattedPhone = `+${parsed.data.countryCode} ${parsed.data.guestPhone}`;
  }

  // ── H4: throttle the supervisor discount PIN on the COMMIT path too ─────────
  // The PIN is validated again inside createReceptionBooking → resolveManualDiscount,
  // but only the preview action (authorizeDiscountAction) was rate-limited — leaving
  // this path open to unlimited guesses of a low-entropy 4–8 digit PIN that end in a
  // up-to-100%-discount booking. Share the SAME per-desk-user counter as the preview
  // so every attempt (preview or commit) contributes to one backoff. Cleared on a
  // committed booking (a valid PIN) below.
  const discountRlKey = parsed.data.manualDiscount ? `discount-pin:${user.id}` : null;
  if (discountRlKey && !(await consumeAttempt(discountRlKey)).ok) {
    return { ok: false, code: 'rate_limited' };
  }

  const commitInput = {
    staffId: user.id,
    clientRequestId: parsed.data.clientRequestId,
    serviceId: parsed.data.serviceId,
    date: parsed.data.date,
    endDate: parsed.data.endDate,
    people: parsed.data.people,
    adults: parsed.data.adults ?? parsed.data.people,
    children: parsed.data.children,
    extraPersons: parsed.data.extraPersons,
    cars: parsed.data.cars,
    locale: parsed.data.locale,
    guestName: parsed.data.guestName,
    guestPhone: formattedPhone,
    paymentMethod: parsed.data.paymentMethod,
    proofUrl,
    promoCode: parsed.data.promoCode,
    manualDiscount: parsed.data.manualDiscount,
    guestIds: parsed.data.guestIds,
    placements: parsed.data.placements,
  };

  // Correct PIN (the booking committed) — reset the shared discount-PIN counter.
  const clearDiscountRl = async () => {
    if (discountRlKey) {
      await prisma.authRateLimit.delete({ where: { key: discountRlKey } }).catch(() => {});
    }
  };

  try {
    // ── OFFLINE-SYNC: online is the SOLE writer of bookings + capacity ──────────
    // On the LOCAL venue node we PROXY the commit to online instead of writing it
    // here — otherwise the reception booking is stranded on local forever (Booking
    // is not a pushable entity, so it never reaches online). The desk already
    // blocks new bookings while offline (assertBookingWritesEnabled); a transport
    // failure here surfaces the same `offline` code. On a single / online
    // deployment we commit directly, exactly as before.
    if (isLocal()) {
      const base = onlineApiUrl();
      if (!base) return { ok: false, code: 'sync_misconfig' };
      let resp: Response;
      try {
        resp = await fetch(`${base}/api/sync/reception-booking`, {
          signal: AbortSignal.timeout(SYNC_TRANSFER_TIMEOUT_MS), // SYNC-002
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [SYNC_SECRET_HEADER]: syncScopeSecret('write') ?? '',
          },
          body: JSON.stringify(commitInput),
        });
      } catch {
        // A genuine transport failure — the venue really can't reach online.
        return { ok: false, code: 'offline' };
      }
      const body = (await resp.json().catch(() => null)) as ReceptionBookingResult | null;
      // A 2xx (incl. a DomainError returned as 200 {ok:false,code}) is authoritative.
      if (resp.ok && body) {
        if (body.ok) {
          await clearDiscountRl();
          // Materialize the just-created booking + its guest-IDs on the local node
          // NOW, so the desk's immediate inline admit (a LOCAL check-in) can find
          // them instead of racing the ~20s worker pull. Best-effort: a pull failure
          // just falls back to the existing "enter at the gate" path.
          await pullAll().catch(() => {});
        }
        return body;
      }
      // Non-2xx — DON'T disguise a deployment/config problem as "offline".
      if (resp.status === 404) return { ok: false, code: 'sync_not_deployed' };
      if (resp.status === 401) return { ok: false, code: 'sync_auth' };
      if (resp.status === 409) return { ok: false, code: 'sync_misconfig' };
      return { ok: false, code: 'unknown' };
    }

    const res = await commitReceptionBooking(commitInput);
    await clearDiscountRl();
    return { ok: true, ...res };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

// ── Reception quick-view tools (read-only) ──────────────────────────────────--

const sanctionedGuestsSchema = z.object({ search: z.string().trim().max(60).optional() });

export type SanctionedGuestsResult =
  | { ok: true; guests: SanctionedGuest[] }
  | { ok: false; code: string };

/**
 * Desk "Sanctions" quick-view: every customer who currently owes an ACTIVE
 * sanction, searchable by name / phone / email. Reception-gated, read-only, and
 * desk-safe (no admin notes). An invalid payload falls back to the full list.
 */
export async function listSanctionedGuestsAction(input: unknown): Promise<SanctionedGuestsResult> {
  const user = await getSessionUser();
  if (!user || !canAccessReception(user.role)) {
    return { ok: false, code: 'forbidden' };
  }
  const parsed = sanctionedGuestsSchema.safeParse(input);
  const search = parsed.success ? parsed.data.search : undefined;
  try {
    const guests = await listSanctionedGuests(search);
    return { ok: true, guests };
  } catch {
    return { ok: false, code: 'unknown' };
  }
}

const capacitySnapshotSchema = z.object({
  serviceId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  locale: z.enum(['ar', 'en']).default('ar'),
});

export type CapacitySnapshotResult =
  | { ok: true; snapshot: CapacitySnapshot }
  | { ok: false; code: string };

/**
 * Desk "Capacity" quick-view: the same per-day occupancy picture as the admin
 * Capacity Preview page, for any service + day. Reception-gated, read-only.
 */
export async function getCapacitySnapshotAction(input: unknown): Promise<CapacitySnapshotResult> {
  const user = await getSessionUser();
  if (!user || !canAccessReception(user.role)) {
    return { ok: false, code: 'forbidden' };
  }
  const parsed = capacitySnapshotSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };
  try {
    const snapshot = await getServiceCapacitySnapshot(
      parsed.data.serviceId,
      parsed.data.date,
      parsed.data.locale,
    );
    if (!snapshot) return { ok: false, code: 'not_found' };
    return { ok: true, snapshot };
  } catch {
    return { ok: false, code: 'unknown' };
  }
}

const statusSchema = z.object({ locale: z.enum(['ar', 'en']).default('ar') });

export type ReceptionStatusResult =
  | { ok: true; status: ReceptionStatusOverview }
  | { ok: false; code: string };

/**
 * Live desk status bar: per-service occupancy, sold-out count, guests still
 * waiting to enter, and places offline. Reception-gated, read-only, polled.
 */
export async function getReceptionStatusAction(input: unknown): Promise<ReceptionStatusResult> {
  const user = await getSessionUser();
  if (!user || !canAccessReception(user.role)) {
    return { ok: false, code: 'forbidden' };
  }
  const parsed = statusSchema.safeParse(input);
  const locale = parsed.success ? parsed.data.locale : 'ar';
  try {
    const status = await getReceptionStatusOverview(locale);
    return { ok: true, status };
  } catch {
    return { ok: false, code: 'unknown' };
  }
}

const customerSearchSchema = z.object({ query: z.string().trim().max(60) });

export type CustomerSearchResult =
  | { ok: true; candidates: CustomerCandidate[] }
  | { ok: false; code: string };

/**
 * Desk "Customer" quick-view step 1: candidates matching a name / phone /
 * email / national-id. Reception-gated, read-only. A too-short query returns an
 * empty (not failed) result so the UI stays quiet until something is typed.
 */
export async function searchCustomersAction(input: unknown): Promise<CustomerSearchResult> {
  const user = await getSessionUser();
  if (!user || !canAccessReception(user.role)) {
    return { ok: false, code: 'forbidden' };
  }
  const parsed = customerSearchSchema.safeParse(input);
  if (!parsed.success) return { ok: true, candidates: [] };
  try {
    const candidates = await searchCustomersForReception(parsed.data.query);
    return { ok: true, candidates };
  } catch {
    return { ok: false, code: 'unknown' };
  }
}

const customerProfileSchema = z
  .object({
    userId: z.string().min(1).optional().nullable(),
    phone: z.string().trim().min(1).max(40).optional().nullable(),
    locale: z.enum(['ar', 'en']).default('ar'),
  })
  .refine((d) => !!d.userId || !!d.phone, { message: 'identifier_required' });

export type CustomerProfileResult =
  | { ok: true; profile: CustomerProfile }
  | { ok: false; code: string };

/**
 * Desk "Customer" quick-view step 2: the full 360 for a chosen account or
 * walk-in phone — identity, outstanding sanctions, and booking history.
 */
export async function getCustomerProfileAction(input: unknown): Promise<CustomerProfileResult> {
  const user = await getSessionUser();
  if (!user || !canAccessReception(user.role)) {
    return { ok: false, code: 'forbidden' };
  }
  const parsed = customerProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };
  try {
    const profile = await getCustomerProfileForReception(
      { userId: parsed.data.userId ?? null, phone: parsed.data.phone ?? null },
      parsed.data.locale,
    );
    if (!profile) return { ok: false, code: 'not_found' };
    return { ok: true, profile };
  } catch {
    return { ok: false, code: 'unknown' };
  }
}

const prefillSchema = z
  .object({
    userId: z.string().min(1).optional().nullable(),
    phone: z.string().trim().min(1).max(40).optional().nullable(),
  })
  .refine((d) => !!d.userId || !!d.phone, { message: 'identifier_required' });

export type ReceptionPrefillResult =
  | { ok: true; prefill: ReceptionPrefill }
  | { ok: false; code: string };

/**
 * Returning-guest prefill for the new-booking wizard: identity + the deduped
 * known-guest ID documents + the last booking's shape. Reception-gated,
 * read-only — the reuse itself is re-verified at booking creation.
 */
export async function getReceptionPrefillAction(input: unknown): Promise<ReceptionPrefillResult> {
  const user = await getSessionUser();
  if (!user || !canAccessReception(user.role)) {
    return { ok: false, code: 'forbidden' };
  }
  const parsed = prefillSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };
  try {
    const prefill = await getReceptionPrefill({
      userId: parsed.data.userId ?? null,
      phone: parsed.data.phone ?? null,
    });
    if (!prefill) return { ok: false, code: 'not_found' };
    return { ok: true, prefill };
  } catch {
    return { ok: false, code: 'unknown' };
  }
}

const sanctionsCheckSchema = z.object({
  phone: z.string().trim().min(4).max(30),
  countryCode: z.string().min(2).max(3).default('EG'),
});

export type GuestSanctionsResult =
  | {
      ok: true;
      /** Null when the phone doesn't match a customer account or owes nothing. */
      sanctions: {
        userName: string | null;
        totalCents: number;
        items: { amountCents: number; reason: string }[];
      } | null;
    }
  | { ok: false; code: string };

/**
 * Desk lookup: does the walk-in guest's phone belong to a customer account
 * with unpaid sanctions? Shown as a warning before the booking is committed —
 * the amounts are recomputed and settled server-side inside the booking
 * transaction, this is display only. Reception sees amount + reason, never the
 * admin-only internal notes.
 */
export async function checkGuestSanctionsAction(input: unknown): Promise<GuestSanctionsResult> {
  const user = await getSessionUser();
  if (!user || !canAccessReception(user.role)) {
    return { ok: false, code: 'forbidden' };
  }
  const parsed = sanctionsCheckSchema.safeParse(input);
  if (!parsed.success) return { ok: true, sanctions: null };

  let formattedPhone: string;
  try {
    if (!isValidPhoneNumber(parsed.data.phone, parsed.data.countryCode as CountryCode)) {
      return { ok: true, sanctions: null };
    }
    formattedPhone = parsePhoneNumber(
      parsed.data.phone,
      parsed.data.countryCode as CountryCode,
    ).format('E.164');
  } catch {
    return { ok: true, sanctions: null };
  }

  const found = await getPayableSanctionsByPhone(formattedPhone);
  if (!found || found.totalCents <= 0) return { ok: true, sanctions: null };
  return {
    ok: true,
    sanctions: {
      userName: found.userName,
      totalCents: found.totalCents,
      items: found.sanctions.map((s) => ({ amountCents: s.amountCents, reason: s.reason })),
    },
  };
}

const promoCheckSchema = z.object({
  code: z.string().trim().min(1).max(40),
  /** Primary guest ID number — keys the once-per-customer check on the person. */
  guestIdNumber: z.string().trim().max(80).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
});

export type PromoCheckResult =
  | { ok: true; valid: true; percentOff: number; code: string }
  | { ok: true; valid: false; reason: string }
  | { ok: false; code: string };

/**
 * Validate a promo code at the desk BEFORE payment — so a blocked / expired /
 * capped / already-used code is caught before the customer pays, never after.
 * Read-only: the real redemption still happens atomically inside the booking
 * transaction (this is a friendly pre-check). "Already used" is keyed on the
 * guest's ID number (falling back to phone), matching the redemption guard.
 */
export async function checkPromoAction(input: unknown): Promise<PromoCheckResult> {
  const user = await getSessionUser();
  if (!user || !canAccessReception(user.role)) return { ok: false, code: 'forbidden' };
  const parsed = promoCheckSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  const norm = normalizeCode(parsed.data.code);
  if (!norm) return { ok: true, valid: false, reason: 'promo_invalid' };
  try {
    const promo = await prisma.promoCode.findUnique({ where: { code: norm } });
    if (!promo) return { ok: true, valid: false, reason: 'promo_not_found' };
    try {
      assertPromoUsable(promo, new Date());
    } catch (e) {
      if (e instanceof DomainError) return { ok: true, valid: false, reason: e.code };
      throw e;
    }
    if (promo.oncePerCustomer) {
      const key = promoRedemptionKey(parsed.data.guestIdNumber, parsed.data.phone ?? '');
      if (key) {
        const prior = await prisma.promoRedemption.findFirst({
          where: { promoCodeId: promo.id, uniqueCustomerPhone: key },
        });
        if (prior) return { ok: true, valid: false, reason: 'promo_already_used' };
      }
    }
    return { ok: true, valid: true, percentOff: promo.percentOff, code: promo.code };
  } catch {
    return { ok: false, code: 'unknown' };
  }
}

const searchSchema = z.object({
  q: z.string().trim().min(2).max(60),
  locale: z.enum(['ar', 'en']).default('ar'),
});

export type ReceptionSearchResult =
  | { ok: true; rows: ReceptionSearchRow[] }
  | { ok: false; code: string };

/**
 * Find today's bookings by guest name / phone / national ID so the desk can
 * check a guest in when they don't have their QR pass. Reception-gated; a
 * too-short or malformed query returns an empty (not failed) result so the UI
 * stays quiet until the operator has typed something searchable.
 */
export async function searchReceptionBookingsAction(input: unknown): Promise<ReceptionSearchResult> {
  const user = await getSessionUser();
  if (!user || !canAccessReception(user.role)) {
    return { ok: false, code: 'forbidden' };
  }
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) return { ok: true, rows: [] };
  try {
    const rows = await searchTodayBookings(parsed.data.q, parsed.data.locale);
    return { ok: true, rows };
  } catch {
    return { ok: false, code: 'unknown' };
  }
}

const localeSchema = z.object({ locale: z.enum(['ar', 'en']).default('ar') });

/**
 * List EVERY confirmed booking of the day for the reception "Today's bookings"
 * board. Reception-gated like the search; an invalid payload falls back to the
 * default locale rather than failing, so the board always renders.
 */
export async function listTodayBookingsAction(input: unknown): Promise<ReceptionSearchResult> {
  const user = await getSessionUser();
  if (!user || !canAccessReception(user.role)) {
    return { ok: false, code: 'forbidden' };
  }
  const parsed = localeSchema.safeParse(input);
  const locale = parsed.success ? parsed.data.locale : 'ar';
  try {
    const rows = await listTodayBookings(locale);
    return { ok: true, rows };
  } catch {
    return { ok: false, code: 'unknown' };
  }
}

export type AuthorizeDiscountResult =
  | { ok: true; name: string; role: string; maxPercent: number }
  | { ok: false; code: string };

/**
 * Validate a supervisor PIN at the desk and return who it belongs to + their
 * max discount %, so the UI can show the authorizer and cap before the staff
 * enters a percentage. The PIN is re-validated server-side at booking commit,
 * so this is a convenience preview only.
 */
export async function authorizeDiscountAction(pin: string): Promise<AuthorizeDiscountResult> {
  const user = await getSessionUser();
  if (!user || !canAccessReception(user.role)) {
    return { ok: false, code: 'forbidden' };
  }
  // Throttle PIN guesses to defeat enumeration of a low-entropy (4–8 digit) PIN.
  // Keyed by the calling desk user; the counter is CLEARED on a correct PIN, so a
  // legitimate authorization is never delayed, while repeated wrong PINs from one
  // session hit exponential backoff (and can no longer brute-force a higher-tier
  // authorizer's ceiling).
  const rlKey = `discount-pin:${user.id}`;
  const gate = await consumeAttempt(rlKey);
  if (!gate.ok) {
    return { ok: false, code: 'rate_limited' };
  }
  try {
    const a = await authorizeByPin(pin);
    // Correct PIN — reset the failure counter so the next legitimate use is instant.
    await prisma.authRateLimit.delete({ where: { key: rlKey } }).catch(() => {});
    return { ok: true, name: a.name, role: a.role, maxPercent: a.maxPercent };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

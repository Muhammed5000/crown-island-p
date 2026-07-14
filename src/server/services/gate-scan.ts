import 'server-only';
import type { Prisma, PlacementStatus } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { audit } from '@/server/audit/audit';
import { bookingQrToken, verifyQrToken, isVisitPayload } from '@/lib/qr';
import { centsToMajor } from '@/lib/money';
import { formatDate, resortCivilDayUTC } from '@/lib/date';
import { summarizeGuestIds } from './guest-id';
import { anyDocumentNumberBlocked } from './blocklist';
import { ensureVisitForBooking, findVisitByCode, recordVisitScan, type VisitRecord } from './visit-code';
import { classifyScan } from './gate-scan-core';
import { DomainError } from './errors';
import { recordWorkActivity } from './work-session';
import { enqueueBookingLocalState } from '@/server/sync/booking-local-state';
import { enqueueById } from '@/server/sync/outbox';

/**
 * Gate check-in scanner — read + admit helpers.
 *
 * Security staff scan a guest's signed QR pass at the gate. The QR encodes an
 * HMAC-signed token (see `@/lib/qr`); this module verifies it, re-reads the
 * booking from the DB (the source of truth), and reports a single `scan` verdict
 * the UI renders directly:
 *
 *   - `valid`   → CONFIRMED, dated today, not yet admitted → staff may admit.
 *   - `used`    → already checked in today → "already admitted" (override only).
 *   - `invalid` → wrong day, cancelled/expired/unpaid, or unknown pass → deny.
 *
 * A successful admit stamps `Booking.checkedInAt` / `checkedInById` once; the DB
 * uniqueness of that timestamp is what makes a second scan read as `used`.
 */

export type ScanState = 'valid' | 'used' | 'invalid';

export interface GateService {
  /** Short machine code shown under the line (e.g. service kind). Optional. */
  code: string;
  label: string;
  qty: number;
  /**
   * Line total in major units (EGP), not piastres. Money-related — OMITTED
   * entirely for SECURITY operators (never serialised to them).
   */
  amount?: number;
}

/** One guest on a booking, keyed to their uploaded ID, for the gate roster. */
export interface GateGuest {
  /** 1-based guest slot. */
  seq: number;
  /** Reception-entered name, or a "Guest N" fallback. */
  name: string;
  /** ID photo URL (shown to staff to verify identity). */
  imageUrl: string;
  /** True once this specific guest has been admitted. */
  entered: boolean;
}

export interface GatePass {
  bookingId: string;
  /** Human reference, e.g. CI-20260525-LM8T3J. Shown as the "invoice" number. */
  invoice: string;
  /** Localized booking date for display. */
  date: string;
  customer: string;
  phone: string;
  /** Booking status, e.g. CONFIRMED. */
  status: string;
  /** Package line — the experience category name. */
  package: string;
  /** Tier badge — the specific service name. */
  tier: string;
  services: GateService[];
  /**
   * Grand total in major units (EGP). Money-related — OMITTED entirely for
   * SECURITY operators (never serialised to them).
   */
  total?: number;
  /** Currency code, sent only alongside `total` (i.e. not to SECURITY). */
  currency?: string;
  guests: number;
  /** Adults / children breakdown (children = age ≤ service.maxChildAge). */
  adults: number;
  children: number;
  vehicles: number;
  /** Physical units per day this booking consumes. */
  unitsPerDay: number;
  /** Distinct ISO days the booking covers (length 1 for single-day). */
  bookingDates: string[];
  // ── Place assignment (Phase 3) ──────────────────────────────────────────────
  /** Service requires a physical place to be assigned before check-in. */
  requiresPlacement: boolean;
  /** Roll-up: NOT_REQUIRED | PENDING | PARTIAL | COMPLETE. */
  placementStatus: PlacementStatus;
  /** Units needing a place vs placed (deduped by unit index). */
  unitsTotal: number;
  placedUnits: number;
  // ── Guest ID collection ─────────────────────────────────────────────────────
  /** Every guest needs an uploaded ID before this booking can be admitted. */
  idDocsRequired: boolean;
  /** Required document count (= guest count). */
  idDocsTotal: number;
  /** Documents uploaded so far. */
  idDocsUploaded: number;
  /** True once every guest's ID is on file — gate will admit. */
  idDocsComplete: boolean;
  /** Guests admitted so far on this ticket (partial check-in by headcount). */
  enteredCount: number;
  /** Guests still allowed to enter on this ticket (people − enteredCount). */
  remaining: number;
  /** Guests scanned out so far on this ticket. */
  exitedCount: number;
  /** Guests currently on site for this ticket (enteredCount − exitedCount). */
  onSite: number;
  /**
   * Per-guest roster (from uploaded ID documents) so the gate can admit
   * specific guests by photo + name rather than a bare count. Empty when the
   * booking has no uploaded IDs.
   */
  guestRoster: GateGuest[];
  scan: ScanState;
  /**
   * Signed QR token for this pass — the same content the guest's QR encodes.
   * Lets staff re-print the ticket's QR at the gate (one copy per guest).
   */
  qrToken: string;
  /** For `invalid` — why entry is refused. */
  reason?: string;
  /** For `used` — HH:mm the guest was admitted. */
  usedAt?: string;
  /** For `used` — gate label where admitted (best-effort). */
  usedGate?: string;
}

type BookingWithRelations = Prisma.BookingGetPayload<{
  include: {
    user: { select: { name: true; email: true; phone: true } };
    service: { include: { category: true } };
    invoice: { include: { lines: true } };
    units: { select: { unitIndex: true; placeId: true; date: true } };
    guestIds: {
      select: { guestSeq: true; guestName: true; imageUrl: true; checkedInAt: true; verificationStatus: true };
    };
    _count: { select: { guestIds: true } };
  };
}>;

const BOOKING_INCLUDE = {
  user: { select: { name: true, email: true, phone: true } },
  service: { include: { category: true } },
  invoice: { include: { lines: true } },
  units: { select: { unitIndex: true, placeId: true, date: true } },
  guestIds: {
    select: { guestSeq: true, guestName: true, imageUrl: true, checkedInAt: true, verificationStatus: true },
    orderBy: { guestSeq: 'asc' },
  },
  _count: { select: { guestIds: true } },
} satisfies Prisma.BookingInclude;

/** Placement roll-up for a freshly-read booking (deduped by unit index). */
function placementOf(b: BookingWithRelations): {
  required: boolean;
  total: number;
  placed: number;
  status: PlacementStatus;
  dates: string[];
} {
  const required = b.service.placeAssignmentRequired;
  const placedByIndex = new Map<number, boolean>();
  const dateSet = new Set<string>();
  for (const u of b.units) {
    placedByIndex.set(u.unitIndex, (placedByIndex.get(u.unitIndex) ?? false) || !!u.placeId);
    dateSet.add(u.date.toISOString().slice(0, 10));
  }
  const total = placedByIndex.size || b.unitsPerDay;
  const placed = Array.from(placedByIndex.values()).filter(Boolean).length;
  const status: PlacementStatus = !required
    ? 'NOT_REQUIRED'
    : placed === 0
      ? 'PENDING'
      : placed >= total
        ? 'COMPLETE'
        : 'PARTIAL';
  const dates = Array.from(dateSet).sort();
  return { required, total, placed, status, dates: dates.length ? dates : [b.bookingDate.toISOString().slice(0, 10)] };
}

/**
 * Calendar-day timestamp helpers — TZ-correct admissibility.
 *
 * Bookings are filed under the operator's / customer's RESORT-LOCAL calendar day
 * and stored as `Date.UTC(localY, localM, localD)` (UTC midnight of that civil
 * day — see reception `toIsoDate` + `parseDateOnly`). "Today" must therefore be
 * the resort's CURRENT local civil day, NOT the server's UTC day. Comparing a
 * booking's civil day against the UTC day used to refuse valid same-day passes
 * during the hours the local day is ahead of UTC (≈00:00–03:00 in Egypt,
 * UTC+2/＋3), and conversely could admit a day-old pass in that same window. The
 * resort civil day is computed timezone-explicitly via `resortCivilDayUTC`
 * (Africa/Cairo), so correctness no longer depends on the host process timezone.
 */
/** Civil day (as UTC-midnight ms) of `now` in the RESORT (Africa/Cairo) tz. */
function localCivilDay(now: Date): number {
  return resortCivilDayUTC(now);
}
/** Civil day (as UTC-midnight ms) of a STORED booking date (already UTC midnight). */
function bookingCivilDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function hhmm(d: Date, locale: 'ar' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** Compute the gate verdict for a freshly-read booking. */
function verdict(b: BookingWithRelations): { scan: ScanState; reason?: string } {
  const today = new Date();
  if (b.status === 'CANCELLED') return { scan: 'invalid', reason: 'Booking was cancelled' };
  if (b.status === 'EXPIRED') return { scan: 'invalid', reason: 'Pass has expired' };
  if (b.status === 'FAILED') return { scan: 'invalid', reason: 'Booking failed — never paid' };
  if (b.status === 'PENDING_PAYMENT')
    return { scan: 'invalid', reason: 'Payment not completed' };

  // status === CONFIRMED beyond this point. Compare CIVIL days (resort-local),
  // not UTC days, so a same-day pass is admissible for its whole local day. A
  // multi-day booking is admissible on ANY day it covers (bookingDate … endDate).
  const todayDay = localCivilDay(today);
  const startDay = bookingCivilDay(b.bookingDate);
  const endDay = b.endDate ? bookingCivilDay(b.endDate) : startDay;
  if (endDay < todayDay) {
    return {
      scan: 'invalid',
      reason: `Pass valid for ${formatDate(b.bookingDate, 'en')} only — expired`,
    };
  }
  if (todayDay < startDay) {
    return {
      scan: 'invalid',
      reason: `Pass valid on ${formatDate(b.bookingDate, 'en')} — not today`,
    };
  }
  // Partial check-in: 'used' only once EVERY guest has entered; while seats
  // remain the pass stays 'valid' so the rest of the party can be admitted.
  if (b.checkedInCount >= b.people + b.extraPersons) return { scan: 'used' };
  return { scan: 'valid' };
}

/**
 * Map a booking to a gate pass. When `includeMoney` is false (SECURITY
 * operators), every monetary field — line `amount`s, the grand `total`, and the
 * `currency` — is omitted from the object entirely, so nothing financial is ever
 * serialised toward those users.
 */
function toPass(b: BookingWithRelations, locale: 'ar' | 'en', includeMoney: boolean): GatePass {
  const { scan, reason } = verdict(b);
  const placement = placementOf(b);
  // ID images are required for ADULTS + paid EXTRA PERSONS — children carry none.
  const idSummary = summarizeGuestIds(b.adults + b.extraPersons, b._count.guestIds);
  const services: GateService[] = (b.invoice?.lines ?? []).map((line) => ({
    code: (line.meta as { code?: string } | null)?.code ?? b.service.kind,
    label: line.label,
    qty: line.quantity,
    ...(includeMoney ? { amount: centsToMajor(line.totalCents) } : {}),
  }));

  return {
    bookingId: b.id,
    invoice: b.reference,
    date: formatDate(b.bookingDate, locale),
    customer: b.user.name ?? 'Guest',
    phone: b.user.phone ?? b.user.email ?? '—',
    status: b.status,
    package: locale === 'ar' ? b.service.category.nameAr : b.service.category.nameEn,
    tier: locale === 'ar' ? b.service.nameAr : b.service.nameEn,
    services,
    ...(includeMoney
      ? {
          total: centsToMajor(b.invoice?.totalCents ?? 0),
          currency: b.invoice?.currency ?? 'EGP',
        }
      : {}),
    // Admissible headcount = base party + paid extra persons (both pass the gate).
    guests: b.people + b.extraPersons,
    adults: b.adults,
    children: b.children,
    vehicles: b.cars,
    unitsPerDay: b.unitsPerDay,
    bookingDates: placement.dates,
    requiresPlacement: placement.required,
    placementStatus: placement.status,
    unitsTotal: placement.total,
    placedUnits: placement.placed,
    idDocsRequired: b.adults + b.extraPersons > 0,
    idDocsTotal: idSummary.total,
    idDocsUploaded: idSummary.uploaded,
    idDocsComplete: idSummary.complete,
    enteredCount: b.checkedInCount,
    remaining: Math.max(0, b.people + b.extraPersons - b.checkedInCount),
    exitedCount: b.checkedOutCount,
    onSite: Math.max(0, b.checkedInCount - b.checkedOutCount),
    guestRoster: (b.guestIds ?? []).map((g) => ({
      seq: g.guestSeq,
      name: g.guestName?.trim() || `Guest ${g.guestSeq}`,
      imageUrl: g.imageUrl,
      entered: g.checkedInAt != null,
    })),
    scan,
    // Re-signed from the booking so manual-entry passes (no scanned token) can
    // still be printed. Mirrors the customer QR — expires 24h after the date.
    qrToken: bookingQrToken(b),
    reason,
    usedAt: b.checkedInAt ? hhmm(b.checkedInAt, locale) : undefined,
    usedGate: b.checkedInAt ? 'Main Gate' : undefined,
  };
}

/**
 * Resolve a scanned QR token to a gate pass. Returns `null` only when the token
 * is structurally invalid / forged or points at a booking that no longer
 * exists — the caller renders a generic "unknown pass" deny state.
 */
export async function readPassByToken(
  token: string,
  locale: 'ar' | 'en' = 'en',
  includeMoney = false,
): Promise<GatePass | null> {
  const payload = verifyQrToken(token);
  if (!payload) return null;
  if (isVisitPayload(payload)) {
    // Visit token — resolve the group and surface its primary pass.
    const group = await readVisitByScan(token, locale, includeMoney);
    return group?.primary ?? null;
  }
  const booking = await prisma.booking.findUnique({
    where: { id: payload.bid },
    include: BOOKING_INCLUDE,
  });
  if (!booking) return null;
  return toPass(booking, locale, includeMoney);
}

// ─── Visit groups (daily root code) ───────────────────────────────────────────

/** The grouped view one scan opens: every booking of the customer's day. */
export interface GateVisit {
  /** Localized visit date. */
  date: string;
  customer: string;
  phone: string;
  bookingCount: number;
  /** Successful scans of this visit code so far (incl. this one). */
  scanCount: number;
  passes: GatePass[];
}

function bestPass(passes: GatePass[]): GatePass {
  return (
    passes.find((p) => p.scan === 'valid') ??
    passes.find((p) => p.scan === 'used') ??
    passes[0]!
  );
}

/**
 * Resolve ANY scanned value to the customer's visit group. Accepted shapes,
 * tried in order:
 *
 *   1. signed VISIT token  (all new QRs — customer app + reception print)
 *   2. signed BOOKING token (legacy printed/saved QRs → booking → its group)
 *   3. raw visit code       ("V-…" — bracelet barcodes / manual entry)
 *   4. booking reference    ("CI-…" — legacy bracelet barcodes / manual entry)
 *
 * Legacy paths run through `ensureVisitForBooking`, so old bookings self-link
 * to a group on first scan. Returns the full group plus a `primary` pass (the
 * first still-admissible booking) the scanner shows by default.
 */
export async function readVisitByScan(
  value: string,
  locale: 'ar' | 'en' = 'en',
  includeMoney = false,
): Promise<{ visit: GateVisit; primary: GatePass } | null> {
  const raw = value.trim();
  if (!raw) return null;

  let visit: VisitRecord | null = null;

  // Routing precedence (token → visit-code → reference) is pinned in
  // gate-scan-core.ts / classifyScan; the payload re-narrowing below is for the
  // type system and is behaviour-identical to the classified kind.
  const payload = verifyQrToken(raw);
  const kind = classifyScan(raw, payload ? { isVisit: isVisitPayload(payload) } : null);

  if (kind === 'visitToken' && payload && isVisitPayload(payload)) {
    visit = await findVisitByCode(payload.vc);
  } else if (kind === 'bookingToken' && payload && !isVisitPayload(payload)) {
    const exists = await prisma.booking.findUnique({ where: { id: payload.bid }, select: { id: true } });
    if (exists) visit = await ensureVisitForBooking(prisma, exists.id);
  } else if (kind === 'visitCode') {
    visit = await findVisitByCode(raw);
  } else if (kind === 'reference') {
    const byRef = await prisma.booking.findUnique({
      where: { reference: raw.toUpperCase() },
      select: { id: true },
    });
    if (byRef) visit = await ensureVisitForBooking(prisma, byRef.id);
  }
  if (!visit) return null;

  const bookings = await prisma.booking.findMany({
    where: { visitCodeId: visit.id },
    include: BOOKING_INCLUDE,
    orderBy: { createdAt: 'asc' },
  });
  if (bookings.length === 0) return null;

  await recordVisitScan(visit.id);

  const passes = bookings.map((b) => toPass(b, locale, includeMoney));
  const primary = bestPass(passes);
  const visitView: GateVisit = {
    date: formatDate(visit.visitDate, locale),
    customer: primary.customer,
    phone: primary.phone,
    bookingCount: passes.length,
    scanCount: visit.scanCount + 1,
    passes,
  };
  return { visit: visitView, primary };
}

/** Manual fallback — look a booking up by its printed reference. */
export async function readPassByReference(
  reference: string,
  locale: 'ar' | 'en' = 'en',
  includeMoney = false,
): Promise<GatePass | null> {
  const booking = await prisma.booking.findUnique({
    where: { reference: reference.trim().toUpperCase() },
    include: BOOKING_INCLUDE,
  });
  if (!booking) return null;
  return toPass(booking, locale, includeMoney);
}

export interface GateLogEntry {
  time: string;
  name: string;
  invoice: string;
  guests: number;
  vehicles: number;
  result: 'admitted' | 'denied';
  gate: string;
}

export interface GateSummary {
  admitted: number;
  /** Live headcount currently on site = Σ(checkedInCount − checkedOutCount). */
  onSite: number;
  /** Guests scanned out today = Σ checkedOutCount. */
  exited: number;
  vehicles: number;
  /** Today's revenue in major units. Money-related — OMITTED for SECURITY. */
  revenue?: number;
  log: GateLogEntry[];
}

/**
 * Today's gate dashboard figures — drives the mobile stat strip and the desktop
 * kiosk's stat tiles + recent-scans rail. Counts only real check-ins since UTC
 * midnight. (Denied scans aren't persisted, so the log shows admissions; the
 * client appends any denials it issues during the session.)
 */
export async function getGateSummary(
  locale: 'ar' | 'en' = 'en',
  includeMoney = false,
): Promise<GateSummary> {
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const checkedIn = await prisma.booking.findMany({
    where: { checkedInAt: { gte: startOfDay } },
    include: {
      user: { select: { name: true } },
      invoice: { select: { totalCents: true } },
    },
    orderBy: { checkedInAt: 'desc' },
    take: 40,
  });

  const admitted = checkedIn.length;
  // Live headcount = guests entered minus guests scanned back out. A 4-person
  // ticket with 2 entered and 1 exited counts 1 on site.
  const onSite = checkedIn.reduce((sum, b) => sum + Math.max(0, b.checkedInCount - b.checkedOutCount), 0);
  const exited = checkedIn.reduce((sum, b) => sum + b.checkedOutCount, 0);
  const vehicles = checkedIn.reduce((sum, b) => sum + b.cars, 0);

  const log: GateLogEntry[] = checkedIn.slice(0, 12).map((b) => ({
    time: b.checkedInAt ? hhmm(b.checkedInAt, locale) : '',
    name: b.user.name ?? 'Guest',
    invoice: b.reference,
    guests: b.people + b.extraPersons,
    vehicles: b.cars,
    result: 'admitted',
    gate: 'Main',
  }));

  // Revenue is money-related: compute and include it only for money-cleared
  // operators, so a SECURITY summary never carries a financial figure.
  const revenue = includeMoney
    ? centsToMajor(checkedIn.reduce((sum, b) => sum + (b.invoice?.totalCents ?? 0), 0))
    : undefined;

  return { admitted, onSite, exited, vehicles, ...(revenue !== undefined ? { revenue } : {}), log };
}

export interface CheckInInput {
  /** One of token / reference / bookingId must be provided. */
  token?: string;
  reference?: string;
  bookingId?: string;
  staffUserId: string;
  locale?: 'ar' | 'en';
  /** Include money fields in the returned pass. Defaults to false (deny). */
  includeMoney?: boolean;
  /**
   * How many guests are entering on THIS admit (partial check-in). Clamped to
   * the remaining headcount. Defaults to "all remaining" so a plain admit lets
   * the whole party in, preserving the original behaviour.
   */
  admitCount?: number;
  /**
   * Specific guest slots (by `guestSeq`) entering on THIS admit — the gate's
   * per-guest selection by ID photo. When provided it takes precedence over
   * `admitCount`; only not-yet-entered slots are marked.
   */
  admitGuestSeqs?: number[];
}

/**
 * Admit a guest. Stamps the check-in once, transactionally, and writes an audit
 * row. Idempotent-ish: re-admitting an already-checked-in booking does not
 * re-stamp and reports `used`. Refuses anything that isn't `valid`/`used`.
 */
export async function checkInBooking(input: CheckInInput): Promise<GatePass> {
  const locale = input.locale ?? 'en';

  let bookingId = input.bookingId ?? null;
  if (!bookingId && input.token) {
    const payload = verifyQrToken(input.token);
    if (!payload) throw new DomainError('invalid_pass', 'invalid_pass', 400);
    // A VISIT token identifies the whole day-group, not one booking — the
    // scanner always sends the selected `bookingId`/`reference` alongside, so
    // we only take the id from legacy per-booking tokens here.
    if (!isVisitPayload(payload)) bookingId = payload.bid;
  }
  if (!bookingId && input.reference) {
    const found = await prisma.booking.findUnique({
      where: { reference: input.reference.trim().toUpperCase() },
      select: { id: true },
    });
    bookingId = found?.id ?? null;
  }
  if (!bookingId) throw new DomainError('not_found', 'not_found', 404);

  const id = bookingId;
  const updated = await prisma.$transaction(async (tx) => {
    const fresh = await tx.booking.findUnique({ where: { id }, include: BOOKING_INCLUDE });
    if (!fresh) throw new DomainError('not_found', 'not_found', 404);

    const { scan, reason } = verdict(fresh);
    if (scan === 'invalid') {
      throw new DomainError(reason ?? 'Pass not admissible', 'not_admissible', 409);
    }
    if (scan === 'used') {
      // Already admitted — return as-is without re-stamping.
      return fresh;
    }

    // Place-assignment gate: a service that requires physical places cannot be
    // checked in until every unit has one. Reception/gate must assign first.
    const placement = placementOf(fresh);
    if (placement.required && placement.status !== 'COMPLETE') {
      throw new DomainError(
        'Assign all places before check-in',
        'placement_required',
        409,
      );
    }

    // Guest-ID gate: identity verification is mandatory for ADULTS only — every
    // adult (slots 1 … adults) must have an uploaded ID document before the
    // party is admitted. Children (slots adults+1 … people) carry no ID image
    // and are admitted as headcount. Enforced here so it holds on EVERY entry
    // path (QR scan, manual lookup, reception screen), never just in the UI.
    const requiredIds = fresh.adults + fresh.extraPersons;
    // Count only rows in REQUIRED slots (adults 1..adults, extra persons
    // people+1..people+extraPersons). A legacy child-slot row (seq in adults+1..people)
    // must not backfill a missing required ID. For bookings created under current
    // code children never have rows, so this equals _count.guestIds.
    const requiredPresent = fresh.guestIds.filter(
      (g) =>
        (g.guestSeq >= 1 && g.guestSeq <= fresh.adults) ||
        (g.guestSeq > fresh.people && g.guestSeq <= fresh.people + fresh.extraPersons),
    ).length;
    if (requiredIds > 0 && requiredPresent < requiredIds) {
      throw new DomainError(
        'Upload every adult + extra-person guest ID before check-in',
        'guest_id_required',
        409,
      );
    }

    // Every required slot must carry a NON-BLANK ID/passport number — the number is
    // what the blocklist below matches on, and `anyDocumentNumberBlocked` correctly
    // skips blanks, so a banned person whose number was never typed would otherwise
    // sail through. Refuse admission until every required slot has a real number.
    const requiredWithNumber = fresh.guestIds.filter(
      (g) =>
        ((g.guestSeq >= 1 && g.guestSeq <= fresh.adults) ||
          (g.guestSeq > fresh.people && g.guestSeq <= fresh.people + fresh.extraPersons)) &&
        !!g.guestName?.trim(),
    ).length;
    if (requiredIds > 0 && requiredWithNumber < requiredIds) {
      throw new DomainError(
        'Enter every guest ID number before check-in',
        'guest_id_number_required',
        409,
      );
    }

    // Identity blocklist gate: each guest-ID row records the guest's ID/passport
    // NUMBER (in `guestName`). Refuse admission if ANY of them is on the admin
    // blocklist (matched as both national-id and passport — see
    // `anyDocumentNumberBlocked`). Enforced here so it holds on EVERY entry path
    // (QR scan, manual lookup, reception screen), never just in the UI. Only the
    // generic `blocked` code is surfaced — never a reason / note / record id.
    if (await anyDocumentNumberBlocked(fresh.guestIds.map((g) => g.guestName))) {
      throw new DomainError('A guest on this booking is blocked', 'blocked', 403);
    }

    const now = new Date();
    const enteredBefore = fresh.checkedInCount;
    const remaining = Math.max(0, fresh.people + fresh.extraPersons - enteredBefore);

    // Per-guest admission: the gate selects WHICH guests enter (by their ID
    // photo / `guestSeq`). Mark only not-yet-entered slots. Falls back to a
    // headcount admit when no guest slots are provided or none are on file.
    const unentered = fresh.guestIds.filter((g) => g.checkedInAt == null);
    let admitNow: number;

    if (input.admitGuestSeqs && input.admitGuestSeqs.length) {
      const wanted = new Set(input.admitGuestSeqs);
      // Slots that have an ID row (adults — and any legacy child rows): stamp the
      // selected, not-yet-entered ones.
      const rowSeqs = unentered.filter((g) => wanted.has(g.guestSeq)).map((g) => g.guestSeq);
      // Children with NO ID row (slots adults+1 … people): admitted as pure
      // headcount. Exclude any slot that already has a row so it can't be
      // double-counted (matters only for legacy bookings that stored child IDs).
      const haveRow = new Set(fresh.guestIds.map((g) => g.guestSeq));
      // Children carry no per-slot entered stamp, so cap how many child seqs we
      // count to the children NOT yet admitted (checkedInCount minus the already-
      // entered adult/extra ID rows). Without this, re-selecting an already-entered
      // child via a crafted request could inflate the on-site headcount.
      const childrenEnteredBefore = enteredBefore - fresh.guestIds.filter((g) => g.checkedInAt != null).length;
      const childAvailable = Math.max(0, fresh.people - fresh.adults - Math.max(0, childrenEnteredBefore));
      const childSelected = Math.min(
        childAvailable,
        [...wanted].filter((s) => s > fresh.adults && s <= fresh.people && !haveRow.has(s)).length,
      );
      const selected = rowSeqs.length + childSelected;
      if (selected === 0) {
        throw new DomainError('Select at least one guest who is entering', 'no_guest_selected', 400);
      }
      if (rowSeqs.length) {
        await tx.guestIdDocument.updateMany({
          where: { bookingId: fresh.id, guestSeq: { in: rowSeqs }, checkedInAt: null },
          data: { checkedInAt: now, checkedInById: input.staffUserId },
        });
      }
      // Cap to the remaining party so a child re-selection can never overcount.
      admitNow = Math.min(remaining, selected);
    } else {
      // Headcount fallback (manual lookup, or a booking with no uploaded IDs).
      const requested = Math.trunc(input.admitCount ?? remaining);
      admitNow = Math.max(1, Math.min(requested || remaining, remaining));
      if (unentered.length) {
        const seqs = unentered.slice(0, admitNow).map((g) => g.guestSeq);
        await tx.guestIdDocument.updateMany({
          where: { bookingId: fresh.id, guestSeq: { in: seqs }, checkedInAt: null },
          data: { checkedInAt: now, checkedInById: input.staffUserId },
        });
      }
    }

    const newCount = Math.min(fresh.people + fresh.extraPersons, enteredBefore + admitNow);
    const firstAdmit = enteredBefore === 0;

    // Conditional (optimistic) write: only commit if `checkedInCount` is still
    // what we read. If two lanes scan the same pass simultaneously, the loser
    // matches 0 rows and the whole tx rolls back (incl. the guest-ID stamps
    // above), so a concurrent double-scan can never clobber the count or admit a
    // party in two overlapping groups whose sum exceeds `people`.
    const committed = await tx.booking.updateMany({
      where: { id: fresh.id, checkedInCount: enteredBefore },
      data: {
        checkedInCount: newCount,
        // Stamp the operator + time on the FIRST admit only.
        ...(firstAdmit ? { checkedInAt: now, checkedInById: input.staffUserId } : {}),
      },
    });
    if (committed.count === 0) {
      throw new DomainError('Pass was just updated — scan again', 'concurrent_update', 409);
    }
    await audit(tx, {
      actorUserId: input.staffUserId,
      action: 'STATUS_CHANGE',
      entityType: 'Booking',
      entityId: fresh.id,
      before: { checkedInCount: enteredBefore },
      after: { checkedInCount: newCount, admitted: admitNow, cause: 'gate_check_in' },
    });

    // One gate-scan event per admit, carrying the headcount admitted THIS scan
    // (so partial entries each show in the admin activity report).
    const ev = await tx.gateScanEvent.create({
      data: {
        result: 'ADMITTED',
        operatorId: input.staffUserId,
        bookingId: fresh.id,
        scannedUserId: fresh.userId,
        categoryId: fresh.service.categoryId,
        people: admitNow,
        reference: fresh.reference,
      },
    });
    await enqueueById(tx, 'GateScanEvent', ev.id);

    // Sync (local→online): queue the booking's local gate state. No-op off-local.
    await enqueueBookingLocalState(tx, fresh.id);

    return tx.booking.findUnique({ where: { id: fresh.id }, include: BOOKING_INCLUDE });
  });

  // Keep the operator's work session (shift) in sync. Best-effort + post-commit:
  // a session write must never affect the admission just recorded.
  await recordWorkActivity(input.staffUserId, 'GATE');

  return toPass(updated as BookingWithRelations, locale, input.includeMoney ?? false);
}

export interface CheckOutInput {
  /** One of token / reference / bookingId must be provided. */
  token?: string;
  reference?: string;
  bookingId?: string;
  staffUserId: string;
  locale?: 'ar' | 'en';
  includeMoney?: boolean;
  /**
   * How many guests are leaving on THIS scan (partial exit). Clamped to the
   * number still on site. Defaults to "all on site" so a plain exit scan checks
   * the whole party out.
   */
  exitCount?: number;
}

/**
 * Scan a guest party OUT at the exit gate. Mirrors {@link checkInBooking}:
 * stamps the first checkout, supports partial exits by headcount, and writes an
 * `EXITED` gate-scan event + audit row. Unlike admission, checkout doesn't run
 * the date / placement / ID gates — anyone currently on site may leave. Refuses
 * if no one is checked in, or everyone has already left.
 */
export async function checkOutBooking(input: CheckOutInput): Promise<GatePass> {
  const locale = input.locale ?? 'en';

  let bookingId = input.bookingId ?? null;
  if (!bookingId && input.token) {
    const payload = verifyQrToken(input.token);
    if (!payload) throw new DomainError('invalid_pass', 'invalid_pass', 400);
    // Visit tokens identify a group — the scanner sends the selected
    // bookingId/reference alongside; only legacy tokens carry one booking.
    if (!isVisitPayload(payload)) bookingId = payload.bid;
  }
  if (!bookingId && input.reference) {
    const found = await prisma.booking.findUnique({
      where: { reference: input.reference.trim().toUpperCase() },
      select: { id: true },
    });
    bookingId = found?.id ?? null;
  }
  if (!bookingId) throw new DomainError('not_found', 'not_found', 404);

  const id = bookingId;
  const updated = await prisma.$transaction(async (tx) => {
    const fresh = await tx.booking.findUnique({ where: { id }, include: BOOKING_INCLUDE });
    if (!fresh) throw new DomainError('not_found', 'not_found', 404);

    if (fresh.checkedInCount === 0) {
      throw new DomainError('No one has checked in on this pass yet', 'not_checked_in', 409);
    }
    const onSite = Math.max(0, fresh.checkedInCount - fresh.checkedOutCount);
    if (onSite <= 0) {
      throw new DomainError('All guests have already checked out', 'already_exited', 409);
    }

    const requested = Math.trunc(input.exitCount ?? onSite);
    const exitNow = Math.max(1, Math.min(requested || onSite, onSite));
    const newCount = fresh.checkedOutCount + exitNow;
    const firstExit = fresh.checkedOutCount === 0;

    const now = new Date();
    // Conditional write (mirrors checkInBooking): only commit if checkedOutCount
    // is unchanged since our read, so two concurrent exit scans can't clobber the
    // count.
    const committed = await tx.booking.updateMany({
      where: { id: fresh.id, checkedOutCount: fresh.checkedOutCount },
      data: {
        checkedOutCount: newCount,
        ...(firstExit ? { checkedOutAt: now, checkedOutById: input.staffUserId } : {}),
      },
    });
    if (committed.count === 0) {
      throw new DomainError('Pass was just updated — scan again', 'concurrent_update', 409);
    }
    await audit(tx, {
      actorUserId: input.staffUserId,
      action: 'STATUS_CHANGE',
      entityType: 'Booking',
      entityId: fresh.id,
      before: { checkedOutCount: fresh.checkedOutCount },
      after: { checkedOutCount: newCount, exited: exitNow, cause: 'gate_check_out' },
    });
    const ev = await tx.gateScanEvent.create({
      data: {
        result: 'EXITED',
        operatorId: input.staffUserId,
        bookingId: fresh.id,
        scannedUserId: fresh.userId,
        categoryId: fresh.service.categoryId,
        people: exitNow,
        reference: fresh.reference,
      },
    });
    await enqueueById(tx, 'GateScanEvent', ev.id);

    // Sync (local→online): queue the booking's local gate state. No-op off-local.
    await enqueueBookingLocalState(tx, fresh.id);

    return tx.booking.findUnique({ where: { id: fresh.id }, include: BOOKING_INCLUDE });
  });

  await recordWorkActivity(input.staffUserId, 'GATE');

  return toPass(updated as BookingWithRelations, locale, input.includeMoney ?? false);
}

// ───────────────────────────────────────────────────────────────────────────
// Gate-scan event recording (deny) + admin activity report
// ───────────────────────────────────────────────────────────────────────────

export interface RecordDenyInput {
  operatorUserId: string;
  token?: string;
  reference?: string;
  bookingId?: string;
  reason?: string;
}

/**
 * Persist a DENIED gate scan. Best-effort resolves the scanned booking (and
 * thus the guest + category) from the token / reference / id; an unknown or
 * forged pass is still recorded against the operator with whatever is known.
 * Denies never mutate the booking — they live only as activity events.
 */
export async function recordGateDeny(input: RecordDenyInput): Promise<void> {
  let bookingId = input.bookingId || null;
  if (!bookingId && input.token) {
    const payload = verifyQrToken(input.token);
    if (payload && !isVisitPayload(payload)) bookingId = payload.bid;
  }

  let booking:
    | { id: string; userId: string; people: number; extraPersons: number; reference: string; service: { categoryId: string } }
    | null = null;

  const select = {
    id: true,
    userId: true,
    people: true,
    extraPersons: true,
    reference: true,
    service: { select: { categoryId: true } },
  } as const;

  if (bookingId) {
    booking = await prisma.booking.findUnique({ where: { id: bookingId }, select });
  } else if (input.reference) {
    booking = await prisma.booking.findUnique({
      where: { reference: input.reference.trim().toUpperCase() },
      select,
    });
  }

  await prisma.$transaction(async (tx) => {
    const ev = await tx.gateScanEvent.create({
      data: {
        result: 'DENIED',
        operatorId: input.operatorUserId,
        bookingId: booking?.id ?? null,
        scannedUserId: booking?.userId ?? null,
        categoryId: booking?.service.categoryId ?? null,
        people: (booking?.people ?? 0) + (booking?.extraPersons ?? 0),
        reference: booking?.reference ?? input.reference ?? null,
        reason: input.reason ?? null,
      },
    });
    await enqueueById(tx, 'GateScanEvent', ev.id);
  });

  await recordWorkActivity(input.operatorUserId, 'GATE');
}

export interface GateActivityOperator {
  id: string;
  name: string;
  role: string;
  firstScan: Date | null;
  lastScan: Date | null;
  /** Working window (last − first) in milliseconds; 0 when fewer than two scans. */
  durationMs: number;
  admittedPeople: number;
  deniedPeople: number;
  admittedScans: number;
  deniedScans: number;
  /** Guests this operator scanned OUT at the exit gate. */
  exitedPeople: number;
  exitedScans: number;
  /** Reception (offline) bookings this operator recorded at the desk. */
  receptionScans: number;
  /** People across this operator's reception bookings. */
  receptionPeople: number;
  /** Total collected across reception bookings, in piastres. */
  receptionAmountCents: number;
}

export interface GateActivityEvent {
  id: string;
  createdAt: Date;
  result: 'ADMITTED' | 'EXITED' | 'DENIED' | 'RECEPTION';
  operatorName: string;
  operatorRole: string;
  guestName: string;
  categoryName: string;
  reference: string | null;
  reason: string | null;
  people: number;
  /** Amount collected (piastres) — set for RECEPTION events, else null. */
  amountCents: number | null;
}

export interface GateActivityReport {
  operators: GateActivityOperator[];
  events: GateActivityEvent[];
}

/**
 * Build the admin "Gate activity" report for STAFF + SECURITY operators:
 *   - per-operator working time (first → last scan), and admit / deny people
 *     counts,
 *   - a chronological trail of every scan: who handled it, who was scanned, and
 *     which category they were trying to enter.
 */
export async function getGateActivityReport(
  locale: 'ar' | 'en' = 'en',
  eventLimit = 200,
): Promise<GateActivityReport> {
  const operatorUsers = await prisma.user.findMany({
    where: { role: { in: ['STAFF', 'SECURITY'] } },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { createdAt: 'asc' },
  });

  // Per-operator aggregates over ALL history, computed with a BOUNDED groupBy (one
  // row per operator per result) instead of loading every gate event into memory —
  // GateScanEvent grows without bound. The chronological trail is a separate query,
  // capped at `eventLimit`.
  const grouped = await prisma.gateScanEvent.groupBy({
    by: ['operatorId', 'result'],
    where: { operator: { role: { in: ['STAFF', 'SECURITY'] } } },
    _count: { _all: true },
    _sum: { people: true, amountCents: true },
    _min: { createdAt: true },
    _max: { createdAt: true },
  });

  const seedOperator = (id: string, name: string, role: string): GateActivityOperator => ({
    id,
    name,
    role,
    firstScan: null,
    lastScan: null,
    durationMs: 0,
    admittedPeople: 0,
    deniedPeople: 0,
    admittedScans: 0,
    deniedScans: 0,
    exitedPeople: 0,
    exitedScans: 0,
    receptionScans: 0,
    receptionPeople: 0,
    receptionAmountCents: 0,
  });

  // Aggregate per operator (seed with every staff/security user so even those
  // with zero scans show up).
  const agg = new Map<string, GateActivityOperator>();
  for (const u of operatorUsers) {
    agg.set(u.id, seedOperator(u.id, u.name ?? u.email ?? 'Operator', u.role));
  }

  for (const g of grouped) {
    // The current-role filter guarantees the operator was seeded above; skip
    // defensively rather than fabricate an operator with no name.
    const op = agg.get(g.operatorId);
    if (!op) continue;
    const scans = g._count._all;
    const people = g._sum.people ?? 0;
    if (g.result === 'ADMITTED') {
      op.admittedScans += scans;
      op.admittedPeople += people;
    } else if (g.result === 'EXITED') {
      op.exitedScans += scans;
      op.exitedPeople += people;
    } else if (g.result === 'RECEPTION') {
      op.receptionScans += scans;
      op.receptionPeople += people;
      op.receptionAmountCents += g._sum.amountCents ?? 0;
    } else {
      op.deniedScans += scans;
      op.deniedPeople += people;
    }
    const min = g._min.createdAt;
    const max = g._max.createdAt;
    if (min && (!op.firstScan || min < op.firstScan)) op.firstScan = min;
    if (max && (!op.lastScan || max > op.lastScan)) op.lastScan = max;
  }

  for (const op of agg.values()) {
    op.durationMs =
      op.firstScan && op.lastScan ? op.lastScan.getTime() - op.firstScan.getTime() : 0;
  }

  const activityTotal = (o: GateActivityOperator) =>
    o.admittedPeople + o.deniedPeople + o.receptionPeople;
  const operators = Array.from(agg.values()).sort((a, b) => activityTotal(b) - activityTotal(a));

  // Chronological trail — bounded by `eventLimit` at the DB level (not sliced
  // after loading everything).
  const trail = await prisma.gateScanEvent.findMany({
    where: { operator: { role: { in: ['STAFF', 'SECURITY'] } } },
    include: {
      operator: { select: { name: true, email: true, role: true } },
      scannedUser: { select: { name: true, email: true } },
      booking: { select: { guestName: true } },
      category: { select: { nameEn: true, nameAr: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: eventLimit,
  });
  const events: GateActivityEvent[] = trail.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    result: r.result,
    operatorName: r.operator.name ?? r.operator.email ?? 'Operator',
    operatorRole: r.operator.role,
    guestName: r.scannedUser?.name ?? r.scannedUser?.email ?? r.booking?.guestName ?? 'Unknown pass',
    categoryName: r.category ? (locale === 'ar' ? r.category.nameAr : r.category.nameEn) : '—',
    reference: r.reference,
    reason: r.reason,
    people: r.people,
    amountCents: r.amountCents ?? null,
  }));

  return { operators, events };
}

// ───────────────────────────────────────────────────────────────────────────
// Single-operator profile: per-day work + full scan history
// ───────────────────────────────────────────────────────────────────────────

export interface GateOperatorDay {
  /** UTC day key (YYYY-MM-DD), used for grouping and as the row key. */
  date: string;
  /** First / last scan of that day — bounds the working window. */
  firstScan: Date;
  lastScan: Date;
  /** Working window (last − first) in milliseconds; 0 for a single scan. */
  durationMs: number;
  admittedPeople: number;
  admittedScans: number;
  deniedPeople: number;
  deniedScans: number;
  exitedPeople: number;
  exitedScans: number;
  receptionScans: number;
  receptionPeople: number;
  receptionAmountCents: number;
}

export interface GateOperatorProfile {
  operator: { id: string; name: string; role: string; email: string | null };
  totals: {
    firstScan: Date | null;
    lastScan: Date | null;
    daysWorked: number;
    admittedPeople: number;
    admittedScans: number;
    deniedPeople: number;
    deniedScans: number;
    exitedPeople: number;
    exitedScans: number;
    receptionScans: number;
    receptionPeople: number;
    receptionAmountCents: number;
  };
  /** One row per day worked, newest first. */
  days: GateOperatorDay[];
  /** Every scan this operator handled, newest first. */
  events: GateActivityEvent[];
}

/**
 * Build a single operator's gate profile: their work broken down per day (UTC),
 * with working time + admit / deny counts, plus the full chronological history
 * of every booking they scanned. Returns `null` when the user doesn't exist.
 */
export async function getOperatorGateProfile(
  operatorId: string,
  locale: 'ar' | 'en' = 'en',
): Promise<GateOperatorProfile | null> {
  const operator = await prisma.user.findUnique({
    where: { id: operatorId },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!operator) return null;

  const rows = await prisma.gateScanEvent.findMany({
    where: { operatorId },
    include: {
      operator: { select: { name: true, email: true, role: true } },
      scannedUser: { select: { name: true, email: true } },
      booking: { select: { guestName: true } },
      category: { select: { nameEn: true, nameAr: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Group by UTC day — consistent with the rest of the gate's day boundaries
  // (see getGateSummary). Each day tracks its own working window + counts.
  const dayMap = new Map<string, GateOperatorDay>();
  let admittedPeople = 0;
  let admittedScans = 0;
  let deniedPeople = 0;
  let deniedScans = 0;
  let exitedPeople = 0;
  let exitedScans = 0;
  let receptionScans = 0;
  let receptionPeople = 0;
  let receptionAmountCents = 0;
  let firstScan: Date | null = null;
  let lastScan: Date | null = null;

  for (const r of rows) {
    const key = r.createdAt.toISOString().split('T')[0] ?? '';
    let day = dayMap.get(key);
    if (!day) {
      day = {
        date: key,
        firstScan: r.createdAt,
        lastScan: r.createdAt,
        durationMs: 0,
        admittedPeople: 0,
        admittedScans: 0,
        deniedPeople: 0,
        deniedScans: 0,
        exitedPeople: 0,
        exitedScans: 0,
        receptionScans: 0,
        receptionPeople: 0,
        receptionAmountCents: 0,
      };
      dayMap.set(key, day);
    }
    if (r.createdAt > day.lastScan) day.lastScan = r.createdAt;
    if (r.createdAt < day.firstScan) day.firstScan = r.createdAt;
    if (r.result === 'ADMITTED') {
      day.admittedScans += 1;
      day.admittedPeople += r.people;
      admittedScans += 1;
      admittedPeople += r.people;
    } else if (r.result === 'EXITED') {
      day.exitedScans += 1;
      day.exitedPeople += r.people;
      exitedScans += 1;
      exitedPeople += r.people;
    } else if (r.result === 'RECEPTION') {
      day.receptionScans += 1;
      day.receptionPeople += r.people;
      day.receptionAmountCents += r.amountCents ?? 0;
      receptionScans += 1;
      receptionPeople += r.people;
      receptionAmountCents += r.amountCents ?? 0;
    } else {
      day.deniedScans += 1;
      day.deniedPeople += r.people;
      deniedScans += 1;
      deniedPeople += r.people;
    }
    if (!lastScan || r.createdAt > lastScan) lastScan = r.createdAt;
    if (!firstScan || r.createdAt < firstScan) firstScan = r.createdAt;
  }

  for (const d of dayMap.values()) {
    d.durationMs = d.lastScan.getTime() - d.firstScan.getTime();
  }

  // Newest day first.
  const days = Array.from(dayMap.values()).sort((a, b) => (a.date < b.date ? 1 : -1));

  const events: GateActivityEvent[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    result: r.result,
    operatorName: r.operator.name ?? r.operator.email ?? 'Operator',
    operatorRole: r.operator.role,
    guestName: r.scannedUser?.name ?? r.scannedUser?.email ?? r.booking?.guestName ?? 'Unknown pass',
    categoryName: r.category ? (locale === 'ar' ? r.category.nameAr : r.category.nameEn) : '—',
    reference: r.reference,
    reason: r.reason,
    people: r.people,
    amountCents: r.amountCents ?? null,
  }));

  return {
    operator: {
      id: operator.id,
      name: operator.name ?? operator.email ?? 'Operator',
      role: operator.role,
      email: operator.email,
    },
    totals: {
      firstScan,
      lastScan,
      daysWorked: days.length,
      admittedPeople,
      admittedScans,
      deniedPeople,
      deniedScans,
      exitedPeople,
      exitedScans,
      receptionScans,
      receptionPeople,
      receptionAmountCents,
    },
    days,
    events,
  };
}

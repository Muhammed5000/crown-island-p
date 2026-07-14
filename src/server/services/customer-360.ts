import 'server-only';
import type { Prisma } from '@prisma/client';
import { parsePhoneNumber } from 'libphonenumber-js';
import { prisma } from '@/server/db/prisma';
import { resortCivilDayUTC, formatDate } from '@/lib/date';
import { dedupeKnownGuests, type KnownGuest } from './customer-prefill-core';

export type { KnownGuest } from './customer-prefill-core';

/**
 * Customer-360 for the reception desk — one lookup that surfaces everything an
 * operator needs to answer a walk-up question: who the customer is, what they
 * owe (active sanctions), and their full booking history (dates, status,
 * payment, assigned places, check-in progress).
 *
 * It unifies the two kinds of "customer" the resort has:
 *   • ACCOUNT customers (booked online) — matched on the User + CustomerProfile,
 *     and their reception (walk-in) bookings are folded in by phone.
 *   • Pure WALK-INS (no account) — matched on the booking's own guestName /
 *     guestPhone, so a repeat walk-in's history is still visible.
 *
 * Read-only and desk-safe (no admin-only sanction notes).
 */

export interface CustomerCandidate {
  /** Account id, or null for a walk-in with no account. */
  userId: string | null;
  phone: string | null;
  name: string | null;
  email: string | null;
  nationalId: string | null;
  /** Sum of ACTIVE sanctions (0 for walk-ins / nothing owed). */
  sanctionCents: number;
  isWalkin: boolean;
}

export interface CustomerBookingRow {
  id: string;
  reference: string;
  serviceName: string;
  categoryName: string;
  dateLabel: string;
  status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';
  people: number;
  checkedInCount: number;
  totalCents: number | null;
  paid: boolean;
  /** Distinct assigned place labels (umbrellas / cabanas), in order. */
  places: string[];
  channel: 'ONLINE' | 'RECEPTION';
  /** Today-or-later and still live. */
  upcoming: boolean;
}

export interface CustomerProfile {
  userId: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  nationalId: string | null;
  isWalkin: boolean;
  sanctions: { totalCents: number; items: { amountCents: number; reason: string }[] };
  bookings: CustomerBookingRow[];
}

/** OR-clauses that own a customer's bookings: their account AND their walk-in phone. */
function bookingOwnerWhere(userId: string | null, phone: string | null): Prisma.BookingWhereInput[] {
  const ors: Prisma.BookingWhereInput[] = [];
  if (userId) ors.push({ userId });
  if (phone) ors.push({ guestPhone: phone });
  // Never-match guard so an empty OR can't select arbitrary rows.
  return ors.length ? ors : [{ id: '__no_such_booking__' }];
}

/**
 * Candidate customers matching a name / phone / email / national-id needle.
 * Account customers first (with their outstanding balance), then account-less
 * walk-ins discovered from booking guest fields.
 */
export async function searchCustomersForReception(
  rawQuery: string,
  limit = 24,
): Promise<CustomerCandidate[]> {
  const q = rawQuery.trim();
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, '').replace(/^0+/, '');
  const phoneNeedle = digits.length >= 4 ? digits : q;

  // ── 1. Account customers ──
  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      role: 'CUSTOMER',
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: phoneNeedle } },
        { profile: { fullName: { contains: q, mode: 'insensitive' } } },
        { profile: { phone: { contains: phoneNeedle } } },
        { profile: { nationalId: { contains: digits || q } } },
        { profile: { passportId: { contains: q, mode: 'insensitive' } } },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      profile: { select: { fullName: true, phone: true, nationalId: true, passportId: true } },
    },
    take: limit,
  });

  // One grouped query for everyone's outstanding balance (no N+1).
  const owedByUser = new Map<string, number>();
  if (users.length) {
    const grouped = await prisma.sanction.groupBy({
      by: ['userId'],
      where: { userId: { in: users.map((u) => u.id) }, status: 'ACTIVE' },
      _sum: { amountCents: true },
    });
    for (const g of grouped) owedByUser.set(g.userId, g._sum.amountCents ?? 0);
  }

  const candidates: CustomerCandidate[] = users.map((u) => ({
    userId: u.id,
    phone: u.phone ?? u.profile?.phone ?? null,
    name: u.name ?? u.profile?.fullName ?? null,
    email: u.email,
    nationalId: u.profile?.nationalId ?? u.profile?.passportId ?? null,
    sanctionCents: owedByUser.get(u.id) ?? 0,
    isWalkin: false,
  }));

  // ── 2. Account-less walk-ins (from reception booking guest fields) ──
  if (candidates.length < limit) {
    const accountPhones = new Set(candidates.map((c) => c.phone).filter(Boolean) as string[]);
    const walkinRows = await prisma.booking.findMany({
      where: {
        createdByStaffId: { not: null },
        OR: [
          { guestPhone: { contains: phoneNeedle } },
          { guestName: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { guestPhone: true, guestName: true },
      orderBy: { createdAt: 'desc' },
      take: 120,
    });
    const seen = new Set<string>();
    for (const w of walkinRows) {
      const ph = w.guestPhone?.trim();
      if (!ph || accountPhones.has(ph) || seen.has(ph)) continue;
      seen.add(ph);
      candidates.push({
        userId: null,
        phone: ph,
        name: w.guestName ?? null,
        email: null,
        nationalId: null,
        sanctionCents: 0,
        isWalkin: true,
      });
      if (candidates.length >= limit) break;
    }
  }

  // Owed customers first, then by name.
  return candidates.sort(
    (a, b) => b.sanctionCents - a.sanctionCents || (a.name ?? '').localeCompare(b.name ?? ''),
  );
}

const bookingInclude = {
  service: { select: { nameEn: true, nameAr: true, category: { select: { nameEn: true, nameAr: true } } } },
  invoice: { select: { totalCents: true, status: true } },
  units: { select: { unitIndex: true, place: { select: { id: true, label: true } } } },
} satisfies Prisma.BookingInclude;

type FullBookingRow = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

function distinctPlaceLabels(units: FullBookingRow['units']): string[] {
  const seen = new Map<string, string>();
  for (const u of [...units].sort((a, b) => a.unitIndex - b.unitIndex)) {
    if (u.place) seen.set(u.place.id, u.place.label);
  }
  return Array.from(seen.values());
}

/**
 * Full desk profile for an account (`userId`) or a walk-in (`phone`). Returns
 * null when neither identifier is given. Bookings are merged from the account
 * and the matching walk-in phone, newest first.
 */
export async function getCustomerProfileForReception(
  ref: { userId?: string | null; phone?: string | null },
  locale: 'ar' | 'en',
): Promise<CustomerProfile | null> {
  const ar = locale === 'ar';
  const todayUtc = new Date(resortCivilDayUTC());

  const userId = ref.userId ?? null;
  let name: string | null = null;
  let phone: string | null = ref.phone ?? null;
  let email: string | null = null;
  let nationalId: string | null = null;
  let isWalkin = true;

  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        profile: { select: { fullName: true, phone: true, nationalId: true, passportId: true } },
      },
    });
    if (!user) return null;
    isWalkin = false;
    name = user.name ?? user.profile?.fullName ?? null;
    email = user.email;
    phone = user.phone ?? user.profile?.phone ?? phone;
    nationalId = user.profile?.nationalId ?? user.profile?.passportId ?? null;
  } else {
    if (!phone) return null;
    // Walk-in: best display name from their most recent booking.
    const latest = await prisma.booking.findFirst({
      where: { guestPhone: phone },
      orderBy: { createdAt: 'desc' },
      select: { guestName: true },
    });
    name = latest?.guestName ?? null;
  }

  // Outstanding sanctions (accounts only — a walk-in with no account owes none).
  let sanctions = { totalCents: 0, items: [] as { amountCents: number; reason: string }[] };
  if (userId) {
    const rows = await prisma.sanction.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { amountCents: true, reason: true },
      orderBy: { createdAt: 'desc' },
    });
    sanctions = {
      totalCents: rows.reduce((s, r) => s + r.amountCents, 0),
      items: rows.map((r) => ({ amountCents: r.amountCents, reason: r.reason })),
    };
  }

  const rows = await prisma.booking.findMany({
    where: { OR: bookingOwnerWhere(userId, phone) },
    include: bookingInclude,
    orderBy: { bookingDate: 'desc' },
    take: 40,
  });

  const bookings: CustomerBookingRow[] = rows.map((b) => {
    const endsAt = b.endDate && b.endDate.getTime() !== b.bookingDate.getTime() ? b.endDate : null;
    const dateLabel = endsAt
      ? `${formatDate(b.bookingDate, locale)} → ${formatDate(endsAt, locale)}`
      : formatDate(b.bookingDate, locale);
    return {
      id: b.id,
      reference: b.reference,
      serviceName: ar ? b.service.nameAr : b.service.nameEn,
      categoryName: ar ? b.service.category.nameAr : b.service.category.nameEn,
      dateLabel,
      status: b.status,
      people: b.people,
      checkedInCount: b.checkedInCount,
      totalCents: b.invoice?.totalCents ?? null,
      paid: b.invoice?.status === 'PAID',
      places: distinctPlaceLabels(b.units),
      channel: b.createdByStaffId ? 'RECEPTION' : 'ONLINE',
      upcoming:
        (b.status === 'CONFIRMED' || b.status === 'PENDING_PAYMENT') &&
        (endsAt ?? b.bookingDate).getTime() >= todayUtc.getTime(),
    };
  });

  return { userId, name, phone, email, nationalId, isWalkin, sanctions, bookings };
}

// ───── Returning-guest prefill (one-tap repeat booking) ──────────────────────

export interface ReceptionPrefill {
  identity: {
    userId: string | null;
    name: string | null;
    /** Stored E.164 phone — feeds the wizard's phone field directly. */
    phone: string | null;
    /** ISO country for the wizard's dial-code select (parsed from the phone). */
    countryCode: string;
    nationalId: string | null;
  };
  /** Sum of ACTIVE sanctions (0 for walk-ins) — surfaced on the picker. */
  sanctionCents: number;
  /** Distinct party members from history, newest-first (deduped by ID number). */
  knownGuests: KnownGuest[];
  /** The customer's most recent booking, as a starting suggestion. */
  lastBooking: {
    serviceId: string;
    categoryId: string;
    adults: number;
    children: number;
    cars: number;
    extraPersons: number;
  } | null;
}

/**
 * Everything the desk wizard needs to prefill a repeat booking for a returning
 * customer: identity for step 1, the deduped known-guest documents for step 2's
 * ID cards, and the last booking's shape as a suggestion. Derived entirely from
 * existing history (see customer-prefill-core) — nothing is denormalized.
 */
export async function getReceptionPrefill(ref: {
  userId?: string | null;
  phone?: string | null;
}): Promise<ReceptionPrefill | null> {
  const userId = ref.userId ?? null;
  let name: string | null = null;
  let phone: string | null = ref.phone ?? null;
  let nationalId: string | null = null;

  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        phone: true,
        profile: { select: { fullName: true, phone: true, nationalId: true, passportId: true } },
      },
    });
    if (!user) return null;
    name = user.name ?? user.profile?.fullName ?? null;
    phone = user.phone ?? user.profile?.phone ?? phone;
    nationalId = user.profile?.nationalId ?? user.profile?.passportId ?? null;
  } else if (!phone) {
    return null;
  }

  // The customer's bookings — account-owned AND walk-ins on their phone (the
  // same ownership rule the profile view uses). Used for the walk-in name
  // fallback and the last-booking suggestion (NOT for known guests — those come
  // from a documents-first query below, so a run of doc-less online bookings
  // can't push the guest's saved IDs out of a small recent window).
  const ownerWhere = bookingOwnerWhere(userId, phone);
  const bookings = await prisma.booking.findMany({
    where: { OR: ownerWhere },
    select: {
      id: true,
      createdAt: true,
      status: true,
      guestName: true,
      serviceId: true,
      adults: true,
      children: true,
      cars: true,
      extraPersons: true,
      service: { select: { categoryId: true, isActive: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 40,
  });

  // Walk-in display name fallback: their most recent booking's guest name.
  if (!name) name = bookings.find((b) => b.guestName)?.guestName ?? null;

  // The dial-code select needs an ISO country; the stored phone is E.164 so it
  // carries its own country. Fall back to EG (the resort's home market).
  let countryCode = 'EG';
  if (phone) {
    try {
      countryCode = parsePhoneNumber(phone).country ?? 'EG';
    } catch {
      /* unparseable legacy value — keep EG */
    }
  }

  let sanctionCents = 0;
  if (userId) {
    const owed = await prisma.sanction.aggregate({
      where: { userId, status: 'ACTIVE' },
      _sum: { amountCents: true },
    });
    sanctionCents = owed._sum.amountCents ?? 0;
  }

  // Distinct party members from the history's ID documents, newest-wins.
  // Documents-first (join through the booking-owner filter) rather than
  // "documents of the 40 most-recent bookings", so a guest whose recent
  // activity is doc-less online bookings still surfaces their saved IDs. Only
  // reception bookings carry documents, so the cap comfortably covers real
  // parties while bounding the scan.
  const docs = await prisma.guestIdDocument.findMany({
    where: { booking: { OR: ownerWhere } },
    select: { id: true, guestName: true, imageUrl: true, fileName: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 60,
  });
  const knownGuests = dedupeKnownGuests(
    docs.map((d) => ({
      documentId: d.id,
      idNumber: d.guestName,
      imageUrl: d.imageUrl,
      fileName: d.fileName,
      seenAtIso: d.createdAt.toISOString(),
    })),
  );

  // Suggest the most recent CONFIRMED booking whose service is still active — a
  // cancelled/failed/expired attempt is not the customer's "usual", and an
  // archived service would leave the wizard's selects dangling.
  const last = bookings.find((b) => b.status === 'CONFIRMED' && b.service.isActive);
  const lastBooking = last
    ? {
        serviceId: last.serviceId,
        categoryId: last.service.categoryId,
        adults: last.adults,
        children: last.children,
        cars: last.cars,
        extraPersons: last.extraPersons,
      }
    : null;

  return {
    identity: { userId, name, phone, countryCode, nationalId },
    sanctionCents,
    knownGuests,
    lastBooking,
  };
}

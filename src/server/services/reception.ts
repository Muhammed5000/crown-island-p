import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { generateBookingReference } from '@/lib/reference';
import { assertBookingWritesEnabled } from '@/server/settings/settings';
import { calcBooking } from './booking-calc';
import { unitCapacityCost } from './capacity-cost';
import { expandDateRange } from './booking';
import { cloneSensitiveUpload, discardClonedUpload, prepareGuestIdRow, validateProofUrl } from './guest-id';
import { guestDocBelongsToCustomer } from './customer-prefill-core';
import { anyDocumentNumberBlocked, isAnyIdentityBlocked } from './blocklist';
import { ensureVisitForBooking } from './visit-code';
import { outagedPlaceIds, getAvailablePlaces } from './place-assignment';
import { firstUnavailablePlace } from './place-capacity-core';
import { redeemPromoForReception } from './promo';
import { resolveManualDiscount } from './staff-discount';
import { assembleFinalTotalCents } from './insurance-core';
import { recordWorkActivity } from './work-session';
import {
  claimSanctionsForBooking,
  getPayableSanctionsForUser,
  settleSanctionsForBooking,
} from './sanctions';
import { audit } from '@/server/audit/audit';
import { formatDate, parseIsoDateUTC, resortCivilDayUTC } from '@/lib/date';
import { DomainError, PastDateError } from './errors';

/**
 * Reception (offline) bookings.
 *
 * A staff member at the reception desk creates a booking on behalf of a walk-in
 * customer who has NO website account. The booking is attributed to the staff
 * member's `userId`, while the real customer's name + phone live in
 * `guestName` / `guestPhone`. `createdByStaffId` marks the booking as a
 * reception booking.
 *
 * Payment is RECORDED, never processed: the staff picks how the customer paid
 * (CASH or INSTAPAY) and the booking is confirmed immediately — capacity is
 * reserved exactly like a real online confirmation. For INSTAPAY the staff may
 * attach a proof-of-payment image (`proofUrl`).
 */

export type ReceptionPaymentMethod = 'CASH' | 'INSTAPAY';

export interface CreateReceptionBookingInput {
  staffId: string;
  /**
   * Idempotency key generated once per booking ATTEMPT on the desk and reused on
   * a retry (like the customer wizard's `clientRequestId`). Backed by
   * `@@unique([userId, clientRequestId])`, so a retried commit — including one
   * where a lost proxy response hid an already-committed booking — returns the
   * existing booking instead of duplicating it + double-charging.
   */
  clientRequestId: string;
  serviceId: string;
  /** yyyy-mm-dd (first day). */
  date: string;
  /** yyyy-mm-dd last day (inclusive) for multi-day services. */
  endDate?: string;
  /** Legacy total persons; treated as adults when `adults` is omitted. */
  people: number;
  /** Adult persons (defaults to `people`). */
  adults?: number;
  /** Children (age ≤ service.maxChildAge). */
  children?: number;
  /**
   * Optional paid "Extra Person" add-on count (services with `allowExtraPeople`).
   * Billed separately at `extraPersonPriceCents`; never opens a unit/umbrella and
   * never counts toward capacity. Each extra person still needs an ID + counts at
   * the gate. Ignored by services that don't offer the add-on.
   */
  extraPersons?: number;
  cars: number;
  locale: 'ar' | 'en';
  guestName: string;
  guestPhone: string;
  /** Optional staff-applied promo code (percentage off). Validated at commit. */
  promoCode?: string | null;
  /**
   * Optional manual discount authorized by a supervisor PIN. Mutually exclusive
   * with `promoCode` (one discount per booking). The booking is recorded as made
   * by the authorizer and the % is clamped to their role's ceiling at commit.
   */
  manualDiscount?: { pin: string; percent: number } | null;
  paymentMethod: ReceptionPaymentMethod;
  /** Public URL of the uploaded InstaPay proof image (INSTAPAY only). */
  proofUrl?: string | null;
  /**
   * Guest identity documents collected in the wizard before commit (deferred
   * model). One per guest slot (1 … total guests). Persisted atomically with the
   * booking; the count must match the party size or the booking is rejected.
   */
  guestIds?: {
    guestSeq: number;
    imageUrl: string;
    fileName: string;
    guestName?: string | null;
    /**
     * Returning-guest reuse: the prior booking's `GuestIdDocument.id` whose
     * photo this slot reuses. When set, the SERVER's copy of that document is
     * the source of truth (its file is cloned; the client's imageUrl/fileName
     * are ignored) and ownership is verified against the new booking's guest
     * phone — see the reuse block in `createReceptionBooking`.
     */
    sourceDocumentId?: string | null;
  }[];
  /**
   * Place assignments chosen on the 2D map before commit. `unitIndex` is the
   * 0-based unit ordinal; the same place is held across all of the booking's days.
   */
  placements?: { unitIndex: number; placeId: string }[];
}

export interface CreateReceptionBookingResult {
  bookingId: string;
  reference: string;
  totalCents: number;
}

function parseDateOnly(iso: string): Date {
  const d = parseIsoDateUTC(iso);
  if (!d) throw new PastDateError();
  return d;
}

/** Distribute `total` as evenly as possible across `parts` buckets. */
function distribute(total: number, parts: number): number[] {
  const out = new Array(Math.max(1, parts)).fill(0) as number[];
  for (let i = 0; i < total; i++) out[i % out.length]! += 1;
  return out;
}

export async function createReceptionBooking(
  input: CreateReceptionBookingInput,
): Promise<CreateReceptionBookingResult> {
  await assertBookingWritesEnabled();

  // ── Idempotency (up-front): a retried commit with the same clientRequestId
  // returns the already-created booking instead of duplicating it. This is the
  // common case — a desk double-click, or a lost proxy response after online had
  // already committed. The concurrent-race case is additionally backstopped by
  // the unique (userId, clientRequestId) + the P2002 handler in the catch below.
  const priorBooking = await prisma.booking.findFirst({
    where: { clientRequestId: input.clientRequestId },
    select: { id: true, reference: true, invoice: { select: { totalCents: true } } },
  });
  if (priorBooking) {
    return {
      bookingId: priorBooking.id,
      reference: priorBooking.reference,
      totalCents: priorBooking.invoice?.totalCents ?? 0,
    };
  }

  const adults = Math.max(1, Math.trunc(input.adults ?? input.people));
  const children = Math.max(0, Math.trunc(input.children ?? 0));
  const extraPersons = Math.max(0, Math.trunc(input.extraPersons ?? 0));
  const cars = Math.max(0, Math.trunc(input.cars));
  const dates = expandDateRange(input.date, input.endDate);
  const firstDay = parseDateOnly(dates[0]!);
  const lastDay = parseDateOnly(dates[dates.length - 1]!);
  const totalPeople = adults + children;

  // Shape-validate the guest IDs BEFORE any filesystem work. When provided they
  // must cover every adult exactly (one per slot 1…adults, no duplicates). Doing
  // this first BOUNDS the reused-file cloning below to at most `adults` copies —
  // otherwise a crafted request of 200 slots all reusing one document would
  // clone that photo 200 times before the party-size check (inside the tx)
  // rejected it, leaking 200 orphaned files. (The tx re-checks too.)
  // Guest IDs are MANDATORY for every ADULT at reception (owner policy): this is
  // what binds the booking to a real identity, so an outstanding sanction, an
  // identity block, or a once-per-customer promo can't be evaded by giving a
  // non-matching phone. Shape-validated here (count + seq, before any filesystem
  // work); the ID NUMBER presence is re-checked on the RESOLVED documents inside
  // the tx (a reused slot gets its number from the source document, not the client).
  if ((input.guestIds ?? []).length !== adults) {
    throw new DomainError('Upload every adult guest ID', 'guest_id_required', 409);
  }
  {
    const seenSeq = new Set<number>();
    for (const g of input.guestIds!) {
      const seq = Math.trunc(g.guestSeq);
      if (seq < 1 || seq > adults) {
        throw new DomainError('Guest number is out of range', 'guest_seq_out_of_range', 400);
      }
      if (seenSeq.has(seq)) {
        throw new DomainError('Duplicate guest number in request', 'duplicate_guest_seq', 400);
      }
      seenSeq.add(seq);
    }
  }

  // Returning-guest reuse: slots carrying a `sourceDocumentId` reuse a PRIOR
  // booking's stored ID photo instead of a fresh upload. Resolve them first —
  // batch-load the source documents and verify OWNERSHIP for every slot before
  // cloning any file (the IDOR guard: document ids are enumerable, so a crafted
  // request must never be able to attach another customer's ID to this booking).
  // Ownership is derived server-side from the new booking's guest phone only —
  // a client-sent customer id is never trusted (see guestDocBelongsToCustomer).
  const reuseIds = (input.guestIds ?? [])
    .map((g) => g.sourceDocumentId)
    .filter((id): id is string => !!id);
  const sourceDocs = new Map<
    string,
    { imageUrl: string; fileName: string; guestName: string | null }
  >();
  if (reuseIds.length) {
    const [docs, accountUser] = await Promise.all([
      prisma.guestIdDocument.findMany({
        where: { id: { in: reuseIds } },
        select: {
          id: true,
          imageUrl: true,
          fileName: true,
          guestName: true,
          booking: { select: { userId: true, guestPhone: true, createdByStaffId: true } },
        },
      }),
      prisma.user.findUnique({ where: { phone: input.guestPhone }, select: { id: true } }),
    ]);
    const byId = new Map(docs.map((d) => [d.id, d]));
    for (const id of reuseIds) {
      const doc = byId.get(id);
      if (!doc) {
        throw new DomainError('Reused guest ID no longer exists', 'guest_id_source_invalid', 400);
      }
      const owned = guestDocBelongsToCustomer(
        {
          bookingUserId: doc.booking.userId,
          bookingGuestPhone: doc.booking.guestPhone,
          bookingCreatedByStaffId: doc.booking.createdByStaffId,
        },
        { guestPhone: input.guestPhone, accountUserId: accountUser?.id ?? null },
      );
      if (!owned) {
        throw new DomainError(
          'Reused guest ID belongs to a different customer',
          'guest_id_source_forbidden',
          403,
        );
      }
      sourceDocs.set(id, { imageUrl: doc.imageUrl, fileName: doc.fileName, guestName: doc.guestName });
    }
  }

  // Clones are filesystem writes made BEFORE the transaction; if anything below
  // (blocklist, capacity, placement, a Serializable retry) aborts the booking,
  // the copied files must be unlinked or they orphan in the private store. Track
  // them so the catch can undo them.
  const clonedUploadUrls: string[] = [];
  const cleanupClones = async () => {
    await Promise.all(clonedUploadUrls.map((u) => discardClonedUpload(u)));
    clonedUploadUrls.length = 0;
  };

  try {
  // Validate + stat every guest ID *before* the transaction (filesystem work
  // stays out of the tx). `prepareGuestIdRow` re-checks type/size on disk.
  // Reused slots CLONE the source document's file into a fresh private path —
  // two bookings must never share one file (each document owns its bytes) —
  // and take the SERVER's stored url/name, keeping only the staff-entered (or
  // prefilled) ID number from the client.
  const preparedIds = input.guestIds
    ? await Promise.all(
        input.guestIds.map(async (g) => {
          const source = g.sourceDocumentId ? sourceDocs.get(g.sourceDocumentId) : undefined;
          if (source) {
            const clonedUrl = await cloneSensitiveUpload(source.imageUrl, input.staffId);
            clonedUploadUrls.push(clonedUrl);
            return {
              guestSeq: Math.trunc(g.guestSeq),
              ...(await prepareGuestIdRow(clonedUrl, source.fileName, g.guestName ?? source.guestName)),
            };
          }
          return {
            guestSeq: Math.trunc(g.guestSeq),
            ...(await prepareGuestIdRow(g.imageUrl, g.fileName, g.guestName)),
          };
        }),
      )
    : [];

  // Identity blocklist: refuse to create a walk-in booking when ANY ID/passport
  // number is on the admin blocklist (matched as both national-id and passport —
  // see `anyDocumentNumberBlocked`). Mirrors the gate's check-in enforcement.
  // For REUSED slots we check the SOURCE document's stored number too, not only
  // the (client-supplied, editable) one — so staff can't launder a blocked
  // person's authentic stored photo through a cleared/edited number. Checked
  // before the transaction (read-only) to fail fast; only the generic `blocked`
  // code is surfaced — never the block reason / note.
  const numbersToCheck = [
    ...preparedIds.map((r) => r.guestName),
    ...[...sourceDocs.values()].map((s) => s.guestName),
  ];
  if (numbersToCheck.length && (await anyDocumentNumberBlocked(numbersToCheck))) {
    throw new DomainError('A guest on this booking is blocked', 'blocked', 403);
  }
  // Also block by the guest's PHONE — UNCONDITIONALLY (the number-based check
  // above is skipped when a crafted request omits guest IDs, so a phone-blocked
  // person could otherwise slip through). Mirrors the identity blocklist used at
  // registration / profile / gate. Only the generic `blocked` code is surfaced.
  if (input.guestPhone && (await isAnyIdentityBlocked([{ kind: 'PHONE', value: input.guestPhone }]))) {
    throw new DomainError('A guest on this booking is blocked', 'blocked', 403);
  }

  // Re-validate the InstaPay proof reference server-side (format + on-disk),
  // exactly like the guest IDs above — the action layer only length-checks it,
  // so a junk or external proofUrl must be rejected before it reaches the
  // Payment record. Only INSTAPAY persists a proof (see Payment.create below).
  if (input.paymentMethod === 'INSTAPAY' && input.proofUrl) {
    await validateProofUrl(input.proofUrl);
  }

  // Reception is a walk-in desk, so we deliberately skip the customer-facing
  // lead-time gate (staff book for "today"). Capacity + pricing are still
  // enforced inside the transaction (via calcBooking) so the desk can never
  // oversell a slot.
  try {
    const result = await prisma.$transaction(
    async (tx) => {
      // Authoritative calculation + per-day capacity check + validation.
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

      const service = await tx.service.findUniqueOrThrow({
        where: { id: input.serviceId },
        select: { kind: true, categoryId: true, placeAssignmentRequired: true },
      });

      // Outstanding penalties are bound to IDENTITY, not just a typeable phone:
      // collect every ACTIVE sanction owed by the account matching the walk-in
      // phone OR any of the captured government-ID numbers, so a walk-in can't
      // dodge a fine by giving a phone that isn't theirs. Deduped by sanction id;
      // settled in this same transaction (claim + settle below).
      const idNumbers = preparedIds
        .map((r) => r.guestName?.trim())
        .filter((n): n is string => !!n);
      const sanctionedUsers = await tx.user.findMany({
        where: {
          deletedAt: null,
          OR: [
            { phone: input.guestPhone },
            ...(idNumbers.length
              ? [{ profile: { OR: [{ nationalId: { in: idNumbers } }, { passportId: { in: idNumbers } }] } }]
              : []),
          ],
        },
        select: { id: true },
      });
      type PayableSanction = Awaited<ReturnType<typeof getPayableSanctionsForUser>>['sanctions'][number];
      const penalties = { sanctions: [] as PayableSanction[], totalCents: 0 };
      const seenSanctionIds = new Set<string>();
      for (const u of sanctionedUsers) {
        const owed = await getPayableSanctionsForUser(u.id, tx);
        for (const s of owed.sanctions) {
          if (seenSanctionIds.has(s.id)) continue;
          seenSanctionIds.add(s.id);
          penalties.sanctions.push(s);
          penalties.totalCents += s.amountCents;
        }
      }

      // Guest IDs are mandatory at reception for every ADULT: exactly one per slot
      // 1 … adults (children carry no ID), each with a NON-BLANK government-ID
      // number — the number is what the sanction / blocklist / promo identity checks
      // key on, so a blank one would let a real identity slip through.
      if (preparedIds.length !== adults) {
        throw new DomainError('Upload every adult guest ID', 'guest_id_required', 409);
      }
      for (const r of preparedIds) {
        if (r.guestSeq < 1 || r.guestSeq > adults) {
          throw new DomainError('Guest number is out of range', 'guest_seq_out_of_range', 400);
        }
        if (!r.guestName?.trim()) {
          throw new DomainError('Enter a valid ID number for every adult', 'guest_id_number_required', 400);
        }
      }

      // One discount per booking: a customer promo code OR a manual supervisor
      // discount, never both.
      const hasPromo = !!(input.promoCode && input.promoCode.trim());
      const hasManual = !!input.manualDiscount;
      if (hasPromo && hasManual) {
        throw new DomainError('Use either a promo code or a manual discount — not both', 'one_discount_only', 409);
      }

      let discountCents = 0;
      let appliedPromoCode: string | null = null;
      let manualPercent: number | null = null;
      let authorizerId: string | null = null;
      let authorizerName: string | null = null;
      let discountLine:
        | { label: string; quantity: number; unitCents: number; totalCents: number; meta: Prisma.InputJsonValue }
        | null = null;

      // A manual discount changes who the booking is attributed to, so resolve
      // (authorize the PIN, clamp to the role's ceiling) BEFORE creating it.
      if (hasManual) {
        const md = await resolveManualDiscount(tx, {
          pin: input.manualDiscount!.pin,
          percent: input.manualDiscount!.percent,
          subtotalCents: calc.subtotalCents,
        });
        discountCents = md.discountCents;
        manualPercent = md.percent;
        authorizerId = md.authorizer.id;
        authorizerName = md.authorizer.name;
        discountLine = {
          label: 'manual_discount',
          quantity: 1,
          unitCents: -discountCents,
          totalCents: -discountCents,
          meta: { kind: 'MANUAL', percent: md.percent, authorizedById: md.authorizer.id, authorizedBy: md.authorizer.name, role: md.authorizer.role },
        };
      }

      // The booking is recorded as made by the authorizer when a manual discount
      // is applied (the desk's "convert to supervisor" step); otherwise the
      // logged-in reception staff own it.
      const ownerId = authorizerId ?? input.staffId;

      const reference = generateBookingReference();
      const booking = await tx.booking.create({
        data: {
          reference,
          userId: ownerId,
          serviceId: input.serviceId,
          bookingDate: firstDay,
          endDate: dates.length > 1 ? lastDay : null,
          people: totalPeople,
          adults,
          children,
          // Allocation-validated add-on count (0 for services without the add-on).
          extraPersons: calc.extraPersons,
          unitsPerDay: calc.unitsPerDay,
          cars,
          // Handicap count removed from the booking flow; kept as 0 for the
          // backward-compatible legacy column.
          handicapPeople: 0,
          clientRequestId: input.clientRequestId,
          locale: input.locale,
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          placementStatus: service.placeAssignmentRequired ? 'PENDING' : 'NOT_REQUIRED',
          guestName: input.guestName,
          guestPhone: input.guestPhone,
          createdByStaffId: ownerId,
          manualDiscountPercent: manualPercent,
          discountAuthorizedById: authorizerId,
          // The reception operator physically at the desk — recorded alongside
          // the authorizer so both staff are shown on the booking.
          enteredByStaffId: input.staffId,
        },
      });

      // Daily visit group: walk-ins group by the GUEST's phone (the booking's
      // userId is the staff member, so it must never be the grouping key) —
      // a returning guest's second booking of the day joins the same pass.
      await ensureVisitForBooking(tx, booking.id);

      // Redeem a promo code (if any) now that the booking exists. Throws a typed
      // DomainError — rolling back the whole booking — if the code is invalid,
      // expired, capped, or already used by this customer.
      if (hasPromo) {
        const promo = await redeemPromoForReception(tx, {
          code: input.promoCode!,
          customerPhone: input.guestPhone,
          // Key the once-per-customer guard on the primary guest's ID number so
          // the same person can't reuse a code with a different phone.
          guestIdNumber: preparedIds.find((r) => r.guestSeq === 1)?.guestName ?? preparedIds[0]?.guestName ?? null,
          bookingId: booking.id,
          subtotalCents: calc.subtotalCents,
        });
        discountCents = promo.discountCents;
        appliedPromoCode = promo.code;
        discountLine = {
          label: 'promo_discount',
          quantity: 1,
          unitCents: -discountCents,
          totalCents: -discountCents,
          meta: { kind: 'PROMO', code: promo.code, percentOff: promo.percentOff },
        };
      }
      // Discounts apply to the BOOKING value only; penalties are debts and the
      // insurance deposit is a separate un-discountable balance — both are added
      // after the clamp: total = max(0, booking − discount) + penalties + insurance.
      // A 100% discount/voucher still collects the full deposit; voucher excess
      // dies inside the clamp and can never bleed into it (docs/INSURANCE.md).
      const finalTotalCents = assembleFinalTotalCents({
        serviceTotalCents: calc.totalCents,
        discountCents,
        penaltiesCents: penalties.totalCents,
        insuranceCents: calc.insuranceCents,
      });

      // Reserve the penalties for this booking, then settle them right away —
      // the desk collects the money immediately. The conditional claim throws
      // (rolling everything back) if a concurrent booking grabbed any of them.
      await claimSanctionsForBooking(tx, penalties.sanctions, booking.id);
      await settleSanctionsForBooking(
        tx,
        booking.id,
        input.staffId,
        'Paid at the reception desk',
      );

      await tx.invoice.create({
        data: {
          bookingId: booking.id,
          status: 'PAID',
          currency: 'EGP',
          subtotalCents: calc.subtotalCents,
          taxCents: calc.taxCents,
          feeCents: calc.feeCents,
          totalCents: finalTotalCents,
          issuedAt: new Date(),
          paidAt: new Date(),
          lines: {
            create: [
              ...calc.lines.map((l) => ({
                label: l.labelKey,
                quantity: l.quantity,
                unitCents: l.unitCents,
                totalCents: l.totalCents,
                meta: { kind: l.kind } as Prisma.InputJsonValue,
              })),
              ...(discountLine ? [discountLine] : []),
              ...penalties.sanctions.map((s) => ({
                label: 'services.sanction',
                quantity: 1,
                unitCents: s.amountCents,
                totalCents: s.amountCents,
                meta: { kind: 'SANCTION', sanctionId: s.id, reason: s.reason } as Prisma.InputJsonValue,
              })),
              // Insurance deposit line — outside `subtotalCents`, never discounted.
              ...(calc.insuranceSnapshot
                ? [
                    {
                      label: 'services.insurance',
                      quantity: 1,
                      unitCents: calc.insuranceSnapshot.amountCents,
                      totalCents: calc.insuranceSnapshot.amountCents,
                      meta: { kind: 'INSURANCE' } as Prisma.InputJsonValue,
                    },
                  ]
                : []),
            ],
          },
        },
      });

      // Frozen insurance snapshot. The desk collects the money in hand, so the
      // deposit is COLLECTED in the same transaction as the SUCCEEDED payment.
      // `paidVia` snapshots the channel — it drives the allowed refund methods
      // at checkout (cash/InstaPay for desk money; never a gateway refund).
      if (calc.insuranceSnapshot) {
        await tx.bookingInsurance.create({
          data: {
            bookingId: booking.id,
            type: calc.insuranceSnapshot.type,
            percent: calc.insuranceSnapshot.percent,
            fixedCents: calc.insuranceSnapshot.fixedCents,
            baseCents: calc.insuranceSnapshot.baseCents,
            amountCents: calc.insuranceSnapshot.amountCents,
            collectionStatus: 'COLLECTED',
            collectedAt: new Date(),
            paidVia: input.paymentMethod,
          },
        });
      }

      // One BookingUnit per physical unit per day; party split evenly.
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

      // Persist guest IDs collected in the wizard (atomic with the booking).
      if (preparedIds.length) {
        await tx.guestIdDocument.createMany({
          data: preparedIds.map((r) => ({
            bookingId: booking.id,
            guestSeq: r.guestSeq,
            guestName: r.guestName,
            fileName: r.fileName,
            fileType: r.fileType,
            fileSizeBytes: r.fileSizeBytes,
            storagePath: r.storagePath,
            imageUrl: r.imageUrl,
            uploadedById: input.staffId,
            verificationStatus: 'PENDING',
          })),
        });
      }

      // Apply place assignments chosen on the 2D map. The same place is held
      // across all of the booking's days (per unitIndex). The unique
      // [placeId, date] constraint guards against a concurrent grab — a clash
      // rolls the whole transaction back, so the desk can never double-book a place.
      if (input.placements?.length && service.placeAssignmentRequired) {
        // Validate the chosen places server-side, mirroring `assignPlaces` (the
        // gate path) so a crafted request can't pin a unit to a place that isn't
        // this service's, is inactive, is out of service, or is named twice. The
        // unique [placeId, date] index is the concurrency backstop; these checks
        // give a precise typed error instead of a late raw collision.
        const placementIds = input.placements.map((p) => p.placeId);
        if (new Set(placementIds).size !== placementIds.length) {
          throw new DomainError('Duplicate place in request', 'duplicate_place', 409);
        }
        const validPlaces = await tx.servicePlace.findMany({
          where: { id: { in: placementIds }, serviceId: input.serviceId, isActive: true },
          select: { id: true },
        });
        if (validPlaces.length !== placementIds.length) {
          throw new DomainError('Place not in this service', 'invalid_place', 400);
        }
        const placementDays = dates.map(parseDateOnly);
        const outaged = await outagedPlaceIds(input.serviceId, placementDays, tx);
        if (placementIds.some((id) => outaged.has(id))) {
          throw new DomainError('Place is out of service', 'place_out_of_service', 409);
        }
        // PREVENTIVE freedom check: reject a place already held by another live
        // booking on any of this booking's days BEFORE writing — a clean error and
        // never a silent overwrite of a not-yet-arrived guest's place. The unique
        // [placeId, date] index (caught as `place_taken` below) is the final
        // concurrency backstop; this makes the common case fail early and clearly.
        const freePlaces = await getAvailablePlaces(input.serviceId, placementDays, booking.id, tx);
        const freeIds = new Set(freePlaces.filter((pl) => pl.isAvailable).map((pl) => pl.id));
        const takenPlace = firstUnavailablePlace(placementIds, freeIds);
        if (takenPlace) {
          throw new DomainError('Place already taken', 'place_taken', 409);
        }
        for (const p of input.placements) {
          await tx.bookingUnit.updateMany({
            where: { bookingId: booking.id, unitIndex: p.unitIndex },
            data: { placeId: p.placeId, assignedById: input.staffId, assignedAt: new Date() },
          });
        }
        const placedUnits = new Set(input.placements.map((p) => p.unitIndex)).size;
        await tx.booking.update({
          where: { id: booking.id },
          data: { placementStatus: placedUnits >= calc.unitsPerDay ? 'COMPLETE' : 'PARTIAL' },
        });
      }

      // Record (never process) the payment method the customer used.
      await tx.payment.create({
        data: {
          bookingId: booking.id,
          provider: input.paymentMethod, // 'CASH' | 'INSTAPAY'
          status: 'SUCCEEDED',
          amountCents: finalTotalCents,
          currency: 'EGP',
          paidAt: new Date(),
          proofUrl: input.paymentMethod === 'INSTAPAY' ? (input.proofUrl ?? null) : null,
          failureMessage: 'RECEPTION_OFFLINE_PAYMENT',
        },
      });

      // Reserve confirmed capacity for every day, exactly like a real online
      // confirmation. Cars occupy parking on EVERY day of the stay (priced
      // per-day too), so reserve them on all days; the release path mirrors this.
      const perDayCost = unitCapacityCost(service.kind, calc.unitsPerDay, totalPeople);
      for (let i = 0; i < dates.length; i++) {
        const date = parseDateOnly(dates[i]!);
        // New reception bookings never carry a handicap count → reserve 0.
        const handicapForDay = 0;
        await tx.bookingSlot.upsert({
          where: { serviceId_date: { serviceId: input.serviceId, date } },
          create: {
            serviceId: input.serviceId,
            date,
            reservedPeople: perDayCost,
            reservedCars: cars,
            reservedHandicap: handicapForDay,
          },
          update: {
            reservedPeople: { increment: perDayCost },
            reservedCars: { increment: cars },
            reservedHandicap: { increment: handicapForDay },
          },
        });
      }

      // Audit actor = the staffer who physically entered it (accountability);
      // the booking itself is attributed to `ownerId` (the authorizer on a
      // manual discount). Both are captured.
      await audit(tx, {
        actorUserId: input.staffId,
        action: 'CREATE',
        entityType: 'Booking',
        entityId: booking.id,
        after: {
          channel: 'RECEPTION',
          paymentMethod: input.paymentMethod,
          guestName: input.guestName,
          totalCents: finalTotalCents,
          enteredByStaffId: input.staffId,
          ...(appliedPromoCode ? { promoCode: appliedPromoCode, discountCents } : {}),
          ...(manualPercent != null
            ? { manualDiscountPercent: manualPercent, discountCents, authorizedById: authorizerId, authorizedBy: authorizerName }
            : {}),
        },
      });

      // Record the reception sale as a gate-scan event so it lands on the admin
      // Gate-activity report. Attributed to `ownerId` so a manual-discount sale
      // shows under the supervisor who authorized it.
      await tx.gateScanEvent.create({
        data: {
          result: 'RECEPTION',
          operatorId: ownerId,
          bookingId: booking.id,
          scannedUserId: null,
          categoryId: service.categoryId,
          people: totalPeople,
          reference: booking.reference,
          reason: input.paymentMethod,
          amountCents: finalTotalCents,
        },
      });

      return {
        bookingId: booking.id,
        reference: booking.reference,
        totalCents: finalTotalCents,
      };
    },
    // Serializable mirrors the webhook-confirm path: createReceptionBooking
    // reads the slot capacity in calcBooking and increments it later in the same
    // tx, so under the DB default (Read Committed) two desks booking the last
    // unit could both read the pre-increment counter, both pass, and both commit
    // (oversell). Serializable aborts the second committer (Postgres 40001 →
    // Prisma P2034); the action retries and the retry then sees the increment and
    // correctly fails the capacity check.
    { maxWait: 5_000, timeout: 15_000, isolationLevel: 'Serializable' },
    );
    // Committed: the cloned files are now owned by persisted GuestIdDocument
    // rows. Forget them so a throw from any POST-commit best-effort step below
    // can never unlink a committed booking's ID photos.
    clonedUploadUrls.length = 0;
    // Sync the desk operator's work session (shift). Attributed to the staffer
    // who physically entered the booking, not a discount authorizer. Best-effort
    // + post-commit: never affects the sale just recorded.
    await recordWorkActivity(input.staffId, 'RECEPTION');

    // Provision physical (ZK) cabin access — best-effort, post-commit. A no-op for
    // non-ZK services or when the integration is off. If the place was assigned in
    // the wizard, the guest's card/QR bind to that cabin's door immediately.
    const { safeSyncBookingZkAccess } = await import('@/server/zk/provision');
    await safeSyncBookingZkAccess(result.bookingId);

    return result;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target)
        ? err.meta.target.join(',')
        : String(err.meta?.target ?? '');
      // Concurrent-race backstop: two simultaneous submits of the SAME
      // clientRequestId both cleared the up-front pre-check; the loser hits the
      // unique (userId, clientRequestId). Return the row the winner committed
      // instead of erroring — so a double-submit never double-books/charges.
      if (target.includes('clientRequestId')) {
        await cleanupClones();
        const existing = await prisma.booking.findFirst({
          where: { clientRequestId: input.clientRequestId },
          select: { id: true, reference: true, invoice: { select: { totalCents: true } } },
        });
        if (existing) {
          return {
            bookingId: existing.id,
            reference: existing.reference,
            totalCents: existing.invoice?.totalCents ?? 0,
          };
        }
      }
      // Otherwise it's a unique [placeId, date] collision — another operator (or a
      // second placement in this request) grabbed one of the chosen places. The
      // whole tx rolled back, so nothing was committed or oversold.
      throw new DomainError('Place was just taken', 'place_taken', 409);
    }
    throw err;
  }
  } catch (outerErr) {
    // The booking did not commit (validation, capacity, a place clash, or a
    // Serializable abort before the action retries) — unlink any files we cloned
    // for reused IDs so they don't orphan in the private store. No-op after a
    // successful commit (the tracking array was cleared above).
    await cleanupClones();
    throw outerErr;
  }
}

/**
 * Load a booking with everything the printable reception invoice + passes pages
 * need. Works for ANY booking — walk-in (reception) AND online — because both
 * pages are reception-staff-gated (`requireReceptionOrNull`), and staff routinely
 * print the invoice / entry tickets for an online customer they're checking in
 * at the gate. Previously this was restricted to `createdByStaffId != null`,
 * which 404'd those pages for every online booking. The `user` relation backs
 * the customer name/phone for online bookings (which leave `guestName` /
 * `guestPhone` null).
 */
export async function getReceptionBookingForInvoice(bookingId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId },
    include: {
      service: { include: { category: true } },
      invoice: { include: { lines: true } },
      payments: { orderBy: { createdAt: 'desc' }, take: 1 },
      units: { include: { place: true }, orderBy: [{ unitIndex: 'asc' }, { date: 'asc' }] },
      user: { select: { name: true, email: true, phone: true } },
      // Insurance deposit (if any) — printed as its own totals row so the
      // receipt separates the refundable deposit from the service amount.
      insurance: { select: { amountCents: true, collectionStatus: true } },
    },
  });
  return booking;
}

/**
 * Distinct assigned place labels for a booking, in unit order. A unit keeps the
 * same place across all its days, so we dedupe by place id. Returns [] when no
 * places are assigned yet.
 */
export function assignedPlaceLabels(
  units: { unitIndex: number; place: { id: string; label: string } | null }[],
): string[] {
  const seen = new Map<string, string>();
  for (const u of [...units].sort((a, b) => a.unitIndex - b.unitIndex)) {
    if (u.place) seen.set(u.place.id, u.place.label);
  }
  return Array.from(seen.values());
}

/**
 * One row of the reception "find a booking" search — everything the desk needs
 * to identify a guest and decide who still needs admitting.
 */
export interface ReceptionSearchRow {
  id: string;
  reference: string;
  /** Best display name: walk-in guest name, else the account holder/profile. */
  guestName: string;
  /** Best contact phone (walk-in, else account, else profile). */
  phone: string;
  /** National ID or passport on file (online bookings) — null for walk-ins. */
  nationalId: string | null;
  serviceName: string;
  categoryName: string;
  dateLabel: string;
  isMultiDay: boolean;
  people: number;
  checkedInCount: number;
  fullyCheckedIn: boolean;
  /** RECEPTION = walk-in created at the desk; ONLINE = booked on the website. */
  channel: 'RECEPTION' | 'ONLINE';
  /**
   * Insurance-deposit state for the desk badge + "Checkout" entry point. Null
   * when the booking has no COLLECTED deposit (none, still pending, or voided).
   */
  deposit: {
    status: 'UNDECIDED' | 'IN_PROGRESS' | 'REFUNDED' | 'RETAINED';
    amountCents: number;
  } | null;
}

// ── Shared "of the day" projection ──
// The find-a-booking search and the today's-bookings board return the SAME row
// shape, ordering, and relation graph — they differ only in the where filter.
// One include + one mapper keeps them in lockstep so a card renders identically
// in both modes.
const todayBookingRowInclude = {
  user: {
    select: {
      name: true,
      phone: true,
      profile: { select: { fullName: true, phone: true, nationalId: true, passportId: true } },
    },
  },
  service: { include: { category: { select: { nameEn: true, nameAr: true } } } },
  // Deposit badge + checkout entry point (docs/INSURANCE.md §5).
  insurance: {
    select: {
      collectionStatus: true,
      decision: true,
      amountCents: true,
      refunds: { select: { status: true } },
    },
  },
} satisfies Prisma.BookingInclude;

type TodayBookingRow = Prisma.BookingGetPayload<{ include: typeof todayBookingRowInclude }>;

/**
 * UTC midnight of TODAY'S RESORT-LOCAL civil day.
 *
 * Bookings are stored as `Date.UTC(localY, localM, localD)` — UTC midnight of
 * the operator's local calendar day (the server runs in the resort timezone).
 * "Today" must therefore be derived from LOCAL date parts, not UTC ones: during
 * the early-morning window where the local day is ahead of UTC (~00:00–03:00
 * Cairo), `getUTCDate()` still returns yesterday, which would make the desk
 * query the wrong day and miss every arrival. Mirrors `localCivilDay` in
 * gate-scan.ts.
 */
function todayUtcMidnight(): Date {
  // Resort-LOCAL civil day as a UTC-midnight key — TZ-independent (does NOT rely
  // on process.env.TZ). Mirrors the gate/engine so the desk board never queries
  // the wrong day in the ~00:00–03:00 Cairo window on a UTC host.
  return new Date(resortCivilDayUTC());
}

/**
 * "Of the day" filter: a CONFIRMED single-day booking dated today, OR a
 * multi-day range that spans today (`bookingDate ≤ today ≤ endDate`). A pass is
 * only admissible on its own day, so the board never shows past/future bookings.
 */
function bookingCoversToday(today: Date): Prisma.BookingWhereInput {
  return {
    status: 'CONFIRMED',
    OR: [
      { bookingDate: today },
      { AND: [{ bookingDate: { lte: today } }, { endDate: { gte: today } }] },
    ],
  };
}

/** Roll one insurance row up to the desk badge state (null = no badge). */
function mapDepositState(
  insurance: TodayBookingRow['insurance'],
): ReceptionSearchRow['deposit'] {
  if (!insurance || insurance.collectionStatus !== 'COLLECTED') return null;
  const status =
    insurance.decision === 'NO_REFUND'
      ? 'RETAINED'
      : insurance.decision === 'REFUND'
        ? insurance.refunds.some((r) => r.status === 'COMPLETED')
          ? 'REFUNDED'
          : 'IN_PROGRESS'
        : 'UNDECIDED';
  return { status, amountCents: insurance.amountCents };
}

function mapTodayBookingRow(b: TodayBookingRow, locale: 'ar' | 'en'): ReceptionSearchRow {
  const ar = locale === 'ar';
  const isReception = !!b.createdByStaffId;
  // For reception bookings `user` is the staff member — never borrow their
  // identity. Only ONLINE bookings expose the account holder's profile.
  const profile = isReception ? null : b.user.profile;
  return {
    id: b.id,
    reference: b.reference,
    guestName: isReception
      ? (b.guestName ?? 'Guest')
      : (b.user.name ?? profile?.fullName ?? b.guestName ?? 'Guest'),
    phone: isReception
      ? (b.guestPhone ?? '—')
      : (b.user.phone ?? profile?.phone ?? b.guestPhone ?? '—'),
    nationalId: profile?.nationalId ?? profile?.passportId ?? null,
    serviceName: ar ? b.service.nameAr : b.service.nameEn,
    categoryName: ar ? b.service.category.nameAr : b.service.category.nameEn,
    dateLabel: formatDate(b.bookingDate, locale),
    isMultiDay: !!b.endDate && b.endDate.getTime() !== b.bookingDate.getTime(),
    people: b.people,
    checkedInCount: b.checkedInCount,
    // Admissible headcount = people + paid extra persons (matches the gate verdict),
    // so a party isn't shown "fully in" while extra persons are still outside.
    fullyCheckedIn: b.checkedInCount >= b.people + b.extraPersons,
    channel: isReception ? 'RECEPTION' : 'ONLINE',
    deposit: mapDepositState(b.insurance),
  };
}

/**
 * List EVERY CONFIRMED booking of the day (no text filter) for the reception
 * "Today's bookings" board — the operator's at-a-glance view of who is expected
 * and who still needs admitting. Same projection + ordering as the search, so
 * both modes render with one card. `limit` is a sanity bound; a single day's
 * volume never approaches it.
 */
export async function listTodayBookings(
  locale: 'ar' | 'en',
  limit = 300,
): Promise<ReceptionSearchRow[]> {
  const rows = await prisma.booking.findMany({
    where: bookingCoversToday(todayUtcMidnight()),
    include: todayBookingRowInclude,
    // Guests still waiting to enter float to the top; newest booking next.
    orderBy: [{ checkedInCount: 'asc' }, { createdAt: 'desc' }],
    take: limit,
  });
  return rows.map((b) => mapTodayBookingRow(b, locale));
}

/**
 * Search today's CONFIRMED bookings by guest name, phone, or national ID so the
 * reception desk can check a guest in when they arrive WITHOUT their QR pass.
 *
 * Covers both walk-in (reception) bookings — matched on `guestName`/`guestPhone`
 * and the per-guest names — and online bookings, matched on the account holder
 * and their `CustomerProfile` (name / phone / national-id / passport). Phone
 * matching is digit-only (and leading zeros are dropped) so formatting and the
 * local-vs-E.164 prefix don't get in the way. Results are limited to bookings
 * whose date range covers *today* — a pass is only admissible on its own day.
 */
export async function searchTodayBookings(
  rawQuery: string,
  locale: 'ar' | 'en',
  limit = 25,
): Promise<ReceptionSearchRow[]> {
  const q = rawQuery.trim();
  if (q.length < 2) return [];

  const today = todayUtcMidnight();

  // Stored phones are E.164 (e.g. +20…); a desk operator types a local number
  // with spaces or a leading 0. Match on the bare digits, sans leading zeros.
  const digits = q.replace(/\D/g, '').replace(/^0+/, '');
  const phoneNeedle = digits.length >= 4 ? digits : q;

  // Walk-in guest fields live on the booking itself, so they're searchable on
  // ANY booking (reception stores the real guest here).
  const guestText: Prisma.BookingWhereInput[] = [
    { reference: { contains: q, mode: 'insensitive' } },
    { guestName: { contains: q, mode: 'insensitive' } },
    { guestPhone: { contains: phoneNeedle } },
    { guestIds: { some: { guestName: { contains: q, mode: 'insensitive' } } } },
  ];
  // Account-holder / profile fields are only the *customer's* on ONLINE bookings.
  // For a reception booking `user` is the STAFF member, so matching their name /
  // phone / national-id would surface the wrong bookings — gate those behind
  // `createdByStaffId: null`.
  const accountText: Prisma.BookingWhereInput[] = [
    { user: { name: { contains: q, mode: 'insensitive' } } },
    { user: { phone: { contains: phoneNeedle } } },
    { user: { profile: { fullName: { contains: q, mode: 'insensitive' } } } },
    { user: { profile: { phone: { contains: phoneNeedle } } } },
    { user: { profile: { nationalId: { contains: digits || q } } } },
    { user: { profile: { passportId: { contains: q, mode: 'insensitive' } } } },
  ];

  const rows = await prisma.booking.findMany({
    where: {
      ...bookingCoversToday(today),
      AND: [{ OR: [...guestText, { AND: [{ createdByStaffId: null }, { OR: accountText }] }] }],
    },
    include: todayBookingRowInclude,
    // Surface guests still waiting to enter first, newest booking next.
    orderBy: [{ checkedInCount: 'asc' }, { createdAt: 'desc' }],
    take: limit,
  });

  return rows.map((b) => mapTodayBookingRow(b, locale));
}

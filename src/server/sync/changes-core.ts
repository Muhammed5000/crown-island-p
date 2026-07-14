import { prisma } from '@/server/db/prisma';
import { SYNC_PULL_SAFETY_LAG_MS } from './config';
import { canUseStaffPassword } from '@/server/auth/roles';

/**
 * The pull sender (runs on `online`). Online is the SINGLE MASTER, so this
 * returns a FULL bundle of everything changed since `cursor`: config + catalog
 * (Settings, Category, Service, PriceRule, ServicePlace, PromoCode,
 * RoleDiscountLimit), the Media manifest, referenced accounts (only venue-staff
 * credential verifiers are retained), and the whole booking
 * domain. It also returns the AUTHORITATIVE catalog id-sets so the local can
 * HARD-MIRROR deletes (remove catalog rows online no longer has). The receiver
 * (pull.ts) applies it idempotently, upsert-by-id, in FK order.
 *
 * Cursor = ONLINE's own clock (statement_timestamp), never the device clock.
 * Rows are those changed in (since, serverNow]; nextCursor = serverNow. The
 * booking subtree is booking-centric — a booking + all its children ship if the
 * booking OR any child moved — so a satellite-only change is never missed.
 */

export interface ChangesBundle {
  nextCursor: string;
  counts: Record<string, number>;
  // config + catalog (online-master; mirrored read-only on local)
  settings: unknown[];
  categories: unknown[];
  services: unknown[];
  priceRules: unknown[];
  servicePlaces: unknown[];
  promoCodes: unknown[];
  roleDiscountLimits: unknown[];
  media: unknown[];
  // accounts (customer/partner hashes removed; staff auth retained locally)
  users: unknown[];
  customerProfiles: unknown[];
  categoryTermsAcceptances: unknown[];
  // gate deny-list (online-authored; pulled so the local gate can deny)
  blockedIdentities: unknown[];
  // booking domain
  visitCodes: unknown[];
  bookings: unknown[];
  bookingUnits: unknown[];
  // capacity counters (online-authoritative; reserved at confirm; mirrored read-only
  // so the local reception/admin capacity views read the SAME numbers online enforces).
  // OPTIONAL: a full recent+future scan, so `sets=0` pulls omit it (receiver no-ops).
  bookingSlots?: unknown[];
  // guest-ID docs are online-created for reception walk-ins → pulled so the local
  // gate/reception see them (per-guest admit stamps are omitted on apply).
  guestIdDocuments: unknown[];
  invoices: unknown[];
  invoiceLines: unknown[];
  refundLines: unknown[];
  payments: unknown[];
  cancellationRequests: unknown[];
  // Insurance deposits: snapshot+state (1:1 booking) and refund-attempt rows —
  // online-owned, mirrored read-only on local (docs/INSURANCE.md §8). OPTIONAL
  // so a bundle from an older online build applies cleanly (absence ≠ delete).
  bookingInsurances?: unknown[];
  insuranceRefunds?: unknown[];
  sanctions: unknown[];
  reviews: unknown[];
  // authoritative id-sets for the hard-mirror delete of catalog tables.
  // OPTIONAL: omitted on a `sets=0` pull (see includeSets) — the receiver's
  // delete-mirror no-ops on absence, never treats it as "delete everything".
  catalogIds?: {
    category: string[];
    service: string[];
    priceRule: string[];
    servicePlace: string[];
  };
  // Authoritative FULL id-set of the online blocklist (small) so the local can
  // HARD-MIRROR un-blocks: an identity deleted from BlockedIdentity on online must
  // stop being denied at the local gate (the createdAt-windowed pull only ADDS).
  // OPTIONAL like catalogIds (sets=0 pulls omit it).
  blockedIdentityIds?: string[];
}

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const byId = new Map<string, T>();
  for (const r of rows) byId.set(r.id, r);
  return [...byId.values()];
}

export async function getChangesSince(
  cursor: string | null,
  opts: { includeSets?: boolean } = {},
): Promise<ChangesBundle> {
  const includeSets = opts.includeSets !== false;
  const since = cursor ? new Date(cursor) : new Date(0);
  const clockRows = await prisma.$queryRaw<{ now: Date }[]>`SELECT statement_timestamp() AS now`;
  const clock = clockRows[0];
  if (!clock) throw new Error('changes-core: could not read the server clock');
  const serverNow = clock.now;
  // Roll the PERSISTED cursor back by a safety lag so the next window re-scans
  // the tail: a row committed just AFTER this snapshot read but stamped
  // `updatedAt <= serverNow` (a multi-statement tx widens this write→commit gap;
  // app-clock↔DB-clock skew widens it further — see config.ts) would otherwise
  // be skipped FOREVER. The pull is idempotent upsert-by-id, so re-scanning a
  // minute of overlap each tick is harmless.
  const nextCursor = new Date(serverNow.getTime() - SYNC_PULL_SAFETY_LAG_MS).toISOString();
  const win = { gt: since, lte: serverNow };

  // ── Booking subtree (booking-centric — catches satellite-only changes) ──────
  const ids = new Set<string>();
  const addBk = (arr: { bookingId: string | null }[]) =>
    arr.forEach((r) => r.bookingId && ids.add(r.bookingId));
  (await prisma.booking.findMany({ where: { updatedAt: win }, select: { id: true } })).forEach((b) =>
    ids.add(b.id),
  );
  addBk(await prisma.payment.findMany({ where: { updatedAt: win }, select: { bookingId: true } }));
  addBk(await prisma.invoice.findMany({ where: { updatedAt: win }, select: { bookingId: true } }));
  addBk(await prisma.bookingUnit.findMany({ where: { updatedAt: win }, select: { bookingId: true } }));
  addBk(
    await prisma.cancellationRequest.findMany({ where: { updatedAt: win }, select: { bookingId: true } }),
  );
  addBk(await prisma.review.findMany({ where: { updatedAt: win }, select: { bookingId: true } }));
  addBk(
    await prisma.guestIdDocument.findMany({ where: { updatedAt: win }, select: { bookingId: true } }),
  );
  addBk(
    await prisma.bookingInsurance.findMany({ where: { updatedAt: win }, select: { bookingId: true } }),
  );
  const insRefundInsuranceIds = (
    await prisma.insuranceRefund.findMany({
      where: { updatedAt: win },
      select: { bookingInsuranceId: true },
    })
  ).map((r) => r.bookingInsuranceId);
  if (insRefundInsuranceIds.length) {
    addBk(
      await prisma.bookingInsurance.findMany({
        where: { id: { in: insRefundInsuranceIds } },
        select: { bookingId: true },
      }),
    );
  }
  const refInvoiceIds = (
    await prisma.refundLine.findMany({ where: { createdAt: win }, select: { invoiceId: true } })
  ).map((r) => r.invoiceId);
  if (refInvoiceIds.length) {
    addBk(
      await prisma.invoice.findMany({ where: { id: { in: refInvoiceIds } }, select: { bookingId: true } }),
    );
  }
  (
    await prisma.sanction.findMany({
      where: { updatedAt: win },
      select: { pendingBookingId: true, paidByBookingId: true },
    })
  ).forEach((s) => {
    if (s.pendingBookingId) ids.add(s.pendingBookingId);
    if (s.paidByBookingId) ids.add(s.paidByBookingId);
  });
  const bookingIds = [...ids];

  const bookings = bookingIds.length
    ? await prisma.booking.findMany({ where: { id: { in: bookingIds } } })
    : [];
  const invoices = bookingIds.length
    ? await prisma.invoice.findMany({ where: { bookingId: { in: bookingIds } } })
    : [];
  const invoiceIds = invoices.map((i) => i.id);
  const subtreeVisitCodeIds = [
    ...new Set(bookings.map((b) => b.visitCodeId).filter((v): v is string => !!v)),
  ];

  const [
    bookingUnits,
    guestIdDocuments,
    invoiceLines,
    refundLines,
    payments,
    cancellationRequests,
    subtreeSanctions,
    reviews,
    subtreeVisitCodes,
    bookingInsurances,
  ] = await Promise.all([
    bookingIds.length ? prisma.bookingUnit.findMany({ where: { bookingId: { in: bookingIds } } }) : [],
    // Booking-centric: a guest-ID change already added its bookingId above, so
    // every id row of a touched booking ships (whole-booking consistency).
    bookingIds.length ? prisma.guestIdDocument.findMany({ where: { bookingId: { in: bookingIds } } }) : [],
    invoiceIds.length ? prisma.invoiceLine.findMany({ where: { invoiceId: { in: invoiceIds } } }) : [],
    invoiceIds.length ? prisma.refundLine.findMany({ where: { invoiceId: { in: invoiceIds } } }) : [],
    bookingIds.length ? prisma.payment.findMany({ where: { bookingId: { in: bookingIds } } }) : [],
    bookingIds.length
      ? prisma.cancellationRequest.findMany({ where: { bookingId: { in: bookingIds } } })
      : [],
    bookingIds.length
      ? prisma.sanction.findMany({
          where: { OR: [{ pendingBookingId: { in: bookingIds } }, { paidByBookingId: { in: bookingIds } }] },
        })
      : [],
    bookingIds.length ? prisma.review.findMany({ where: { bookingId: { in: bookingIds } } }) : [],
    subtreeVisitCodeIds.length
      ? prisma.visitCode.findMany({ where: { id: { in: subtreeVisitCodeIds } } })
      : [],
    bookingIds.length
      ? prisma.bookingInsurance.findMany({ where: { bookingId: { in: bookingIds } } })
      : [],
  ]);

  // Refund-attempt rows ship with their parent deposit (whole-subtree consistency).
  const bookingInsuranceIds = bookingInsurances.map((bi) => (bi as { id: string }).id);
  const insuranceRefunds = bookingInsuranceIds.length
    ? await prisma.insuranceRefund.findMany({
        where: { bookingInsuranceId: { in: bookingInsuranceIds } },
      })
    : [];

  // ── Independent online-master tables changed in the window ──────────────────
  const [
    settings,
    categories,
    services,
    priceRules,
    servicePlaces,
    promoCodes,
    roleDiscountLimits,
    media,
    changedUsers,
    customerProfiles,
    categoryTermsAcceptances,
    changedVisitCodes,
    blockedIdentities,
    sanctionsChanged,
  ] = await Promise.all([
    prisma.settings.findMany({ where: { updatedAt: win } }),
    prisma.category.findMany({ where: { updatedAt: win } }),
    prisma.service.findMany({ where: { updatedAt: win } }),
    prisma.priceRule.findMany({ where: { updatedAt: win } }),
    prisma.servicePlace.findMany({ where: { updatedAt: win } }),
    prisma.promoCode.findMany({ where: { updatedAt: win } }),
    prisma.roleDiscountLimit.findMany({ where: { updatedAt: win } }),
    prisma.media.findMany({ where: { createdAt: win } }),
    // ALL users (staff + customers) WITH credentials — staff log in on the local
    // mirror; delivered only over the x-sync-secret channel to a trusted node.
    prisma.user.findMany({ where: { updatedAt: win } }),
    prisma.customerProfile.findMany({ where: { updatedAt: win } }),
    prisma.categoryTermsAcceptance.findMany({ where: { acceptedAt: win } }),
    prisma.visitCode.findMany({ where: { updatedAt: win } }),
    prisma.blockedIdentity.findMany({ where: { createdAt: win } }),
    // Fines changed anywhere (not only those tied to a changed booking) — a fine
    // on a customer with no booking, or an admin-created/settled one.
    prisma.sanction.findMany({ where: { updatedAt: win } }),
  ]);

  const visitCodes = dedupeById([
    ...(subtreeVisitCodes as { id: string }[]),
    ...(changedVisitCodes as { id: string }[]),
  ]);
  const sanctions = dedupeById([
    ...(subtreeSanctions as { id: string }[]),
    ...(sanctionsChanged as { id: string }[]),
  ]);

  // ── User completeness: every referenced user must ship in the bundle ────────
  const userRefs = new Set<string>();
  const addUserRef = (rows: unknown[], key = 'userId') => {
    for (const r of rows as Record<string, unknown>[]) {
      const v = r[key];
      if (typeof v === 'string' && v) userRefs.add(v);
    }
  };
  addUserRef(bookings);
  addUserRef(customerProfiles);
  addUserRef(categoryTermsAcceptances);
  addUserRef(visitCodes);
  addUserRef(sanctions);
  addUserRef(blockedIdentities);
  const haveUserIds = new Set((changedUsers as { id: string }[]).map((u) => u.id));
  const missingUserIds = [...userRefs].filter((id) => !haveUserIds.has(id));
  const extraUsers = missingUserIds.length
    ? await prisma.user.findMany({ where: { id: { in: missingUserIds } } })
    : [];
  // The venue needs credential verifiers only for roles that can authenticate
  // to staff/gate surfaces locally. Customer and partner credential hashes are
  // explicitly nulled before crossing the online → venue trust boundary.
  const users = [...changedUsers, ...extraUsers].map((user) =>
    canUseStaffPassword(user.role)
      ? user
      : { ...user, passwordHash: null, pinHash: null },
  );

  // ── Authoritative catalog id-sets (full-table scans) for the delete-mirror ──
  // Only on a `sets` pull: these + the BookingSlot set are the expensive
  // every-row scans, and they only feed the delete-mirror / capacity views —
  // the worker requests them at SYNC_SETS_INTERVAL_MS cadence, not every tick.
  const [catCat, catSvc, catPr, catSp, allBlocked] = includeSets
    ? await Promise.all([
        prisma.category.findMany({ select: { id: true } }),
        prisma.service.findMany({ select: { id: true } }),
        prisma.priceRule.findMany({ select: { id: true } }),
        prisma.servicePlace.findMany({ select: { id: true } }),
        prisma.blockedIdentity.findMany({ select: { id: true } }),
      ])
    : [null, null, null, null, null];

  // ── Capacity counters (FULL recent+future set — NOT updatedAt-windowed) ─────
  // BookingSlot.reservedPeople/Cars/Handicap are the authoritative confirmed-capacity
  // counters (reserved at confirm on this master). They're NOT booking-centric: a
  // slot's counter changes when ANY booking on that service/date confirms or releases,
  // so windowing by updatedAt (or the booking subtree) would let the local read a
  // stale/absent counter. Ship the full set from ~30d back onward (no upper bound —
  // all future dates); bounded ≈ services × dates. The local upserts by the
  // (serviceId,date) natural key, so re-sending is an idempotent overwrite that also
  // self-corrects any decrement. Rides the `sets` cadence with the id-sets above.
  const bookingSlots = includeSets
    ? await prisma.bookingSlot.findMany({
        where: { date: { gte: new Date(serverNow.getTime() - 30 * 86_400_000) } },
      })
    : undefined;

  return {
    nextCursor,
    counts: {
      bookings: bookings.length,
      users: users.length,
      categories: categories.length,
      services: services.length,
      servicePlaces: servicePlaces.length,
      bookingSlots: bookingSlots?.length ?? 0,
      media: media.length,
    },
    settings,
    categories,
    services,
    priceRules,
    servicePlaces,
    promoCodes,
    roleDiscountLimits,
    media,
    users,
    customerProfiles,
    categoryTermsAcceptances,
    blockedIdentities,
    visitCodes,
    bookings,
    bookingUnits,
    bookingSlots,
    guestIdDocuments,
    invoices,
    invoiceLines,
    refundLines,
    payments,
    cancellationRequests,
    bookingInsurances,
    insuranceRefunds,
    sanctions,
    reviews,
    catalogIds:
      catCat && catSvc && catPr && catSp
        ? {
            category: catCat.map((r) => r.id),
            service: catSvc.map((r) => r.id),
            priceRule: catPr.map((r) => r.id),
            servicePlace: catSp.map((r) => r.id),
          }
        : undefined,
    blockedIdentityIds: allBlocked ? allBlocked.map((r) => r.id) : undefined,
  };
}

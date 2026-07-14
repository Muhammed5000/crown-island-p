import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { log, errFields } from '@/lib/log';
import { onlineApiUrl, SYNC_SECRET_HEADER, syncDataSecret, syncScopeSecret, SYNC_TRANSFER_TIMEOUT_MS } from './config';
import type { ChangesBundle } from './changes-core';
import { decryptSyncPayload, type SyncEnvelope } from './envelope';
import { BOOKING_STATE_FIELDS, UNIT_STATE_FIELDS, GUESTID_STATE_FIELDS } from './booking-local-state';

/**
 * The pull worker (runs on `local`). Online is the single master, so this pulls
 * the FULL bundle changed since the stored cursor — config, catalog, accounts
 * (customer hashes minimized; required staff verifiers retained), Media, and the
 * booking domain — upserts it by id in FK
 * order, HARD-MIRRORS catalog deletes, then advances the cursor to ONLINE's
 * clock. Idempotent (re-pulling a window is a no-op). Actual file bytes are
 * fetched separately by file-sync.ts after this returns.
 *
 * CHUNKED application: each section applies in slices of `CHUNK` rows, each
 * slice in its own short transaction, still in FK order (parents commit before
 * children are attempted). The cursor advances ONLY after every section
 * succeeded, so a mid-pull failure simply re-pulls the same window next tick —
 * safe by construction because every applier is an idempotent upsert-by-id.
 * (The previous single 120s transaction made a large initial sync time out and
 * start over forever; between-chunk readers may briefly see a half-applied
 * window, which is acceptable for a 20s-cadence mirror.)
 *
 * The (vestigial) gate/ZK/placement columns on Booking/BookingUnit are omitted
 * from the pull so it never clobbers local-owned state (the authoritative copy
 * lives in BookingLocalState / UnitPlacement, which are pushed up, not pulled).
 */

const PULL_KEY = 'pull:bookings';

/** Rows per transaction slice — small enough that one slice is always quick. */
const CHUNK = 200;

async function inTx<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(run, { maxWait: 15_000, timeout: 120_000 });
}

/** Apply one bundle section in CHUNK-sized slices, one short tx per slice. */
async function applyChunked(
  rows: unknown[] | undefined,
  run: (tx: Prisma.TransactionClient, slice: unknown[]) => Promise<void>,
): Promise<void> {
  // Tolerate a bundle section the sender didn't include — e.g. an online node on
  // an older build that predates a newly-added table (rollout skew), or a
  // sets-omitted incremental pull. Missing section = nothing to apply.
  if (!Array.isArray(rows) || rows.length === 0) return;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await inTx((tx) => run(tx, slice));
  }
}

// Prisma delegates carry strict per-model upsert signatures; `any` on the arg
// lets one helper drive every model. Row shapes come from online's own findMany.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UpsertModel = { upsert: (args: any) => Promise<unknown> };

async function upsertMany(model: UpsertModel, rows: unknown[], omit?: readonly string[]): Promise<void> {
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    const r = { ...(row as Record<string, unknown>) };
    if (omit) for (const k of omit) delete r[k];
    const { id, ...rest } = r;
    await model.upsert({ where: { id }, create: r, update: rest });
  }
}

/**
 * Mirror the online-authoritative `BookingSlot` capacity counters onto the local
 * by the `(serviceId, date)` NATURAL key — NOT by id. The two nodes can hold a slot
 * for the same service+date under DIFFERENT ids (independent seeding / independent
 * confirms), so the generic by-id `upsertMany` would collide on
 * `@@unique([serviceId, date])` and abort the whole pull. Upserting by the natural
 * key updates that row's counters in place (id untouched). The local never writes
 * BookingSlot itself (reception proxies to online), so this is a pure read-mirror.
 * ROLLOUT-SAFE: an older online build that omits `bookingSlots` yields `undefined`
 * → no-op (never wipes local slots). `date` arrives as an ISO string over JSON and
 * as a Date in the loopback test — `new Date()` normalises both.
 */
async function upsertBookingSlots(tx: Prisma.TransactionClient, rows: unknown[]): Promise<void> {
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    const r = row as {
      serviceId: string;
      date: string | Date;
      reservedPeople: number;
      reservedCars: number;
      reservedHandicap: number;
    };
    const data = {
      reservedPeople: r.reservedPeople,
      reservedCars: r.reservedCars,
      reservedHandicap: r.reservedHandicap,
    };
    await tx.bookingSlot.upsert({
      where: { serviceId_date: { serviceId: r.serviceId, date: new Date(r.date) } },
      create: { serviceId: r.serviceId, date: new Date(r.date), ...data },
      update: data,
    });
  }
}

/**
 * Mirror PromoCode by id, but PRESERVE the local `redemptionCount` on update.
 *
 * F2: reception redeems promos on the local node (increments `redemptionCount`),
 * but PromoCode isn't PUSHABLE, so those increments never reach online. A plain
 * upsert would overwrite the venue's own count back to online's stale value each
 * ~20s pull → the global cap would never advance and a capped promo could be
 * redeemed without limit at the desk. So: CREATE seeds from online's count (first
 * time the promo is pulled), UPDATE omits `redemptionCount` so a live venue count
 * is never clobbered. Online/local counts may diverge until a future reconcile;
 * the per-customer guard (PromoRedemption, local-only) is unaffected.
 */
async function upsertPromoCodes(tx: Prisma.TransactionClient, rows: unknown[]): Promise<void> {
  if (!Array.isArray(rows)) return;
  // Loose model typing (same reason as upsertMany): rows are online's own findMany
  // scalars, not a statically-typed create input.
  const model = tx.promoCode as unknown as UpsertModel;
  for (const row of rows) {
    const r = { ...(row as Record<string, unknown>) };
    const id = r.id as string;
    const update = { ...r };
    delete update.id;
    delete update.redemptionCount; // preserve the local venue count
    await model.upsert({ where: { id }, create: r, update });
  }
}

/**
 * Free online-owned unique values (email / phone / pinHash) from any STALE local
 * user before the by-id user upsert. Online is the master identity store, but the
 * two nodes were seeded independently, so the same person can exist locally under
 * a DIFFERENT id — and a plain `upsert where:{id}` then collides on the unique
 * `email`/`phone`/`pinHash` and aborts the whole pull transaction.
 *
 * For each unique field, if online assigns value V to id OID but a local row with
 * a DIFFERENT id currently holds V, we NULL that field on the stale local row
 * (nullable + Postgres allows many NULLs, so this is always collision-free and
 * FK-safe — the row and its references survive, only the contended value is
 * released). The subsequent by-id upsert then writes online's row authoritatively.
 */
async function reconcileUserUniques(
  tx: Prisma.TransactionClient,
  incoming: unknown[],
): Promise<void> {
  if (!Array.isArray(incoming)) return;
  const users = incoming as { id: string; email?: string | null; phone?: string | null; pinHash?: string | null }[];
  for (const field of ['email', 'phone', 'pinHash'] as const) {
    const owner = new Map<string, string>();
    for (const u of users) {
      const v = u[field];
      if (typeof v === 'string' && v) owner.set(v, u.id);
    }
    if (owner.size === 0) continue;
    const held = (await tx.user.findMany({
      where: { [field]: { in: [...owner.keys()] } },
      select: { id: true, [field]: true },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as { id: string; [k: string]: unknown }[];
    const staleIds = held
      .filter((r) => owner.get(r[field] as string) !== r.id)
      .map((r) => r.id);
    if (staleIds.length) {
      await tx.user.updateMany({ where: { id: { in: staleIds } }, data: { [field]: null } });
    }
  }
}

/**
 * Free the `(bookingId, guestSeq)` unique from any STALE local guest-ID row
 * before the by-id upsert. Guest-ID docs are bidirectional (online-created for
 * reception walk-ins → pulled; gate-created → pushed). If a slot was recorded
 * locally under a different id than online's for the same booking+seq (a rare
 * re-record-before-pull race), a plain `upsert where:{id}` would hit the unique
 * and abort the whole pull. Online is authoritative, so drop the stale local dup
 * (its only local-owned data — the admit stamp — is omitted from the pull anyway).
 */
async function reconcileGuestIdUniques(
  tx: Prisma.TransactionClient,
  incoming: unknown[],
): Promise<void> {
  const rows = incoming as { id: string; bookingId: string; guestSeq: number }[];
  if (!Array.isArray(rows) || rows.length === 0) return;
  const owner = new Map<string, string>(); // "bookingId:guestSeq" -> online id
  for (const r of rows) owner.set(`${r.bookingId}:${r.guestSeq}`, r.id);
  const held = await tx.guestIdDocument.findMany({
    where: { OR: rows.map((r) => ({ bookingId: r.bookingId, guestSeq: r.guestSeq })) },
    select: { id: true, bookingId: true, guestSeq: true },
  });
  const staleIds = held
    .filter((h) => owner.get(`${h.bookingId}:${h.guestSeq}`) !== h.id)
    .map((h) => h.id);
  if (staleIds.length) {
    await tx.guestIdDocument.deleteMany({ where: { id: { in: staleIds } } });
  }
}

/**
 * Free the online-owned NATURAL-KEY uniques on the hard-mirror catalog tables
 * before the by-id upsert, so a locally-seeded catalog with the same slug/code/
 * label under a DIFFERENT id can't collide and abort the whole pull (the same
 * failure class as `reconcileUserUniques`, but for `Category.slug`,
 * `Service.(categoryId,slug)`, `ServicePlace.(serviceId,label)`, `PromoCode.code`
 * and `RoleDiscountLimit.role`). Non-nullable string keys are PARKED (renamed to a
 * unique junk value keyed on the local id) — the row survives (no FK risk) and is
 * removed later by the delete-mirror; the enum `role` can't be parked, so a
 * conflicting local RoleDiscountLimit (no incoming FK) is deleted.
 */
async function parkCatalogUnique(
  tx: Prisma.TransactionClient,
  model: string,
  scopeFields: string[],
  keyField: string,
  incoming: unknown[] | undefined,
): Promise<void> {
  const rows = (incoming ?? []) as Record<string, unknown>[];
  if (!rows.length) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delegate = (tx as unknown as Record<string, any>)[model];
  const natKey = (r: Record<string, unknown>) =>
    [...scopeFields.map((f) => String(r[f] ?? '')), String(r[keyField] ?? '')].join(String.fromCharCode(0));
  const owner = new Map<string, unknown>();
  for (const r of rows) owner.set(natKey(r), r.id);
  const orClauses = rows.map((r) => {
    const w: Record<string, unknown> = {};
    for (const f of scopeFields) w[f] = r[f];
    w[keyField] = r[keyField];
    return w;
  });
  const select: Record<string, boolean> = { id: true };
  for (const f of [...scopeFields, keyField]) select[f] = true;
  const held = (await delegate.findMany({ where: { OR: orClauses }, select })) as Record<
    string,
    unknown
  >[];
  for (const h of held) {
    if (owner.get(natKey(h)) === h.id) continue; // same id → not a collision
    const parked = `${String(h[keyField] ?? '').slice(0, 20)}_stale_${h.id}`;
    await delegate.update({ where: { id: h.id }, data: { [keyField]: parked } });
  }
}

async function reconcileCatalogUniques(tx: Prisma.TransactionClient, b: ChangesBundle): Promise<void> {
  await parkCatalogUnique(tx, 'category', [], 'slug', b.categories);
  await parkCatalogUnique(tx, 'service', ['categoryId'], 'slug', b.services);
  await parkCatalogUnique(tx, 'servicePlace', ['serviceId'], 'label', b.servicePlaces);
  await parkCatalogUnique(tx, 'promoCode', [], 'code', b.promoCodes);
  // RoleDiscountLimit.role is an enum @unique → can't be parked; delete the
  // conflicting local row (it has no incoming FK, so this is safe).
  const roles = (b.roleDiscountLimits ?? []) as { id: string; role: string }[];
  if (roles.length) {
    const owner = new Map(roles.map((r) => [r.role, r.id]));
    const held = await tx.roleDiscountLimit.findMany({
      // `role` is a UserRole enum; the incoming values are strings from the bundle.
      where: { role: { in: roles.map((r) => r.role) as never } },
      select: { id: true, role: true },
    });
    const stale = held.filter((h) => owner.get(h.role) !== h.id).map((h) => h.id);
    if (stale.length) await tx.roleDiscountLimit.deleteMany({ where: { id: { in: stale } } });
  }
}

/**
 * Park incoming ACTIVE sanctions that LOCAL has already settled while the
 * settlement push is still queued (pending or quarantined). While that push is
 * in flight, an incoming ACTIVE row for the same id is online-STALENESS, not an
 * admin reactivation — applying it would revert the venue's settlement and
 * re-charge the guest. Once the push lands (or dead-letters, see push.ts), the
 * queue row leaves pending/failed and the filter stops matching, so online's
 * authoritative copy (including a genuine admin reactivation) applies again.
 * This matters most on a cursor-reset full pull, which ships ALL sanctions and
 * would otherwise hard-revert every not-yet-pushed settlement.
 */
async function filterParkedSanctions(rows: unknown[] | undefined): Promise<unknown[]> {
  if (!Array.isArray(rows) || rows.length === 0) return rows ?? [];
  const incoming = rows as { id: string; status?: string; settledAt?: unknown }[];
  const activeIds = incoming
    .filter((r) => (r.status ?? 'ACTIVE') === 'ACTIVE' && r.settledAt == null)
    .map((r) => r.id);
  if (activeIds.length === 0) return rows;
  const [settledLocal, queuedPush] = await Promise.all([
    prisma.sanction.findMany({
      where: { id: { in: activeIds }, OR: [{ status: { not: 'ACTIVE' } }, { settledAt: { not: null } }] },
      select: { id: true },
    }),
    prisma.syncQueue.findMany({
      where: { entityType: 'Sanction', entityId: { in: activeIds }, status: { in: ['pending', 'failed'] } },
      select: { entityId: true },
    }),
  ]);
  const settled = new Set(settledLocal.map((r) => r.id));
  const pushInFlight = new Set(queuedPush.map((q) => q.entityId));
  const parked = new Set(activeIds.filter((id) => settled.has(id) && pushInFlight.has(id)));
  if (parked.size === 0) return rows;
  log.warn('sync pull: parked incoming ACTIVE sanction(s) — local settlement push still queued', {
    parked: parked.size,
  });
  return incoming.filter((r) => !parked.has(r.id));
}

export type BundleFetcher = (cursor: string | null) => Promise<ChangesBundle>;

/** Default fetcher: GET online's /api/sync/changes?since=<cursor>[&sets=0]. */
async function fetchFromOnline(cursor: string | null, includeSets: boolean): Promise<ChangesBundle> {
  const base = onlineApiUrl();
  if (!base) throw new Error('pull: ONLINE_API_URL is not set');
  // Pull is READ scope; its sensitive bundle is independently AES-GCM encrypted.
  const secret = syncScopeSecret('read') ?? '';
  const params = new URLSearchParams();
  if (cursor) params.set('since', cursor);
  if (!includeSets) params.set('sets', '0');
  const qs = params.toString();
  const url = `${base}/api/sync/changes${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, {
    headers: { [SYNC_SECRET_HEADER]: secret },
    signal: AbortSignal.timeout(SYNC_TRANSFER_TIMEOUT_MS), // SYNC-002
  });
  if (res.status !== 200) throw new Error(`pull: changes returned ${res.status}`);
  const body = (await res.json()) as { ok?: boolean; envelope?: SyncEnvelope };
  if (!body || body.ok !== true || !body.envelope) {
    throw new Error('pull: changes returned an unconfirmed body');
  }
  const dataSecret = syncDataSecret();
  if (!dataSecret) throw new Error('pull: SYNC_DATA_SECRET is not configured');
  return decryptSyncPayload<ChangesBundle>(body.envelope, dataSecret);
}

export interface PullOptions {
  fetchBundle?: BundleFetcher;
  /**
   * Ship the full id-sets + BookingSlot mirror this pull (`sets=0` omitted).
   * The worker keeps this false on most ticks (SYNC_SETS_INTERVAL_MS cadence) —
   * those sets are full-table scans on online and only feed the delete-mirror /
   * capacity views, which tolerate minutes of staleness. Always forced ON for
   * an initial sync (no cursor yet).
   */
  includeSets?: boolean;
}

export interface PullResult {
  pulled: Record<string, number>;
  nextCursor: string;
  /** Whether this pull requested the id-sets/slots (worker updates its cadence key). */
  includedSets: boolean;
}

export async function pullAll(opts: PullOptions = {}): Promise<PullResult> {
  const state = await prisma.syncState.findUnique({ where: { key: PULL_KEY } });
  const cursor = state?.cursor ?? null;
  // Initial sync always takes the sets (the delete-mirror/slots baseline).
  const includeSets = opts.includeSets !== false || cursor === null;
  const fetchBundle = opts.fetchBundle ?? ((c: string | null) => fetchFromOnline(c, includeSets));
  const bundle = await fetchBundle(cursor);

  // FK order: accounts → config → catalog → media → booking domain. Reconcilers
  // run once per section (own tx) immediately before that section's chunks —
  // they release natural-key collisions and are idempotent, so committing them
  // early is safe even if a later section fails and the window is re-pulled.
  await inTx((tx) => reconcileUserUniques(tx, bundle.users));
  await applyChunked(bundle.users, (tx, rows) => upsertMany(tx.user, rows));
  await applyChunked(bundle.settings, (tx, rows) => upsertMany(tx.settings, rows));
  await inTx((tx) => reconcileCatalogUniques(tx, bundle));
  await applyChunked(bundle.categories, (tx, rows) => upsertMany(tx.category, rows));
  await applyChunked(bundle.services, (tx, rows) => upsertMany(tx.service, rows));
  // Capacity counters, by (serviceId,date) natural key — after Service (FK).
  await applyChunked(bundle.bookingSlots, (tx, rows) => upsertBookingSlots(tx, rows));
  await applyChunked(bundle.priceRules, (tx, rows) => upsertMany(tx.priceRule, rows));
  await applyChunked(bundle.servicePlaces, (tx, rows) => upsertMany(tx.servicePlace, rows));
  await applyChunked(bundle.promoCodes, (tx, rows) => upsertPromoCodes(tx, rows));
  await applyChunked(bundle.roleDiscountLimits, (tx, rows) => upsertMany(tx.roleDiscountLimit, rows));
  await applyChunked(bundle.media, (tx, rows) => upsertMany(tx.media, rows));
  await applyChunked(bundle.customerProfiles, (tx, rows) => upsertMany(tx.customerProfile, rows));
  await applyChunked(bundle.categoryTermsAcceptances, (tx, rows) =>
    upsertMany(tx.categoryTermsAcceptance, rows),
  );
  await applyChunked(bundle.blockedIdentities, (tx, rows) => upsertMany(tx.blockedIdentity, rows));
  await applyChunked(bundle.visitCodes, (tx, rows) => upsertMany(tx.visitCode, rows));
  await applyChunked(bundle.bookings, (tx, rows) => upsertMany(tx.booking, rows, BOOKING_STATE_FIELDS));
  await applyChunked(bundle.bookingUnits, (tx, rows) =>
    upsertMany(tx.bookingUnit, rows, UNIT_STATE_FIELDS),
  );
  // Guest-ID docs after their booking (FK) + uploader (User, above). Free any
  // stale (bookingId,guestSeq) dup first, then upsert — omitting the local-owned
  // per-guest admit stamps so the pull never clobbers a gate admit.
  await inTx((tx) => reconcileGuestIdUniques(tx, bundle.guestIdDocuments));
  await applyChunked(bundle.guestIdDocuments, (tx, rows) =>
    upsertMany(tx.guestIdDocument, rows, GUESTID_STATE_FIELDS),
  );
  await applyChunked(bundle.invoices, (tx, rows) => upsertMany(tx.invoice, rows));
  await applyChunked(bundle.invoiceLines, (tx, rows) => upsertMany(tx.invoiceLine, rows));
  await applyChunked(bundle.refundLines, (tx, rows) => upsertMany(tx.refundLine, rows));
  await applyChunked(bundle.payments, (tx, rows) => upsertMany(tx.payment, rows));
  // A locally-settled sanction whose settlement push is still queued must not be
  // reverted by an incoming (stale) ACTIVE copy — park those rows this pull.
  const sanctions = await filterParkedSanctions(bundle.sanctions);
  await applyChunked(sanctions, (tx, rows) => upsertMany(tx.sanction, rows));
  await applyChunked(bundle.reviews, (tx, rows) => upsertMany(tx.review, rows));
  await applyChunked(bundle.cancellationRequests, (tx, rows) =>
    upsertMany(tx.cancellationRequest, rows),
  );
  // Insurance deposits after Booking/Invoice/Payment (FK: BookingInsurance →
  // Booking; InsuranceRefund → BookingInsurance). Online-owned, mirrored
  // read-only — assertNotLocalNode blocks every local mutation. Optional keys:
  // a bundle from an older online build simply omits them (absence ≠ delete).
  await applyChunked(bundle.bookingInsurances ?? [], (tx, rows) =>
    upsertMany(tx.bookingInsurance, rows),
  );
  await applyChunked(bundle.insuranceRefunds ?? [], (tx, rows) =>
    upsertMany(tx.insuranceRefund, rows),
  );

  // Cursor LAST — only after every section applied. A failure anywhere above
  // throws out of pullAll before this line, so the same window re-pulls next
  // tick (idempotent by construction).
  await prisma.syncState.upsert({
    where: { key: PULL_KEY },
    create: { key: PULL_KEY, cursor: bundle.nextCursor, lastPulledAt: new Date() },
    update: { cursor: bundle.nextCursor, lastPulledAt: new Date() },
  });

  // Hard-mirror catalog deletes AFTER the upserts (best-effort, outside any tx
  // so a single FK-blocked delete can't abort the whole pull — see mirrorDeletes).
  await mirrorCatalogDeletes(bundle.catalogIds);
  // Hard-mirror blocklist deletes (un-blocks) — an identity dropped on the online
  // master must stop being denied at the local gate.
  await mirrorBlockedIdentityDeletes(bundle.blockedIdentityIds);

  return { pulled: bundle.counts, nextCursor: bundle.nextCursor, includedSets: includeSets };
}

/** Warn-level logger for the best-effort mirror deletes (never throws). */
function logMirrorWarn(what: string): (err: unknown) => void {
  return (err) => log.warn('sync pull mirror delete failed', { what, ...errFields(err) });
}

/**
 * Remove local BlockedIdentity rows the online master no longer has (hard mirror
 * of un-blocks). BlockedIdentity is a leaf (only a scalar `userId`, no incoming
 * FK), so a bulk deleteMany can't be FK-blocked. ROLLOUT-SAFE: if an older online
 * build didn't send the id-set, do NOTHING (never wipe the whole local blocklist).
 * A real DB error here is security-relevant (an un-blocked identity would keep
 * being denied — or worse, the inverse on a later change), so it is LOGGED, not
 * swallowed.
 */
async function mirrorBlockedIdentityDeletes(ids: string[] | undefined): Promise<void> {
  if (!Array.isArray(ids)) return;
  await prisma.blockedIdentity
    .deleteMany({ where: { id: { notIn: ids } } })
    .catch(logMirrorWarn('blocklist un-block mirror'));
}

/** Legacy name kept for the worker until it's updated. */
export const pullBookings = pullAll;

/**
 * Remove local catalog rows online no longer has (hard mirror). Runs OUTSIDE the
 * pull transactions and pre-checks references, so a Service/Category still tied
 * to a local Booking is kept (not force-deleted) instead of aborting the pull.
 * Only runs on sets-included pulls (the id-sets are absent otherwise). Delete
 * candidates are normally EMPTY — the reference pre-check is one groupBy over
 * just the candidates, and deletes stay per-row so DB cascades fire and one FK
 * surprise can't abort the rest (it's logged instead).
 */
async function mirrorCatalogDeletes(catalogIds: ChangesBundle['catalogIds']): Promise<void> {
  if (!catalogIds) return;
  const { category = [], service = [], priceRule = [], servicePlace = [] } = catalogIds;

  // Safe incoming FKs (BookingUnit.placeId is SetNull; PriceRule has none) → bulk.
  await prisma.servicePlace
    .deleteMany({ where: { id: { notIn: servicePlace } } })
    .catch(logMirrorWarn('service-place delete-mirror'));
  await prisma.priceRule
    .deleteMany({ where: { id: { notIn: priceRule } } })
    .catch(logMirrorWarn('price-rule delete-mirror'));

  // Services/categories can be blocked by a Booking → pre-check the candidates
  // (one groupBy, not a count per row), delete only the safe ones (deleting a
  // service cascades its own places/rules).
  const svcSet = new Set(service);
  const svcCandidates = (await prisma.service.findMany({ select: { id: true } }))
    .map((s) => s.id)
    .filter((id) => !svcSet.has(id));
  if (svcCandidates.length) {
    const used = await prisma.booking.groupBy({
      by: ['serviceId'],
      where: { serviceId: { in: svcCandidates } },
    });
    const blocked = new Set(used.map((u) => u.serviceId));
    for (const id of svcCandidates) {
      if (blocked.has(id)) continue;
      await prisma.service.delete({ where: { id } }).catch(logMirrorWarn(`service delete-mirror (${id})`));
    }
  }
  const catSet = new Set(category);
  const catCandidates = (await prisma.category.findMany({ select: { id: true } }))
    .map((c) => c.id)
    .filter((id) => !catSet.has(id));
  if (catCandidates.length) {
    const used = await prisma.service.groupBy({
      by: ['categoryId'],
      where: { categoryId: { in: catCandidates } },
    });
    const blocked = new Set(used.map((u) => u.categoryId));
    for (const id of catCandidates) {
      if (blocked.has(id)) continue;
      await prisma.category.delete({ where: { id } }).catch(logMirrorWarn(`category delete-mirror (${id})`));
    }
  }
}

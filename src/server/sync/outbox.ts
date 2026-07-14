import type { Prisma } from '@prisma/client';
import { isLocal } from './config';
import { log } from '@/lib/log';

/**
 * Outbox writer for the offline sync layer — the push-side peer of `audit()`
 * (src/server/audit/audit.ts).
 *
 * On APP_MODE=local, every LOCAL-OWNED operational mutation calls this with its
 * ACTIVE transaction, immediately after `audit(tx, …)`, so the queued change and
 * the mutation it describes commit or roll back together. There are no
 * "wrote-but-didn't-queue" or "queued-but-didn't-write" gaps — identical to the
 * audit guarantee. A local-only background worker later drains `sync_queue`
 * FIFO to online's /api/sync/apply.
 *
 * Booking-domain rows (Booking / Invoice / Payment / BookingSlot / …) are NEVER
 * enqueued: online is their sole writer. `PUSHABLE` is the allow-list and
 * `enqueueOutbox` throws for anything else, so a mis-wired call site fails loudly
 * in development instead of silently corrupting the single-writer invariant.
 */

/**
 * Models that flow local → online. Booking-domain models are deliberately
 * ABSENT (online owns them). Two models are intentionally held back pending the
 * SYNC_ANALYSIS §G sign-off and are NOT yet listed:
 *   - `User`       — customer rows are online-origin/pulled; only STAFF rows are
 *                    local-origin. Needs the staff-vs-customer ownership split.
 *   - `Restaurant` — owner self-edits happen online; admin moderation is local.
 * They will be added with dedicated, scoped handling once that split is decided.
 */
// ONLINE-MASTER model: the local node pushes up ONLY venue-authored operational
// data. Everything else (catalog, settings, promos, media, sanctions, blocklist,
// customer tags, role limits, and ALL accounts) is owned by online and PULLED
// down — so it is deliberately absent here. A pushed catalog write would wrongly
// overwrite the master, and the receiver (apply-core) rejects anything not listed.
export const PUSHABLE = [
  // decision-3 local-owned extraction tables (gate/ZK/placement state)
  'BookingLocalState',
  'UnitPlacement',
  // operational append-only + state (gate / reception / ops)
  'GuestIdDocument',
  'GateScanEvent',
  'WorkSession',
  'OpsTicket',
  'OpsTicketEvent',
  'StaffNotification',
  'PlaceOutage',
  'PlaceOutageLog',
  'ZkCard',
  // Fines put on a guest AT THE VENUE (gate/reception) push up. Bidirectional:
  // admin-created fines + settlements come back down in the pull, converging by id.
  'Sanction',
] as const;

/**
 * Pseudo entity type for the file-BYTES push lane. Venue file uploads ride the
 * SAME `SyncQueue` so they inherit the outbox's retry / skip-and-continue /
 * quarantine / recovery machinery (see push.ts) instead of the old fire-and-
 * forget push. It is DELIBERATELY absent from `PUSHABLE`: `apply-core` shares
 * `isPushable()` as the allow-list for the JSON `/api/sync/apply` channel, so
 * listing it there would let a raw file row be POSTed as a JSON upsert. Instead
 * `drainOutbox` dispatches these rows to the file sender (`postMediaFile` →
 * `/api/sync/upload-file`). `entityId` is the LOCAL Media row id.
 */
export const MEDIA_FILE_ENTITY = 'MediaFile';

export type PushableEntity = (typeof PUSHABLE)[number];

const PUSHABLE_SET: ReadonlySet<string> = new Set(PUSHABLE);

/** True iff `entityType` may be pushed local → online. */
export function isPushable(entityType: string): entityType is PushableEntity {
  return PUSHABLE_SET.has(entityType);
}

export interface EnqueueInput {
  /** Model name; validated against PUSHABLE at runtime (non-pushable → no-op). */
  entityType: string;
  entityId: string;
  op?: 'upsert' | 'delete';
  /** Whole-row snapshot the receiver upserts by id (no timestamps / LWW). */
  payload: Prisma.InputJsonValue;
}

/**
 * Enqueue one change onto the outbox, on the caller's transaction. Call it right
 * after the mutating write inside the same `prisma.$transaction(async (tx) => …)`
 * callback, exactly as `audit(tx, …)` is called.
 */
function toJson(obj: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(obj)) as Prisma.InputJsonValue;
}

/**
 * Enqueue a whole-row snapshot of a local-owned row by id — the one-liner used
 * at every operational write site (call after the mutation, in the same tx,
 * next to `audit(tx, …)`). Re-reads the row's SCALARS ONLY (a plain findUnique,
 * no relations) so the pushed payload is always a clean upsertable snapshot,
 * never a relation-laden object. No-op off `local`; throws for a non-pushable
 * (booking-domain) entity so a mis-wired seam fails loudly in dev.
 */
export async function enqueueById(
  tx: Prisma.TransactionClient,
  entityType: string,
  id: string,
  op: 'upsert' | 'delete' = 'upsert',
): Promise<void> {
  if (!isLocal()) return;
  if (!isPushable(entityType)) {
    // ONLINE-MASTER: catalog/config/etc. are pulled, not pushed. A call site that
    // was pushing one of those is now a no-op (its local edit is transient — the
    // next pull hard-mirrors online's authoritative copy back). Warn in dev so a
    // genuinely mis-wired operational seam is still visible.
    if (process.env.NODE_ENV !== 'production') {
      log.warn('sync enqueueById: not pushable (online-owned) — skipped', { entityType });
    }
    return;
  }
  if (op === 'delete') {
    // A queued-but-unsent upsert for this row is now pointless AND dangerous: if
    // it fails, quarantines, and is re-armed AFTER the delete applies on online,
    // it would RE-CREATE (resurrect) the deleted row there (A-09). Park those
    // snapshots as 'superseded' — terminal like 'dead', pruned on retention.
    // The drain is sequential in this one process, so an upsert can't be
    // in-flight while this runs; and cuid ids are never re-used, so a later
    // legitimate re-create of the same id cannot exist.
    await tx.syncQueue.updateMany({
      where: { entityType, entityId: id, op: 'upsert', status: { in: ['pending', 'failed'] } },
      data: { status: 'superseded', lastError: 'superseded_by_delete' },
    });
    await enqueueOutbox(tx, { entityType, entityId: id, op: 'delete', payload: { id } });
    return;
  }
  const key = entityType.charAt(0).toLowerCase() + entityType.slice(1);
  const delegate = (tx as unknown as Record<string, { findUnique?: (a: unknown) => Promise<unknown> }>)[
    key
  ];
  if (!delegate?.findUnique) throw new Error(`enqueueById: no delegate for "${entityType}".`);
  const row = await delegate.findUnique({ where: { id } });
  if (!row) return; // row was deleted in the same tx — nothing to push
  await enqueueOutbox(tx, { entityType, entityId: id, payload: toJson(row) });
}

export function enqueueOutbox(
  tx: Prisma.TransactionClient,
  input: EnqueueInput,
): Promise<{ id: string } | null> {
  // The outbox is written ONLY on `local`. On `online` (the receiver) and on a
  // single APP_MODE-unset deployment this is a no-op, so call sites can enqueue
  // unconditionally — exactly like `audit(tx, …)` — with zero effect off-local.
  if (!isLocal()) return Promise.resolve(null);
  if (!isPushable(input.entityType)) {
    // Online-owned entity (catalog/config/booking domain) — never queued on local.
    if (process.env.NODE_ENV !== 'production') {
      log.warn('sync enqueueOutbox: not pushable — skipped', { entityType: input.entityType });
    }
    return Promise.resolve(null);
  }
  return tx.syncQueue.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      op: input.op ?? 'upsert',
      payload: input.payload,
    },
    select: { id: true },
  });
}

export interface FilePushInput {
  /** Local Media row id → SyncQueue.entityId (the confirmed-id the drain checks). */
  mediaId: string;
  url: string;
  mimeType: string;
  /** Upload-time hash; the sender re-verifies the on-disk bytes against it. */
  sha256?: string | null;
  uploadedById?: string | null;
}

/**
 * Enqueue a file-bytes push (venue → online) on the caller's transaction, right
 * next to the `Media` row it points at — so the queued push and the row it
 * describes commit or roll back together. No-op off `local` (like
 * `enqueueOutbox`), so call sites enqueue unconditionally. Writes the
 * `MediaFile` lane row DIRECTLY, bypassing the `isPushable` guard on purpose
 * (see `MEDIA_FILE_ENTITY`); the drain routes it to the file sender.
 */
export function enqueueFilePush(
  tx: Prisma.TransactionClient,
  input: FilePushInput,
): Promise<{ id: string } | null> {
  if (!isLocal()) return Promise.resolve(null);
  return tx.syncQueue.create({
    data: {
      entityType: MEDIA_FILE_ENTITY,
      entityId: input.mediaId,
      op: 'upsert',
      payload: {
        url: input.url,
        mimeType: input.mimeType,
        sha256: input.sha256 ?? null,
        uploadedById: input.uploadedById ?? null,
      },
    },
    select: { id: true },
  });
}

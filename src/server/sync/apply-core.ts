import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { log, errFields } from '@/lib/log';
import { isPushable } from './outbox';
import { BOOKING_STATE_FIELDS, UNIT_STATE_FIELDS } from './booking-local-state';
import { decideSanctionApply } from './sanction-merge-core';
import { sanitizePayload } from './payload-sanitize-core';

/**
 * The receiver side of the push (runs on `online`). An idempotent upsert-by-id:
 * given a change pushed from local, it upserts the row by its id. The single
 * writer's whole-row snapshot is authoritative, so a replayed push is a no-op —
 * but because the drain SKIPS failing rows and the recovery re-arms quarantined
 * ones, snapshots for one entity can arrive OUT OF ORDER, so a per-entity
 * `updatedAt` version guard (same-clock: local stamps, local re-stamps) drops a
 * stale snapshot instead of letting it regress newer state. `Sanction` — the
 * only bidirectional model — additionally converges on its domain state machine
 * (see sanction-merge-core.ts) because cross-host wall-clock LWW would drop
 * venue settlements under clock skew.
 *
 * The allow-list (shared with the outbox) is enforced here too: booking-domain
 * and unknown models are REJECTED, so online can never be tricked into taking a
 * booking write from the push channel (bookings are online-written only).
 *
 * Each applied change is ATOMIC: staff-stub creation, the upsert, and the
 * parent-column mirror run in ONE transaction — a mirror failure can no longer
 * commit the snapshot row while leaving the mirrored Booking columns stale.
 */

export interface ApplyInput {
  entityType: string;
  entityId: string;
  op?: 'upsert' | 'delete';
  payload: Record<string, unknown>;
}

export interface ApplyResult {
  ok: boolean;
  entityType: string;
  id: string;
  applied: 'upsert' | 'delete' | 'noop';
  error?: string;
  /**
   * How the caller (the push loop) should treat a failure:
   *  - 'reject'  — permanent; this row can never apply (not-pushable / unknown /
   *                a payload the DB will always refuse). Quarantine + skip it.
   *  - 'retry'   — transient; the parent may not have synced yet or online had a
   *                hiccup. Leave the row pending and try again next tick.
   * Absent on success.
   */
  disposition?: 'reject' | 'retry';
}

type UpsertDelegate = {
  upsert: (args: unknown) => Promise<unknown>;
  deleteMany: (args: unknown) => Promise<unknown>;
  findUnique: (args: unknown) => Promise<{ updatedAt?: Date | null } | null>;
};

/**
 * Staff/operator User foreign keys carried by pushed operational rows. Staff are
 * local-origin and not (yet) synced UP, so online may lack them — the upsert would
 * then FK-fail and the row would retry/quarantine forever. We ensure a minimal
 * User STUB for these ids first (a later pull overwrites it), mirroring the
 * reception-booking receiver's precedent. Customer FKs (scannedUserId, Sanction
 * userId) are online-mastered and always present, so they're not listed.
 */
const STAFF_FK_FIELDS: Record<string, readonly string[]> = {
  GateScanEvent: ['operatorId'],
  WorkSession: ['staffId'],
  OpsTicket: ['createdById', 'assignedToId'],
  OpsTicketEvent: ['actorId'],
  StaffNotification: ['userId'],
  GuestIdDocument: ['uploadedById', 'checkedInById'],
  PlaceOutage: ['createdById'],
  PlaceOutageLog: ['actorId'],
  ZkCard: ['assignedById'],
};

async function ensureStaffStubs(
  tx: Prisma.TransactionClient,
  entityType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const fields = STAFF_FK_FIELDS[entityType];
  if (!fields) return;
  const ids = fields
    .map((f) => payload[f])
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (ids.length === 0) return;
  // skipDuplicates → a real (already-present) staff/admin is left untouched.
  await tx.user.createMany({ data: ids.map((id) => ({ id })), skipDuplicates: true });
}

/** Prisma delegates are the camelCase of the model name. */
function delegateFor(
  client: Prisma.TransactionClient | typeof prisma,
  entityType: string,
): UpsertDelegate | null {
  const key = entityType.charAt(0).toLowerCase() + entityType.slice(1);
  const d = (client as unknown as Record<string, unknown>)[key] as UpsertDelegate | undefined;
  return d && typeof d.upsert === 'function' ? d : null;
}

/**
 * Version guard: the drain skips/quarantines then re-arms failing rows, so an
 * OLDER snapshot can arrive after a newer one. If the row already on online is
 * newer than this snapshot, skip it — otherwise a stale push would regress
 * online state (incl. the mirrored Booking/BookingUnit columns, which are only
 * reached on a non-stale apply). Payloads without `updatedAt` (append-only
 * models like GateScanEvent that have no such column) skip the guard.
 * Resurrection-after-delete is handled at the SOURCE: enqueueing a delete
 * supersedes that entity's queued upserts (outbox.ts), so no tombstone is
 * needed here (A-09).
 */
async function isStaleSnapshot(
  delegate: UpsertDelegate,
  entityId: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const incoming = payload.updatedAt;
  const incomingAt =
    typeof incoming === 'string' || incoming instanceof Date ? new Date(incoming as string) : null;
  if (!incomingAt || Number.isNaN(incomingAt.getTime())) return false;
  const current = await delegate.findUnique({ where: { id: entityId }, select: { updatedAt: true } });
  return Boolean(current?.updatedAt && current.updatedAt > incomingAt);
}

/**
 * Map a DB refusal to a compact classification. The raw Prisma message (which
 * exposes constraint/column names and SQL fragments) stays in the ONLINE server
 * log only; the classification travels back to local and lands in
 * SyncQueue.lastError — entity/id are already on that row, so `P2003:fk_missing`
 * is enough for venue-ops triage without shipping internals over the wire.
 */
function classifyDbError(err: unknown): string {
  const code = (err as { code?: string }).code;
  const label =
    code === 'P2003'
      ? 'fk_missing'
      : code === 'P2002'
        ? 'unique_conflict'
        : code === 'P2000' || code === 'P2005' || code === 'P2006' || code === 'P2007' || code === 'P2009'
          ? 'bad_value'
          : 'db_error';
  return `${code ?? 'ERR'}:${label}`;
}

export async function applyChange(input: ApplyInput): Promise<ApplyResult> {
  const { entityType, entityId } = input;
  const op = input.op ?? 'upsert';

  // Single-writer invariant: only local-owned models may arrive via the push.
  // A non-pushable / unknown entity can NEVER apply → permanent reject.
  if (!isPushable(entityType)) {
    return { ok: false, entityType, id: entityId, applied: 'noop', error: 'entity_not_pushable', disposition: 'reject' };
  }
  if (!delegateFor(prisma, entityType)) {
    return { ok: false, entityType, id: entityId, applied: 'noop', error: 'unknown_entity', disposition: 'reject' };
  }

  // Field hygiene BEFORE touching the DB: strip unknown keys (rollout skew —
  // a local ahead of online no longer burns retries on a P2xxx), hard-reject a
  // structurally impossible value (it would fail on every attempt).
  const sanitized = sanitizePayload(entityType, input.payload);
  if (!sanitized.ok) {
    return {
      ok: false,
      entityType,
      id: entityId,
      applied: 'noop',
      error: `bad_value:${sanitized.field}`,
      disposition: 'reject',
    };
  }
  if (sanitized.dropped.length > 0) {
    log.warn('sync apply dropped unknown field(s)', {
      entityType,
      entityId,
      dropped: sanitized.dropped,
    });
  }
  const payload = sanitized.data;

  try {
    if (op === 'delete') {
      // Idempotent: deleting an already-absent row is a no-op, not an error.
      await delegateFor(prisma, entityType)!.deleteMany({ where: { id: entityId } });
      return { ok: true, entityType, id: entityId, applied: 'delete' };
    }

    // ONE transaction per change: guard read + staff stubs + upsert + parent
    // mirror commit or roll back together, so a failure can't leave the snapshot
    // row applied while the mirrored Booking/BookingUnit columns stay stale.
    const applied = await prisma.$transaction(async (tx) => {
      const delegate = delegateFor(tx, entityType)!;

      if (entityType === 'Sanction') {
        // Bidirectional model → domain merge, not cross-host clock LWW.
        const current = await tx.sanction.findUnique({
          where: { id: entityId },
          select: { status: true, settledAt: true },
        });
        const decision = decideSanctionApply(current, payload);
        if (decision === 'skip') return 'noop' as const;
        // 'apply' bypasses the updatedAt guard (a settlement must win even if
        // the venue clock lags); 'guard' (both ACTIVE) falls through to it.
        if (decision === 'guard' && (await isStaleSnapshot(delegate, entityId, payload))) {
          return 'noop' as const;
        }
      } else if (await isStaleSnapshot(delegate, entityId, payload)) {
        return 'noop' as const;
      }

      // Ensure any local-origin staff FK exists so the upsert can't FK-fail forever.
      await ensureStaffStubs(tx, entityType, payload);

      // Upsert by id. Strip `id` from the update branch (never re-assign a PK); keep
      // it in create. Prisma coerces the payload's ISO date strings + enum strings.
      const { id: _omitId, ...rest } = payload;
      await delegate.upsert({
        where: { id: entityId },
        create: { ...payload, id: entityId },
        update: rest,
      });

      // Field-scoped MIRROR: the local-owned gate/ZK/placement state also lives as
      // columns on the online-owned Booking/BookingUnit rows (so all 24 reader files
      // stay unchanged). Write it through here — online owns those rows.
      await mirrorToParent(tx, entityType, payload);

      return 'upsert' as const;
    });

    return { ok: true, entityType, id: entityId, applied };
  } catch (err) {
    // A DB refusal (e.g. an FK to a parent that isn't on online yet) used to
    // surface as an opaque HTTP 500 and STALL the whole push queue. Classify it:
    //  - FK / missing-relation  → 'retry' (the parent may sync on a later tick)
    //  - a truly malformed row  → still 'retry' here, but the drain loop caps
    //    attempts, quarantines, and eventually dead-letters it, so it can never
    //    jam the queue forever.
    log.error('sync apply failed', { entityType, entityId, ...errFields(err) });
    return {
      ok: false,
      entityType,
      id: entityId,
      applied: 'noop',
      error: classifyDbError(err),
      disposition: 'retry',
    };
  }
}

async function mirrorToParent(
  tx: Prisma.TransactionClient,
  entityType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (entityType === 'BookingLocalState') {
    const bookingId = payload.bookingId;
    if (typeof bookingId !== 'string') return;
    const data = pick(payload, BOOKING_STATE_FIELDS);
    // updateMany: idempotent + never throws if the booking isn't present yet.
    if (Object.keys(data).length) await tx.booking.updateMany({ where: { id: bookingId }, data });
  } else if (entityType === 'UnitPlacement') {
    const unitId = payload.bookingUnitId;
    if (typeof unitId !== 'string') return;
    const data = pick(payload, UNIT_STATE_FIELDS);
    if (Object.keys(data).length)
      await tx.bookingUnit.updateMany({ where: { id: unitId }, data });
  }
}

function pick(src: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (f in src) out[f] = src[f];
  return out;
}

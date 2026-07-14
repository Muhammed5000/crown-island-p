import 'server-only';
import { Prisma, type PlaceType } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { audit } from '@/server/audit/audit';
import { enqueueById } from '@/server/sync/outbox';
import { assertNotLocalNode } from '@/server/sync/node-guard';
import { DomainError } from './errors';
import { opsOnPlaceOutOfService, opsOnPlaceBackInService } from './ops-tickets';

/**
 * Admin management of a service's physical place inventory (the cabins /
 * cabanas / umbrellas / seats reception & gate assign to booking units).
 *
 * Every mutation runs in a transaction with an `AuditLog` row. Uniqueness on
 * `(serviceId, label)` is translated into a typed `label_taken` domain error.
 */

function rethrowAsLabelTaken(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new DomainError('label_taken', 'label_taken', 409);
  }
  throw err;
}

export interface PlaceInput {
  label: string;
  type: PlaceType;
  zone?: string | null;
  position?: number;
  gridX?: number;
  gridY?: number;
  sortOrder?: number;
  isActive?: boolean;
  isHandicap?: boolean;
  /** ZKBio access-level group id that opens this place's door (ZK services). */
  zkAccessLevelId?: string | null;
  /** Optional human label for the ZK door/level (admin display). */
  zkDoorLabel?: string | null;
}

/** Default label prefix per place type for auto-provisioned places. */
const TYPE_PREFIX: Record<PlaceType, string> = {
  CABANA: 'C',
  CABIN: 'K',
  UMBRELLA: 'U',
  SEAT: 'S',
  SPOT: 'P',
};

/**
 * BOOTSTRAP an empty place-required service with `dailyCapacityPeople` numbered
 * places, so a brand-new service doesn't open with an empty reception/gate
 * picker.
 *
 * It is a strict NO-OP the moment the service already has ANY place. Once an
 * admin manages the inventory by hand (e.g. 50 umbrellas in "manage places"),
 * the system must NEVER auto-add more to reach the capacity number — that's the
 * bug that bolted 150 auto `S` seats onto a deliberate 50-umbrella setup. The
 * admin's manual set is authoritative; capacity and physical-place count are
 * decoupled (a place may hold several people). Never deletes or renames places.
 *
 * Accepts a tx or the base client so it can run inside a service-save
 * transaction or stand-alone (the capacity backfill script).
 */
export async function topUpPlacesForCapacity(
  db: Prisma.TransactionClient | typeof prisma,
  serviceId: string,
): Promise<{ added: number }> {
  const service = await db.service.findUnique({
    where: { id: serviceId },
    select: { placeType: true, placeAssignmentRequired: true, dailyCapacityPeople: true },
  });
  if (!service || !service.placeAssignmentRequired) return { added: 0 };
  const target = service.dailyCapacityPeople ?? 0;
  if (target <= 0 || target > 1000) return { added: 0 };

  const existing = await db.servicePlace.findMany({
    where: { serviceId },
    select: { label: true, gridY: true },
  });
  // Bootstrap ONLY an empty inventory. If the admin has created any places, the
  // manual set is authoritative — never supplement it up to the capacity number.
  if (existing.length > 0) return { added: 0 };

  const taken = new Set(existing.map((p) => p.label));
  const startRow = existing.length ? Math.max(...existing.map((p) => p.gridY)) + 1 : 0;
  const prefix = TYPE_PREFIX[service.placeType] ?? 'P';
  const toCreate = target - existing.length;

  const rows: Prisma.ServicePlaceCreateManyInput[] = [];
  let n = 1;
  let added = 0;
  while (added < toCreate) {
    const label = `${prefix}${n}`;
    n += 1;
    if (taken.has(label)) continue;
    taken.add(label);
    rows.push({
      serviceId,
      label,
      type: service.placeType,
      position: 1000 + added,
      gridX: added % 8,
      gridY: startRow + Math.floor(added / 8),
      sortOrder: 1000 + added,
    });
    added += 1;
  }
  if (rows.length) {
    await db.servicePlace.createMany({ data: rows });
  }
  return { added: rows.length };
}

export async function adminListPlaces(serviceId: string) {
  return prisma.servicePlace.findMany({
    where: { serviceId },
    orderBy: [{ zone: 'asc' }, { position: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }],
    include: {
      outages: { orderBy: { startsAt: 'asc' } },
      // Lets the UI mark cells that have (or had) booking assignments — those
      // can't be deleted, only deactivated.
      _count: { select: { units: true } },
    },
  });
}

/**
 * Downtime history for open-ended online/offline flips: going offline opens a
 * `kind=INACTIVE` PlaceOutageLog span; coming back online closes it. Reports
 * read durations from the log, so offline time is never lost. Closing closes
 * EVERY open span (not just the newest) so a duplicate left by a concurrent
 * toggle self-heals instead of inflating downtime forever. No-op when the
 * value didn't change.
 */
async function logActiveFlip(
  tx: Prisma.TransactionClient,
  placeId: string,
  wasActive: boolean,
  nowActive: boolean,
  actorUserId: string,
) {
  if (wasActive === nowActive) return;
  const now = new Date();
  // Both directions close any currently-open INACTIVE span; capture its id(s)
  // first so the in-place edit can be pushed (updateMany returns none).
  const openIds = (
    await tx.placeOutageLog.findMany({
      where: { placeId, kind: 'INACTIVE', endsAt: null },
      select: { id: true },
    })
  ).map((r) => r.id);
  if (!nowActive) {
    // Self-heal: never stack a second open span on top of an existing one.
    await tx.placeOutageLog.updateMany({
      where: { placeId, kind: 'INACTIVE', endsAt: null },
      data: { endsAt: now, endedById: actorUserId },
    });
    for (const logId of openIds) await enqueueById(tx, 'PlaceOutageLog', logId);
    const created = await tx.placeOutageLog.create({
      data: { placeId, kind: 'INACTIVE', startsAt: now, createdById: actorUserId },
    });
    await enqueueById(tx, 'PlaceOutageLog', created.id);
  } else {
    await tx.placeOutageLog.updateMany({
      where: { placeId, kind: 'INACTIVE', endsAt: null },
      data: { endsAt: now, endedById: actorUserId },
    });
    for (const logId of openIds) await enqueueById(tx, 'PlaceOutageLog', logId);
  }
}

/** Quick online/offline toggle for a place (open-ended; audited). */
export async function adminSetPlaceActive(id: string, isActive: boolean, actorUserId: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.servicePlace.findUnique({ where: { id }, select: { id: true, isActive: true } });
    if (!before) throw new DomainError('not_found', 'not_found', 404);
    const after = await tx.servicePlace.update({ where: { id }, data: { isActive } });
    await logActiveFlip(tx, id, before.isActive, isActive, actorUserId);
    // Housekeeping & maintenance desk: going offline opens (or annotates) an
    // OUT_OF_SERVICE ticket + notifies the departments; coming back online
    // annotates any open ticket so the workers know to verify + close it.
    if (before.isActive && !isActive) {
      await opsOnPlaceOutOfService(tx, {
        placeId: id,
        reason: 'Switched offline',
        until: null,
        actorUserId,
      });
    } else if (!before.isActive && isActive) {
      await opsOnPlaceBackInService(tx, { placeId: id, actorUserId });
    }
    await audit(tx, {
      actorUserId,
      action: 'UPDATE',
      entityType: 'ServicePlace',
      entityId: id,
      before: { isActive: before.isActive },
      after: { isActive },
    });
    return after;
  });
}

/**
 * Mark / unmark a place as an accessibility (handicap) cell (audited). Advisory
 * only — it never changes availability, so there's no downtime log to keep, just
 * the flag + an audit row.
 */
export async function adminSetPlaceHandicap(id: string, isHandicap: boolean, actorUserId: string) {
  assertNotLocalNode('Place inventory');
  return prisma.$transaction(async (tx) => {
    const before = await tx.servicePlace.findUnique({ where: { id }, select: { id: true, isHandicap: true } });
    if (!before) throw new DomainError('not_found', 'not_found', 404);
    const after = await tx.servicePlace.update({ where: { id }, data: { isHandicap } });
    await audit(tx, {
      actorUserId,
      action: 'UPDATE',
      entityType: 'ServicePlace',
      entityId: id,
      before: { isHandicap: before.isHandicap },
      after: { isHandicap },
    });
    return after;
  });
}

/**
 * Set a place's ZKBio access-level id (and optional door label) — the level group
 * that opens THIS specific place's door. Focused setter (like the handicap
 * toggle) so the ZK editor can save one field without resubmitting the whole
 * place form. Blank clears the mapping. Audited.
 */
export async function adminSetPlaceZkLevel(
  id: string,
  zkAccessLevelId: string | null,
  zkDoorLabel: string | null,
  actorUserId: string,
) {
  assertNotLocalNode('Place inventory');
  return prisma.$transaction(async (tx) => {
    const before = await tx.servicePlace.findUnique({
      where: { id },
      select: { id: true, zkAccessLevelId: true, zkDoorLabel: true },
    });
    if (!before) throw new DomainError('not_found', 'not_found', 404);
    const after = await tx.servicePlace.update({
      where: { id },
      data: { zkAccessLevelId: zkAccessLevelId || null, zkDoorLabel: zkDoorLabel || null },
    });
    await audit(tx, {
      actorUserId,
      action: 'UPDATE',
      entityType: 'ServicePlace',
      entityId: id,
      before: { zkAccessLevelId: before.zkAccessLevelId, zkDoorLabel: before.zkDoorLabel },
      after: { zkAccessLevelId: after.zkAccessLevelId, zkDoorLabel: after.zkDoorLabel },
    });
    return after;
  });
}

/** Schedule an out-of-service window for a place (audited). */
export async function adminCreatePlaceOutage(
  input: { placeId: string; startsAt: Date; endsAt: Date; reason?: string | null },
  actorUserId: string,
) {
  if (!(input.startsAt instanceof Date) || Number.isNaN(input.startsAt.getTime())) {
    throw new DomainError('invalid_range', 'invalid_range', 400);
  }
  if (!(input.endsAt instanceof Date) || Number.isNaN(input.endsAt.getTime())) {
    throw new DomainError('invalid_range', 'invalid_range', 400);
  }
  if (input.endsAt.getTime() <= input.startsAt.getTime()) {
    throw new DomainError('invalid_range', 'invalid_range', 400);
  }
  return prisma.$transaction(async (tx) => {
    const place = await tx.servicePlace.findUnique({ where: { id: input.placeId }, select: { id: true } });
    if (!place) throw new DomainError('not_found', 'not_found', 404);
    const created = await tx.placeOutage.create({
      data: {
        placeId: input.placeId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        reason: input.reason?.trim().slice(0, 200) || null,
        createdById: actorUserId,
      },
    });
    // Mirror into the append-only history (reports read from the log; the live
    // row above gets hard-deleted on cancel/end-early).
    const createdLog = await tx.placeOutageLog.create({
      data: {
        placeId: created.placeId,
        outageId: created.id,
        kind: 'OUTAGE',
        startsAt: created.startsAt,
        endsAt: created.endsAt,
        reason: created.reason,
        createdById: actorUserId,
      },
    });
    // Housekeeping & maintenance desk: every scheduled downtime opens (or
    // annotates) an OUT_OF_SERVICE ticket and notifies the departments.
    await opsOnPlaceOutOfService(tx, {
      placeId: created.placeId,
      reason: created.reason,
      until: created.endsAt,
      outageId: created.id,
      actorUserId,
    });
    await audit(tx, {
      actorUserId,
      action: 'CREATE',
      entityType: 'PlaceOutage',
      entityId: created.id,
      after: created,
    });
    await enqueueById(tx, 'PlaceOutage', created.id);
    await enqueueById(tx, 'PlaceOutageLog', createdLog.id);
    return created;
  });
}

/** Cancel a scheduled / active out-of-service window (audited). */
export async function adminDeletePlaceOutage(id: string, actorUserId: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.placeOutage.findUnique({ where: { id } });
    if (!before) throw new DomainError('not_found', 'not_found', 404);
    // Keep the history truthful before deleting the live row. The branch is by
    // TIME, not by which button was pressed:
    //   future window  → cancelled before it started: zero downtime, flag it;
    //   active window  → ended early: truncate endsAt to the real end (now);
    //   already ended  → the log row is already accurate, leave it.
    const now = new Date();
    // Capture affected log-row ids so the in-place history edit below can be
    // pushed as an upsert snapshot (no id is returned by updateMany).
    const affectedLogIds = (
      before.startsAt.getTime() > now.getTime() || before.endsAt.getTime() > now.getTime()
        ? await tx.placeOutageLog.findMany({ where: { outageId: id }, select: { id: true } })
        : []
    ).map((r) => r.id);
    if (before.startsAt.getTime() > now.getTime()) {
      await tx.placeOutageLog.updateMany({
        where: { outageId: id },
        data: { cancelled: true, endedById: actorUserId },
      });
    } else if (before.endsAt.getTime() > now.getTime()) {
      await tx.placeOutageLog.updateMany({
        where: { outageId: id },
        data: { endsAt: now, endedById: actorUserId },
      });
    }
    for (const logId of affectedLogIds) {
      await enqueueById(tx, 'PlaceOutageLog', logId);
    }
    await tx.placeOutage.delete({ where: { id } });
    await enqueueById(tx, 'PlaceOutage', id, 'delete');
    // Housekeeping & maintenance desk: ending an ACTIVE window can bring the
    // place back to service — annotate any open OUT_OF_SERVICE ticket when the
    // place is now truly online (no other live window, not switched offline).
    if (before.startsAt.getTime() <= now.getTime() && before.endsAt.getTime() > now.getTime()) {
      const stillDown = await tx.placeOutage.findFirst({
        where: { placeId: before.placeId, startsAt: { lte: now }, endsAt: { gt: now } },
        select: { id: true },
      });
      const place = await tx.servicePlace.findUnique({
        where: { id: before.placeId },
        select: { isActive: true },
      });
      if (!stillDown && place?.isActive) {
        await opsOnPlaceBackInService(tx, { placeId: before.placeId, actorUserId });
      }
    }
    await audit(tx, {
      actorUserId,
      action: 'DELETE',
      entityType: 'PlaceOutage',
      entityId: id,
      before,
    });
  });
}

export async function adminCreatePlace(serviceId: string, data: PlaceInput, actorUserId: string) {
  assertNotLocalNode('Place inventory');
  try {
    return await prisma.$transaction(async (tx) => {
      const service = await tx.service.findUnique({ where: { id: serviceId }, select: { id: true } });
      if (!service) throw new DomainError('not_found', 'not_found', 404);
      const created = await tx.servicePlace.create({
        data: {
          serviceId,
          label: data.label,
          type: data.type,
          zone: data.zone ?? null,
          position: data.position ?? 0,
          gridX: data.gridX ?? 0,
          gridY: data.gridY ?? 0,
          sortOrder: data.sortOrder ?? 0,
          isActive: data.isActive ?? true,
          isHandicap: data.isHandicap ?? false,
          zkAccessLevelId: data.zkAccessLevelId ?? null,
          zkDoorLabel: data.zkDoorLabel ?? null,
        },
      });
      await audit(tx, {
        actorUserId,
        action: 'CREATE',
        entityType: 'ServicePlace',
        entityId: created.id,
        after: created,
      });
      return created;
    });
  } catch (err) {
    rethrowAsLabelTaken(err);
  }
}

export async function adminUpdatePlace(id: string, data: PlaceInput, actorUserId: string) {
  assertNotLocalNode('Place inventory');
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.servicePlace.findUnique({ where: { id } });
      if (!before) throw new DomainError('not_found', 'not_found', 404);
      const after = await tx.servicePlace.update({
        where: { id },
        data: {
          label: data.label,
          type: data.type,
          zone: data.zone ?? null,
          position: data.position ?? 0,
          sortOrder: data.sortOrder ?? 0,
          isActive: data.isActive ?? true,
          // Only touch coordinates / handicap when explicitly provided (the
          // layout editor moves places via `adminMovePlace`; the per-place
          // handicap toggle goes through `adminSetPlaceHandicap`).
          ...(data.gridX != null ? { gridX: data.gridX } : {}),
          ...(data.gridY != null ? { gridY: data.gridY } : {}),
          ...(data.isHandicap != null ? { isHandicap: data.isHandicap } : {}),
          // Only touch the ZK level when the edit form sent it (undefined = leave
          // as-is); an explicit null/'' clears the door mapping.
          ...(data.zkAccessLevelId !== undefined ? { zkAccessLevelId: data.zkAccessLevelId } : {}),
          ...(data.zkDoorLabel !== undefined ? { zkDoorLabel: data.zkDoorLabel } : {}),
        },
      });
      // The edit form can flip isActive too — record the downtime span exactly
      // like the quick toggle does, or offline time would silently go unlogged.
      await logActiveFlip(tx, id, before.isActive, data.isActive ?? true, actorUserId);
      await audit(tx, {
        actorUserId,
        action: 'UPDATE',
        entityType: 'ServicePlace',
        entityId: id,
        before,
        after,
      });
      return after;
    });
  } catch (err) {
    rethrowAsLabelTaken(err);
  }
}

export async function adminDeletePlace(id: string, actorUserId: string) {
  assertNotLocalNode('Place inventory');
  return prisma.$transaction(async (tx) => {
    const before = await tx.servicePlace.findUnique({
      where: { id },
      include: { units: { select: { id: true }, take: 1 } },
    });
    if (!before) throw new DomainError('not_found', 'not_found', 404);
    // Refuse to delete a place that is (or was) assigned to a booking unit — the
    // assignment history would silently lose its place. Deactivate it instead.
    if (before.units.length > 0) {
      throw new DomainError('place_in_use', 'place_in_use', 409);
    }
    await tx.servicePlace.delete({ where: { id } });
    await audit(tx, {
      actorUserId,
      action: 'DELETE',
      entityType: 'ServicePlace',
      entityId: id,
      before,
    });
  });
}

/**
 * Bulk-delete a service's places — a specific selection or `'all'`.
 *
 * Mirrors `adminDeletePlace`'s safety rule per place: anything that is (or
 * ever was) assigned to a booking unit is SKIPPED, never deleted — its
 * assignment history must keep its place. The caller gets exact counts so the
 * UI can report "removed X · kept Y (in use)". One audit row summarises the
 * batch (labels capped to keep the row bounded).
 */
export async function adminBulkDeletePlaces(
  serviceId: string,
  placeIds: string[] | 'all',
  actorUserId: string,
): Promise<{ deleted: number; skippedInUse: number }> {
  assertNotLocalNode('Place inventory');
  return prisma.$transaction(async (tx) => {
    const candidates = await tx.servicePlace.findMany({
      where: placeIds === 'all' ? { serviceId } : { serviceId, id: { in: placeIds } },
      select: { id: true, label: true, units: { select: { id: true }, take: 1 } },
    });
    const deletable = candidates.filter((p) => p.units.length === 0);
    const skippedInUse = candidates.length - deletable.length;
    if (deletable.length > 0) {
      await tx.servicePlace.deleteMany({ where: { id: { in: deletable.map((p) => p.id) } } });
      await audit(tx, {
        actorUserId,
        action: 'DELETE',
        entityType: 'ServicePlace',
        entityId: serviceId,
        before: {
          bulkDeleted: deletable.length,
          skippedInUse,
          scope: placeIds === 'all' ? 'all' : 'selection',
          labels: deletable.slice(0, 50).map((p) => p.label),
        },
      });
    }
    return { deleted: deletable.length, skippedInUse };
  });
}

/**
 * Move a place to new layout coordinates. Used by the admin drag-to-arrange map.
 * Lightweight (no audit row per drag) — coordinates are cosmetic layout state.
 */
export async function adminMovePlace(
  serviceId: string,
  placeId: string,
  gridX: number,
  gridY: number,
  actorId: string,
) {
  assertNotLocalNode('Place inventory');
  const place = await prisma.servicePlace.findFirst({
    where: { id: placeId, serviceId },
    select: { id: true, gridX: true, gridY: true },
  });
  if (!place) throw new DomainError('not_found', 'not_found', 404);
  const x = Math.max(0, Math.trunc(gridX));
  const y = Math.max(0, Math.trunc(gridY));
  await prisma.$transaction(async (tx) => {
    await tx.servicePlace.update({ where: { id: placeId }, data: { gridX: x, gridY: y } });
    await audit(tx, {
      actorUserId: actorId,
      action: 'UPDATE',
      entityType: 'ServicePlace',
      entityId: placeId,
      before: { gridX: place.gridX, gridY: place.gridY },
      after: { gridX: x, gridY: y },
    });
  });
  return { ok: true as const };
}

export interface BulkAddInput {
  type: PlaceType;
  zone?: string | null;
  /** Label prefix, e.g. "C" → C1, C2 … */
  prefix: string;
  from: number;
  to: number;
  /** Mark the whole batch as accessibility (handicap) cells. */
  isHandicap?: boolean;
}

/**
 * Create a numbered run of places (prefix+from … prefix+to). `position` follows
 * the number so the adjacency recommendation treats consecutive labels as
 * neighbours. Labels that already exist are skipped (idempotent-ish).
 */
export async function adminBulkAddPlaces(
  serviceId: string,
  input: BulkAddInput,
  actorUserId: string,
) {
  assertNotLocalNode('Place inventory');
  if (input.to < input.from) throw new DomainError('invalid_range', 'invalid_range', 400);
  if (input.to - input.from + 1 > 500) throw new DomainError('range_too_large', 'range_too_large', 400);

  return prisma.$transaction(async (tx) => {
    const service = await tx.service.findUnique({ where: { id: serviceId }, select: { id: true } });
    if (!service) throw new DomainError('not_found', 'not_found', 404);

    const existing = new Set(
      (await tx.servicePlace.findMany({ where: { serviceId }, select: { label: true } })).map(
        (p) => p.label,
      ),
    );

    // Lay new places out on the grid below any existing rows so they don't
    // overlap what the admin has already arranged.
    const maxY = await tx.servicePlace.aggregate({
      where: { serviceId },
      _max: { gridY: true },
    });
    const startRow = existing.size > 0 ? (maxY._max.gridY ?? 0) + 1 : 0;

    const rows: Prisma.ServicePlaceCreateManyInput[] = [];
    let n = 0;
    for (let i = input.from; i <= input.to; i++) {
      const label = `${input.prefix}${i}`;
      if (existing.has(label)) continue;
      rows.push({
        serviceId,
        label,
        type: input.type,
        zone: input.zone ?? null,
        position: i,
        gridX: n % 8,
        gridY: startRow + Math.floor(n / 8),
        sortOrder: i,
        isHandicap: input.isHandicap ?? false,
      });
      n += 1;
    }
    if (rows.length) {
      await tx.servicePlace.createMany({ data: rows });
      await audit(tx, {
        actorUserId,
        action: 'CREATE',
        entityType: 'ServicePlace',
        entityId: serviceId,
        after: { bulkAdded: rows.length, prefix: input.prefix, from: input.from, to: input.to },
      });
    }
    return { added: rows.length };
  });
}

import 'server-only';
import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { auditStandalone } from '@/server/audit/audit';
import { resortCivilDayUTC } from '@/lib/date';
import { log, errFields } from '@/lib/log';
import { getZkConfig, isZkConfigured, ZkNotConfiguredError } from './client';
import { personAdd, personDelete, departmentAdd, accLevelDeletePerson } from './api';
import { classifyZkError } from './errors';
import {
  zkAccessWindow,
  computeDesiredLevels,
  isBookingPastCivilDay,
  isActiveBookingStatus,
  zkPersonName,
} from './provision-core';
import { isLocal } from '@/server/sync/config';
import { enqueueBookingLocalState } from '@/server/sync/booking-local-state';

/**
 * ZK provisioning orchestration — the impure layer that reconciles ZKBio to match
 * a booking. Idempotent and never trusted to run inside a payment transaction:
 * triggers call the `safe*` wrappers post-commit (best-effort), and the reconciler
 * is the backstop. Nothing here ever fails a paid/confirmed booking.
 */

export interface ZkSyncResult {
  status: 'provisioned' | 'pending' | 'failed' | 'revoked' | 'skipped';
  reason?: string;
}

const GUEST_DEPT_NAME = 'Guests';

// ── Data loading ───────────────────────────────────────────────────────────--

async function loadBooking(bookingId: string) {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      reference: true,
      status: true,
      bookingDate: true,
      endDate: true,
      guestName: true,
      zkProvisionStatus: true,
      zkPin: true,
      zkCardNo: true,
      zkLevelIds: true,
      user: { select: { name: true } },
      service: { select: { requiresAccessControl: true } },
      units: { select: { place: { select: { zkAccessLevelId: true } } } },
    },
  });
}

// ── Card pool (atomic claim / release) ───────────────────────────────────────

/**
 * Claim a free active card for a booking, or return null if the pool is empty.
 * Race-safe: the conditional `updateMany` (where `assignedBookingId` is null) can
 * only succeed for one caller; a lost race retries with the next candidate, and a
 * `@unique(assignedBookingId)` violation (two syncs for the SAME booking) resolves
 * to the card the winner already claimed.
 */
export async function claimCardForBooking(
  bookingId: string,
): Promise<{ id: string; cardNo: string } | null> {
  const existing = await prisma.zkCard.findUnique({
    where: { assignedBookingId: bookingId },
    select: { id: true, cardNo: true },
  });
  if (existing) return existing;

  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = await prisma.zkCard.findFirst({
      where: { assignedBookingId: null, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, cardNo: true },
    });
    if (!candidate) return null; // pool exhausted

    try {
      const claimed = await prisma.zkCard.updateMany({
        where: { id: candidate.id, assignedBookingId: null },
        data: { assignedBookingId: bookingId, assignedAt: new Date() },
      });
      if (claimed.count === 1) return candidate;
      // Lost the race for this candidate — try the next free card.
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // This booking already holds a card (concurrent sync) — use it.
        const now = await prisma.zkCard.findUnique({
          where: { assignedBookingId: bookingId },
          select: { id: true, cardNo: true },
        });
        if (now) return now;
      } else {
        throw err;
      }
    }
  }
  return null;
}

/** Release whatever card a booking holds back into the pool. Idempotent. */
export async function releaseCardForBooking(bookingId: string): Promise<void> {
  await prisma.zkCard.updateMany({
    where: { assignedBookingId: bookingId },
    data: { assignedBookingId: null, assignedAt: null },
  });
}

/**
 * A pool card that ZK reports as already-in-use (`-23`) is retired AND released so
 * it is never re-claimed until an admin reviews it (a stale/duplicate cardNo).
 */
async function retireConflictedCard(cardId: string): Promise<void> {
  await prisma.zkCard.update({
    where: { id: cardId },
    data: { assignedBookingId: null, assignedAt: null, isActive: false },
  });
  log.warn('zk retired card: ZK reports the number already in use (-23)', { cardId });
}

// ── PIN ────────────────────────────────────────────────────────────────────--

/**
 * A stable 9-digit numeric ZK pin for the booking, generated once and stored.
 * Uniqueness only needs to hold among currently-active ZK bookings (past persons
 * are deleted on teardown), so a short check against the active set suffices.
 */
async function ensureZkPin(booking: { id: string; zkPin: string | null }): Promise<string> {
  if (booking.zkPin) return booking.zkPin;
  for (let i = 0; i < 12; i++) {
    const pin = String(randomInt(100_000_000, 1_000_000_000));
    const clash = await prisma.booking.findFirst({
      where: { zkPin: pin, id: { not: booking.id }, status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] } },
      select: { id: true },
    });
    if (!clash) {
      await prisma.booking.update({ where: { id: booking.id }, data: { zkPin: pin } });
      return pin;
    }
  }
  throw new Error('zk_pin_generation_failed');
}

// ── Department (best-effort, once per process) ───────────────────────────────

let deptEnsured = false;
async function ensureGuestDepartment(deptCode: string): Promise<void> {
  if (deptEnsured) return;
  try {
    await departmentAdd(GUEST_DEPT_NAME, deptCode);
  } catch {
    // Already exists (or a transient error) — persons still add under the code.
  }
  deptEnsured = true;
}

// ── Persistence of provisioning state ────────────────────────────────────────

function auditZk(bookingId: string, event: string, detail: Record<string, unknown>) {
  // Best-effort, non-blocking audit trail; never let logging break provisioning.
  void auditStandalone({
    action: 'STATUS_CHANGE',
    entityType: 'ZkAccess',
    entityId: bookingId,
    after: { event, ...detail },
  }).catch(() => {});
}

async function finishProvisioned(
  bookingId: string,
  pin: string,
  cardNo: string | null,
  levels: string[],
): Promise<ZkSyncResult> {
  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      zkProvisionStatus: 'PROVISIONED',
      zkPin: pin,
      zkCardNo: cardNo,
      // Remember the doors we just bound so the NEXT sync can diff + revoke any
      // that get reassigned away (H8). Null when no place is assigned yet.
      zkLevelIds: levels.length ? levels.join(',') : null,
      zkLastError: null,
      zkProvisionedAt: new Date(),
    },
  });
  auditZk(bookingId, 'PROVISIONED', { pin, cardNo, levels });
  return { status: 'provisioned' };
}

/** Person pushed, but not fully done (e.g. no card yet) — reconciler will finish. */
async function finishPending(
  bookingId: string,
  pin: string,
  cardNo: string | null,
  reason: string,
  levels: string[],
): Promise<ZkSyncResult> {
  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      zkProvisionStatus: 'PENDING',
      zkPin: pin,
      zkCardNo: cardNo,
      // The person WAS pushed with these levels — record them so a later sync
      // can diff + revoke reassigned doors (H8).
      zkLevelIds: levels.length ? levels.join(',') : null,
      zkLastError: reason,
      zkProvisionedAt: new Date(),
    },
  });
  auditZk(bookingId, 'PENDING', { reason });
  return { status: 'pending', reason };
}

/**
 * Actively remove any ZK access levels the booking no longer holds (its cabin was
 * reassigned or released). `personAdd` only ADDS levels, so without this a guest
 * keeps the old door. Best-effort — the reconciler re-diffs on the next sweep.
 */
async function revokeRemovedLevels(
  pin: string,
  previousCsv: string | null | undefined,
  desired: string[],
): Promise<void> {
  const previous = (previousCsv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const removed = previous.filter((l) => !desired.includes(l));
  if (removed.length === 0) return;
  try {
    await accLevelDeletePerson(pin, removed.join(','));
  } catch (err) {
    // Do not log the pin — it is a door-access credential (see pass.ts). The
    // failed level ids + error are enough to debug; the audit log has the pin.
    log.warn('zk failed to remove revoked levels', { levels: removed.join(','), ...errFields(err) });
  }
}

async function finishFailed(
  bookingId: string,
  pin: string,
  cardNo: string | null,
  decision: ReturnType<typeof classifyZkError>,
): Promise<ZkSyncResult> {
  // Transient failures stay PENDING (reconciler retries); config/fatal → FAILED.
  const status = decision.retryable ? 'PENDING' : 'FAILED';
  await prisma.booking.update({
    where: { id: bookingId },
    data: { zkProvisionStatus: status, zkPin: pin, zkCardNo: cardNo, zkLastError: decision.reason },
  });
  auditZk(bookingId, status, { reason: decision.reason });
  if (decision.adminActionable) {
    log.warn('zk booking needs admin attention', { bookingId, reason: decision.reason });
  }
  return { status: decision.retryable ? 'pending' : 'failed', reason: decision.reason };
}

// ── Push helper ──────────────────────────────────────────────────────────────

async function pushPerson(input: {
  pin: string;
  deptCode: string;
  name: string;
  cardNo?: string;
  levels: string[];
  window: { start: string; end: string };
}): Promise<void> {
  await personAdd({
    pin: input.pin,
    deptCode: input.deptCode,
    name: input.name,
    // Omit cardNo when absent so we never clear an existing binding by accident.
    ...(input.cardNo ? { cardNo: input.cardNo } : {}),
    // Only send accLevelIds when a place is assigned; an empty string would clear.
    ...(input.levels.length ? { accLevelIds: input.levels.join(',') } : {}),
    accStartTime: input.window.start,
    accEndTime: input.window.end,
  });
}

// ── Main entry: desired-state sync ───────────────────────────────────────────

/**
 * Reconcile ZKBio to match a booking. Idempotent — safe to call from any trigger
 * and repeatedly from the reconciler.
 */
export async function syncBookingZkAccess(bookingId: string): Promise<ZkSyncResult> {
  const booking = await loadBooking(bookingId);
  if (!booking) return { status: 'skipped', reason: 'booking_not_found' };

  // Not a ZK service → nothing to do (and undo if it was somehow provisioned).
  if (!booking.service?.requiresAccessControl) {
    if (booking.zkProvisionStatus !== 'NONE') await revokeBookingZkAccess(bookingId);
    return { status: 'skipped', reason: 'not_zk_service' };
  }

  // Terminal or past its day → tear down.
  const nowCivil = resortCivilDayUTC();
  const terminal = !isActiveBookingStatus(booking.status);
  const past = isBookingPastCivilDay(booking.bookingDate, booking.endDate, nowCivil);
  if (terminal || past) {
    await revokeBookingZkAccess(bookingId);
    return { status: 'revoked', reason: terminal ? 'terminal' : 'past_day' };
  }

  // Only provision a CONFIRMED booking (a PENDING_PAYMENT one waits for payment).
  if (booking.status !== 'CONFIRMED') return { status: 'skipped', reason: 'not_confirmed' };

  // ZK off / not configured → inert (leave status untouched).
  let config;
  try {
    config = await getZkConfig();
  } catch (err) {
    if (err instanceof ZkNotConfiguredError) return { status: 'skipped', reason: 'zk_disabled' };
    throw err;
  }

  const pin = await ensureZkPin(booking);
  await ensureGuestDepartment(config.guestDeptCode);

  const card = await claimCardForBooking(bookingId);
  const levels = computeDesiredLevels(booking.units);
  const window = zkAccessWindow(booking.bookingDate, booking.endDate);
  const name = zkPersonName({
    guestName: booking.guestName,
    userName: booking.user?.name,
    reference: booking.reference,
  });

  // The door set previously pushed to this person (for the reassignment diff).
  const previousLevelsCsv = booking.zkLevelIds;

  try {
    await pushPerson({ pin, deptCode: config.guestDeptCode, name, cardNo: card?.cardNo, levels, window });
  } catch (err) {
    const decision = classifyZkError(err);
    // A pool card ZK reports as used: retire it, claim another, retry once.
    if (decision.kind === 'card_conflict' && card) {
      await retireConflictedCard(card.id);
      const card2 = await claimCardForBooking(bookingId);
      try {
        await pushPerson({ pin, deptCode: config.guestDeptCode, name, cardNo: card2?.cardNo, levels, window });
        await revokeRemovedLevels(pin, previousLevelsCsv, levels);
        return card2?.cardNo
          ? finishProvisioned(bookingId, pin, card2.cardNo, levels)
          : finishPending(bookingId, pin, null, 'no_card_available', levels);
      } catch (err2) {
        return finishFailed(bookingId, pin, card2?.cardNo ?? null, classifyZkError(err2));
      }
    }
    return finishFailed(bookingId, pin, card?.cardNo ?? null, decision);
  }

  // Person pushed OK — actively remove any doors no longer desired (place
  // reassigned/released) so the guest can't still open the old cabin, THEN persist
  // the new level set for the next diff.
  await revokeRemovedLevels(pin, previousLevelsCsv, levels);

  // Without a card it's usable (QR) but not complete → PENDING.
  return card?.cardNo
    ? finishProvisioned(bookingId, pin, card.cardNo, levels)
    : finishPending(bookingId, pin, null, 'no_card_available', levels);
}

/**
 * Tear down a booking's ZK access: delete the person, release the card, mark
 * REVOKED. Idempotent. Only frees the card AFTER the person is gone, so a released
 * card number is never re-provisioned onto another guest while ZK still holds it.
 */
export async function revokeBookingZkAccess(bookingId: string): Promise<{ ok: boolean }> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, zkPin: true, zkProvisionStatus: true },
  });
  if (!booking) return { ok: true };

  // Nothing was ever provisioned (a non-ZK booking, or already torn down) — the
  // cancel/refund triggers fire for every booking, so skip fast here.
  if (booking.zkProvisionStatus === 'NONE' && !booking.zkPin) return { ok: true };
  if (booking.zkProvisionStatus === 'REVOKED') return { ok: true };

  // Free any card and delete the ZK person.
  let personGone = true;
  if (booking.zkPin) {
    try {
      if (await isZkConfigured()) {
        await personDelete(booking.zkPin);
      }
      // If ZK is off we can't call it; access is inert, so treat the person as gone.
    } catch (err) {
      const decision = classifyZkError(err);
      if (decision.kind !== 'not_found') {
        personGone = false;
        log.error('zk revoke delete failed', { bookingId, ...errFields(err) });
      }
    }
  }

  if (!personGone) {
    // Transient: keep the card + status so the next reconciler sweep retries.
    await prisma.booking.update({
      where: { id: bookingId },
      data: { zkLastError: 'revoke_pending' },
    });
    return { ok: false };
  }

  await releaseCardForBooking(bookingId);
  await prisma.booking.update({
    where: { id: bookingId },
    data: { zkProvisionStatus: 'REVOKED', zkCardNo: null, zkLevelIds: null, zkLastError: null },
  });
  auditZk(bookingId, 'REVOKED', {});
  return { ok: true };
}

// ── Never-throw wrappers for lifecycle triggers ──────────────────────────────

/**
 * Sync (local→online): queue the booking's local state (which carries the zk*
 * columns just written). Best-effort in its own tx — the ZK reconciler re-syncs
 * on its next pass, so a missed enqueue self-heals. No-op off-local.
 */
async function queueZkState(bookingId: string): Promise<void> {
  if (!isLocal()) return;
  try {
    await prisma.$transaction((tx) => enqueueBookingLocalState(tx, bookingId));
  } catch (err) {
    log.error('zk sync enqueue failed', { bookingId, ...errFields(err) });
  }
}

/** Fire-and-log provisioning from a trigger; never throws (best-effort). */
export async function safeSyncBookingZkAccess(bookingId: string): Promise<void> {
  try {
    const result = await syncBookingZkAccess(bookingId);
    if (result.status === 'failed') {
      log.warn('zk provisioning failed', { bookingId, reason: result.reason });
    }
  } catch (err) {
    log.error('zk provisioning crashed', { bookingId, ...errFields(err) });
  }
  await queueZkState(bookingId);
}

/** Fire-and-log teardown from a trigger; never throws (best-effort). */
export async function safeRevokeBookingZkAccess(bookingId: string): Promise<void> {
  try {
    await revokeBookingZkAccess(bookingId);
  } catch (err) {
    log.error('zk revoke crashed', { bookingId, ...errFields(err) });
  }
  await queueZkState(bookingId);
}

import type { Prisma } from '@prisma/client';
import { isLocal } from './config';
import { enqueueOutbox } from './outbox';

/**
 * Field-scoped sync of the LOCAL-OWNED operational state that physically lives
 * as columns on the (online-owned) Booking / BookingUnit rows.
 *
 * These columns are written by gate check-in/out, place assignment, and ZK
 * provisioning — all of which run on `local`. To keep the 142 readers across 24
 * files unchanged while still preventing the online→local pull from clobbering
 * them, we:
 *   1. PULL: omit these columns when upserting Booking/BookingUnit on local
 *      (pull.ts) — local's gate-written values survive.
 *   2. PUSH: after any local write, enqueue a whole-row snapshot to
 *      BookingLocalState / UnitPlacement (id === the parent id, matching the
 *      migration backfill so both nodes agree).
 *   3. APPLY (online): mirror the pushed snapshot back onto online's own
 *      Booking/BookingUnit columns (apply-core.ts) — online's readers stay
 *      unchanged too.
 */

// Booking columns that are local-owned operational state.
export const BOOKING_STATE_FIELDS = [
  'checkedInAt',
  'checkedInById',
  'checkedInCount',
  'checkedOutAt',
  'checkedOutById',
  'checkedOutCount',
  'placementStatus',
  'zkProvisionStatus',
  'zkPin',
  'zkCardNo',
  'zkLastError',
  'zkProvisionedAt',
  'zkLevelIds',
] as const;

// BookingUnit columns that are local-owned operational state.
export const UNIT_STATE_FIELDS = ['placeId', 'assignedById', 'assignedAt', 'checkedInAt'] as const;

// GuestIdDocument columns that are LOCAL-owned per-guest gate state. The ID rows
// themselves are online-created for reception walk-ins (so they're pulled), but
// WHO entered and WHEN is a gate operation written locally + pushed up — so the
// pull must never clobber it (mirrors BOOKING_STATE_FIELDS).
export const GUESTID_STATE_FIELDS = ['checkedInAt', 'checkedInById'] as const;

const BOOKING_STATE_SELECT = Object.fromEntries(
  BOOKING_STATE_FIELDS.map((f) => [f, true]),
) as Record<(typeof BOOKING_STATE_FIELDS)[number], true>;

const UNIT_STATE_SELECT = {
  bookingId: true,
  date: true,
  placeId: true,
  assignedById: true,
  assignedAt: true,
  checkedInAt: true,
} as const;

/** Normalize Prisma rows (Dates → ISO strings) into a plain JSON snapshot. */
function toJson(obj: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(obj)) as Prisma.InputJsonValue;
}

/**
 * Enqueue a whole-row snapshot of a booking's local state. Call inside the same
 * transaction as the gate/ZK write. No-op off `local`. id === bookingId so it
 * matches the deterministic migration backfill (conflict-free upsert on online).
 *
 * `updatedAt` is stamped here (LOCAL clock at enqueue time) because these
 * snapshots are built from Booking COLUMNS, not from a row that carries its own
 * `updatedAt` — without the stamp the apply-side version guard is silently
 * skipped, and a quarantined-then-re-armed OLDER snapshot would regress online
 * state (e.g. revert a checked-out guest to checked-in via the column mirror).
 * Local is the single writer of this state, so successive stamps are monotonic
 * within one clock domain; online persists the explicit value verbatim, so the
 * guard always compares local-clock vs local-clock. Two accepted edges: (1) the
 * very first stamped push per migration-backfilled row compares against that
 * backfill's ONLINE-clock stamp (one-time, benign once venue skew < time since
 * the migration); (2) an NTP step-back on the venue clock can stamp a newer
 * snapshot older — the guard drops it as stale until the next local write, which
 * re-snapshots the current state and self-corrects.
 */
export async function enqueueBookingLocalState(
  tx: Prisma.TransactionClient,
  bookingId: string,
): Promise<void> {
  if (!isLocal()) return;
  const b = await tx.booking.findUnique({ where: { id: bookingId }, select: BOOKING_STATE_SELECT });
  if (!b) return;
  await enqueueOutbox(tx, {
    entityType: 'BookingLocalState',
    entityId: bookingId,
    payload: toJson({ id: bookingId, bookingId, ...b, updatedAt: new Date() }),
  });
}

/**
 * Enqueue a snapshot of every one of a booking's unit placements. Call inside
 * the same transaction as the place-assignment write. No-op off `local`.
 */
export async function enqueueUnitPlacements(
  tx: Prisma.TransactionClient,
  bookingId: string,
): Promise<void> {
  if (!isLocal()) return;
  const units = await tx.bookingUnit.findMany({
    where: { bookingId },
    select: { id: true, ...UNIT_STATE_SELECT },
  });
  // One stamp for the whole batch (see enqueueBookingLocalState for why the
  // snapshot must carry `updatedAt`): the units of one assignment write are a
  // single logical change, and the apply guard is strictly `>`, so equal stamps
  // never block the FIFO-later row.
  const stampedAt = new Date();
  for (const u of units) {
    const { id: uid, ...rest } = u;
    await enqueueOutbox(tx, {
      entityType: 'UnitPlacement',
      entityId: uid,
      payload: toJson({ id: uid, bookingUnitId: uid, ...rest, updatedAt: stampedAt }),
    });
  }
}

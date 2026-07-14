import 'server-only';
import type { StaffWorkLocation } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { enqueueById } from '@/server/sync/outbox';
import { nextSessionAction } from '@/lib/work-hours';

export { WORK_SESSION_IDLE_MS, nextSessionAction, sessionWorkedMs } from '@/lib/work-hours';

/**
 * Staff working-hours tracking.
 *
 * The product has no explicit clock-in/out, so a staff member's working time is
 * derived from the real gate/reception actions they perform. Each action calls
 * {@link recordWorkActivity}, which keeps an open {@link WorkSession} ("shift")
 * in sync:
 *
 *   - the worked span of a session is `(endedAt ?? lastActivityAt) − startedAt`
 *     — we never count time past the last real action, so an un-closed session
 *     can never inflate the hours total;
 *   - an action arriving after an idle gap longer than {@link WORK_SESSION_IDLE_MS}
 *     opens a NEW session instead of stretching the previous one, so a long
 *     break (lunch, off-shift) is excluded from worked time.
 *
 * All writes are best-effort: a failure here must never break the booking / scan
 * it accompanies, so callers invoke these AFTER the underlying action commits.
 */

/**
 * Idle gap (ms) after which the next action opens a fresh session rather than
 * extending the previous one. Three hours is long enough to bridge genuine
 * quiet periods at a resort desk, short enough to split clearly-separate shifts
 * (and any overnight gap).
 */
/**
 * Record that `staffId` performed a gate/reception action at `now`, syncing
 * their work session. Best-effort — never throws. Call after the action commits.
 */
export async function recordWorkActivity(
  staffId: string,
  location: StaffWorkLocation,
  now: Date = new Date(),
): Promise<void> {
  try {
    const open = await prisma.workSession.findFirst({
      where: { staffId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    const action = nextSessionAction(open, now);

    if (action === 'extend') {
      // Same shift — extend it to this action.
      await prisma.$transaction(async (tx) => {
        await tx.workSession.update({ where: { id: open!.id }, data: { lastActivityAt: now } });
        await enqueueById(tx, 'WorkSession', open!.id);
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      if (action === 'split') {
        // Idle too long — close the stale session at its LAST real activity (never
        // "now", which would count the idle gap as worked time), then open anew.
        await tx.workSession.update({
          where: { id: open!.id },
          data: { endedAt: open!.lastActivityAt, autoClosed: true },
        });
        await enqueueById(tx, 'WorkSession', open!.id);
      }

      const created = await tx.workSession.create({
        data: { staffId, location, startedAt: now, lastActivityAt: now },
      });
      await enqueueById(tx, 'WorkSession', created.id);
    });
  } catch {
    // Non-fatal: hours tolerate a rare lost touch; the next action re-syncs.
  }
}

/**
 * Close every open session for a staff member (explicit end-of-shift, e.g. on
 * sign-out). Closes at last activity, not "now". Best-effort — never throws.
 */
export async function closeWorkSessions(staffId: string, now: Date = new Date()): Promise<void> {
  try {
    const open = await prisma.workSession.findMany({ where: { staffId, endedAt: null } });
    await prisma.$transaction(async (tx) => {
      await Promise.all(
        open.map((s) =>
          tx.workSession.update({
            where: { id: s.id },
            // Cap at now in the (impossible-in-practice) case lastActivityAt is in
            // the future; otherwise use the real last-activity instant.
            data: { endedAt: s.lastActivityAt.getTime() > now.getTime() ? now : s.lastActivityAt },
          }),
        ),
      );
      await Promise.all(open.map((s) => enqueueById(tx, 'WorkSession', s.id)));
    });
  } catch {
    // Non-fatal.
  }
}

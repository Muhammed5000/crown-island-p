import { prisma } from '@/server/db/prisma';
import { log, errFields } from '@/lib/log';
import { onlineApiUrl, SYNC_PING_TIMEOUT_MS, SYNC_SETS_INTERVAL_MS } from './config';
import { pullAll } from './pull';
import { syncFiles, type FileSyncStats } from './file-sync';
import { drainOutbox, recoverQuarantined, pruneSyncQueue } from './push';

/**
 * The local sync worker. One tick = ping online for connectivity; if reachable,
 * pull ALL master data (config, catalog, accounts, bookings), download any
 * missing files, then drain the operational outbox up. If offline, just record
 * it — local keeps writing operations to the outbox and the booking-write UI
 * locks. Local initiates ALL sync; online is a passive receiver.
 *
 * `activity` (idle | pulling | pushing) is written to a SyncState row each tick
 * so /api/sync/status can show the on-screen indicator what's happening.
 */

const REACHABLE_KEY = 'online:reachable';
const ACTIVITY_KEY = 'sync:activity';
const FILE_STATS_KEY = 'file:stats';
/** Last time a pull included the full id-sets/slots (SYNC_SETS_INTERVAL_MS cadence). */
const SETS_KEY = 'pull:setsLastAt';

/** Persist the last file-sweep counters (+ timestamp) for /api/sync/status. */
async function recordFileStats(stats: FileSyncStats): Promise<void> {
  const payload = JSON.stringify({ at: new Date().toISOString(), ...stats });
  await prisma.syncState
    .upsert({
      where: { key: FILE_STATS_KEY },
      create: { key: FILE_STATS_KEY, cursor: payload },
      update: { cursor: payload },
    })
    // Cosmetic bookkeeping for the status indicator — never fail the tick, but
    // don't hide a real DB error either.
    .catch((err) => log.warn('sync worker recording file stats failed', errFields(err)));
}

export type SyncActivity = 'idle' | 'pulling' | 'pushing';

async function setActivity(activity: SyncActivity): Promise<void> {
  await prisma.syncState
    .upsert({
      where: { key: ACTIVITY_KEY },
      create: { key: ACTIVITY_KEY, cursor: activity },
      update: { cursor: activity },
    })
    .catch((err) => log.warn('sync worker recording activity failed', errFields(err)));
}

export async function pingOnline(): Promise<boolean> {
  const base = onlineApiUrl();
  if (!base) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_PING_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/api/health`, { signal: controller.signal });
    return res.status === 200;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function recordReachable(online: boolean): Promise<void> {
  const flag = online ? '1' : '0';
  await prisma.syncState.upsert({
    where: { key: REACHABLE_KEY },
    create: { key: REACHABLE_KEY, cursor: flag },
    update: { cursor: flag },
  });
}

/**
 * Most pulls skip the full id-sets + BookingSlot mirror (they're full-table
 * scans on online that only feed the delete-mirror / capacity views); force
 * them through every SYNC_SETS_INTERVAL_MS. pullAll additionally forces sets
 * on an initial sync (no cursor), regardless of what this returns.
 */
async function wantSetsThisTick(now: Date): Promise<boolean> {
  const state = await prisma.syncState.findUnique({ where: { key: SETS_KEY } });
  const last = state?.cursor ? new Date(state.cursor).getTime() : 0;
  return now.getTime() - last >= SYNC_SETS_INTERVAL_MS;
}

async function recordSetsPulled(now: Date): Promise<void> {
  await prisma.syncState.upsert({
    where: { key: SETS_KEY },
    create: { key: SETS_KEY, cursor: now.toISOString() },
    update: { cursor: now.toISOString() },
  });
}

export async function syncTick(): Promise<{ online: boolean }> {
  const online = await pingOnline();
  await recordReachable(online);
  if (!online) {
    await setActivity('idle');
    return { online: false };
  }

  // Pull first (bring local up to date), then run the file integrity sweep, then
  // push the outbox. Each stage is isolated so one failing never blocks the
  // others or crashes the tick — and each gets its OWN error label (the file
  // sweep used to be masked under "pull failed").
  await setActivity('pulling');
  try {
    const now = new Date();
    const result = await pullAll({ includeSets: await wantSetsThisTick(now) });
    // Advance the cadence key only after a SUCCESSFUL sets-included pull (also
    // covers pullAll forcing sets on an initial sync).
    if (result.includedSets) await recordSetsPulled(now);
  } catch (err) {
    log.error('sync pull failed', errFields(err));
  }
  try {
    const stats = await syncFiles();
    await recordFileStats(stats);
    if (stats.failed > 0 || stats.repushQueued > 0) {
      log.warn('sync file sweep', {
        checked: stats.checked,
        downloaded: stats.downloaded,
        repaired: stats.repaired,
        repushQueued: stats.repushQueued,
        failed: stats.failed,
      });
    }
  } catch (err) {
    log.error('sync file sync failed', errFields(err));
  }
  try {
    await setActivity('pushing');
    // Re-arm any quarantined rows (throttled internally) BEFORE draining, so a
    // row that was stuck on a since-fixed condition flushes on this same tick.
    await recoverQuarantined();
    await drainOutbox();
    // Retention housekeeping (throttled internally to once a day).
    await pruneSyncQueue();
  } catch (err) {
    log.error('sync push failed', errFields(err));
  }
  await setActivity('idle');
  return { online: true };
}

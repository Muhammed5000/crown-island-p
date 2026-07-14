import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/prisma';
import { appMode } from '@/server/sync/config';
import { MEDIA_FILE_ENTITY } from '@/server/sync/outbox';

/** Parse the last file-sweep counters JSON persisted by the worker (or null). */
function parseFileStats(cursor: string | null | undefined): unknown {
  if (!cursor) return null;
  try {
    return JSON.parse(cursor);
  } catch {
    return null;
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * In-process memo of the last computed body. The route is meaningful only on
 * the single-process LOCAL node, where SyncStatusProvider polls every ~4s PER
 * TAB and the desk keeps several tabs open — without the memo every poll fires
 * ~10 uncached DB queries. Worker state changes at 20s cadence, so 5s staleness
 * is invisible.
 */
const STATUS_TTL_MS = 5_000;
let memo: { at: number; body: unknown } | null = null;

/**
 * GET /api/sync/status  (LOCAL, read-only, no secret)
 *
 * Consumed by the client SyncStatusProvider poll. Reports whether online is
 * reachable, whether booking WRITES are currently allowed (the offline lock),
 * and the outbox depth (incl. quarantined/dead rows needing attention).
 * `online:reachable` is the heartbeat the local worker maintains (cursor '1' =
 * reachable). On the ONLINE deployment this endpoint does not exist (404): it
 * is unauthenticated by design (the local browser poll), and the public node
 * must not leak sync posture or serve as a free DB-query amplifier.
 */
export async function GET() {
  const mode = appMode();
  if (mode === 'online') {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  if (memo && Date.now() - memo.at < STATUS_TTL_MS) {
    return NextResponse.json(memo.body, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  }

  const [pending, filePushPending, failedCount, deadCount, reachable, pull, push, activity, fileStats, settings] =
    await Promise.all([
      prisma.syncQueue.count({ where: { status: 'pending' } }),
      prisma.syncQueue.count({ where: { status: 'pending', entityType: MEDIA_FILE_ENTITY } }),
      prisma.syncQueue.count({ where: { status: 'failed' } }),
      prisma.syncQueue.count({ where: { status: 'dead' } }),
      prisma.syncState.findUnique({ where: { key: 'online:reachable' } }),
      prisma.syncState.findUnique({ where: { key: 'pull:bookings' } }),
      prisma.syncState.findUnique({ where: { key: 'push' } }),
      prisma.syncState.findUnique({ where: { key: 'sync:activity' } }),
      prisma.syncState.findUnique({ where: { key: 'file:stats' } }),
      prisma.settings.findUnique({ where: { id: 'default' }, select: { bookingsEnabled: true } }),
    ]);

  const online = reachable?.cursor === '1';
  const bookingsEnabled = settings?.bookingsEnabled ?? true;

  const body = {
    mode: mode ?? 'unset',
    online,
    // The single lever the booking-write UI + server guard read: when local is
    // offline, booking writes are locked (reception proxy unavailable).
    bookingWritesEnabled: bookingsEnabled && (mode !== 'local' || online),
    bookingsEnabled,
    outboxDepth: pending,
    // Pending file-bytes pushes (the MediaFile lane) — a SUBSET of outboxDepth.
    filePushPending,
    // Quarantined rows awaiting the periodic re-arm, and dead-lettered rows that
    // spent their recovery budget (need manual triage — see push.ts).
    failedCount,
    deadCount,
    // What the worker is doing right now — drives the on-screen indicator.
    activity: (activity?.cursor as 'idle' | 'pulling' | 'pushing' | null) ?? 'idle',
    lastPulledAt: pull?.lastPulledAt ?? null,
    lastPushedAt: push?.lastPushedAt ?? null,
    // Last file-integrity sweep: { at, checked, downloaded, repaired, repushQueued, failed }.
    fileSync: parseFileStats(fileStats?.cursor),
  };

  memo = { at: Date.now(), body };
  return NextResponse.json(body, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}

import { readFile } from 'node:fs/promises';
import { prisma } from '@/server/db/prisma';
import { log } from '@/lib/log';
import {
  onlineApiUrl,
  SYNC_SECRET_HEADER,
  SYNC_QUEUE_RETENTION_DAYS,
  syncScopeSecret,
  SYNC_TRANSFER_TIMEOUT_MS,
} from './config';
import { MEDIA_FILE_ENTITY } from './outbox';
import { pushFileToOnline } from './push-file';
import { verifyFileIntegrity, mimeForExt } from './file-integrity-core';
import { resolveSensitiveUpload } from '@/lib/upload-paths';

/**
 * The push worker (runs on `local`). Drains the outbox oldest-first. Each change
 * must return HTTP 200 AND a confirmed-write body (`ok:true` with the same id).
 *
 * ONLINE-MASTER model: the pushables are INDEPENDENT operational rows (gate
 * events, work sessions, local-state snapshots — see outbox.PUSHABLE), so there
 * is no cross-row ordering to protect. The drain therefore SKIPS a failing row
 * and keeps going instead of stopping the whole queue on it — a single stuck row
 * (e.g. one blocked by a not-yet-deployed online migration) can never wedge every
 * later push behind it. A row that keeps failing is quarantined (status='failed')
 * after MAX_ATTEMPTS; `recoverQuarantined()` periodically re-arms those so the
 * queue self-heals once online catches up. See SYNC_PLAN.md §4.1.
 */

export interface OutboxRow {
  id: string;
  entityType: string;
  entityId: string;
  op: string;
  payload: unknown;
}

export interface SendResult {
  httpOk: boolean;
  status: number;
  /** The id online confirmed it wrote (from `{ ok:true, id }`), else null. */
  confirmedId: string | null;
  error?: string;
  /**
   * From online's response body: 'reject' = permanent (quarantine now),
   * 'retry' = transient (leave pending). Absent on success or a network error
   * (a network error is always treated as transient).
   */
  disposition?: 'reject' | 'retry';
}

/**
 * A row that keeps failing must not jam the queue behind it forever. After this
 * many failed attempts a still-unconfirmed row is quarantined (status='failed')
 * and the loop moves on. Handles the poison-pill case — e.g. a gate event whose
 * booking only ever lived on the local node, which online will always FK-reject.
 */
const MAX_ATTEMPTS = 5;

export type ApplySender = (row: OutboxRow) => Promise<SendResult>;

/** Default sender: POST one change to online's /api/sync/apply. */
async function postToOnline(row: OutboxRow): Promise<SendResult> {
  const base = onlineApiUrl();
  if (!base) return { httpOk: false, status: 0, confirmedId: null, error: 'online_api_url_unset' };
  // Outbox drain writes to online (/apply) — WRITE scope. (SYNC-001)
  const secret = syncScopeSecret('write') ?? '';
  try {
    const res = await fetch(`${base}/api/sync/apply`, {
      signal: AbortSignal.timeout(SYNC_TRANSFER_TIMEOUT_MS), // SYNC-002
      method: 'POST',
      headers: { 'content-type': 'application/json', [SYNC_SECRET_HEADER]: secret },
      body: JSON.stringify({
        entityType: row.entityType,
        entityId: row.entityId,
        op: row.op,
        payload: row.payload,
      }),
    });
    type ApplyBody = { ok?: boolean; id?: string; error?: string; disposition?: 'reject' | 'retry' };
    let body: ApplyBody | null = null;
    try {
      body = (await res.json()) as ApplyBody;
    } catch {
      body = null;
    }
    const confirmedId = body && body.ok === true ? (body.id ?? null) : null;
    return {
      httpOk: res.status === 200,
      status: res.status,
      confirmedId,
      error: body?.error,
      disposition: body?.disposition,
    };
  } catch (err) {
    return { httpOk: false, status: 0, confirmedId: null, error: (err as Error).message };
  }
}

/**
 * Default sender for the `MediaFile` lane: read the bytes off local disk at SEND
 * time, verify them, then push them verified to online's /api/sync/upload-file.
 *
 * A bad payload / missing / corrupt LOCAL file is a PERMANENT reject (quarantine)
 * rather than a doomed retry — but `recoverQuarantined` re-arms it every ≥10 min,
 * so once file-sync restores a temporarily-missing file the push self-heals. A
 * receiver 4xx/5xx or a network error is transient (stays pending → attempts++ →
 * quarantine at the cap → recovery), exactly like the JSON lane. Reading bytes at
 * send time (not enqueue time) means a re-push always ships the CURRENT disk copy.
 */
async function postMediaFile(row: OutboxRow): Promise<SendResult> {
  const payload = row.payload as {
    url?: string;
    mimeType?: string;
    sha256?: string | null;
    uploadedById?: string | null;
  } | null;
  const url = payload?.url;
  if (!url) {
    return { httpOk: false, status: 0, confirmedId: null, error: 'bad_media_payload', disposition: 'reject' };
  }
  const resolved = resolveSensitiveUpload(url);
  if (!resolved) {
    return { httpOk: false, status: 0, confirmedId: null, error: 'bad_media_url', disposition: 'reject' };
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(resolved.diskPath);
  } catch {
    return { httpOk: false, status: 0, confirmedId: null, error: 'local_file_missing', disposition: 'reject' };
  }
  // Never push corruption up under a fresh valid hash — verify the disk bytes
  // against the recorded hash + image signature before sending.
  const mime = payload?.mimeType || mimeForExt(resolved.ext) || 'application/octet-stream';
  const verdict = verifyFileIntegrity(bytes, { expectedSha256: payload?.sha256 ?? null, mime });
  if (!verdict.ok) {
    return { httpOk: false, status: 0, confirmedId: null, error: `local_${verdict.reason}`, disposition: 'reject' };
  }
  const pushed = await pushFileToOnline(url, mime, bytes, payload?.uploadedById ?? null);
  return {
    httpOk: pushed.ok,
    status: pushed.status,
    confirmedId: pushed.ok ? row.entityId : null,
    error: pushed.error,
    // 409 = the receiver refused to overwrite a verified-HEALTHY file with
    // different bytes (upload-file's tamper guard). That conflict is permanent —
    // retrying ships the same bytes — so quarantine instead of churning.
    disposition: pushed.status === 409 ? 'reject' : undefined,
  };
}

export interface DrainResult {
  pushed: number;
  stopped: boolean;
  failedId?: string;
  reason?: string;
}

export async function drainOutbox(
  opts: { send?: ApplySender; sendFile?: ApplySender; max?: number } = {},
): Promise<DrainResult> {
  const send = opts.send ?? postToOnline;
  const sendFile = opts.sendFile ?? postMediaFile;
  const max = opts.max ?? 1000; // safety bound per tick
  let pushed = 0;
  // Rows attempted THIS tick — excluded from the next `findFirst` so a row that
  // failed-but-stayed-pending isn't retried in a tight loop, and the drain keeps
  // advancing to the next row instead of stopping on it.
  const tried: string[] = [];

  for (let i = 0; i < max; i++) {
    // Oldest not-yet-tried pending row.
    const row = await prisma.syncQueue.findFirst({
      where: { status: 'pending', id: { notIn: tried } },
      orderBy: { createdAt: 'asc' },
    });
    if (!row) break; // nothing left to try this tick
    tried.push(row.id);

    // File-bytes rows go to the file sender; everything else to the JSON /apply
    // sender. Both return the same SendResult shape, so the confirm / quarantine
    // / recovery bookkeeping below is identical for both lanes.
    const result =
      row.entityType === MEDIA_FILE_ENTITY
        ? await sendFile(row as OutboxRow)
        : await send(row as OutboxRow);
    const confirmed =
      result.httpOk && result.status === 200 && result.confirmedId === row.entityId;

    if (!confirmed) {
      const attempts = row.attempts + 1;
      const reason = result.error ?? `unconfirmed (status=${result.status})`;
      // Quarantine (never auto-send again until recovery re-arms it) when online
      // says it's a PERMANENT reject (not-pushable / unknown entity) or it has
      // failed too many times. Otherwise leave it pending and move on to the next
      // row — a stuck row never blocks the ones behind it.
      const quarantine = result.disposition === 'reject' || attempts >= MAX_ATTEMPTS;
      await prisma.syncQueue.update({
        where: { id: row.id },
        data: {
          attempts: { increment: 1 },
          lastError: reason,
          ...(quarantine ? { status: 'failed' } : {}),
        },
      });
      if (quarantine) {
        log.error('sync push quarantined row', {
          entityType: row.entityType,
          entityId: row.entityId,
          reason,
        });
      }
      continue; // try the next row regardless
    }

    await prisma.syncQueue.update({
      where: { id: row.id },
      data: { status: 'synced', syncedAt: new Date() },
    });
    pushed++;
  }

  if (pushed > 0) {
    await prisma.syncState.upsert({
      where: { key: 'push' },
      create: { key: 'push', lastPushedAt: new Date() },
      update: { lastPushedAt: new Date() },
    });
  }
  return { pushed, stopped: false };
}

/**
 * Re-arm quarantined rows so the queue self-heals — WITH a dead-letter cap. A
 * row is quarantined (status='failed') after MAX_ATTEMPTS consecutive failures;
 * many of those are transient-but-slow conditions (above all an online node
 * briefly behind on a schema migration), so recovery promotes failed rows back
 * to 'pending' with a fresh attempt budget. But a genuinely-poison row must not
 * churn 5 attempts every interval FOREVER: each re-arm increments `recoveries`,
 * and at MAX_RECOVERIES the row is buried as status='dead' — terminal, never
 * auto-retried, surfaced via /api/sync/status (deadCount) for manual triage
 * (re-arm = set status='pending', attempts=0, recoveries=0 by hand). Total
 * budget for a poison row: MAX_ATTEMPTS × (MAX_RECOVERIES + 1) = 35 sends over
 * ~an hour, then silence. NOTE: burying is also what frees a parked sanction /
 * superseded ordering edge to converge (see pull.filterParkedSanctions).
 *
 * Called from the worker throttled to ~RECOVER_INTERVAL_MS via the
 * `recover:lastRunAt` SyncState key (SyncQueue has no per-row timestamp), so a
 * still-failing row costs at most one attempt-burst per interval.
 */
const RECOVER_INTERVAL_MS = 10 * 60_000; // 10 minutes
const RECOVER_KEY = 'recover:lastRunAt';
const MAX_RECOVERIES = 6;

export async function recoverQuarantined(now: Date = new Date()): Promise<number> {
  const state = await prisma.syncState.findUnique({ where: { key: RECOVER_KEY } });
  const last = state?.cursor ? new Date(state.cursor).getTime() : 0;
  if (now.getTime() - last < RECOVER_INTERVAL_MS) return 0;

  // Bury budget-spent rows FIRST so they don't get one more free round.
  const buried = await prisma.syncQueue.updateMany({
    where: { status: 'failed', recoveries: { gte: MAX_RECOVERIES } },
    data: { status: 'dead' },
  });
  if (buried.count > 0) {
    log.error('sync push dead-lettered rows after failed recoveries — see /api/sync/status', {
      count: buried.count,
      maxRecoveries: MAX_RECOVERIES,
    });
  }
  const res = await prisma.syncQueue.updateMany({
    where: { status: 'failed', recoveries: { lt: MAX_RECOVERIES } },
    data: { status: 'pending', attempts: 0, lastError: null, recoveries: { increment: 1 } },
  });
  await prisma.syncState.upsert({
    where: { key: RECOVER_KEY },
    create: { key: RECOVER_KEY, cursor: now.toISOString() },
    update: { cursor: now.toISOString() },
  });
  if (res.count > 0) log.info('sync push re-armed quarantined rows for retry', { count: res.count });
  return res.count;
}

/**
 * Prune finished outbox rows — without this the queue grows forever (one row
 * per operational mutation). `synced` and `superseded` rows are deleted after
 * SYNC_QUEUE_RETENTION_DAYS; `dead` rows are kept 4× longer so venue ops can
 * still inspect what was dropped. `pending`/`failed` rows are NEVER pruned —
 * they still carry undelivered work. Throttled to once a day via the same
 * SyncState-key mechanism as recoverQuarantined.
 */
const PRUNE_INTERVAL_MS = 24 * 60 * 60_000; // daily
const PRUNE_KEY = 'prune:lastRunAt';

export async function pruneSyncQueue(now: Date = new Date()): Promise<number> {
  const state = await prisma.syncState.findUnique({ where: { key: PRUNE_KEY } });
  const last = state?.cursor ? new Date(state.cursor).getTime() : 0;
  if (now.getTime() - last < PRUNE_INTERVAL_MS) return 0;

  const cutoff = new Date(now.getTime() - SYNC_QUEUE_RETENTION_DAYS * 86_400_000);
  const deadCutoff = new Date(now.getTime() - SYNC_QUEUE_RETENTION_DAYS * 4 * 86_400_000);
  const synced = await prisma.syncQueue.deleteMany({
    where: { status: 'synced', syncedAt: { lt: cutoff } },
  });
  // superseded rows never got a syncedAt — age them by creation.
  const superseded = await prisma.syncQueue.deleteMany({
    where: { status: 'superseded', createdAt: { lt: cutoff } },
  });
  const dead = await prisma.syncQueue.deleteMany({
    where: { status: 'dead', createdAt: { lt: deadCutoff } },
  });
  await prisma.syncState.upsert({
    where: { key: PRUNE_KEY },
    create: { key: PRUNE_KEY, cursor: now.toISOString() },
    update: { cursor: now.toISOString() },
  });
  const total = synced.count + superseded.count + dead.count;
  if (total > 0) {
    log.info('sync push pruned queue rows', {
      synced: synced.count,
      superseded: superseded.count,
      dead: dead.count,
    });
  }
  return total;
}

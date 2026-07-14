import { open, stat } from 'node:fs/promises';
import { prisma } from '@/server/db/prisma';
import { onlineApiUrl, SYNC_SECRET_HEADER, syncScopeSecret, SYNC_TRANSFER_TIMEOUT_MS } from './config';
import { resolveSensitiveUpload } from '@/lib/upload-paths';
import { imageSignatureMatches } from '@/lib/file-signature-core';
import {
  verifyFileIntegrity,
  planFileAction,
  mimeForExt,
  SIGNATURE_HEAD_BYTES,
  type OnlineFileStat,
} from './file-integrity-core';
import { atomicWrite } from './atomic-write';
import { enqueueFilePush, MEDIA_FILE_ENTITY } from './outbox';

/**
 * LOCAL file mirror + integrity sweep. Walks the `Media` manifest one id-ordered
 * BATCH per tick (wrapping `SyncState` cursor, so EVERY file is eventually
 * re-verified) and reconciles each stored file with online by an AUTHORITY-BY-
 * PREFIX rule:
 *
 *   - PUBLIC `/uploads/**` files are ONLINE-authored (catalog covers, menus). The
 *     local node only ever DOWNLOADS them: missing, or a live size that drifted
 *     from the row, → re-fetch (verified) from `GET /api/sync/file`.
 *   - SECURE `/api/secure-media/**` files are VENUE-authored (guest IDs, proofs).
 *     Local holds the master copy, so it REPAIRS online: it probes online via
 *     `POST /api/sync/file-stat` and, if online is missing / a different size /
 *     signature-broken, queues a verified re-push (`MediaFile` outbox lane). If
 *     the LOCAL secure copy is itself corrupt, it re-downloads from online (whose
 *     copy may be intact — the corrupt-clone recovery case).
 *
 * Every transfer is VERIFIED (size / sha256 / image signature) before it is
 * promoted, and writes are ATOMIC (temp + rename), so a truncated download can
 * never overwrite a good file and a present-but-corrupt file is detected rather
 * than trusted. Counters `{checked, downloaded, repaired, repushQueued, failed}`
 * are returned for the worker to surface (see worker.ts → SyncState 'file:stats').
 */
const WALK_CURSOR_KEY = 'file:walk-cursor';
const STAT_CHUNK = 200; // matches /api/sync/file-stat's per-request cap

export interface FileSyncStats {
  checked: number;
  downloaded: number;
  repaired: number;
  repushQueued: number;
  failed: number;
}

/** Media rows sharing one url, deduped (local-authored + pull-mirrored pair). */
interface UrlGroup {
  url: string;
  diskPath: string;
  ext: string;
  secure: boolean;
  ids: string[];
  mimeType: string;
  sizeBytes: number | null;
  sha256: string | null;
}

interface LocalFacts {
  exists: boolean;
  size: number | null;
  signatureOk: boolean | null;
}

/** Read the head of a file and run the image signature check (never full read). */
async function localSignature(diskPath: string, size: number, mime: string): Promise<boolean> {
  const len = Math.min(SIGNATURE_HEAD_BYTES, size);
  if (len <= 0) return false;
  const head = Buffer.alloc(len);
  const fh = await open(diskPath, 'r');
  try {
    await fh.read(head, 0, len, 0);
  } finally {
    await fh.close();
  }
  return imageSignatureMatches(head, mime);
}

/** Batched online integrity probe. A failed/absent probe → `null` (= unknown). */
async function fetchOnlineStats(
  base: string,
  secret: string,
  urls: string[],
): Promise<Map<string, OnlineFileStat | null>> {
  const map = new Map<string, OnlineFileStat | null>();
  for (let i = 0; i < urls.length; i += STAT_CHUNK) {
    const chunk = urls.slice(i, i + STAT_CHUNK);
    try {
      const res = await fetch(`${base}/api/sync/file-stat`, {
        signal: AbortSignal.timeout(SYNC_TRANSFER_TIMEOUT_MS), // SYNC-002
        method: 'POST',
        headers: { 'content-type': 'application/json', [SYNC_SECRET_HEADER]: secret },
        body: JSON.stringify({ urls: chunk }),
      });
      if (res.status !== 200) {
        // Old online without the endpoint (404), or an error — mark unknown so
        // planFileAction makes NO re-push decision (never guess a push).
        for (const u of chunk) map.set(u, null);
        continue;
      }
      const body = (await res.json()) as {
        results?: Array<OnlineFileStat & { url: string }>;
      };
      const byUrl = new Map((body.results ?? []).map((r) => [r.url, r]));
      for (const u of chunk) {
        const r = byUrl.get(u);
        map.set(u, r ? { exists: r.exists, size: r.size, signatureOk: r.signatureOk } : null);
      }
    } catch {
      for (const u of chunk) map.set(u, null);
    }
  }
  return map;
}

export async function syncFiles(batchSize = 1000): Promise<FileSyncStats> {
  const empty: FileSyncStats = { checked: 0, downloaded: 0, repaired: 0, repushQueued: 0, failed: 0 };
  const base = onlineApiUrl();
  if (!base) return empty;
  // File download + stat probe are READ scope (online → local). (SYNC-001)
  const secret = syncScopeSecret('read') ?? '';

  const state = await prisma.syncState.findUnique({ where: { key: WALK_CURSOR_KEY } });
  const cursorId = state?.cursor || null; // last Media id walked (empty ⇒ start over)

  const media = await prisma.media.findMany({
    select: { id: true, url: true, mimeType: true, sizeBytes: true, sha256: true },
    orderBy: { id: 'asc' },
    take: batchSize,
    ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
  });

  // Exhausted the manifest → wrap the cursor back to the start for the next tick.
  if (media.length === 0) {
    await prisma.syncState
      .upsert({ where: { key: WALK_CURSOR_KEY }, create: { key: WALK_CURSOR_KEY, cursor: '' }, update: { cursor: '' } })
      .catch(() => {});
    return empty;
  }

  // Group by url so a file that has BOTH a local-authored row and a pull-mirrored
  // row (same url, different ids) is reconciled once.
  const groups = new Map<string, UrlGroup>();
  for (const m of media) {
    const resolved = resolveSensitiveUpload(m.url);
    if (!resolved) continue; // external / malformed — nothing to mirror
    const g = groups.get(m.url);
    if (g) {
      g.ids.push(m.id);
      if (g.sizeBytes == null && m.sizeBytes != null) g.sizeBytes = m.sizeBytes;
      if (g.sha256 == null && m.sha256) g.sha256 = m.sha256;
    } else {
      groups.set(m.url, {
        url: m.url,
        diskPath: resolved.diskPath,
        ext: resolved.ext,
        secure: resolved.secure,
        ids: [m.id],
        mimeType: m.mimeType,
        sizeBytes: m.sizeBytes,
        sha256: m.sha256,
      });
    }
  }

  // Pass 1 — live local facts + collect the online-probe candidates (secure files
  // that look intact locally: the only ones whose online copy we must compare).
  const localFacts = new Map<string, LocalFacts>();
  const statCandidates: string[] = [];
  for (const g of groups.values()) {
    let exists = false;
    let size: number | null = null;
    let signatureOk: boolean | null = null;
    try {
      const info = await stat(g.diskPath);
      exists = info.isFile();
      size = info.size;
    } catch {
      exists = false;
    }
    if (exists && g.secure) {
      const mime = mimeForExt(g.ext);
      if (mime) signatureOk = await localSignature(g.diskPath, size ?? 0, mime);
    }
    localFacts.set(g.url, { exists, size, signatureOk });
    if (g.secure && exists && signatureOk === true) statCandidates.push(g.url);
  }
  const onlineStats = await fetchOnlineStats(base, secret, statCandidates);

  // Pass 2 — decide + execute per file.
  let checked = 0;
  let downloaded = 0;
  let repaired = 0;
  let failed = 0;
  const repushGroups: UrlGroup[] = [];

  for (const g of groups.values()) {
    checked++;
    const local = localFacts.get(g.url)!;
    const online = onlineStats.get(g.url) ?? null; // null unless it was probed
    const action = planFileAction({
      secure: g.secure,
      localExists: local.exists,
      localSize: local.size,
      localSignatureOk: local.signatureOk,
      rowSizeBytes: g.sizeBytes,
      online,
    });
    if (action === 'none') continue;
    if (action === 'repush') {
      repushGroups.push(g);
      continue;
    }
    // action === 'download' — fetch the online master copy, VERIFY, then promote.
    try {
      const res = await fetch(`${base}/api/sync/file?u=${encodeURIComponent(g.url)}`, {
        headers: { [SYNC_SECRET_HEADER]: secret },
        signal: AbortSignal.timeout(SYNC_TRANSFER_TIMEOUT_MS), // SYNC-002
      });
      if (res.status !== 200) {
        failed++; // missing on online too (or an error) — surfaces as unrepairable
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const sizeHeader = res.headers.get('x-sync-size');
      const verdict = verifyFileIntegrity(buf, {
        expectedSize: sizeHeader && /^\d+$/.test(sizeHeader) ? Number(sizeHeader) : null,
        expectedSha256: res.headers.get('x-sync-sha256'),
        mime: mimeForExt(g.ext),
      });
      if (!verdict.ok) {
        failed++; // don't promote a corrupt/truncated download over a file
        continue;
      }
      await atomicWrite(g.diskPath, buf);
      if (local.exists) repaired++;
      else downloaded++;
    } catch {
      failed++;
    }
  }

  // Queue re-pushes for secure files broken/missing on online — deduped against
  // rows already pending/failed in the MediaFile lane (one query for the batch).
  let repushQueued = 0;
  if (repushGroups.length > 0) {
    const candidateIds = repushGroups.flatMap((g) => g.ids);
    const existing = await prisma.syncQueue.findMany({
      where: { entityType: MEDIA_FILE_ENTITY, status: { in: ['pending', 'failed'] }, entityId: { in: candidateIds } },
      select: { entityId: true },
    });
    const alreadyQueued = new Set(existing.map((r) => r.entityId));
    for (const g of repushGroups) {
      if (g.ids.some((id) => alreadyQueued.has(id))) continue; // already in flight
      try {
        await enqueueFilePush(prisma, {
          mediaId: g.ids[0]!,
          url: g.url,
          mimeType: g.mimeType,
          sha256: g.sha256,
        });
        repushQueued++;
      } catch {
        failed++;
      }
    }
  }

  // Advance the walk cursor to the last id in this batch (wrap when < a full batch).
  const nextCursor = media.length < batchSize ? '' : media[media.length - 1]!.id;
  await prisma.syncState
    .upsert({
      where: { key: WALK_CURSOR_KEY },
      create: { key: WALK_CURSOR_KEY, cursor: nextCursor },
      update: { cursor: nextCursor },
    })
    .catch(() => {});

  return { checked, downloaded, repaired, repushQueued, failed };
}

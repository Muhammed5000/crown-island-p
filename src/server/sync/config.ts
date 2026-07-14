import { timingSafeEqual } from 'crypto';

/**
 * Central config + helpers for the offline sync layer. See SYNC_PLAN.md.
 *
 * APP_MODE tells the two deployments of this codebase apart:
 *   - 'online' → the public server; sole writer of bookings; passive sync receiver.
 *   - 'local'  → the on-prem venue server; sole writer of operations; initiates all sync.
 *   - unset    → single-deployment mode; the whole sync layer is inert.
 *
 * This module has NO Prisma / server-only imports (only node:crypto), so the
 * secret guard is directly unit-testable — mirroring src/server/env-core.ts.
 */

export type AppMode = 'online' | 'local';

export function appMode(): AppMode | null {
  const m = process.env.APP_MODE;
  return m === 'online' || m === 'local' ? m : null;
}

export const isLocal = (): boolean => appMode() === 'local';
export const isOnline = (): boolean => appMode() === 'online';

/** Base URL of the online deployment (local uses it to push / pull / proxy). */
export function onlineApiUrl(): string | null {
  const u = process.env.ONLINE_API_URL;
  return u ? u.replace(/\/+$/, '') : null;
}

/**
 * Header the sync endpoints authenticate with — deliberately separate from the
 * user-auth Authorization header and from CRON_SECRET.
 */
export const SYNC_SECRET_HEADER = 'x-sync-secret';

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Least-privilege scopes for the sync channel (SYNC-001).
 *   - 'read'  → online SENDS master data to local: /changes (which carries
 *               password/PIN hashes + PII), /file, /file-stat.
 *   - 'write' → local WRITES to online: /apply, /upload-file, /reception-booking.
 * Splitting the credential means a leaked READ secret (the hash-bearing pull
 * channel) cannot authorize a WRITE route, and each half can be rotated on its
 * own.
 */
export type SyncScope = 'read' | 'write';

const SCOPE_ENV: Record<SyncScope, string> = {
  read: 'SYNC_READ_SECRET',
  write: 'SYNC_WRITE_SECRET',
};

/**
 * The secret that authorizes `scope`. Production requires the scoped variables;
 * the legacy shared secret is accepted only outside production for local rollout
 * compatibility. Used on BOTH ends, so a production node with an incomplete
 * migration fails closed instead of silently restoring bidirectional authority.
 */
export function syncScopeSecret(scope: SyncScope): string | null {
  const scoped = process.env[SCOPE_ENV[scope]];
  if (scoped) return scoped;
  if (process.env.NODE_ENV === 'production') return null;
  const shared = process.env.SYNC_SECRET;
  return shared || null;
}

/** Separate application-layer encryption secret for sensitive pull payloads. */
export function syncDataSecret(): string | null {
  const value = process.env.SYNC_DATA_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

/**
 * Guard for the secret-protected sync endpoints. Timing-safe; refuses while the
 * relevant secret is unconfigured. `scope` selects READ vs WRITE credentials so
 * a compromised read credential can't reach write routes (SYNC-001).
 */
export function syncSecretOk(request: Request, scope: SyncScope): boolean {
  const expected = syncScopeSecret(scope);
  if (!expected) return false; // refuse to run while unconfigured
  const provided = request.headers.get(SYNC_SECRET_HEADER) ?? '';
  return safeEqual(provided, expected);
}

// ── Worker cadence (local only) ──────────────────────────────────────────────
// Short tick so the outbox drains promptly; first-run delay is offset from the
// existing scheduler stagger (notifications 8s / payments 20s / ZK 35s /
// review 50s) so boot sweeps don't collide.
export const SYNC_TICK_MS = Number(process.env.SYNC_TICK_MS) || 20_000;
export const SYNC_FIRST_RUN_DELAY_MS = Number(process.env.SYNC_FIRST_RUN_DELAY_MS) || 45_000;
export const SYNC_PING_TIMEOUT_MS = Number(process.env.SYNC_PING_TIMEOUT_MS) || 5_000;

/**
 * Per-request deadline for sync DATA transfers — pull, outbox push, file
 * download and file upload (SYNC-002). The health ping has its own (shorter)
 * timeout; these carry real payloads so the budget is larger, but a peer that
 * accepts the connection and then never responds must NOT stall the worker
 * indefinitely and block every later tick. An abort surfaces as a normal
 * transfer failure and is retried on the next tick.
 */
export const SYNC_TRANSFER_TIMEOUT_MS = Number(process.env.SYNC_TRANSFER_TIMEOUT_MS) || 60_000;

/**
 * How far the /api/sync/changes cursor is rolled BACK from online's clock
 * (used on the ONLINE sender). The lag must absorb BOTH:
 *  (i)  the `updatedAt`-stamp → COMMIT gap of the longest online write
 *       transaction — Prisma stamps `updatedAt` app-side when the statement
 *       runs, but the row only becomes visible at commit, so a slow tx can
 *       commit a row whose stamp is already older than a snapshot read; and
 *  (ii) any skew between the Node app clock (which stamps `updatedAt`) and the
 *       Postgres clock (which provides `statement_timestamp()` for the cursor).
 * A row whose gap+skew exceeds the lag is skipped FOREVER (silent data loss on
 * local), so err large: re-scanning the window is just idempotent re-upserts of
 * rows changed in the last minute. 60s default; env-tunable like the tick.
 */
export const SYNC_PULL_SAFETY_LAG_MS = Number(process.env.SYNC_PULL_SAFETY_LAG_MS) || 60_000;

/**
 * How often a pull includes the full id-sets + BookingSlot mirror (`sets`).
 * Those are full-table scans on online and only feed the local delete-mirror /
 * capacity views, which tolerate minutes of staleness — so most 20s ticks skip
 * them (`sets=0`) and the worker forces them through at this cadence (and
 * always on an initial sync).
 */
export const SYNC_SETS_INTERVAL_MS = Number(process.env.SYNC_SETS_INTERVAL_MS) || 5 * 60_000;

/**
 * Retention for finished SyncQueue rows (every operational mutation queues one,
 * forever — without pruning the table only grows). `synced`/`superseded` rows
 * are deleted after this many days; `dead` rows are kept 4× longer so venue ops
 * can still inspect what was dropped. Pending rows are NEVER pruned.
 */
export const SYNC_QUEUE_RETENTION_DAYS = Number(process.env.SYNC_QUEUE_RETENTION_DAYS) || 14;

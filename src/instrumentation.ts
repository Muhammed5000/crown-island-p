/**
 * Next.js instrumentation hook — runs ONCE when the server process boots
 * (in `next dev` and in production / Docker).
 *
 * It starts two in-process schedulers, so a single-process deployment (bare-Node
 * VPS, PM2, `next dev`) needs NO external cron:
 *
 *  1. NOTIFICATIONS — dispatches due SCHEDULED notification campaigns every
 *     minute. This is what makes "Schedule for later" actually send in
 *     development and in a single app process — previously a SCHEDULED campaign
 *     only went out if something POSTed /api/cron/notifications (the
 *     docker-compose cron sidecar), which never runs under `next dev` and
 *     silently 401s if CRON_SECRET is unset. Set NOTIF_SCHEDULER=off to disable.
 *
 *  2. PAYMENT RECONCILER — re-runs the authoritative MPGS RETRIEVE_ORDER check
 *     for Crédit Agricole payments stuck PENDING/FAILED (browser never returned
 *     to /complete: tab closed mid-redirect, network drop). Without this sweep a
 *     CAPTURED order could leave its booking PENDING_PAYMENT forever — the money
 *     taken, no booking. Every 2 minutes with a 2-minute sweep min-age, so an
 *     abandoned-tab capture confirms in ~2–4 min (the live payment page polls
 *     /check for up to ~10 min, so the 2-min floor stays mostly behind it and
 *     avoids redundant gateway reads). Set PAYMENT_RECONCILER=off to disable
 *     (e.g. to drive it purely via POST /api/cron/reconcile-payments).
 *     ALWAYS started (unless =off); it self-heals — each tick re-checks MPGS
 *     config and no-ops quietly while unconfigured, so enabling MPGS after boot
 *     needs no restart.
 *
 * Safe alongside the cron endpoints / sidecar or multiple app instances: the
 * campaign dispatcher claims each campaign atomically (SCHEDULED → SENDING), and
 * the payment reconciler is idempotent end-to-end (all confirms funnel through
 * the guarded sync engine), so overlapping runs can never double-send or
 * double-confirm.
 */
const NOTIF_TICK_MS = 60_000;
const NOTIF_FIRST_RUN_DELAY_MS = 8_000;
const RECONCILE_TICK_MS = 2 * 60_000;
const RECONCILE_FIRST_RUN_DELAY_MS = 20_000;
const ZK_TICK_MS = 5 * 60_000;
// Offset from the payment reconciler's first run so the two sweeps don't collide.
const ZK_FIRST_RUN_DELAY_MS = 35_000;
const REVIEW_NUDGE_TICK_MS = 24 * 60 * 60_000; // once a day is plenty (day-granularity)
const REVIEW_NUDGE_FIRST_RUN_DELAY_MS = 50_000;

export async function register() {
  // Only the Node.js server runtime can talk to the DB / web-push / gateway.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Guard against duplicate intervals (repeated register / HMR in dev).
  const g = globalThis as typeof globalThis & { __ciSchedulers?: boolean };
  if (g.__ciSchedulers) return;
  g.__ciSchedulers = true;

  // ── Process crash safety ────────────────────────────────────────────────────
  // Keep-alive handlers for unhandledRejection/uncaughtException (see
  // process-guards.ts for the trade-off). Dynamically imported so the
  // Edge-runtime static analysis never sees `process.on`; the __ciSchedulers
  // guard above keeps the listeners single-registration across dev HMR.
  const { installProcessGuards } = await import('@/server/process-guards');
  installProcessGuards();

  // ── Boot-time env validation ────────────────────────────────────────────────
  // Fail a misconfigured production boot in seconds instead of on the first
  // customer request; dev only logs. (Import stays dynamic — instrumentation
  // must not pull server-only modules at edge-bundle analysis time.)
  const { validateEnv } = await import('@/server/env');
  validateEnv();

  // APP_MODE gates (offline sync layer): notifications, the payment reconciler
  // and the review nudge all act on customers/payments that live ONLINE, so they
  // run on `online` or on a single APP_MODE-unset deployment — never on the
  // on-prem `local` node. The ZK reconciler + sync worker are the local-only
  // ones (below). With APP_MODE unset every scheduler runs exactly as before.
  const notLocal = process.env.APP_MODE !== 'local';
  const notOnline = process.env.APP_MODE !== 'online';

  if (notLocal && process.env.NOTIF_SCHEDULER !== 'off') {
    const { dispatchDueScheduledCampaigns } = await import(
      '@/server/services/admin-notifications'
    );

    const run = async () => {
      try {
        const { dispatched } = await dispatchDueScheduledCampaigns();
        if (dispatched > 0) {
          console.info(`[notifications] dispatched ${dispatched} scheduled campaign(s)`);
        }
      } catch (err) {
        console.error('[notifications] scheduled dispatch failed:', (err as Error).message);
      }
    };

    setTimeout(run, NOTIF_FIRST_RUN_DELAY_MS);
    setInterval(run, NOTIF_TICK_MS);
    console.info('[notifications] in-process scheduler started (every 60s)');
  }

  if (notLocal && process.env.PAYMENT_RECONCILER !== 'off') {
    // ALWAYS start the loop; SELF-HEAL by probing MPGS config INSIDE each tick.
    // Previously this gated on getMpgsConfig() ONCE at boot and skipped forever
    // if MPGS wasn't configured the instant the process started — so a VPS that
    // booted before its env was in place (or had MPGS added later) would leave
    // every captured-but-abandoned payment stuck until a manual restart. Now the
    // interval runs unconditionally and each tick no-ops quietly while MPGS is
    // unconfigured, so enabling it at runtime needs no restart. (Mirrors the ZK
    // reconciler below, which is likewise always-on / no-op-while-disabled.)
    const { getMpgsConfig } = await import('@/server/credit-agricole/client');
    const { reconcilePendingMpgs, sweepStuckRefundPending, flagAgedOutPayments } = await import(
      '@/server/credit-agricole/reconcile'
    );

    // Overlap guard: a sweep of 50 rows can outlast the tick when the gateway is
    // slow (each RETRIEVE_ORDER may take up to 15s). Overlapping sweeps are
    // idempotent-safe but double the gateway traffic for nothing.
    let sweeping = false;
    const run = async () => {
      if (sweeping) return;
      // Quiet self-heal no-op while MPGS is unconfigured — no per-tick log, so an
      // idle (e.g. cash-only or pre-config) process stays silent.
      try {
        getMpgsConfig();
      } catch {
        return;
      }
      sweeping = true;
      try {
        try {
          const result = await reconcilePendingMpgs();
          if (result.scanned > 0) {
            console.info(
              `[payments] reconcile sweep: scanned=${result.scanned} confirmed=${result.confirmed} refunded=${result.refunded} failed=${result.failed} stillPending=${result.stillPending}`,
            );
          }
        } catch (err) {
          console.error('[payments] reconcile sweep failed:', (err as Error).message);
        }
        // Recover payments stranded in REFUND_PENDING (admin refund whose
        // release/finalize never landed) from the gateway's authoritative state.
        try {
          const r = await sweepStuckRefundPending();
          if (r.scanned > 0) {
            console.info(
              `[payments] refund-pending sweep: scanned=${r.scanned} finalized=${r.finalized} released=${r.released} left=${r.left}`,
            );
          }
        } catch (err) {
          console.error('[payments] refund-pending sweep failed:', (err as Error).message);
        }
        // Flag payments that aged out of the reconcile window still PENDING —
        // once per payment, with an admin summary email.
        try {
          const r = await flagAgedOutPayments();
          if (r.flagged > 0) {
            console.warn(`[payments] flagged ${r.flagged} aged-out PENDING payment(s) for review`);
          }
        } catch (err) {
          console.error('[payments] aged-out payment flagging failed:', (err as Error).message);
        }
        // Insurance-deposit sweep: resolve stuck PROCESSING deposit refunds from
        // gateway leg evidence, void orphaned PENDING deposits, and surface
        // forgotten checkouts + ledger invariant violations (docs/INSURANCE.md §9).
        try {
          const { sweepInsurance } = await import('@/server/services/insurance-sweep');
          const r = await sweepInsurance();
          if (r.processingChecked + r.voided + r.forgotten > 0) {
            console.info(
              `[payments] insurance sweep: processing=${r.processingChecked} finalized=${r.finalized} released=${r.released} failed=${r.failed} voided=${r.voided} forgotten=${r.forgotten}`,
            );
          }
        } catch (err) {
          console.error('[payments] insurance sweep failed:', (err as Error).message);
        }
        // REL-001: record a heartbeat on every COMPLETED tick (money-critical, so
        // the health probe flags this reconciler going stale). Reached only when
        // MPGS is configured — an unconfigured no-op returns above the sweep and
        // records nothing, so a legitimately-idle process never looks stale.
        const { recordHeartbeat } = await import('@/server/health/heartbeat');
        recordHeartbeat('payment-reconciler', { staleAfterMs: RECONCILE_TICK_MS * 3, critical: true });
      } finally {
        sweeping = false;
      }
    };

    setTimeout(run, RECONCILE_FIRST_RUN_DELAY_MS);
    setInterval(run, RECONCILE_TICK_MS);
    console.info(
      '[payments] in-process MPGS reconciler started (every 2m; no-op while MPGS is unconfigured)',
    );
  }

  // ── ZK access-control reconciler ──────────────────────────────────────────
  // Backstop for the on-prem ZKBio integration (which has NO push): retries
  // pending/failed provisioning for in-window confirmed cabin bookings and tears
  // down access for cancelled/expired/past-day ones (delete person, free card).
  // Always started (unless ZK_RECONCILER=off); the sweep itself is a cheap no-op
  // while the integration is disabled, so it also picks up ZK being enabled later
  // at runtime without a restart. Idempotent → safe alongside an external cron.
  if (notOnline && process.env.ZK_RECONCILER !== 'off') {
    const { reconcilePendingZk } = await import('@/server/zk/reconcile');

    let sweeping = false;
    const run = async () => {
      if (sweeping) return;
      sweeping = true;
      try {
        const r = await reconcilePendingZk();
        if (r.scanned > 0) {
          console.info(
            `[zk] reconcile sweep: scanned=${r.scanned} provisioned=${r.provisioned} revoked=${r.revoked} failed=${r.failed} stillPending=${r.stillPending}`,
          );
        }
      } catch (err) {
        console.error('[zk] reconcile sweep failed:', (err as Error).message);
      } finally {
        sweeping = false;
      }
    };

    setTimeout(run, ZK_FIRST_RUN_DELAY_MS);
    setInterval(run, ZK_TICK_MS);
    console.info('[zk] in-process reconciler started (every 5m; no-op while ZK is off)');
  }

  // ── Post-visit review nudge ───────────────────────────────────────────────
  // Once a day, notify account customers whose visit has passed (and who haven't
  // reviewed / been nudged) to rate their booking. Day-granularity, so a daily
  // tick is plenty. Idempotent (atomic reviewPromptedAt claim) → safe alongside
  // POST /api/cron/review-nudge and multiple app instances. REVIEW_NUDGE_SCHEDULER=off disables.
  if (notLocal && process.env.REVIEW_NUDGE_SCHEDULER !== 'off') {
    const { sweepReviewNudges } = await import('@/server/services/review-nudge');

    let sweeping = false;
    const run = async () => {
      if (sweeping) return;
      sweeping = true;
      try {
        const r = await sweepReviewNudges();
        if (r.nudged > 0) {
          console.info(`[reviews] nudge sweep: scanned=${r.scanned} nudged=${r.nudged}`);
        }
      } catch (err) {
        console.error('[reviews] nudge sweep failed:', (err as Error).message);
      } finally {
        sweeping = false;
      }
    };

    setTimeout(run, REVIEW_NUDGE_FIRST_RUN_DELAY_MS);
    setInterval(run, REVIEW_NUDGE_TICK_MS);
    console.info('[reviews] in-process post-visit nudge scheduler started (daily)');
  }

  // ── Offline sync worker (APP_MODE=local only) ─────────────────────────────
  // Pings online for connectivity; when reachable, pulls booking changes then
  // drains the local outbox FIFO to online. Local initiates ALL sync; online is
  // a passive receiver. Runs ONLY on the on-prem node. SYNC_WORKER=off disables.
  if (process.env.APP_MODE === 'local' && process.env.SYNC_WORKER !== 'off') {
    const { syncTick } = await import('@/server/sync/worker');
    const { SYNC_TICK_MS, SYNC_FIRST_RUN_DELAY_MS } = await import('@/server/sync/config');

    let syncing = false;
    const run = async () => {
      if (syncing) return; // overlap guard — a slow tick must not stack
      syncing = true;
      try {
        await syncTick();
      } catch (err) {
        console.error('[sync] tick failed:', (err as Error).message);
      } finally {
        syncing = false;
      }
    };

    setTimeout(run, SYNC_FIRST_RUN_DELAY_MS);
    setInterval(run, SYNC_TICK_MS);
    console.info('[sync] in-process local sync worker started (pull + outbox push)');
  }
}

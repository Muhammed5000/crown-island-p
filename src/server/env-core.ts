/**
 * Pure boot-time environment validation (no server-only/Prisma deps, so it is
 * directly unit-testable).
 *
 * Why: env vars were read ad-hoc all over the codebase, so a missing/misspelled
 * var surfaced as a runtime crash in the FIRST request that needed it (payments
 * silently down, JWT errors at first login, gate civil-day math shifted by the
 * server timezone). This validates once at boot (instrumentation.ts) instead:
 * hard errors abort a production boot; everything else warns loudly.
 */

/** The placeholder shipped in docker-compose.yml — must never run production. */
export const DEV_DEFAULT_AUTH_SECRET = 'dev-only-change-me-openssl-rand-base64-32';

export interface EnvReport {
  /** Fatal misconfiguration — production must not boot with any of these. */
  errors: string[];
  /** Degraded-but-runnable — logged loudly, boot continues. */
  warnings: string[];
}

export function validateEnvCore(env: Record<string, string | undefined>): EnvReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isProd = env.NODE_ENV === 'production';

  // ── Hard requirements ───────────────────────────────────────────────────────
  if (!env.DATABASE_URL) {
    errors.push('DATABASE_URL is not set — the app cannot reach the database.');
  }
  if (!env.AUTH_SECRET) {
    errors.push('AUTH_SECRET is not set — sessions/JWTs cannot be signed.');
  } else if (isProd && env.AUTH_SECRET === DEV_DEFAULT_AUTH_SECRET) {
    errors.push(
      'AUTH_SECRET is still the docker-compose dev placeholder — generate a real one (openssl rand -base64 32).',
    );
  }

  // ── Payments (MPGS / Crédit Agricole) ───────────────────────────────────────
  const mpgs = ['MPGS_GATEWAY_HOST', 'MPGS_MERCHANT_ID', 'MPGS_PASSWORD'] as const;
  const mpgsSet = mpgs.filter((k) => !!env[k]);
  if (mpgsSet.length === 0) {
    warnings.push('MPGS_* not set — card payments and the payment reconciler are disabled.');
  } else if (mpgsSet.length < mpgs.length) {
    const missing = mpgs.filter((k) => !env[k]);
    warnings.push(
      `MPGS is PARTIALLY configured — missing ${missing.join(', ')}; card payments will fail at checkout.`,
    );
  } else if (!env.MPGS_WEBHOOK_SECRET) {
    // MPGS is fully configured but the webhook secret is not set, so the
    // seconds-scale server-to-server confirm is OFF and a captured payment whose
    // browser closes mid-redirect only recovers via the ~2–4 min reconciler.
    // A warning, not an error — the reconciler still covers it.
    warnings.push(
      'MPGS_WEBHOOK_SECRET is not set — the instant server-to-server payment confirm is OFF; captured payments recover only via the ~2–4 min reconciler. Register the webhook in MPGS Merchant Administration and set the secret.',
    );
  }

  // ── Timezone ────────────────────────────────────────────────────────────────
  // Gate admission / booking "today" logic works in resort-local CIVIL days;
  // the deployment contract (docker-compose, docs) pins TZ=Africa/Cairo.
  if (!env.TZ) {
    warnings.push(
      'TZ is not set — civil-day logic (gate admission, booking "today") will use the machine timezone; set TZ=Africa/Cairo.',
    );
  } else if (env.TZ !== 'Africa/Cairo') {
    warnings.push(
      `TZ is "${env.TZ}" — the resort deployment contract expects Africa/Cairo; gate/booking day boundaries may shift.`,
    );
  }

  // ── Web push (all-or-nothing pair) ─────────────────────────────────────────
  const vapidPub = !!env.VAPID_PUBLIC_KEY;
  const vapidPriv = !!env.VAPID_PRIVATE_KEY;
  if (vapidPub !== vapidPriv) {
    warnings.push(
      'Exactly one of VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY is set — web push will crash on send; set both or neither.',
    );
  } else if (!vapidPub) {
    warnings.push('VAPID keys not set — web push notifications are disabled.');
  }

  // ── Cron endpoints ─────────────────────────────────────────────────────────
  if (!env.CRON_SECRET) {
    warnings.push(
      'CRON_SECRET is not set — the /api/cron/* endpoints refuse every request (in-process schedulers still run).',
    );
  }

  // ── Offline sync layer (APP_MODE local ↔ online) ────────────────────────────
  // APP_MODE unset = single-deployment mode: the sync layer is inert and the app
  // behaves exactly as before. Only an INVALID non-empty value is fatal.
  const mode = env.APP_MODE;
  if (mode && mode !== 'online' && mode !== 'local') {
    errors.push(
      `APP_MODE is "${mode}" — it must be 'online', 'local', or unset (unset disables sync / single-deployment behaviour).`,
    );
  }
  if (mode === 'local' && !env.ONLINE_API_URL) {
    errors.push(
      'APP_MODE=local but ONLINE_API_URL is not set — the local node cannot reach online to push its outbox, pull bookings, or proxy reception sales.',
    );
  }
  // Sync auth: production requires independent read/write credentials. The
  // shared fallback is development-only and must never restore bidirectional
  // authority on a deployed two-node system.
  if (mode) {
    const hasShared = !!env.SYNC_SECRET;
    const readOk = !!env.SYNC_READ_SECRET || (!isProd && hasShared);
    const writeOk = !!env.SYNC_WRITE_SECRET || (!isProd && hasShared);
    if (!(readOk && writeOk)) {
      const message =
        'APP_MODE is set but both SYNC_READ_SECRET and SYNC_WRITE_SECRET are not configured. Production sync fails closed; set distinct scoped credentials on both nodes.';
      if (isProd) errors.push(message);
      else warnings.push(`${message} Development may temporarily use SYNC_SECRET.`);
    } else if (!isProd && hasShared && !(env.SYNC_READ_SECRET && env.SYNC_WRITE_SECRET)) {
      warnings.push(
        'Sync uses a single shared SYNC_SECRET for both read (the pull channel carries password/PIN hashes + PII) and write scopes. For least privilege, set distinct SYNC_READ_SECRET and SYNC_WRITE_SECRET so a leaked read credential cannot call write routes (SYNC-001).',
      );
    }
    if (!env.SYNC_DATA_SECRET || env.SYNC_DATA_SECRET.trim().length < 32) {
      const message =
        'APP_MODE is set but SYNC_DATA_SECRET is missing or shorter than 32 characters; encrypted pull payloads will be refused.';
      if (isProd) errors.push(message);
      else warnings.push(message);
    }
  }

  // ── Production-only expectations ───────────────────────────────────────────
  if (isProd) {
    if (!env.RESEND_API_KEY) {
      warnings.push(
        'RESEND_API_KEY is not set in production — all email (magic links, refund notices, admin alerts) goes to the console mock.',
      );
    }
    if (!env.NEXT_PUBLIC_APP_URL && !env.TRUSTED_HOSTS) {
      warnings.push(
        'Neither NEXT_PUBLIC_APP_URL nor TRUSTED_HOSTS is set in production — forwarded-host headers are ignored and links may carry the wrong host; set one of them.',
      );
    }
  }

  return { errors, warnings };
}

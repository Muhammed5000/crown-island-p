import 'server-only';

/**
 * Typed, read-once server configuration.
 *
 * `env-core.ts` VALIDATES the environment at boot; this is the typed READER that
 * downstream code should consume instead of reaching for `process.env.X` inline
 * (which scattered ad-hoc reads + defaulting across the codebase). Values are read
 * once at module load and frozen.
 *
 * Note: a few subsystems already own well-encapsulated typed accessors and keep
 * them — MPGS (`getMpgsConfig` in credit-agricole/client.ts), the sync layer
 * (`appMode`/secret resolution in server/sync/config.ts), and origin resolution
 * (`resolveOrigin` in lib/origin.ts). This module is the home for everything else
 * and the convention for new env reads.
 */

/** Trim to a non-empty string, else undefined — collapses "" and whitespace to undefined. */
function str(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

const env = process.env;

export const config = Object.freeze({
  nodeEnv: env.NODE_ENV ?? 'development',
  isProduction: env.NODE_ENV === 'production',

  /** Shared secret guarding the /api/cron/* endpoints (Bearer token). */
  cronSecret: str(env.CRON_SECRET),

  /** Canonical public URL + additional trusted hosts (also consumed by lib/origin.ts). */
  appUrl: str(env.NEXT_PUBLIC_APP_URL),
  trustedHosts: str(env.TRUSTED_HOSTS),

  /** Deployment timezone contract for civil-day logic (see env-core.ts). */
  tz: str(env.TZ),
});

export type ServerConfig = typeof config;

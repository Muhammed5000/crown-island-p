import 'server-only';
import { validateEnvCore } from './env-core';

/**
 * Boot-time env validation — called once from instrumentation.ts.
 *
 * Production with a FATAL misconfiguration (no DB URL, no/placeholder
 * AUTH_SECRET) refuses to boot: failing in 2 seconds at deploy time beats
 * failing on the first customer request. Development only logs, so tests,
 * lint and DB-less dev keep working.
 */
export function validateEnv(): void {
  const { errors, warnings } = validateEnvCore(process.env);

  for (const w of warnings) console.warn(`[env] WARNING: ${w}`);
  for (const e of errors) console.error(`[env] ERROR: ${e}`);

  if (errors.length > 0 && process.env.NODE_ENV === 'production') {
    throw new Error(
      `Fatal environment misconfiguration (${errors.length} error(s)) — refusing to boot. See [env] ERROR lines above.`,
    );
  }
}

import 'server-only';
import { log, errFields } from '@/lib/log';

/**
 * Process-level crash guards — installed once at boot from instrumentation.ts
 * (dynamically imported there so the Edge-runtime static analysis never sees
 * `process.on`; this module is Node-only).
 *
 * REL-001 policy:
 *  - `unhandledRejection` → LOG + CONTINUE. A rejected promise (a forgotten
 *    await in a best-effort block) usually does not corrupt global state, so
 *    keeping the process up is acceptable and avoids losing the in-process
 *    payment reconciler over a stray rejection.
 *  - `uncaughtException` → LOG + mark readiness FAILED + EXIT. Node's own
 *    guidance is that it is *not safe to resume* after an uncaught exception:
 *    the process may be in an undefined state (corrupt caches, half-mutated
 *    module singletons). So we record a fatal flag (the health probe reads it
 *    to fail readiness immediately, draining traffic), then exit after a short
 *    best-effort window so a SUPERVISOR (PM2 / systemd / Docker restart policy)
 *    restarts a clean process — which is also what re-arms the reconciler.
 *
 * Escape hatch: set `PROCESS_EXIT_ON_FATAL=false` to restore log-and-continue
 * on a genuinely un-supervised host where a crash means hard downtime. Such a
 * host MUST add a supervisor — resuming after an uncaught exception is unsafe.
 */

let fatalError: Error | null = null;

/** The fatal uncaught error, if one has occurred. Read by the health probe. */
export function getFatalError(): Error | null {
  return fatalError;
}

export function installProcessGuards(): void {
  process.on('unhandledRejection', (reason) => {
    log.error('process UNHANDLED REJECTION (kept alive)', { ...errFields(reason) });
  });

  process.on('uncaughtException', (err) => {
    log.error('process UNCAUGHT EXCEPTION (fatal)', { ...errFields(err) });
    fatalError = err instanceof Error ? err : new Error(String(err));

    if (process.env.PROCESS_EXIT_ON_FATAL === 'false') {
      log.error(
        'process PROCESS_EXIT_ON_FATAL=false — staying alive after a fatal error (UNSAFE; add a process supervisor)',
      );
      return;
    }

    // Give in-flight requests and the readiness drain a brief moment, then exit
    // for the supervisor to restart a clean process.
    setTimeout(() => process.exit(1), 1_000);
  });
}

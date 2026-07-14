import 'server-only';

/**
 * In-process scheduler heartbeats (REL-001).
 *
 * Each background scheduler in `instrumentation.ts` calls `recordHeartbeat` at
 * the end of every completed tick. The health probe reads these so a WEDGED
 * worker (process + DB still answering, but a sweep silently stuck) is visible
 * instead of masquerading as healthy.
 *
 * Semantics:
 *  - A heartbeat is recorded even on a no-op tick (alive, nothing to do), so a
 *    correctly-idle scheduler stays fresh.
 *  - ABSENCE of a heartbeat never signals unhealthy — a scheduler that is
 *    disabled (`*_SCHEDULER=off`) or not yet past its first-run delay simply
 *    has no entry. Only an entry that has gone STALE (no completed tick within
 *    `staleAfterMs`) is flagged.
 *  - State is per-process and in-memory: the probe and the schedulers share the
 *    one Node runtime, and in a multi-instance deployment each instance reports
 *    its own freshness — which is what a readiness check wants.
 */

interface Beat {
  at: number;
  staleAfterMs: number;
  critical: boolean;
}

const beats = new Map<string, Beat>();

export function recordHeartbeat(
  name: string,
  opts: { staleAfterMs: number; critical?: boolean },
): void {
  beats.set(name, { at: Date.now(), staleAfterMs: opts.staleAfterMs, critical: !!opts.critical });
}

export interface HeartbeatStatus {
  name: string;
  ageMs: number;
  stale: boolean;
  critical: boolean;
}

export function heartbeatStatuses(): HeartbeatStatus[] {
  const now = Date.now();
  return [...beats.entries()].map(([name, b]) => ({
    name,
    ageMs: now - b.at,
    stale: now - b.at > b.staleAfterMs,
    critical: b.critical,
  }));
}

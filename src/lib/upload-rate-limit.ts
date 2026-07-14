import 'server-only';

/**
 * In-memory fixed-window rate limiter for authenticated file uploads.
 *
 * This is DoS *containment*, not an auth control: it stops a runaway client
 * loop or a compromised staff account from exhausting disk by hammering the
 * upload routes, while staying generous enough that legitimate bulk work
 * (uploading one ID image per guest for a large party) never trips it.
 *
 * Deliberately NOT the auth `consumeAttempt` backoff: that schedule blocks the
 * 2nd attempt for 30s, which would break reception staff uploading six IDs in a
 * row. A flat "N per minute" window is the right shape here.
 *
 * Caveat: state is per-process. On a multi-instance / serverless deployment
 * each instance keeps its own window, so the effective global ceiling is
 * N×instances. That's acceptable for the containment goal; a hard global cap
 * would need a shared store (Redis) or the DB-backed AuthRateLimit table.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 40;

const hits = new Map<string, number[]>();

export interface UploadRateResult {
  ok: boolean;
  /** Seconds until the oldest hit in the window expires (0 when allowed). */
  retryAfterSeconds: number;
}

export function checkUploadRate(
  key: string,
  max: number = MAX_PER_WINDOW,
  windowMs: number = WINDOW_MS,
): UploadRateResult {
  const now = Date.now();
  const cutoff = now - windowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);

  if (recent.length >= max) {
    const oldest = recent[0]!;
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  recent.push(now);
  hits.set(key, recent);

  // Opportunistic cleanup so the Map can't grow unbounded under churn.
  if (hits.size > 5_000) {
    for (const [k, v] of hits) {
      const live = v.filter((t) => t > cutoff);
      if (live.length === 0) hits.delete(k);
      else hits.set(k, live);
    }
  }

  return { ok: true, retryAfterSeconds: 0 };
}

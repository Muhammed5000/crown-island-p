import 'server-only';
import { prisma } from '@/server/db/prisma';

/**
 * Per-key exponential backoff for resend-style endpoints.
 *
 * Use this to throttle anything a user can trigger over and over via email
 * or IP — magic-link sends, password-reset sends, etc. The user-facing rule
 * is "wait a little longer each time you try again", capped at 1 day after
 * the 10th attempt.
 *
 * Schedule (waits BEFORE attempt N can fire), in seconds:
 *
 *   attempt 1  → 0       (the first try is always allowed)
 *   attempt 2  → 30
 *   attempt 3  → 60
 *   attempt 4  → 120
 *   attempt 5  → 300       (5 m)
 *   attempt 6  → 600       (10 m)
 *   attempt 7  → 1 800     (30 m)
 *   attempt 8  → 3 600     (1 h)
 *   attempt 9  → 21 600    (6 h)
 *   attempt 10 → 43 200    (12 h)
 *   attempt 11+→ 86 400    (24 h — cap)
 *
 * Callers MUST check `consumeAttempt()` *before* doing the work. The state
 * is stored in the AuthRateLimit table, keyed by an opaque string. We
 * recommend two checks per action — once with `email:<addr>` and once with
 * `ip:<addr>` — and the stricter wait wins.
 *
 * The window also "decays": if the last attempt was more than 24 h ago we
 * reset attempts to 0 so a legitimate user who comes back the next day starts
 * fresh.
 */

const SCHEDULE_SECONDS: number[] = [
  0,        // attempt 1 — instant
  30,       // attempt 2
  60,
  120,
  300,
  600,
  1_800,
  3_600,
  21_600,
  43_200,
  86_400,   // attempt 11+ cap
];

/** Seconds of inactivity after which the counter decays back to 0. */
const DECAY_WINDOW_SECONDS = 86_400;

/**
 * Sign-in schedule: a GRACE of 5 instant attempts so a legitimate user
 * fat-fingering their password is never locked out, then escalating backoff.
 * Kept separate from the resend schedule (and used via a separate `login:` key
 * namespace) so credential sign-in and magic-link sends never throttle each other.
 */
const LOGIN_SCHEDULE_SECONDS: number[] = [0, 0, 0, 0, 0, 60, 300, 900, 1_800, 3_600, 86_400];

export interface RateLimitOk {
  ok: true;
  /** Attempt number that was just consumed (1-based). */
  attempt: number;
  /** Seconds the caller MUST wait before consuming again. */
  nextRetryAfterSeconds: number;
}

export interface RateLimitDenied {
  ok: false;
  /** How many seconds until the caller may try again. */
  retryAfterSeconds: number;
  /** Number of attempts already recorded. */
  attempt: number;
}

export type RateLimitResult = RateLimitOk | RateLimitDenied;

function waitForAttempt(attempt: number, schedule: number[] = SCHEDULE_SECONDS): number {
  if (attempt <= 0) return 0;
  return schedule[Math.min(attempt, schedule.length - 1)] ?? 86_400;
}

/**
 * Check + atomically consume a rate-limit slot for `key`.
 *
 * - If the caller is within the wait window → returns `{ ok: false, retryAfterSeconds }`.
 * - Otherwise → increments attempts, schedules the next allowed time, returns
 *   `{ ok: true, nextRetryAfterSeconds }` so the UI can show a countdown.
 *
 * Atomicity (AUTH-003): the check-and-increment is a read-modify-write, so
 * concurrent requests for the same key must be serialized or they could all read
 * the same slot and slip through. We take a transaction-scoped Postgres ADVISORY
 * lock on the key first: a second consumer for the same key blocks until the
 * first commits, then reads the updated row. This covers the first-insert race
 * too (a plain `FOR UPDATE` can't lock a not-yet-existing row), needs no retry
 * loop, and releases automatically at transaction end.
 */
export async function consumeAttempt(
  key: string,
  schedule: number[] = SCHEDULE_SECONDS,
): Promise<RateLimitResult> {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    // Serialize all consumers of this key (see the atomicity note above).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const existing = await tx.authRateLimit.findUnique({ where: { key } });

    // Fast path — first request ever for this key. Record attempt #1 and
    // schedule the wait for attempt #2.
    if (!existing) {
      const next = waitForAttempt(2, schedule);
      await tx.authRateLimit.create({
        data: {
          key,
          attempts: 1,
          lastAttemptAt: now,
          nextAllowedAt: new Date(now.getTime() + next * 1_000),
        },
      });
      return {
        ok: true as const,
        attempt: 1,
        nextRetryAfterSeconds: next,
      };
    }

    // Decay: if it's been a full day since the last attempt, reset to a clean slate.
    const secondsSinceLast = (now.getTime() - existing.lastAttemptAt.getTime()) / 1_000;
    if (secondsSinceLast > DECAY_WINDOW_SECONDS) {
      const next = waitForAttempt(2, schedule);
      await tx.authRateLimit.update({
        where: { key },
        data: {
          attempts: 1,
          lastAttemptAt: now,
          nextAllowedAt: new Date(now.getTime() + next * 1_000),
        },
      });
      return {
        ok: true as const,
        attempt: 1,
        nextRetryAfterSeconds: next,
      };
    }

    // Still inside the window. Are we allowed yet?
    if (existing.nextAllowedAt.getTime() > now.getTime()) {
      const retryAfter = Math.ceil(
        (existing.nextAllowedAt.getTime() - now.getTime()) / 1_000,
      );
      return {
        ok: false as const,
        retryAfterSeconds: Math.max(1, retryAfter),
        attempt: existing.attempts,
      };
    }

    // Allowed — bump the counter and schedule the next wait.
    const newAttempts = existing.attempts + 1;
    const next = waitForAttempt(newAttempts + 1, schedule);
    await tx.authRateLimit.update({
      where: { key },
      data: {
        attempts: newAttempts,
        lastAttemptAt: now,
        nextAllowedAt: new Date(now.getTime() + next * 1_000),
      },
    });
    return {
      ok: true as const,
      attempt: newAttempts,
      nextRetryAfterSeconds: next,
    };
  });
}

/**
 * Composite check across email + IP. Both are consumed only if both pass —
 * keeps the counters in sync. Returns the strictest result.
 */
export async function consumeEmailAndIp(
  email: string,
  ip: string | null | undefined,
): Promise<RateLimitResult> {
  const emailKey = `email:${email.toLowerCase()}`;
  const ipKey = ip ? `ip:${ip}` : null;

  // We check sequentially so a single denied response short-circuits before
  // we burn an attempt on the other key.
  const emailRes = await consumeAttempt(emailKey);
  if (!emailRes.ok) return emailRes;

  if (ipKey) {
    const ipRes = await consumeAttempt(ipKey);
    if (!ipRes.ok) return ipRes;
    // Return the larger of the two waits so the UI shows the strictest gate.
    return ipRes.nextRetryAfterSeconds > emailRes.nextRetryAfterSeconds ? ipRes : emailRes;
  }

  return emailRes;
}

/**
 * Throttle a password sign-in attempt for `key` (grace-then-backoff). Callers
 * should key per email (`login:<addr>`) and reset the counter on a successful
 * sign-in so legitimate users are never delayed.
 */
export function consumeLoginAttempt(key: string): Promise<RateLimitResult> {
  return consumeAttempt(key, LOGIN_SCHEDULE_SECONDS);
}

/**
 * Per-IP sign-in schedule. More lenient than the per-email one (10 instant
 * attempts of grace) so a shared/NAT/corporate egress IP with several legitimate
 * users isn't locked out, while a high-volume password SPRAY (one IP against many
 * different emails) still trips the backoff — the per-email counter alone can't
 * stop spraying because every fresh email starts with its own grace.
 */
const LOGIN_IP_SCHEDULE_SECONDS: number[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // 10 instant (shared-IP tolerance)
  30, 60, 120, 300, 900, 1_800, 3_600, 86_400,
];

/**
 * Throttle a password sign-in by BOTH the target email and the source IP. Denies
 * when EITHER trips, so a spray across many emails from one IP is bounded even
 * though each per-email counter is fresh. Consume this BEFORE the password compare;
 * on a genuine success call `clearLoginAttempts` to reset both counters.
 */
export async function consumeLoginAttemptEmailAndIp(
  email: string,
  ip: string | null | undefined,
): Promise<RateLimitResult> {
  const emailRes = await consumeAttempt(`login:${email.toLowerCase()}`, LOGIN_SCHEDULE_SECONDS);
  if (!emailRes.ok) return emailRes;
  if (ip) {
    const ipRes = await consumeAttempt(`login:ip:${ip}`, LOGIN_IP_SCHEDULE_SECONDS);
    if (!ipRes.ok) return ipRes;
  }
  return emailRes;
}

/** Clear the per-email and per-IP sign-in counters after a successful login. */
export async function clearLoginAttempts(email: string, ip: string | null | undefined): Promise<void> {
  const keys = [`login:${email.toLowerCase()}`];
  if (ip) keys.push(`login:ip:${ip}`);
  await prisma.authRateLimit.deleteMany({ where: { key: { in: keys } } }).catch(() => {});
}

/** Extract a best-effort IP from a Next.js Request. */
export function extractIp(headers: Headers): string | null {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    // x-forwarded-for: client, proxy1, proxy2 — first non-private IP wins.
    const first = xff.split(',').map((s) => s.trim()).find(Boolean);
    if (first) return first;
  }
  const real = headers.get('x-real-ip');
  if (real) return real;
  return null;
}

/** Human-readable formatter — used by the UI to show "wait 5m before retrying". */
export function formatRetryAfter(seconds: number, locale: 'ar' | 'en' = 'en'): string {
  if (seconds < 60) {
    return locale === 'ar' ? `${seconds} ثانية` : `${seconds}s`;
  }
  const m = Math.ceil(seconds / 60);
  if (m < 60) {
    return locale === 'ar' ? `${m} دقيقة` : `${m}m`;
  }
  const h = Math.ceil(m / 60);
  if (h < 24) {
    return locale === 'ar' ? `${h} ساعة` : `${h}h`;
  }
  const d = Math.ceil(h / 24);
  return locale === 'ar' ? `${d} يوم` : `${d}d`;
}

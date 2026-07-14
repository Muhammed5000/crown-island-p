import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/prisma';
import { getFatalError } from '@/server/process-guards';
import { heartbeatStatuses } from '@/server/health/heartbeat';

/**
 * Liveness + readiness probe (REL-001).
 *
 * Status model — honest about background health, not just the DB:
 *  - 503 `down`      → the DB is unreachable, OR a fatal uncaught exception has
 *                      occurred (the process is exiting): pull from rotation /
 *                      restart.
 *  - 200 `degraded`  → process + DB are fine but a CRITICAL in-process scheduler
 *                      (e.g. the payment reconciler) has gone stale. The web tier
 *                      still serves, so we stay in rotation, but the body flags
 *                      the wedged worker so monitors can alert — this is exactly
 *                      the case that previously masqueraded as `ok`.
 *  - 200 `ok`        → everything answering and no stale critical scheduler.
 *
 * Deliberately unauthenticated and leak-free: only up/down, coarse latency, and
 * scheduler names/ages — never DB internals, versions, or error details.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = Date.now();
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const fatal = getFatalError() !== null;
  const schedulers = heartbeatStatuses();
  const staleCritical = schedulers.filter((s) => s.critical && s.stale).map((s) => s.name);

  // Hard-unhealthy (503) only for genuine liveness failures — a stale background
  // sweep must not evict a perfectly-serving web instance from the load balancer.
  const hardDown = !dbOk || fatal;
  const status = hardDown ? 'down' : staleCritical.length > 0 ? 'degraded' : 'ok';

  const body = {
    status,
    db: dbOk ? 'up' : 'down',
    ...(fatal && { fatal: true }),
    ...(staleCritical.length > 0 && { staleSchedulers: staleCritical }),
    schedulers: schedulers.map((s) => ({ name: s.name, ageMs: s.ageMs, stale: s.stale })),
    latencyMs: Date.now() - startedAt,
  } as const;

  return NextResponse.json(body, {
    status: hardDown ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}

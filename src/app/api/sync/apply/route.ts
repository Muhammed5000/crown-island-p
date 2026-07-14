import { NextResponse } from 'next/server';
import { syncSecretOk, isOnline } from '@/server/sync/config';
import { applyChange } from '@/server/sync/apply-core';
import { readJsonBounded, MIB } from '@/server/sync/http-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/sync/apply  (ONLINE receiver)
 *
 * Receives ONE pushed change from local and applies it as an idempotent
 * upsert-by-id. Protected by SYNC_SECRET (x-sync-secret header), independent of
 * user auth, and refused off the online node (a LAN-exposed local must not
 * accept out-of-band writes through this channel). Returns 200 + `{ ok:true,
 * id }` — the confirmed-write body the push loop requires before it sends the
 * next change. Booking-domain / unknown entities are rejected (422): online is
 * the sole writer of those.
 */
export async function POST(request: Request) {
  if (!syncSecretOk(request, 'write')) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (!isOnline()) {
    return NextResponse.json({ ok: false, error: 'not_online_node' }, { status: 409 });
  }

  // One whole-row JSON snapshot; 1 MiB is orders of magnitude above any real row.
  const parsed = await readJsonBounded(request, 1 * MIB);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.reason },
      { status: parsed.reason === 'too_large' ? 413 : 400 },
    );
  }
  const body: unknown = parsed.body;

  const { entityType, entityId, op, payload } = (body ?? {}) as {
    entityType?: unknown;
    entityId?: unknown;
    op?: unknown;
    payload?: unknown;
  };
  if (
    typeof entityType !== 'string' ||
    typeof entityId !== 'string' ||
    typeof payload !== 'object' ||
    payload === null
  ) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const result = await applyChange({
    entityType,
    entityId,
    op: op === 'delete' ? 'delete' : 'upsert',
    payload: payload as Record<string, unknown>,
  });

  // Success → 200 + confirmed body. On failure the body carries `error` +
  // `disposition` so the push loop knows whether to quarantine or retry:
  //  - 'reject' (not-pushable / unknown)         → 422 (permanent)
  //  - 'retry'  (DB refusal, e.g. FK not synced) → 409 (transient)
  // A DB error is caught inside applyChange, so this route never throws a 500.
  const status = result.ok ? 200 : result.disposition === 'reject' ? 422 : 409;
  return NextResponse.json(result, { status });
}

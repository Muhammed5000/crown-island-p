import { NextResponse } from 'next/server';
import { syncDataSecret, syncSecretOk, isOnline } from '@/server/sync/config';
import { getChangesSince } from '@/server/sync/changes-core';
import { encryptSyncPayload } from '@/server/sync/envelope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/sync/changes?since=<cursor>[&sets=0]  (ONLINE sender)
 *
 * Returns the full master bundle changed since `cursor` (online's clock) for
 * the local pull worker. READ-scope guarded, AES-GCM encrypted, and online-only;
 * the LAN-exposed local node must never serve it. Omit `since` for a full initial
 * sync. `sets=0` skips the
 * full id-sets + BookingSlot mirror (the expensive every-row scans) — the
 * worker requests those only at SYNC_SETS_INTERVAL_MS cadence; an absent param
 * keeps the full (pre-cadence) behaviour for older pullers.
 */
export async function GET(request: Request) {
  if (!syncSecretOk(request, 'read')) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (!isOnline()) {
    return NextResponse.json({ ok: false, error: 'not_online_node' }, { status: 409 });
  }
  const dataSecret = syncDataSecret();
  if (!dataSecret) {
    return NextResponse.json({ ok: false, error: 'sync_data_secret_missing' }, { status: 503 });
  }
  const params = new URL(request.url).searchParams;
  const since = params.get('since');
  const includeSets = params.get('sets') !== '0';
  const bundle = await getChangesSince(since && since.length ? since : null, { includeSets });
  return NextResponse.json(
    { ok: true, envelope: encryptSyncPayload(bundle, dataSecret) },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

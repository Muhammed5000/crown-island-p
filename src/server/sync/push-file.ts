import { onlineApiUrl, SYNC_SECRET_HEADER, isLocal, syncScopeSecret, SYNC_TRANSFER_TIMEOUT_MS } from './config';
import { sha256Hex } from './file-integrity-core';

export interface PushFileResult {
  /** Receiver confirmed a 2xx AND `{ ok: true }` body. */
  ok: boolean;
  /** Receiver confirmed it VERIFIED size/sha (new receiver). Old receiver → false. */
  verified: boolean;
  status: number;
  error?: string;
}

/**
 * Push a venue-uploaded file's bytes to the online master at the SAME stored URL,
 * so a reception booking (committed on online) can reference it and the online
 * node holds the master copy.
 *
 * INTEGRITY: sends `application/octet-stream` (never an image content-type — that
 * invites a proxy/CDN to transcode the body) plus `x-sync-mime` / `x-sync-size` /
 * `x-sync-sha256` so the receiver can reject a truncated or mangled transfer. A
 * no-op off the local node. The result is now MEANINGFUL — callers use it (the
 * upload route's fast path, and the `MediaFile` drain lane) instead of ignoring it.
 */
export async function pushFileToOnline(
  url: string,
  mimeType: string,
  bytes: Buffer,
  staffId?: string | null,
): Promise<PushFileResult> {
  if (!isLocal()) return { ok: false, verified: false, status: 0, error: 'not_local' };
  const base = onlineApiUrl();
  if (!base) return { ok: false, verified: false, status: 0, error: 'online_api_url_unset' };
  try {
    const res = await fetch(`${base}/api/sync/upload-file`, {
      signal: AbortSignal.timeout(SYNC_TRANSFER_TIMEOUT_MS), // SYNC-002
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-sync-file-url': url,
        'x-sync-mime': mimeType,
        'x-sync-size': String(bytes.length),
        'x-sync-sha256': sha256Hex(bytes),
        ...(staffId ? { 'x-sync-staff-id': staffId } : {}),
        [SYNC_SECRET_HEADER]: syncScopeSecret('write') ?? '',
      },
      body: new Uint8Array(bytes),
    });
    let body: { ok?: boolean; verified?: boolean } | null = null;
    try {
      body = (await res.json()) as { ok?: boolean; verified?: boolean };
    } catch {
      body = null; // non-JSON (e.g. a proxy error page) → treat as unconfirmed
    }
    return {
      ok: res.ok && body?.ok === true,
      verified: body?.verified === true,
      status: res.status,
    };
  } catch (err) {
    return { ok: false, verified: false, status: 0, error: (err as Error).message };
  }
}

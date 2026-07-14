import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { syncSecretOk, isOnline } from '@/server/sync/config';
import { resolveSensitiveUpload } from '@/lib/upload-paths';
import { prisma } from '@/server/db/prisma';
import { sha256Hex } from '@/server/sync/file-integrity-core';

/**
 * GET /api/sync/file?u=<storedUrl>  (ONLINE)
 *
 * Streams the bytes for a stored upload URL — public (`/uploads/...`) or private
 * (`/api/secure-media/...`) — to the local mirror. `x-sync-secret`-guarded; the
 * URL is validated by `resolveSensitiveUpload` (strict `/YYYY/MM/<hex>.<ext>`
 * shape → no traversal). External `https://` URLs resolve to null (not served).
 *
 * INTEGRITY: responds with `x-sync-sha256` + `x-sync-size` so the local mirror
 * can verify the download before promoting it. As a cheap side effect it lazily
 * back-fills `Media.sha256`/`sizeBytes` for the row when they are null (legacy
 * rows), so the manifest converges without a bulk migration.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!syncSecretOk(request, 'read')) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  // Online-only, like file-stat/upload-file: the local node holds the same
  // private files (guest IDs, payment proofs) and must not serve them on the LAN.
  if (!isOnline()) {
    return NextResponse.json({ ok: false, error: 'not_online_node' }, { status: 409 });
  }
  const u = new URL(request.url).searchParams.get('u') ?? '';
  const resolved = resolveSensitiveUpload(u);
  if (!resolved) return NextResponse.json({ ok: false, error: 'bad_path' }, { status: 400 });
  try {
    const bytes = await readFile(resolved.diskPath);
    const sha256 = sha256Hex(bytes);
    // Lazy manifest back-fill (best-effort; uses the Media(url) index).
    prisma.media
      .updateMany({ where: { url: u, sha256: null }, data: { sha256, sizeBytes: bytes.length } })
      .catch(() => {});
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(bytes.length),
        'x-sync-sha256': sha256,
        'x-sync-size': String(bytes.length),
        'cache-control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
}

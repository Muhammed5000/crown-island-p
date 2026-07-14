import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { syncSecretOk, isOnline } from '@/server/sync/config';
import { resolveSensitiveUpload } from '@/lib/upload-paths';
import { prisma } from '@/server/db/prisma';
import {
  verifyFileIntegrity,
  sha256Hex,
  mimeForExt,
  planOverwrite,
  SYNC_UPLOAD_EXTS,
} from '@/server/sync/file-integrity-core';
import { atomicWrite } from '@/server/sync/atomic-write';
import { readBytesBounded, MIB } from '@/server/sync/http-core';

/**
 * POST /api/sync/upload-file  (ONLINE)
 *
 * Receives a venue-uploaded file (guest ID photo / payment proof / ops proof) so
 * the online master holds a copy at the SAME stored URL the local desk generated
 * (the reception booking committed on online references that URL). Headers:
 *  - `x-sync-secret`   — auth
 *  - `x-sync-file-url` — the stored URL (validated to a strict /YYYY/MM/<hex>.<ext>)
 *  - `x-sync-mime`     — the TRUE image mime (transport `content-type` is octet-stream)
 *  - `x-sync-size`     — decimal byte length the sender computed
 *  - `x-sync-sha256`   — hex SHA-256 the sender computed
 *  - `x-sync-staff-id` — uploader (optional)
 * body: raw bytes.
 *
 * INTEGRITY: the received bytes are verified against the declared size/sha256 and
 * (for images) the byte signature BEFORE anything is written — a truncated or
 * mangled transfer (e.g. a reverse-proxy body cap) is rejected with 400, never
 * persisted. The write is atomic (temp + rename), and the `Media` manifest row is
 * corrected on every verified (re-)push. Old senders that ship no size/sha
 * headers fall through to a legacy-lenient path that still signature-checks images.
 */
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!syncSecretOk(request, 'write')) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (!isOnline()) {
    return NextResponse.json({ ok: false, error: 'not_online_node' }, { status: 409 });
  }
  const url = request.headers.get('x-sync-file-url') ?? '';
  const resolved = resolveSensitiveUpload(url);
  if (!resolved) return NextResponse.json({ ok: false, error: 'bad_path' }, { status: 400 });
  // Photo formats only (what the venue upload routes produce). A non-image ext
  // would skip the signature check below and let arbitrary bytes land under a
  // servable path — permanent reject, the sender quarantines it.
  if (!SYNC_UPLOAD_EXTS.has(resolved.ext.toLowerCase())) {
    return NextResponse.json({ ok: false, error: 'bad_ext' }, { status: 400 });
  }

  // Venue uploads are capped at 10 MB at every origin; 15 MiB bounds the buffer
  // here without ever rejecting a legitimate push (streaming cap → no OOM lever).
  const read = await readBytesBounded(request, 15 * MIB);
  if (!read.ok) {
    return NextResponse.json({ ok: false, error: 'too_large' }, { status: 413 });
  }
  const buf = read.bytes;

  // True mime for the signature check + the manifest row: the sender's declared
  // image mime (x-sync-mime, or an old sender's image content-type), else derive
  // it from the stored extension so an octet-stream-only push still validates.
  const declaredMime =
    request.headers.get('x-sync-mime') ?? request.headers.get('content-type') ?? 'application/octet-stream';
  const realMime = declaredMime.startsWith('image/')
    ? declaredMime
    : (mimeForExt(resolved.ext) ?? declaredMime);

  const sizeHeader = request.headers.get('x-sync-size');
  const shaHeader = request.headers.get('x-sync-sha256');
  const expectedSize = sizeHeader && /^\d+$/.test(sizeHeader) ? Number(sizeHeader) : null;

  // Reject empty / size-mismatched / sha-mismatched / signature-broken bytes
  // before touching disk. Header-less (old-sender) pushes still get the image
  // signature check — an intact image passes, from-byte-0 garbage does not.
  const verdict = verifyFileIntegrity(buf, {
    expectedSize,
    expectedSha256: shaHeader,
    mime: realMime,
  });
  if (!verdict.ok) {
    return NextResponse.json(
      { ok: false, error: 'integrity_mismatch', reason: verdict.reason },
      { status: 400 },
    );
  }

  // Overwrite guard: never silently replace a verified-HEALTHY stored file with
  // DIFFERENT bytes (evidence tampering on guest IDs / payment proofs). The
  // repair path — replacing a corrupt or manifest-mismatched copy — stays open,
  // and an identical re-push is acknowledged without touching disk.
  const existing = await readFile(resolved.diskPath).catch(() => null);
  const manifest = existing
    ? await prisma.media.findFirst({ where: { url }, select: { sha256: true, sizeBytes: true } })
    : null;
  const decision = planOverwrite({ existing, incoming: buf, manifest, mime: realMime });
  if (decision === 'refuse_healthy') {
    return NextResponse.json({ ok: false, error: 'exists_healthy' }, { status: 409 });
  }
  if (decision === 'write') {
    await atomicWrite(resolved.diskPath, buf);
  }

  // Manifest row is best-effort but CORRECTIVE: updateMany fixes a stale
  // size/mime/sha on re-push and tolerates duplicate-url rows; create only when
  // the row is genuinely new. The bytes on disk are the source of truth.
  const uploadedById = request.headers.get('x-sync-staff-id') || null;
  const sha256 = sha256Hex(buf);
  try {
    const updated = await prisma.media.updateMany({
      where: { url },
      data: { mimeType: realMime, sizeBytes: buf.length, sha256 },
    });
    if (updated.count === 0) {
      await prisma.media.create({
        data: { url, mimeType: realMime, sizeBytes: buf.length, sha256, uploadedById },
      });
    }
  } catch {
    /* manifest row is best-effort; the file itself is what matters */
  }

  const verified = Boolean(shaHeader || expectedSize != null);
  return NextResponse.json({ ok: true, url, verified }, { headers: { 'Cache-Control': 'no-store' } });
}

import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/server/auth/guards';
import { canAccessOps } from '@/server/auth/roles';
import { prisma } from '@/server/db/prisma';
import { checkUploadRate } from '@/lib/upload-rate-limit';
import { secureUploadTarget } from '@/lib/upload-paths';
import { imageSignatureMatches } from '@/lib/file-signature';
import { pushFileToOnline } from '@/server/sync/push-file';
import { sha256Hex } from '@/server/sync/file-integrity-core';
import { log, errFields } from '@/lib/log';
import { enqueueFilePush } from '@/server/sync/outbox';

/**
 * Ops desk photo upload (progress / completion proof on a housekeeping or
 * maintenance ticket) — accepts a single multipart `file` (image only), stores it
 * in the PRIVATE secure root (auth-gated serving), records a `Media` row, and —
 * on the local venue node — durably queues the bytes for a verified push to the
 * online master. Gated to ops-authorised staff (any gate role — incl.
 * HOUSEKEEPING / MAINTENANCE / SECURITY).
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

const IMAGE_MIME_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

function err(code: string, status = 400, detail?: string) {
  return NextResponse.json({ ok: false, code, detail }, { status });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !canAccessOps(user.role)) return err('unauthorized', 401);

  const rate = checkUploadRate(`ops-upload:${user.id}`);
  if (!rate.ok) {
    return err('rate_limited', 429, `Too many uploads — wait ${rate.retryAfterSeconds}s.`);
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return err('bad_request', 400, 'Could not read upload.');
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return err('no_file', 400, 'No file was attached.');
  }

  const mime = file.type || 'application/octet-stream';
  const ext = IMAGE_MIME_TYPES[mime];
  if (!ext) return err('unsupported_type', 415, `"${mime}" is not an accepted image type.`);
  if (file.size > MAX_IMAGE_BYTES) {
    return err('too_large', 413, 'Image exceeds the 10MB limit.');
  }

  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const fileName = `${randomBytes(12).toString('hex')}.${ext}`;
  // Ops proof photos are SENSITIVE: private store + auth-gated serving route.
  const buffer = Buffer.from(await file.arrayBuffer());
  // Never trust the declared image MIME — verify the real byte signature so a
  // renamed script / HTML can't be stored under an image extension.
  if (!imageSignatureMatches(buffer, mime)) {
    return err('unsupported_type', 415, 'File content does not match its image type.');
  }
  const { url, diskPath } = secureUploadTarget(year, month, fileName);
  await mkdir(path.dirname(diskPath), { recursive: true });
  await writeFile(diskPath, buffer);
  const sha256 = sha256Hex(buffer);

  // Record the Media row AND queue the durable file-bytes push in ONE tx, so the
  // upload can never be "written but not queued". On failure remove the just-
  // written file (no orphaned proof bytes) and 500 so the desk retries.
  let queued: { id: string } | null = null;
  try {
    queued = await prisma.$transaction(async (tx) => {
      const media = await tx.media.create({
        data: { url, mimeType: mime, sizeBytes: file.size, sha256, uploadedById: user.id },
        select: { id: true },
      });
      return enqueueFilePush(tx, { mediaId: media.id, url, mimeType: mime, sha256, uploadedById: user.id });
    });
  } catch (e) {
    log.error('ops upload failed to record upload', errFields(e));
    await unlink(diskPath).catch(() => {});
    return err('storage_error', 500, 'Could not record the upload — try again.');
  }

  // OFFLINE-SYNC fast path: one immediate VERIFIED push so the online master holds
  // the bytes promptly. If it fails we still return ok — the queued row drains on
  // a later tick, and the file also mirrors back to local via file-sync.
  const pushed = await pushFileToOnline(url, mime, buffer, user.id);
  if (pushed.ok && queued) {
    await prisma.syncQueue
      .updateMany({ where: { id: queued.id, status: 'pending' }, data: { status: 'synced', syncedAt: new Date() } })
      .catch(() => {});
  }

  return NextResponse.json({ ok: true, url });
}

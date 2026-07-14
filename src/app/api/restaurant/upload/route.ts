import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/server/auth/guards';
import { isRestaurantOwner } from '@/server/auth/roles';
import { prisma } from '@/server/db/prisma';
import { checkUploadRate } from '@/lib/upload-rate-limit';
import { imageSignatureMatches } from '@/lib/file-signature';
import { sha256Hex } from '@/server/sync/file-integrity-core';
import { log, errFields } from '@/lib/log';

/**
 * Restaurant-partner upload — cover images and the menu PDF. Mirrors the
 * admin/reception uploaders (same storage layout, random filenames, Media
 * audit row) but is gated to RESTAURANT accounts and additionally verifies
 * the PDF magic bytes: a renamed executable / HTML file whose client lies
 * about `Content-Type: application/pdf` is rejected before it touches disk.
 *
 * Files land in `public/uploads/YYYY/MM/<random>.<ext>` — the extension comes
 * from the validated MIME type, never from the user-supplied filename, so an
 * upload can never materialise as a servable script.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

const IMAGE_MIME_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const PDF_MIME = 'application/pdf';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15 MB — menus scan heavy

function err(code: string, status = 400, detail?: string) {
  return NextResponse.json({ ok: false, code, detail }, { status });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !isRestaurantOwner(user.role)) return err('unauthorized', 401);

  // DoS containment: cap uploads per partner per minute.
  const rate = checkUploadRate(`restaurant-upload:${user.id}`);
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
  const isPdf = mime === PDF_MIME;
  const imageExt = IMAGE_MIME_TYPES[mime];
  if (!isPdf && !imageExt) {
    return err('unsupported_type', 415, `"${mime}" is not allowed — JPG, PNG, WebP or PDF only.`);
  }

  const limit = isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
  if (file.size > limit) {
    return err(
      'too_large',
      413,
      `File exceeds the ${(limit / (1024 * 1024)).toFixed(0)}MB limit.`,
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Never trust the declared MIME for PDFs — check the real file signature.
  // Every valid PDF starts with "%PDF-"; anything else (renamed .exe, HTML
  // with a fake Content-Type, …) is refused.
  if (isPdf && !buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    return err('unsupported_type', 415, 'This file is not a real PDF.');
  }

  // Same guard for images — the declared MIME must match the real byte
  // signature (JPEG/PNG/WebP), mirroring the admin/reception/ops uploaders.
  if (!isPdf && !imageSignatureMatches(buffer, mime)) {
    return err('unsupported_type', 415, 'File content does not match its image type.');
  }

  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ext = isPdf ? 'pdf' : imageExt;
  const fileName = `${randomBytes(12).toString('hex')}.${ext}`;
  const dir = path.join(process.cwd(), 'public', 'uploads', year, month);
  await mkdir(dir, { recursive: true });
  const publicUrl = `/uploads/${year}/${month}/${fileName}`;
  await writeFile(path.join(dir, fileName), buffer);

  try {
    await prisma.media.create({
      data: {
        url: publicUrl,
        mimeType: mime,
        sizeBytes: file.size,
        sha256: sha256Hex(buffer),
        uploadedById: user.id,
      },
    });
  } catch (e) {
    log.error('restaurant upload failed to record Media row', errFields(e));
  }

  return NextResponse.json({
    ok: true,
    url: publicUrl,
    mimeType: mime,
    sizeBytes: file.size,
    kind: isPdf ? 'pdf' : 'image',
  });
}

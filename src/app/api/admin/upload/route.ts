import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { checkUploadRate } from '@/lib/upload-rate-limit';
import { imageSignatureMatches } from '@/lib/file-signature';
import { sha256Hex } from '@/server/sync/file-integrity-core';
import { log, errFields } from '@/lib/log';

/**
 * Admin media upload — accepts a single multipart `file` field, persists it
 * under `public/uploads/YYYY/MM/`, registers a `Media` row, and returns the
 * public URL the admin form fields then store.
 *
 * Notes:
 *  - Files are validated for *mime* + *size* before they hit disk.
 *  - Filenames are random + slug-safe; the original name is never trusted.
 *  - This route runs on the Node.js runtime — Edge does not have `fs/promises`.
 *  - Body size in route handlers is not bounded by `experimental.serverActions`
 *    so the same route serves both images (≤ 10 MB) and videos (≤ 100 MB).
 */

export const runtime = 'nodejs';
// Allow uploads up to ~100MB. Default Next route handler limit is 4MB; this
// raises it for video uploads. Note: not all hosts honor this — Vercel still
// caps at 4.5MB unless you use direct-to-S3. For dev / self-hosted ngrok this
// works fine.
export const maxDuration = 60;

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  // SVG is intentionally NOT accepted: an SVG is an executable document (inline
  // <script>/onload/foreignObject) and the byte-signature check only proves shape,
  // not safety. It would be served from the public web root, so a stored SVG is a
  // persistent-XSS risk resting solely on the /uploads CSP header. Logos use
  // PNG/WEBP; if scalable art is ever required, sanitize server-side first.
]);

const VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime', // .mov
  'video/x-m4v',
  'video/ogg',
]);

// Hard cap per category — larger files are rejected with a clear message
// instead of silently truncating.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB

/** Friendly extension picker that matches the mime, not the user-supplied name. */
function extensionForMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/avif':
      return 'avif';
    case 'video/mp4':
      return 'mp4';
    case 'video/webm':
      return 'webm';
    case 'video/quicktime':
      return 'mov';
    case 'video/x-m4v':
      return 'm4v';
    case 'video/ogg':
      return 'ogv';
    default:
      return 'bin';
  }
}

/** Structured JSON error so the client can render a useful message. */
function errorJson(code: string, status = 400, detail?: string) {
  return NextResponse.json({ ok: false, code, detail }, { status });
}

export async function POST(req: NextRequest) {
  try {
    // 1) Admin auth — non-admins get a 401, never a hint about what's behind.
    let admin;
    try {
      admin = await requireAdmin();
    } catch {
      return errorJson('unauthorized', 401);
    }

    // 1b) DoS containment — cap uploads per admin per minute. Generous enough
    //     for batch gallery uploads; stops a runaway loop exhausting disk.
    const rate = checkUploadRate(`admin-upload:${admin.id}`);
    if (!rate.ok) {
      return errorJson('rate_limited', 429, `Too many uploads — wait ${rate.retryAfterSeconds}s.`);
    }

    // 2) Parse multipart payload.
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch (err) {
      return errorJson(
        'bad_request',
        400,
        err instanceof Error ? err.message : 'Could not read upload.',
      );
    }

    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return errorJson('no_file', 400, 'No file was attached to the request.');
    }

    // 3) Type + size validation.
    const mime = file.type || 'application/octet-stream';
    const isImage = IMAGE_MIME_TYPES.has(mime);
    const isVideo = VIDEO_MIME_TYPES.has(mime);

    if (!isImage && !isVideo) {
      return errorJson(
        'unsupported_type',
        415,
        `Type "${mime}" is not allowed. Accepted: ${[...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES].join(', ')}.`,
      );
    }

    const limit = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (file.size > limit) {
      const mb = (limit / (1024 * 1024)).toFixed(0);
      return errorJson(
        'too_large',
        413,
        `File is ${(file.size / (1024 * 1024)).toFixed(1)}MB — limit is ${mb}MB for ${isImage ? 'images' : 'videos'}.`,
      );
    }

    // 4) Pick a safe path: public/uploads/YYYY/MM/<random>.<ext>
    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const ext = extensionForMime(mime);
    const fileName = `${randomBytes(12).toString('hex')}.${ext}`;

    const dir = path.join(process.cwd(), 'public', 'uploads', year, month);
    await mkdir(dir, { recursive: true });
    const absPath = path.join(dir, fileName);
    const publicUrl = `/uploads/${year}/${month}/${fileName}`;

    // 5) Stream-ish write (Web File → ArrayBuffer → Buffer). For 100MB videos
    //    this allocates briefly; on a self-hosted dev box that's fine.
    const buffer = Buffer.from(await file.arrayBuffer());

    // Never trust the declared image MIME — verify the real byte signature so a
    // renamed script / HTML can't be stored under an image extension. (Videos are
    // not sniffed; their containers vary and they are served sandboxed.)
    if (isImage && !imageSignatureMatches(buffer, mime)) {
      return errorJson('unsupported_type', 415, 'File content does not match its image type.');
    }

    await writeFile(absPath, buffer);

    // 6) Log a Media row so admins can audit what's been uploaded. Failure
    //    here is non-fatal — the file is still on disk and reachable.
    let mediaRow: { id: string } | null = null;
    try {
      mediaRow = await prisma.media.create({
        data: {
          url: publicUrl,
          mimeType: mime,
          sizeBytes: file.size,
          // sha256 lets the local mirror verify this file when it downloads it.
          sha256: sha256Hex(buffer),
          uploadedById: admin.id,
        },
        select: { id: true },
      });
    } catch (err) {
      log.error('upload failed to record Media row', errFields(err));
    }

    return NextResponse.json({
      ok: true,
      url: publicUrl,
      mediaId: mediaRow?.id ?? null,
      mimeType: mime,
      sizeBytes: file.size,
      kind: isImage ? 'image' : 'video',
    });
  } catch (err) {
    log.error('upload unexpected error', errFields(err));
    return errorJson('server_error', 500, 'Upload failed — please try again.');
  }
}

import path from 'node:path';

/**
 * Storage + URL helpers for uploads.
 *
 * SENSITIVE uploads (guest ID images, payment proofs, ops proofs) must NOT be
 * world-readable static assets. They live under a PRIVATE on-disk root (outside
 * `public/`, never served by Next's static handler) and are reachable only
 * through the auth-gated route `GET /api/secure-media/[...]`, which checks a
 * staff role before returning the bytes.
 *
 * PUBLIC catalog media (category covers, hero videos, restaurant menu images)
 * are unaffected — they keep living under `public/uploads/**` and stay directly
 * servable, because they're meant to be seen by guests.
 *
 * Backward compatibility: `resolveSensitiveUpload` accepts BOTH the new secure
 * form and the LEGACY public form, so existing records keep working until the
 * one-off migration (scripts/migrate-sensitive-uploads.ts) moves their bytes.
 */

/** Stored-URL prefix for auth-gated sensitive media. */
export const SECURE_MEDIA_PREFIX = '/api/secure-media';

/** Private on-disk root for sensitive uploads — OUTSIDE `public/`. */
export const PRIVATE_UPLOAD_ROOT = path.join(process.cwd(), 'private-uploads');

/** Legacy/public on-disk root. */
const PUBLIC_ROOT = path.join(process.cwd(), 'public');

// The ONLY shape our upload routes ever produce: /YYYY/MM/<24-hex>.<ext>.
const REL_RE = /^\/(\d{4})\/(\d{2})\/([a-f0-9]{24})\.([a-z0-9]+)$/i;

export interface ResolvedUpload {
  /** Absolute on-disk path, rebuilt from validated segments (no traversal). */
  diskPath: string;
  /** Lower-cased file extension. */
  ext: string;
  /** True when the bytes live in the private (auth-gated) store. */
  secure: boolean;
}

/** Build the stored URL + private disk path for a NEW sensitive upload. */
export function secureUploadTarget(
  year: string,
  month: string,
  fileName: string,
): { url: string; diskPath: string } {
  return {
    url: `${SECURE_MEDIA_PREFIX}/${year}/${month}/${fileName}`,
    diskPath: path.join(PRIVATE_UPLOAD_ROOT, year, month, fileName),
  };
}

/**
 * Resolve a stored sensitive-media URL to its on-disk path, accepting BOTH:
 *  - the new secure form  `/api/secure-media/YYYY/MM/<hex>.<ext>` → private store
 *  - the legacy public form `/uploads/YYYY/MM/<hex>.<ext>`        → public store
 *
 * Returns `null` for anything that doesn't match the strict shape — this is the
 * guard that blocks path traversal / pointing a "document" at an arbitrary file.
 */
/**
 * True when `url` is a stored media reference this app actually produced — the
 * strict `/api/secure-media/YYYY/MM/<hex>.<ext>` (or legacy `/uploads/...`) shape.
 * Use it to constrain user-supplied image-URL fields (ops proofs, reception ID /
 * proof images) that are later rendered as `<a href>` / `<img src>`, so a stored
 * `javascript:` / `data:` / external / traversal value can never reach the DOM.
 */
export function isStoredMediaUrl(url: string): boolean {
  return resolveSensitiveUpload(url.trim()) !== null;
}

export function resolveSensitiveUpload(url: string): ResolvedUpload | null {
  let rel: string | null = null;
  let secure = false;
  if (url.startsWith(`${SECURE_MEDIA_PREFIX}/`)) {
    rel = url.slice(SECURE_MEDIA_PREFIX.length);
    secure = true;
  } else if (url.startsWith('/uploads/')) {
    rel = url.slice('/uploads'.length);
    secure = false;
  }
  if (rel === null) return null;

  const m = REL_RE.exec(rel);
  if (!m) return null;
  const [, year, month, hex, ext] = m;
  const fileName = `${hex}.${ext}`;
  const diskPath = secure
    ? path.join(PRIVATE_UPLOAD_ROOT, year!, month!, fileName)
    : path.join(PUBLIC_ROOT, 'uploads', year!, month!, fileName);
  return { diskPath, ext: ext!.toLowerCase(), secure };
}

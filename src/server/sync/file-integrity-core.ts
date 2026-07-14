import { createHash } from 'node:crypto';
import { imageSignatureMatches } from '@/lib/file-signature-core';

/**
 * Pure integrity helpers for the sync file layer — no I/O, no Prisma, so they can
 * be unit-tested directly (mirrors the `*-core.ts` convention, e.g.
 * `file-signature-core.ts`). Two concerns live here:
 *
 *  1. VERIFY a buffer against declared size / sha256 / image signature
 *     (`verifyFileIntegrity`) — used by the receiver and the download path to
 *     reject a truncated or mangled transfer before it is persisted.
 *  2. DECIDE what to do about a file the walk visited (`planFileAction`) — the
 *     self-healing "authority-by-prefix" rule: secure `/api/secure-media/**`
 *     files are venue-authored (local repairs online by RE-PUSHING), public
 *     `/uploads/**` files are online-authored (local only DOWNLOADS).
 */

/** Hex SHA-256 of a buffer (lower-case). The one hashing primitive for files. */
export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Bytes to read from the head of a file for `imageSignatureMatches`. The SVG
 * structural check scans up to 1024 bytes and the AVIF `ftyp` scan up to 64, so
 * 1024 is the safe minimum for every accepted image type. Both the file-stat
 * endpoint and the local sweep read exactly this much — never the whole file.
 */
export const SIGNATURE_HEAD_BYTES = 1024;

/**
 * The extensions our upload routes ever produce → their image MIME. Non-image
 * public assets (menu PDFs, hero videos) are deliberately absent: `mimeForExt`
 * returns null for them, so the signature check is skipped and only size/sha
 * verification applies. `svg` is kept for LEGACY entries (admin SVG upload was
 * removed in A-17) so the sweep can still validate any that predate that change.
 */
export const IMAGE_EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

/** Image MIME for a file extension, or null for a non-image (PDF/video) ext. */
export function mimeForExt(ext: string): string | null {
  return IMAGE_EXT_MIME[ext.toLowerCase()] ?? null;
}

/**
 * Extensions the local→online file push (upload-file) accepts. STRICTER than
 * IMAGE_EXT_MIME: the venue upload routes only ever produce photo formats, and
 * `svg` (active-content capable, legacy-only) plus non-image exts must never
 * arrive through this lane — a non-image ext would skip the signature check and
 * let arbitrary bytes land under a servable path.
 */
export const SYNC_UPLOAD_EXTS: ReadonlySet<string> = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'avif',
]);

export type IntegrityFailure = 'empty' | 'size_mismatch' | 'sha256_mismatch' | 'signature_mismatch';

/**
 * Verify a received/downloaded buffer against whatever expectations are known.
 * Each expectation is optional so this works across the rollout skew (an old
 * sender ships no size/sha headers → only the always-present checks run):
 *  - always: non-empty;
 *  - `expectedSize`  set → byte length must match (catches truncation);
 *  - `expectedSha256` set → content hash must match (catches any mangling);
 *  - `mime` is image/* → the byte signature must match (catches from-byte-0
 *    corruption even when no size/sha travelled).
 */
export function verifyFileIntegrity(
  buf: Buffer,
  exp: { expectedSize?: number | null; expectedSha256?: string | null; mime?: string | null },
): { ok: true } | { ok: false; reason: IntegrityFailure } {
  if (buf.length === 0) return { ok: false, reason: 'empty' };
  if (exp.expectedSize != null && buf.length !== exp.expectedSize) {
    return { ok: false, reason: 'size_mismatch' };
  }
  if (exp.expectedSha256 && sha256Hex(buf) !== exp.expectedSha256.toLowerCase()) {
    return { ok: false, reason: 'sha256_mismatch' };
  }
  if (exp.mime && exp.mime.startsWith('image/') && !imageSignatureMatches(buf, exp.mime)) {
    return { ok: false, reason: 'signature_mismatch' };
  }
  return { ok: true };
}

export type OverwriteDecision = 'write' | 'skip_identical' | 'refuse_healthy';

/**
 * Decide whether an incoming (already integrity-verified) push may replace the
 * bytes currently stored at the same URL on the receiver. The legitimate flows
 * are: first delivery (nothing stored), an idempotent re-push of the SAME
 * bytes, and the file-sweep REPAIR of a corrupt/mismatched copy. What must be
 * refused is silently replacing a verified-HEALTHY file with different bytes —
 * that is evidence tampering (guest IDs, payment proofs), not sync.
 *
 *  - nothing stored                 → write            (first delivery)
 *  - identical bytes                → skip_identical   (re-push; no disk touch)
 *  - stored copy verifies against the manifest sha/size + image signature
 *                                   → refuse_healthy   (409 to the sender)
 *  - stored copy is corrupt / mismatched / unverifiable-and-broken
 *                                   → write            (the repair path)
 */
export function planOverwrite(input: {
  /** Bytes currently on disk at the target path; null = no file stored. */
  existing: Buffer | null;
  incoming: Buffer;
  /** Manifest (Media row) expectations for the EXISTING file, if a row exists. */
  manifest: { sha256: string | null; sizeBytes: number | null } | null;
  /** Image mime for the target ext (signature check input). */
  mime: string | null;
}): OverwriteDecision {
  const { existing, incoming, manifest, mime } = input;
  if (!existing) return 'write';
  if (sha256Hex(existing) === sha256Hex(incoming)) return 'skip_identical';
  const verdict = verifyFileIntegrity(existing, {
    expectedSize: manifest?.sizeBytes ?? null,
    expectedSha256: manifest?.sha256 ?? null,
    mime,
  });
  return verdict.ok ? 'refuse_healthy' : 'write';
}

export type FileAction = 'none' | 'download' | 'repush';

/** The online node's view of a file, from POST /api/sync/file-stat. */
export interface OnlineFileStat {
  exists: boolean;
  size: number | null;
  /** imageSignatureMatches on the head; null when the ext isn't an image. */
  signatureOk: boolean | null;
}

export interface PlanFileInput {
  /** From resolveSensitiveUpload().secure — the authority-by-prefix switch. */
  secure: boolean;
  localExists: boolean;
  localSize: number | null;
  /** Signature of the LOCAL bytes; null = not checkable (non-image ext). */
  localSignatureOk: boolean | null;
  /** Media.sizeBytes — the immutable upload-time size (public compare only). */
  rowSizeBytes: number | null;
  /** null = online stat UNAVAILABLE (old online / request failed) — don't guess. */
  online: OnlineFileStat | null;
}

/**
 * Decide the repair action for one file the walk visited. Reads only LIVE facts
 * (disk stat + head signature + the online stat), never a stale row, so a
 * back-filled hash never has to propagate for this to be correct.
 */
export function planFileAction(input: PlanFileInput): FileAction {
  const { secure, localExists, localSize, localSignatureOk, rowSizeBytes, online } = input;

  // Nothing on local disk → fetch the master copy (either prefix). If it is also
  // absent online, the fetch 404s and the caller counts it failed (missing-both).
  if (!localExists) return 'download';

  if (secure) {
    // Venue-authored truth. A locally-CORRUPT secure file can't be the repair
    // source — re-fetch, because online's copy may still be intact (this is the
    // corrupt-local / laundered-clone recovery case).
    if (localSignatureOk === false) return 'download';
    // No stat from online (old online without the endpoint, or the request
    // failed) → make no re-push decision. Never conjure a push from a guess.
    if (online === null) return 'none';
    // Online missing it, size-diverged, or holding corrupt bytes → push our good
    // local copy up to heal it.
    if (!online.exists || online.size !== localSize || online.signatureOk === false) {
      return 'repush';
    }
    return 'none';
  }

  // Public / online-authored truth: local only ever DOWNLOADS (never repushes an
  // online-owned file). The cheap corruption signal is the immutable upload-time
  // size — a live file whose byte count drifted from the row must be re-fetched.
  if (rowSizeBytes != null && localSize !== rowSizeBytes) return 'download';
  return 'none';
}

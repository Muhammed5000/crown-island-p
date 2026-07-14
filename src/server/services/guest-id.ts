import 'server-only';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GuestIdDocument, Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { audit } from '@/server/audit/audit';
import { enqueueById } from '@/server/sync/outbox';
import { imageSignatureMatches } from '@/lib/file-signature';
import { sha256Hex } from '@/server/sync/file-integrity-core';
import { resolveSensitiveUpload, secureUploadTarget } from '@/lib/upload-paths';
import { isDocumentNumberBlocked } from './blocklist';
import { log, errFields } from '@/lib/log';
import { DomainError } from './errors';
import { maskId } from '@/lib/mask';

/**
 * Guest identity-document service — the single source of truth for collecting,
 * validating and counting the ID images reception staff must upload for every
 * guest before the gate will admit a booking.
 *
 * Business rule (see `checkInBooking`'s `guest_id_required` gate): a booking
 * needs one ID document per ADULT (slots 1 … `Booking.adults`) AND per paid
 * EXTRA PERSON (slots `people+1` … `people+extraPersons`) before check-in can
 * complete. Children (slots `adults+1` … `people`) carry NO ID image — they're
 * admitted as headcount only. Re-uploading a slot overwrites it (unique
 * `[bookingId, guestSeq]`), so duplicate uploads can't inflate the count.
 *
 * Validation is deliberately NOT trusting the client: the record step re-derives
 * the file type from the stored filename and the real byte size from disk, and
 * only accepts URLs the app's own upload route could have produced. The client's
 * declared MIME/size are advisory.
 */

/** Accepted ID image extensions (JPG / JPEG / PNG / WEBP per the spec). */
const ALLOWED_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Hard cap, mirrors the upload route's image limit. */
export const MAX_ID_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Accepted payment-proof image extensions. WIDER than ID images: the reception
 * upload route also emits gif/avif, so reusing {@link ALLOWED_EXT} here would
 * wrongly reject a legitimately-uploaded gif/avif proof. Keep in sync with
 * `IMAGE_MIME_TYPES` in `/api/reception/upload`.
 */
const PROOF_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);

/**
 * Re-validate a reception payment-proof URL server-side, mirroring the guest-ID
 * checks: it must be a URL the upload route could have produced
 * (`/uploads/YYYY/MM/<24-hex>.<ext>`, which blocks path traversal and pointing
 * the "proof" at an arbitrary/external string) and the file must exist non-empty
 * within the size cap. The action layer only enforces `z.string().max(2000)`,
 * so without this a reception-authorised caller POSTing the action directly
 * could persist a junk or external proofUrl into the payment record and pollute
 * the audit trail. Returns the validated URL unchanged.
 */
export async function validateProofUrl(proofUrl: string): Promise<string> {
  const resolved = resolveSensitiveUpload(proofUrl);
  if (!resolved) throw new DomainError('Invalid payment proof reference', 'invalid_upload', 400);
  if (!PROOF_EXT.has(resolved.ext)) {
    throw new DomainError('Payment proof must be an image', 'unsupported_type', 415);
  }
  const diskPath = resolved.diskPath;
  try {
    const info = await stat(diskPath);
    if (!info.isFile() || info.size === 0) {
      throw new DomainError('Payment proof is empty or missing', 'empty_file', 400);
    }
    if (info.size > MAX_ID_BYTES) {
      throw new DomainError('Payment proof exceeds the 10MB limit', 'too_large', 413);
    }
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError('Payment proof could not be read', 'storage_error', 502);
  }
  return proofUrl;
}

export interface GuestIdStatus {
  bookingId: string;
  /** Required document count = adults + paid extra persons (children need none). */
  total: number;
  /** Number of distinct guest slots with a document. */
  uploaded: number;
  /** True once every guest slot has a document. */
  complete: boolean;
  status: 'NONE' | 'PARTIAL' | 'COMPLETE';
}

/** Pure roll-up — given the guest count and how many slots are filled. */
export function summarizeGuestIds(total: number, uploaded: number): Omit<GuestIdStatus, 'bookingId'> {
  const capped = Math.min(uploaded, total);
  const complete = total > 0 && capped >= total;
  return {
    total,
    uploaded: capped,
    complete,
    status: capped === 0 ? 'NONE' : complete ? 'COMPLETE' : 'PARTIAL',
  };
}

export interface PreparedGuestIdRow {
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  storagePath: string;
  imageUrl: string;
  /** Human label for this guest (reception-entered), trimmed; null when blank. */
  guestName: string | null;
}

/** Trim + cap a guest name, or null when blank. */
function cleanGuestName(raw: string | null | undefined): string | null {
  const n = (raw ?? '').trim();
  return n ? n.slice(0, 80) : null;
}

/**
 * Validate one uploaded ID reference server-side and resolve its real on-disk
 * size + MIME (never trusting client-sent values). Used by both the per-guest
 * record path and the reception finalize transaction (deferred commit), so a
 * deferred booking's IDs get the exact same checks as immediate ones.
 */
export async function prepareGuestIdRow(
  imageUrl: string,
  fileName: string,
  guestName?: string | null,
): Promise<PreparedGuestIdRow> {
  const resolved = resolveSensitiveUpload(imageUrl);
  if (!resolved) throw new DomainError('Invalid upload reference', 'invalid_upload', 400);
  const ext = resolved.ext;
  const mime = ALLOWED_EXT[ext];
  if (!mime) {
    throw new DomainError('Only JPG, PNG or WEBP images are accepted', 'unsupported_type', 415);
  }
  const diskPath = resolved.diskPath;
  let sizeBytes: number;
  try {
    const info = await stat(diskPath);
    if (!info.isFile() || info.size === 0) {
      throw new DomainError('Uploaded file is empty or missing', 'empty_file', 400);
    }
    sizeBytes = info.size;
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError('Uploaded file could not be read', 'storage_error', 502);
  }
  if (sizeBytes > MAX_ID_BYTES) {
    throw new DomainError('Image exceeds the 10MB limit', 'too_large', 413);
  }
  return {
    fileName: fileName.trim().slice(0, 255) || `guest.${ext}`,
    fileType: mime,
    fileSizeBytes: sizeBytes,
    storagePath: imageUrl,
    imageUrl,
    guestName: cleanGuestName(guestName),
  };
}

/**
 * Clone a stored sensitive upload (guest ID photo) into a FRESH private file
 * and return the new secure URL.
 *
 * Used by the returning-guest reuse flow: a repeat booking that reuses a prior
 * booking's ID photo must never point two `GuestIdDocument` rows at the SAME
 * file — each document owns its bytes (deleting/retiring one booking's media
 * can then never orphan another's). Accepts both secure and legacy source URLs
 * (see `resolveSensitiveUpload`) but always clones INTO the private store.
 */
export async function cloneSensitiveUpload(
  imageUrl: string,
  uploadedById: string,
): Promise<string> {
  const resolved = resolveSensitiveUpload(imageUrl);
  if (!resolved) throw new DomainError('Invalid upload reference', 'invalid_upload', 400);
  const mime = ALLOWED_EXT[resolved.ext];
  if (!mime) {
    throw new DomainError('Only JPG, PNG or WEBP images are accepted', 'unsupported_type', 415);
  }

  // Read the SOURCE bytes once — we need them for the copy, the size, the hash,
  // and the corruption check below (a stat alone can't tell a good file from a
  // truncated one).
  let bytes: Buffer;
  try {
    bytes = await readFile(resolved.diskPath);
  } catch {
    throw new DomainError('Stored file could not be read', 'storage_error', 502);
  }
  if (bytes.length === 0) {
    throw new DomainError('Stored file is empty or missing', 'empty_file', 400);
  }
  if (bytes.length > MAX_ID_BYTES) {
    throw new DomainError('Image exceeds the 10MB limit', 'too_large', 413);
  }
  // Never launder corruption into a fresh URL: if the source bytes are already
  // broken (e.g. an earlier push stored a truncated file), refuse with an
  // actionable error so the desk re-captures the ID — instead of cloning garbage
  // into a new URL that then exists nowhere else and can never be repaired.
  if (!imageSignatureMatches(bytes, mime)) {
    throw new DomainError('Stored ID image is corrupt — re-capture it', 'corrupt_source', 422);
  }

  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const fileName = `${randomBytes(12).toString('hex')}.${resolved.ext}`;
  const target = secureUploadTarget(year, month, fileName);
  try {
    await mkdir(path.dirname(target.diskPath), { recursive: true });
    await writeFile(target.diskPath, bytes);
  } catch {
    throw new DomainError('Could not copy the stored file', 'storage_error', 502);
  }

  // Best-effort storage accounting (mirrors the upload routes). This runs on the
  // ONLINE node during the proxied reception commit, so there is NO file-push to
  // queue — the clone mirrors DOWN to local via pull + file-sync. The row carries
  // sha256 so that mirror is verified.
  try {
    await prisma.media.create({
      data: { url: target.url, mimeType: mime, sizeBytes: bytes.length, sha256: sha256Hex(bytes), uploadedById },
    });
  } catch (e) {
    log.error('guest-id clone: failed to record Media row', { ...errFields(e) });
  }

  return target.url;
}

/**
 * Best-effort removal of a cloned sensitive file whose booking never committed.
 * Used to undo `cloneSensitiveUpload` when the create transaction rolls back, so
 * a failed/aborted booking can't leak orphaned copies of national-ID / passport
 * images into the private store. Never throws — a leftover file is far less bad
 * than turning cleanup into a second failure. The best-effort Media row is left
 * (harmless bookkeeping; the bytes are what matter for PII/disk).
 */
export async function discardClonedUpload(url: string): Promise<void> {
  try {
    const resolved = resolveSensitiveUpload(url);
    if (resolved) await unlink(resolved.diskPath);
  } catch {
    /* already gone / unreadable — nothing to do */
  }
}

export interface RecordGuestIdInput {
  bookingId: string;
  /** 1-based ADULT guest slot (Guest 1 … Guest adults). */
  guestSeq: number;
  /** Public URL returned by POST /api/reception/upload. */
  imageUrl: string;
  /** Original client filename (display only). */
  fileName: string;
  /** Human label for this guest (reception-entered). */
  guestName?: string | null;
  uploadedById: string;
}

/**
 * Persist (or replace) one guest's ID document. Re-validates everything
 * server-side, then upserts on `[bookingId, guestSeq]` and writes an audit row
 * in the same transaction. Throws typed {@link DomainError}s the action layer
 * maps to friendly messages.
 */
export async function recordGuestId(input: RecordGuestIdInput): Promise<GuestIdDocument> {
  const booking = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    select: { id: true, adults: true, people: true, extraPersons: true, status: true },
  });
  if (!booking) throw new DomainError('Booking not found', 'not_found', 404);

  // ID documents are required for ADULTS (slots 1 … adults) and paid EXTRA PERSONS
  // (slots people+1 … people+extraPersons). Children (adults+1 … people) carry no
  // ID image, so an upload outside those two ranges is out of range.
  const seq = Math.trunc(input.guestSeq);
  const isAdultSlot = seq >= 1 && seq <= booking.adults;
  const isExtraSlot = seq >= booking.people + 1 && seq <= booking.people + booking.extraPersons;
  if (!Number.isFinite(seq) || (!isAdultSlot && !isExtraSlot)) {
    throw new DomainError('Guest number is out of range', 'guest_seq_out_of_range', 400);
  }

  const resolved = resolveSensitiveUpload(input.imageUrl);
  if (!resolved) throw new DomainError('Invalid upload reference', 'invalid_upload', 400);
  const ext = resolved.ext;
  const mime = ALLOWED_EXT[ext];
  if (!mime) {
    throw new DomainError('Only JPG, PNG or WEBP images are accepted', 'unsupported_type', 415);
  }

  // Re-derive the true size from disk — never trust a client-sent byte count.
  const diskPath = resolved.diskPath;
  let sizeBytes: number;
  try {
    const info = await stat(diskPath);
    if (!info.isFile() || info.size === 0) {
      throw new DomainError('Uploaded file is empty or missing', 'empty_file', 400);
    }
    sizeBytes = info.size;
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError('Uploaded file could not be read', 'storage_error', 502);
  }
  if (sizeBytes > MAX_ID_BYTES) {
    throw new DomainError('Image exceeds the 10MB limit', 'too_large', 413);
  }

  const fileName = input.fileName.trim().slice(0, 255) || `guest-${seq}.${ext}`;
  // The reception-entered label is the guest's ID/passport NUMBER (stored in the
  // `guestName` column). It may be typed before OR after the photo upload.
  const guestName = cleanGuestName(input.guestName);

  const doc = await prisma.$transaction(async (tx) => {
    const existing = await tx.guestIdDocument.findUnique({
      where: { bookingId_guestSeq: { bookingId: booking.id, guestSeq: seq } },
      select: { id: true, imageUrl: true },
    });

    const saved = await tx.guestIdDocument.upsert({
      where: { bookingId_guestSeq: { bookingId: booking.id, guestSeq: seq } },
      create: {
        bookingId: booking.id,
        guestSeq: seq,
        guestName,
        fileName,
        fileType: mime,
        fileSizeBytes: sizeBytes,
        storagePath: input.imageUrl, // path under public/ — not served directly
        imageUrl: input.imageUrl,
        uploadedById: input.uploadedById,
        verificationStatus: 'PENDING',
      },
      update: {
        guestName,
        fileName,
        fileType: mime,
        fileSizeBytes: sizeBytes,
        storagePath: input.imageUrl,
        imageUrl: input.imageUrl,
        uploadedById: input.uploadedById,
        verificationStatus: 'PENDING',
      },
    });

    await audit(tx, {
      actorUserId: input.uploadedById,
      action: existing ? 'UPDATE' : 'CREATE',
      entityType: 'GuestIdDocument',
      entityId: saved.id,
      before: existing ? { imageUrl: existing.imageUrl } : undefined,
      after: { bookingId: booking.id, guestSeq: seq, imageUrl: input.imageUrl, fileName },
    });
    await enqueueById(tx, 'GuestIdDocument', saved.id);

    return saved;
  });

  // Blocklist check on the entered ID/passport number (national-id + passport).
  // Runs after the row is persisted so a blocked attempt is recorded; the gate
  // re-enforces at check-in. Only the generic `blocked` code is surfaced.
  if (await isDocumentNumberBlocked(guestName)) {
    throw new DomainError('This guest is blocked', 'blocked', 403);
  }

  return doc;
}

export interface RemoveGuestIdInput {
  bookingId: string;
  guestSeq: number;
  actorId: string;
}

/** Remove a guest's ID document (e.g. wrong photo). Audited. No-op if absent. */
export async function removeGuestId(input: RemoveGuestIdInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.guestIdDocument.findUnique({
      where: { bookingId_guestSeq: { bookingId: input.bookingId, guestSeq: input.guestSeq } },
      select: { id: true, imageUrl: true },
    });
    if (!existing) return;
    await tx.guestIdDocument.delete({ where: { id: existing.id } });
    await audit(tx, {
      actorUserId: input.actorId,
      action: 'DELETE',
      entityType: 'GuestIdDocument',
      entityId: existing.id,
      before: { bookingId: input.bookingId, guestSeq: input.guestSeq, imageUrl: existing.imageUrl },
    });
    await enqueueById(tx, 'GuestIdDocument', existing.id, 'delete');
  });
}

/**
 * Update just the guest's ID/passport NUMBER on an existing ID row (reception
 * types it after uploading the photo). A missing row throws `not_found`.
 *
 * After the number is saved, it is checked against the admin identity blocklist
 * (as both national-id and passport — see {@link isDocumentNumberBlocked}); a
 * blocked guest throws the generic `blocked` code so the action can stop the
 * flow without leaking the block reason / notes / record id. The number is still
 * persisted first so the blocked attempt is recorded for the audit trail.
 */
export async function setGuestIdName(input: {
  bookingId: string;
  guestSeq: number;
  /** The guest's ID-card / passport NUMBER (stored in the `guestName` column). */
  guestName: string | null;
  actorId: string;
}): Promise<void> {
  const guestName = cleanGuestName(input.guestName);
  const seq = Math.trunc(input.guestSeq);
  await prisma.$transaction(async (tx) => {
    const doc = await tx.guestIdDocument.findUnique({
      where: { bookingId_guestSeq: { bookingId: input.bookingId, guestSeq: seq } },
      select: { id: true },
    });
    if (!doc) throw new DomainError('Upload the ID first', 'not_found', 404);
    await tx.guestIdDocument.update({ where: { id: doc.id }, data: { guestName } });
    await audit(tx, {
      actorUserId: input.actorId,
      action: 'UPDATE',
      entityType: 'GuestIdDocument',
      entityId: doc.id,
      // NEVER audit the raw government-ID number — mask to the last 4. The audit
      // log is readable by staff and exported, so the full number must not land
      // there. (`guestName` here is the ID/passport NUMBER, not a person's name.)
      after: { guestIdNumber: maskId(guestName) },
    });
    await enqueueById(tx, 'GuestIdDocument', doc.id);
  });

  // Blocklist check on the entered ID/passport number — reuse the admin block
  // system (national-id + passport). Safe, generic signal only.
  if (await isDocumentNumberBlocked(guestName)) {
    throw new DomainError('This guest is blocked', 'blocked', 403);
  }
}

/** All documents for a booking, ordered by guest slot. */
export function listGuestIds(
  bookingId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  return db.guestIdDocument.findMany({
    where: { bookingId },
    orderBy: { guestSeq: 'asc' },
  });
}

/**
 * Document-collection status for a booking (drives the check-in gate + UI).
 * The required count is adults + paid extra persons — children need no ID image.
 */
export async function getGuestIdStatus(bookingId: string): Promise<GuestIdStatus> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, adults: true, extraPersons: true, _count: { select: { guestIds: true } } },
  });
  if (!booking) throw new DomainError('Booking not found', 'not_found', 404);
  return {
    bookingId: booking.id,
    ...summarizeGuestIds(booking.adults + booking.extraPersons, booking._count.guestIds),
  };
}

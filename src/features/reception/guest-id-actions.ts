'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/server/auth/guards';
import { canAccessReception, canViewGateMoney } from '@/server/auth/roles';
import {
  recordGuestId,
  removeGuestId,
  setGuestIdName,
  getGuestIdStatus,
  type GuestIdStatus,
} from '@/server/services/guest-id';
import { checkInBooking } from '@/server/services/gate-scan';
import { isDocumentNumberBlocked } from '@/server/services/blocklist';
import { DomainError } from '@/server/services/errors';
import { log, errFields } from '@/lib/log';

/**
 * Reception guest-ID server actions. Each action independently re-checks that
 * the caller is reception-authorised (STAFF / admin tiers, never SECURITY) — the
 * UI gating is convenience only. The file upload itself goes through
 * `POST /api/reception/upload` (auth + MIME/size validation); these actions then
 * persist / clear the per-guest document and gate the final check-in.
 */

export type GuestIdActionResult =
  | { ok: true; status: GuestIdStatus }
  | { ok: false; code: string };

const recordSchema = z.object({
  bookingId: z.string().min(1),
  guestSeq: z.number().int().min(1).max(200),
  imageUrl: z.string().trim().min(1).max(2000),
  fileName: z.string().trim().min(1).max(255),
  guestName: z.string().trim().max(80).optional().nullable(),
});

/** Persist (or replace) one guest's uploaded ID image (+ optional name). */
export async function recordGuestIdAction(input: unknown): Promise<GuestIdActionResult> {
  const user = await getSessionUser();
  if (!user || !canAccessReception(user.role)) return { ok: false, code: 'forbidden' };

  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  try {
    await recordGuestId({
      bookingId: parsed.data.bookingId,
      guestSeq: parsed.data.guestSeq,
      imageUrl: parsed.data.imageUrl,
      fileName: parsed.data.fileName,
      guestName: parsed.data.guestName,
      uploadedById: user.id,
    });
    const status = await getGuestIdStatus(parsed.data.bookingId);
    return { ok: true, status };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

const nameSchema = z.object({
  bookingId: z.string().min(1),
  guestSeq: z.number().int().min(1).max(200),
  guestName: z.string().trim().max(80).nullable(),
});

/** Update just a guest's name on an already-uploaded ID (typed after the photo). */
export async function setGuestIdNameAction(input: unknown): Promise<{ ok: boolean; code?: string }> {
  const user = await getSessionUser();
  if (!user || !canAccessReception(user.role)) return { ok: false, code: 'forbidden' };

  const parsed = nameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  try {
    await setGuestIdName({
      bookingId: parsed.data.bookingId,
      guestSeq: parsed.data.guestSeq,
      guestName: parsed.data.guestName,
      actorId: user.id,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

const blockCheckSchema = z.object({
  /** The guest's ID-card / passport NUMBER typed at the desk. */
  number: z.string().trim().min(1).max(80),
});

/**
 * Live blocklist check for a typed ID/passport number — used by the walk-in
 * wizard (deferred commit) where no guest-ID row exists yet to re-check. Gives
 * the desk immediate feedback; the authoritative stop is re-enforced server-side
 * when the booking is created (`createReceptionBooking`) and again at the gate.
 * Tested as BOTH national-id and passport (see `isDocumentNumberBlocked`). A
 * blank/invalid number is treated as not-blocked so the field stays quiet until
 * something checkable is typed. Never leaks the block reason — just a boolean.
 */
export async function checkGuestDocumentBlockedAction(
  input: unknown,
): Promise<{ ok: true; blocked: boolean } | { ok: false; code: string }> {
  const user = await getSessionUser();
  if (!user || !canAccessReception(user.role)) return { ok: false, code: 'forbidden' };

  const parsed = blockCheckSchema.safeParse(input);
  if (!parsed.success) return { ok: true, blocked: false };

  try {
    const blocked = await isDocumentNumberBlocked(parsed.data.number);
    return { ok: true, blocked };
  } catch {
    // Best-effort signal — a hiccup here must not block the desk; the create +
    // gate checks remain the authoritative enforcement.
    return { ok: true, blocked: false };
  }
}

const removeSchema = z.object({
  bookingId: z.string().min(1),
  guestSeq: z.number().int().min(1).max(200),
});

/** Remove a guest's ID document (wrong photo, retake, etc.). */
export async function removeGuestIdAction(input: unknown): Promise<GuestIdActionResult> {
  const user = await getSessionUser();
  if (!user || !canAccessReception(user.role)) return { ok: false, code: 'forbidden' };

  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  try {
    await removeGuestId({
      bookingId: parsed.data.bookingId,
      guestSeq: parsed.data.guestSeq,
      actorId: user.id,
    });
    const status = await getGuestIdStatus(parsed.data.bookingId);
    return { ok: true, status };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

export type CompleteCheckInResult =
  | { ok: true; reference: string; entered: number; remaining: number; total: number }
  | { ok: false; code: string; status?: GuestIdStatus };

const completeSchema = z.object({
  bookingId: z.string().min(1),
  locale: z.enum(['ar', 'en']).default('en'),
  /** How many guests are entering on this admit (clamped server-side). */
  admitCount: z.number().int().min(1).max(500).optional(),
  /** Specific guests (by ID slot) entering on this admit — chosen by photo. */
  admitGuestSeqs: z.array(z.number().int().min(1).max(500)).max(500).optional(),
});

/**
 * Complete check-in for a booking. The authoritative guest-ID gate lives in
 * `checkInBooking`, so a partial upload throws `guest_id_required` and we return
 * the current status for the UI to highlight the missing slots.
 */
export async function completeCheckInAction(input: unknown): Promise<CompleteCheckInResult> {
  const user = await getSessionUser();
  if (!user || !canAccessReception(user.role)) return { ok: false, code: 'forbidden' };

  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  try {
    const pass = await checkInBooking({
      bookingId: parsed.data.bookingId,
      staffUserId: user.id,
      locale: parsed.data.locale,
      includeMoney: canViewGateMoney(user.role),
      admitCount: parsed.data.admitCount,
      admitGuestSeqs: parsed.data.admitGuestSeqs,
    });
    revalidatePath(`/${parsed.data.locale}/gate/reception/checkin/${parsed.data.bookingId}`);
    return {
      ok: true,
      reference: pass.invoice,
      entered: pass.enteredCount,
      remaining: pass.remaining,
      total: pass.guests,
    };
  } catch (err) {
    if (err instanceof DomainError) {
      // Surface the live status so the UI can point at the unfilled slots.
      let status: GuestIdStatus | undefined;
      try {
        status = await getGuestIdStatus(parsed.data.bookingId);
      } catch {
        /* ignore — best-effort enrichment */
      }
      return { ok: false, code: err.code, status };
    }
    // A non-DomainError is a real fault (DB constraint, FK, etc.) — the UI can
    // only show the generic "something went wrong", so LOG it here or it is
    // completely invisible (this is exactly how the extra-persons check-in
    // constraint bug hid for so long).
    log.error('completeCheckIn unexpected error', errFields(err));
    return { ok: false, code: 'unknown' };
  }
}

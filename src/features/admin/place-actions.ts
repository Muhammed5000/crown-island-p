'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/server/auth/guards';
import {
  adminCreatePlace,
  adminUpdatePlace,
  adminDeletePlace,
  adminBulkDeletePlaces,
  adminBulkAddPlaces,
  adminMovePlace,
  adminSetPlaceActive,
  adminSetPlaceHandicap,
  adminSetPlaceZkLevel,
  adminCreatePlaceOutage,
  adminDeletePlaceOutage,
} from '@/server/services/admin-places';
import { DomainError } from '@/server/services/errors';

/**
 * Admin server actions for the per-service place inventory. Every action
 * re-checks admin auth on the server, validates with Zod, and converts domain
 * errors into discriminated-union results for the UI.
 */

const placeTypes = ['CABIN', 'CABANA', 'UMBRELLA', 'SEAT', 'SPOT'] as const;

const placeSchema = z.object({
  label: z.string().trim().min(1).max(40),
  type: z.enum(placeTypes),
  zone: z.string().trim().max(60).optional().nullable(),
  position: z.coerce.number().int().min(0).default(0),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().optional(),
  isHandicap: z.boolean().optional(),
  // ZKBio access-level group id that opens this place's door (blank = none).
  zkAccessLevelId: z.string().trim().max(120).optional().nullable(),
  zkDoorLabel: z.string().trim().max(80).optional().nullable(),
});

export type PlaceActionResult = { ok: true } | { ok: false; code: string };

export async function createPlaceAction(
  serviceId: string,
  formData: FormData,
): Promise<PlaceActionResult> {
  const admin = await requireAdmin();
  const parsed = placeSchema.safeParse({
    label: formData.get('label'),
    type: formData.get('type'),
    zone: (formData.get('zone') as string | null)?.trim() || null,
    position: formData.get('position') ?? 0,
    sortOrder: formData.get('sortOrder') ?? 0,
    isActive: formData.get('isActive') !== 'off',
    isHandicap: formData.get('isHandicap') === 'on',
    zkAccessLevelId: (formData.get('zkAccessLevelId') as string | null)?.trim() || null,
    zkDoorLabel: (formData.get('zkDoorLabel') as string | null)?.trim() || null,
  });
  if (!parsed.success) return { ok: false, code: 'invalid_input' };
  try {
    await adminCreatePlace(serviceId, parsed.data, admin.id);
    revalidatePath(`/admin/services/${serviceId}/places`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

export async function updatePlaceAction(
  serviceId: string,
  placeId: string,
  formData: FormData,
): Promise<PlaceActionResult> {
  const admin = await requireAdmin();
  const parsed = placeSchema.safeParse({
    label: formData.get('label'),
    type: formData.get('type'),
    zone: (formData.get('zone') as string | null)?.trim() || null,
    position: formData.get('position') ?? 0,
    sortOrder: formData.get('sortOrder') ?? 0,
    isActive: formData.get('isActive') !== 'off',
    zkAccessLevelId: (formData.get('zkAccessLevelId') as string | null)?.trim() || null,
    zkDoorLabel: (formData.get('zkDoorLabel') as string | null)?.trim() || null,
  });
  if (!parsed.success) return { ok: false, code: 'invalid_input' };
  try {
    await adminUpdatePlace(placeId, parsed.data, admin.id);
    revalidatePath(`/admin/services/${serviceId}/places`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

export async function deletePlaceAction(input: {
  serviceId: string;
  placeId: string;
}): Promise<PlaceActionResult> {
  const admin = await requireAdmin();
  try {
    await adminDeletePlace(input.placeId, admin.id);
    revalidatePath(`/admin/services/${input.serviceId}/places`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

export type BulkDeleteResult =
  | { ok: true; deleted: number; skippedInUse: number }
  | { ok: false; code: string };

const bulkDeleteSchema = z.object({
  serviceId: z.string().min(1),
  /** Specific place ids, or 'all' to clear the whole inventory. */
  placeIds: z.union([z.literal('all'), z.array(z.string().min(1)).min(1).max(1000)]),
});

/**
 * Remove many places at once (or every place of the service). Places that are
 * (or were) assigned to a booking are skipped, never deleted — the result
 * reports both counts so the UI can say "removed X · kept Y (in use)".
 */
export async function bulkDeletePlacesAction(input: unknown): Promise<BulkDeleteResult> {
  const admin = await requireAdmin();
  const parsed = bulkDeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };
  try {
    const res = await adminBulkDeletePlaces(parsed.data.serviceId, parsed.data.placeIds, admin.id);
    revalidatePath(`/admin/services/${parsed.data.serviceId}/places`);
    return { ok: true, ...res };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

const moveSchema = z.object({
  serviceId: z.string().min(1),
  placeId: z.string().min(1),
  gridX: z.coerce.number().int().min(0).max(200),
  gridY: z.coerce.number().int().min(0).max(200),
});

/** Persist a place's layout coordinates after an admin drags it on the map. */
export async function movePlaceAction(input: unknown): Promise<PlaceActionResult> {
  const admin = await requireAdmin();
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };
  try {
    await adminMovePlace(parsed.data.serviceId, parsed.data.placeId, parsed.data.gridX, parsed.data.gridY, admin.id);
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

const bulkSchema = z.object({
  type: z.enum(placeTypes),
  zone: z.string().trim().max(60).optional().nullable(),
  prefix: z.string().trim().max(20),
  from: z.coerce.number().int().min(0),
  to: z.coerce.number().int().min(0),
  isHandicap: z.boolean().optional(),
});

export async function bulkAddPlacesAction(
  serviceId: string,
  formData: FormData,
): Promise<PlaceActionResult> {
  const admin = await requireAdmin();
  const parsed = bulkSchema.safeParse({
    type: formData.get('type'),
    zone: (formData.get('zone') as string | null)?.trim() || null,
    prefix: formData.get('prefix') ?? '',
    from: formData.get('from') ?? 1,
    to: formData.get('to') ?? 1,
    isHandicap: formData.get('isHandicap') === 'on',
  });
  if (!parsed.success) return { ok: false, code: 'invalid_input' };
  try {
    await adminBulkAddPlaces(serviceId, parsed.data, admin.id);
    revalidatePath(`/admin/services/${serviceId}/places`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

/** Quick online/offline toggle for a single place. */
export async function setPlaceActiveAction(input: {
  serviceId: string;
  placeId: string;
  isActive: boolean;
}): Promise<PlaceActionResult> {
  const admin = await requireAdmin();
  try {
    await adminSetPlaceActive(input.placeId, !!input.isActive, admin.id);
    revalidatePath(`/admin/services/${input.serviceId}/places`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

/** Mark / unmark a single place as an accessibility (handicap) cell. */
export async function setPlaceHandicapAction(input: {
  serviceId: string;
  placeId: string;
  isHandicap: boolean;
}): Promise<PlaceActionResult> {
  const admin = await requireAdmin();
  try {
    await adminSetPlaceHandicap(input.placeId, !!input.isHandicap, admin.id);
    revalidatePath(`/admin/services/${input.serviceId}/places`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

const zkLevelSchema = z.object({
  serviceId: z.string().min(1),
  placeId: z.string().min(1),
  zkAccessLevelId: z.string().trim().max(120).nullable(),
  zkDoorLabel: z.string().trim().max(80).nullable(),
});

/** Set (or clear) a single place's ZKBio door access-level id. */
export async function setPlaceZkLevelAction(input: unknown): Promise<PlaceActionResult> {
  const admin = await requireAdmin();
  const parsed = zkLevelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };
  try {
    await adminSetPlaceZkLevel(
      parsed.data.placeId,
      parsed.data.zkAccessLevelId || null,
      parsed.data.zkDoorLabel || null,
      admin.id,
    );
    revalidatePath(`/admin/services/${parsed.data.serviceId}/places`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

const outageSchema = z.object({
  serviceId: z.string().min(1),
  placeId: z.string().min(1),
  // ISO datetime-local strings from the form, parsed to Date.
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  reason: z.string().trim().max(200).optional().nullable(),
});

/** Schedule an out-of-service window for a place. */
export async function createPlaceOutageAction(input: unknown): Promise<PlaceActionResult> {
  const admin = await requireAdmin();
  const parsed = outageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };
  try {
    await adminCreatePlaceOutage(
      {
        placeId: parsed.data.placeId,
        startsAt: parsed.data.startsAt,
        endsAt: parsed.data.endsAt,
        reason: parsed.data.reason ?? null,
      },
      admin.id,
    );
    revalidatePath(`/admin/services/${parsed.data.serviceId}/places`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

/** Cancel a scheduled / active out-of-service window. */
export async function deletePlaceOutageAction(input: {
  serviceId: string;
  outageId: string;
}): Promise<PlaceActionResult> {
  const admin = await requireAdmin();
  try {
    await adminDeletePlaceOutage(input.outageId, admin.id);
    revalidatePath(`/admin/services/${input.serviceId}/places`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { RestaurantStatus } from '@prisma/client';
import { requireAdmin } from '@/server/auth/guards';
import {
  adminDeleteRestaurant,
  adminSetRestaurantStatus,
} from '@/server/services/restaurants';
import { DomainError } from '@/server/services/errors';
import { log, errFields } from '@/lib/log';

export type RestaurantAdminActionResult = { ok: false; code: string } | { ok: true };

const statusSchema = z.object({
  status: z.nativeEnum(RestaurantStatus),
  note: z.string().trim().max(500).optional().default(''),
});

function revalidateRestaurantViews(id?: string) {
  revalidatePath('/admin/restaurants');
  if (id) revalidatePath(`/admin/restaurants/${id}`);
  revalidatePath('/menu');
  revalidatePath('/menu/manage');
}

/** Approve / reject / disable / re-queue a restaurant profile. */
export async function setRestaurantStatusAction(
  id: string,
  formData: FormData,
): Promise<RestaurantAdminActionResult> {
  const admin = await requireAdmin();

  const parsed = statusSchema.safeParse({
    status: formData.get('status'),
    note: typeof formData.get('note') === 'string' ? formData.get('note') : '',
  });
  if (!parsed.success || typeof id !== 'string' || !id) {
    return { ok: false, code: 'invalid_input' };
  }

  try {
    await adminSetRestaurantStatus(id, parsed.data.status, parsed.data.note || null, admin.id);
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    log.error('setRestaurantStatusAction failed', errFields(err));
    return { ok: false, code: 'unknown' };
  }

  revalidateRestaurantViews(id);
  return { ok: true };
}

export async function deleteRestaurantAction(id: string): Promise<RestaurantAdminActionResult> {
  const admin = await requireAdmin();
  if (typeof id !== 'string' || !id) return { ok: false, code: 'invalid_input' };

  try {
    await adminDeleteRestaurant(id, admin.id);
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    log.error('deleteRestaurantAction failed', errFields(err));
    return { ok: false, code: 'unknown' };
  }

  revalidateRestaurantViews();
  return { ok: true };
}

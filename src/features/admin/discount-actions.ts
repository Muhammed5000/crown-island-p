'use server';

import { revalidatePath } from 'next/cache';
import type { UserRole } from '@prisma/client';
import { requireAdmin } from '@/server/auth/guards';
import { DISCOUNT_LADDER_ROLES, setRoleDiscountLimit, setStaffPin } from '@/server/services/staff-discount';
import { DomainError } from '@/server/services/errors';

export type DiscountActionResult = { ok: false; code: string } | { ok: true };

/** Save all four reception-ladder discount ceilings in one submit. */
export async function setRoleLimitsAction(formData: FormData): Promise<DiscountActionResult> {
  const admin = await requireAdmin();
  try {
    for (const role of DISCOUNT_LADDER_ROLES) {
      const raw = formData.get(`percent_${role}`);
      if (typeof raw !== 'string') continue;
      const pct = parseInt(raw, 10);
      if (Number.isNaN(pct)) continue;
      await setRoleDiscountLimit(role as UserRole, pct, admin.id);
    }
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
  revalidatePath('/admin/discounts');
  return { ok: true };
}

/** Set or clear a staff member's desk override PIN. */
export async function setStaffPinAction(userId: string, pin: string | null): Promise<DiscountActionResult> {
  const admin = await requireAdmin();
  try {
    const value = pin && pin.trim() ? pin.trim() : null;
    await setStaffPin(userId, value, admin.id);
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
  revalidatePath(`/admin/users/${userId}/edit`);
  return { ok: true };
}

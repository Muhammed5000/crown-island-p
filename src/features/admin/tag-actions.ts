'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireAdmin } from '@/server/auth/guards';
import {
  adminCreateTag,
  adminDeleteTag,
  assignTagToCustomer,
  unassignTagFromCustomer,
} from '@/server/services/admin-tags';
import { DomainError } from '@/server/services/errors';

export type TagActionResult = { ok: false; code: string } | { ok: true };

const createSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().trim().min(1).max(20),
});

export async function createTagAction(formData: FormData): Promise<TagActionResult | void> {
  const admin = await requireAdmin();
  const parsed = createSchema.safeParse({ name: formData.get('name'), color: formData.get('color') });
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  try {
    await adminCreateTag(parsed.data.name, parsed.data.color, admin.id);
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
  revalidatePath('/admin/tags');
  redirect('/admin/tags');
}

export async function deleteTagAction(id: string): Promise<TagActionResult> {
  const admin = await requireAdmin();
  try {
    await adminDeleteTag(id, admin.id);
    revalidatePath('/admin/tags');
    revalidatePath('/admin/customers');
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

export async function assignTagAction(userId: string, tagId: string): Promise<TagActionResult> {
  const admin = await requireAdmin();
  try {
    await assignTagToCustomer(userId, tagId, admin.id);
    revalidatePath(`/admin/customers/${userId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

export async function unassignTagAction(userId: string, tagId: string): Promise<TagActionResult> {
  const admin = await requireAdmin();
  try {
    await unassignTagFromCustomer(userId, tagId, admin.id);
    revalidatePath(`/admin/customers/${userId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

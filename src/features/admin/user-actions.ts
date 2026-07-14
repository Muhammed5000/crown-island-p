'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireSuperAdmin, requireAdmin } from '@/server/auth/guards';
import {
  adminCreateUser,
  adminUpdateUser,
  adminDeleteUser,
  adminBlockUser,
  adminUnblockUser,
} from '@/server/services/admin-users';
import { DomainError } from '@/server/services/errors';
import { UserRole } from '@prisma/client';

const userSchema = z.object({
  name: z.string().trim().min(1).max(120).nullish(),
  email: z.string().trim().email().max(254).nullish().or(z.literal('')),
  phone: z.string().trim().max(40).nullish().or(z.literal('')),
  role: z.nativeEnum(UserRole),
  password: z.string().min(8).max(100).nullish().or(z.literal('')),
});

export type UserActionResult = {
  ok: false;
  code: string;
  fields?: Record<string, string[]>;
} | { ok: true };

function readString(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

export async function createUserAction(formData: FormData): Promise<UserActionResult | void> {
  const admin = await requireSuperAdmin();

  const data = {
    name: readString(formData, 'name'),
    email: readString(formData, 'email'),
    phone: readString(formData, 'phone'),
    role: formData.get('role') as UserRole,
    password: readString(formData, 'password'),
  };

  const parsed = userSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, code: 'invalid_input', fields: parsed.error.flatten().fieldErrors };
  }

  try {
    await adminCreateUser(parsed.data, admin.id);
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }

  revalidatePath('/admin/users');
  redirect('/admin/users');
}

export async function updateUserAction(id: string, formData: FormData): Promise<UserActionResult | void> {
  const admin = await requireSuperAdmin();

  const data = {
    name: readString(formData, 'name'),
    email: readString(formData, 'email'),
    phone: readString(formData, 'phone'),
    role: formData.get('role') as UserRole,
    password: readString(formData, 'password'),
  };

  const parsed = userSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, code: 'invalid_input', fields: parsed.error.flatten().fieldErrors };
  }

  try {
    await adminUpdateUser(id, parsed.data, admin.id);
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }

  revalidatePath('/admin/users');
  redirect('/admin/users');
}

export async function deleteUserAction(id: string): Promise<UserActionResult> {
  const admin = await requireSuperAdmin();

  try {
    await adminDeleteUser(id, admin.id);
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

/** Ban a customer: blocks the account + blocklists their identifiers. */
export async function blockUserAction(id: string, reason: string | null): Promise<UserActionResult> {
  const admin = await requireAdmin();
  try {
    await adminBlockUser(id, reason, admin.id);
    revalidatePath(`/admin/customers/${id}`);
    revalidatePath('/admin/customers');
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

/** Lift a customer's ban. */
export async function unblockUserAction(id: string): Promise<UserActionResult> {
  const admin = await requireAdmin();
  try {
    await adminUnblockUser(id, admin.id);
    revalidatePath(`/admin/customers/${id}`);
    revalidatePath('/admin/customers');
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

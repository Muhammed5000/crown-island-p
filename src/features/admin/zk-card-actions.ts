'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/auth/guards';
import {
  adminAddZkCards,
  adminSetZkCardActive,
  adminDeleteZkCard,
} from '@/server/services/admin-zk-cards';
import { DomainError } from '@/server/services/errors';

/**
 * Admin server actions for the ZK card pool. Each re-checks admin auth, then maps
 * domain errors to a discriminated-union result for the UI.
 */

export type ZkCardActionResult =
  | { ok: true; added?: number; attempted?: number }
  | { ok: false; code: string };

export async function addZkCardsAction(formData: FormData): Promise<ZkCardActionResult> {
  const admin = await requireAdmin();
  const raw = String(formData.get('cardNos') ?? '');
  const label = String(formData.get('label') ?? '').trim() || null;
  // Accept whitespace / comma / semicolon separated numbers.
  const cardNos = raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  if (cardNos.length === 0) return { ok: false, code: 'no_cards' };
  if (cardNos.length > 2000) return { ok: false, code: 'too_many' };

  try {
    const res = await adminAddZkCards({ cardNos, label }, admin.id);
    revalidatePath('/admin/zk-cards');
    return { ok: true, added: res.added, attempted: res.attempted };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

export async function setZkCardActiveAction(input: {
  id: string;
  isActive: boolean;
}): Promise<ZkCardActionResult> {
  const admin = await requireAdmin();
  try {
    await adminSetZkCardActive(input.id, !!input.isActive, admin.id);
    revalidatePath('/admin/zk-cards');
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

export async function deleteZkCardAction(input: { id: string }): Promise<ZkCardActionResult> {
  const admin = await requireAdmin();
  try {
    await adminDeleteZkCard(input.id, admin.id);
    revalidatePath('/admin/zk-cards');
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

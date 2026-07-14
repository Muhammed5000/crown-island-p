'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { SanctionStatus } from '@prisma/client';
import { requireAdmin } from '@/server/auth/guards';
import {
  adminCreateSanction,
  adminSetSanctionStatus,
  adminUpdateSanction,
} from '@/server/services/sanctions';
import { SANCTION_MAX_CENTS } from '@/server/services/sanctions-core';
import { DomainError } from '@/server/services/errors';
import { log, errFields } from '@/lib/log';

/**
 * Admin sanction actions. The actor always comes from the session
 * (`requireAdmin`), never from the form; amounts arrive in whole EGP from the
 * UI and are converted to piastres here so currency precision is exact.
 */

export type SanctionActionResult = { ok: false; code: string } | { ok: true };

const amountSchema = z.coerce
  .number()
  .positive()
  .max(SANCTION_MAX_CENTS / 100)
  // Whole-piastre precision: at most 2 decimal places of EGP survive.
  .transform((egp) => Math.round(egp * 100));

const createSchema = z.object({
  userId: z.string().min(1),
  amount: amountSchema,
  reason: z.string().trim().min(3).max(500),
  notes: z.string().trim().max(1000).optional().default(''),
});

const updateSchema = createSchema.omit({ userId: true });

const settleSchema = z.object({
  status: z.nativeEnum(SanctionStatus),
  note: z.string().trim().max(1000).optional().default(''),
});

function revalidateSanctionViews(userId?: string) {
  revalidatePath('/admin/sanctions');
  revalidatePath('/admin/customers');
  if (userId) revalidatePath(`/admin/customers/${userId}`);
}

export async function createSanctionAction(formData: FormData): Promise<SanctionActionResult> {
  const admin = await requireAdmin();

  const parsed = createSchema.safeParse({
    userId: formData.get('userId'),
    amount: formData.get('amount'),
    reason: formData.get('reason'),
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  try {
    await adminCreateSanction(
      {
        userId: parsed.data.userId,
        amountCents: parsed.data.amount,
        reason: parsed.data.reason,
        notes: parsed.data.notes || null,
      },
      admin.id,
    );
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    log.error('createSanctionAction failed', errFields(err));
    return { ok: false, code: 'unknown' };
  }

  revalidateSanctionViews(parsed.data.userId);
  return { ok: true };
}

export async function updateSanctionAction(
  id: string,
  formData: FormData,
): Promise<SanctionActionResult> {
  const admin = await requireAdmin();
  if (typeof id !== 'string' || !id) return { ok: false, code: 'invalid_input' };

  const parsed = updateSchema.safeParse({
    amount: formData.get('amount'),
    reason: formData.get('reason'),
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  try {
    const updated = await adminUpdateSanction(
      id,
      {
        amountCents: parsed.data.amount,
        reason: parsed.data.reason,
        notes: parsed.data.notes || null,
      },
      admin.id,
    );
    revalidateSanctionViews(updated.userId);
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    log.error('updateSanctionAction failed', errFields(err));
    return { ok: false, code: 'unknown' };
  }
}

/** ACTIVE → PAID (settled outside a booking) / WAIVED / CANCELLED. */
export async function settleSanctionAction(
  id: string,
  formData: FormData,
): Promise<SanctionActionResult> {
  const admin = await requireAdmin();
  if (typeof id !== 'string' || !id) return { ok: false, code: 'invalid_input' };

  const parsed = settleSchema.safeParse({
    status: formData.get('status'),
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  try {
    const updated = await adminSetSanctionStatus(
      id,
      parsed.data.status,
      parsed.data.note || null,
      admin.id,
    );
    revalidateSanctionViews(updated.userId);
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    log.error('settleSanctionAction failed', errFields(err));
    return { ok: false, code: 'unknown' };
  }
}

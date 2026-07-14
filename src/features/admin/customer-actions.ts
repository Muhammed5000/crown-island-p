'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/server/auth/guards';
import { canAccessAdmin } from '@/server/auth/roles';
import { adminUpdateCustomerNotes } from '@/server/services/admin-customers';
import { DomainError } from '@/server/services/errors';

export type CustomerNotesResult = { ok: true } | { ok: false; code: string };

const schema = z.object({
  userId: z.string().min(1),
  notes: z.string().trim().max(4000).optional().nullable(),
  adminNotes: z.string().trim().max(4000).optional().nullable(),
  locale: z.enum(['ar', 'en']).default('en'),
});

/** Save customer-facing + internal admin notes on a customer profile. Audited. */
export async function updateCustomerNotesAction(input: unknown): Promise<CustomerNotesResult> {
  const user = await getSessionUser();
  if (!user || !canAccessAdmin(user.role)) return { ok: false, code: 'forbidden' };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_input' };

  try {
    await adminUpdateCustomerNotes(
      parsed.data.userId,
      { notes: parsed.data.notes ?? null, adminNotes: parsed.data.adminNotes ?? null },
      user.id,
    );
    revalidatePath(`/${parsed.data.locale}/admin/customers/${parsed.data.userId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

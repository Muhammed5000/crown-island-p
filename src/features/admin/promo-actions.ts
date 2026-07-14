'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireAdmin } from '@/server/auth/guards';
import { adminCreatePromo, adminTogglePromo, adminDeletePromo } from '@/server/services/admin-promos';
import { DomainError } from '@/server/services/errors';

export type PromoActionResult = { ok: false; code: string; fields?: Record<string, string[]> } | { ok: true };

const createSchema = z.object({
  code: z.string().trim().min(2).max(40),
  description: z.string().trim().max(200).nullish().or(z.literal('')),
  percentOff: z.coerce.number().int().min(1).max(100),
  maxRedemptions: z.coerce.number().int().min(1).nullish().or(z.literal('')),
  startsAt: z.string().trim().nullish().or(z.literal('')),
  endsAt: z.string().trim().nullish().or(z.literal('')),
});

/** Parse a `<input type="date">` value (yyyy-mm-dd) to a UTC Date, or null. */
function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function createPromoAction(formData: FormData): Promise<PromoActionResult | void> {
  const admin = await requireAdmin();

  const parsed = createSchema.safeParse({
    code: formData.get('code'),
    description: formData.get('description'),
    percentOff: formData.get('percentOff'),
    maxRedemptions: formData.get('maxRedemptions') || null,
    startsAt: formData.get('startsAt'),
    endsAt: formData.get('endsAt'),
  });
  if (!parsed.success) {
    return { ok: false, code: 'invalid_input', fields: parsed.error.flatten().fieldErrors };
  }

  try {
    await adminCreatePromo(
      {
        code: parsed.data.code,
        description: parsed.data.description || null,
        percentOff: parsed.data.percentOff,
        maxRedemptions: typeof parsed.data.maxRedemptions === 'number' ? parsed.data.maxRedemptions : null,
        startsAt: parseDate(parsed.data.startsAt),
        endsAt: parseDate(parsed.data.endsAt),
        // Unchecked checkbox is absent from FormData → unlimited reuse; checked → once.
        oncePerCustomer: formData.get('oncePerCustomer') != null,
      },
      admin.id,
    );
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }

  revalidatePath('/admin/promos');
  redirect('/admin/promos');
}

export async function togglePromoAction(id: string): Promise<PromoActionResult> {
  const admin = await requireAdmin();
  try {
    await adminTogglePromo(id, admin.id);
    revalidatePath('/admin/promos');
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

export async function deletePromoAction(id: string): Promise<PromoActionResult> {
  const admin = await requireAdmin();
  try {
    await adminDeletePromo(id, admin.id);
    revalidatePath('/admin/promos');
    return { ok: true };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    return { ok: false, code: 'unknown' };
  }
}

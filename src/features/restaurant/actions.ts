'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { isValidPhoneNumber, parsePhoneNumberFromString } from 'libphonenumber-js';
import { requireRestaurantOwner } from '@/server/auth/guards';
import { upsertMyRestaurant } from '@/server/services/restaurants';
import { DomainError } from '@/server/services/errors';
import { validateSocialUrl, validateWebsiteUrl, type SocialPlatform } from '@/lib/safe-url';
import { log, errFields } from '@/lib/log';

/**
 * Restaurant-partner server actions (`/menu/manage`).
 *
 * Security model:
 *  - `requireRestaurantOwner()` re-checks the session role on EVERY call — the
 *    UI hiding the form is never the authorization boundary.
 *  - the owner id comes from the session, never from the form (no way to
 *    write someone else's profile), and `status` is not a form field at all.
 *  - social/website links pass the strict allow-list parser in
 *    `src/lib/safe-url.ts`; only the normalised URL is stored.
 *  - cover / menu references must be `/uploads/…` paths from our own uploader.
 */

export type RestaurantActionResult =
  | { ok: false; code: string; fields?: Record<string, string> }
  | { ok: true };

/** Accepts only paths produced by `/api/restaurant/upload`. */
const uploadPath = (kind: 'image' | 'pdf') =>
  z
    .string()
    .trim()
    .max(300)
    .refine(
      (v) =>
        /^\/uploads\/[a-z0-9/._-]+$/i.test(v) &&
        !v.includes('..') &&
        (kind === 'image' || v.toLowerCase().endsWith('.pdf')),
      { message: kind === 'pdf' ? 'menu_not_pdf' : 'invalid_upload' },
    );

const profileSchema = z.object({
  name: z.string().trim().min(2, 'name_short').max(80, 'name_long'),
  description: z.string().trim().max(2000, 'description_long').optional().default(''),
  phone: z.string().trim().min(6, 'invalid_phone').max(20, 'invalid_phone'),
  address: z.string().trim().max(200, 'address_long').optional().default(''),
  openingHours: z.string().trim().max(120, 'hours_long').optional().default(''),
  facebookUrl: z.string().trim().max(300).optional().default(''),
  instagramUrl: z.string().trim().max(300).optional().default(''),
  tiktokUrl: z.string().trim().max(300).optional().default(''),
  websiteUrl: z.string().trim().max(300).optional().default(''),
  coverUrl: uploadPath('image').optional().or(z.literal('')).default(''),
  menuPdfUrl: uploadPath('pdf').optional().or(z.literal('')).default(''),
  menuPdfName: z.string().trim().max(150).optional().default(''),
  menuPdfSize: z.coerce.number().int().min(0).max(20_000_000).optional().nullable(),
});

const SOCIAL_FIELDS: ReadonlyArray<{ field: string; platform: SocialPlatform }> = [
  { field: 'facebookUrl', platform: 'facebook' },
  { field: 'instagramUrl', platform: 'instagram' },
  { field: 'tiktokUrl', platform: 'tiktok' },
];

function readString(formData: FormData, key: string): string {
  const raw = formData.get(key);
  return typeof raw === 'string' ? raw : '';
}

/**
 * Strip path separators and control characters from the display filename so
 * it can never read as a path; the real storage name is server-random anyway.
 */
function sanitizeDisplayFileName(raw: string): string | null {
  const cleaned = raw
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || null;
}

export async function saveMyRestaurantAction(
  formData: FormData,
): Promise<RestaurantActionResult> {
  const owner = await requireRestaurantOwner();

  const parsed = profileSchema.safeParse({
    name: readString(formData, 'name'),
    description: readString(formData, 'description'),
    phone: readString(formData, 'phone'),
    address: readString(formData, 'address'),
    openingHours: readString(formData, 'openingHours'),
    facebookUrl: readString(formData, 'facebookUrl'),
    instagramUrl: readString(formData, 'instagramUrl'),
    tiktokUrl: readString(formData, 'tiktokUrl'),
    websiteUrl: readString(formData, 'websiteUrl'),
    coverUrl: readString(formData, 'coverUrl'),
    menuPdfUrl: readString(formData, 'menuPdfUrl'),
    menuPdfName: readString(formData, 'menuPdfName'),
    menuPdfSize: readString(formData, 'menuPdfSize') || null,
  });

  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      if (!(key in fields)) fields[key] = issue.message;
    }
    return { ok: false, code: 'invalid_input', fields };
  }

  const data = parsed.data;
  const fields: Record<string, string> = {};

  // Phone: parse + validate against Egypt as the default region (matches the
  // customer-profile convention), store the unambiguous E.164 form.
  const phoneOk = isValidPhoneNumber(data.phone, 'EG') || isValidPhoneNumber(data.phone);
  const parsedPhone = phoneOk ? parsePhoneNumberFromString(data.phone, 'EG') : undefined;
  if (!parsedPhone) fields.phone = 'invalid_phone';

  // Social links: optional, but when present they must parse AND land on the
  // platform's real domain. We store the normalised form, never the raw input.
  const normalizedSocials: Record<string, string | null> = {};
  for (const { field, platform } of SOCIAL_FIELDS) {
    const raw = (data as Record<string, unknown>)[field] as string;
    if (!raw) {
      normalizedSocials[field] = null;
      continue;
    }
    const result = validateSocialUrl(raw, platform);
    if (!result.ok) {
      fields[field] = result.code === 'wrong_domain' ? `wrong_domain_${platform}` : result.code;
      continue;
    }
    normalizedSocials[field] = result.url;
  }

  let websiteUrl: string | null = null;
  if (data.websiteUrl) {
    const result = validateWebsiteUrl(data.websiteUrl);
    if (!result.ok) fields.websiteUrl = result.code;
    else websiteUrl = result.url;
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, code: 'invalid_input', fields };
  }

  try {
    await upsertMyRestaurant(owner.id, {
      name: data.name,
      description: data.description || null,
      phone: parsedPhone!.number, // E.164
      address: data.address || null,
      openingHours: data.openingHours || null,
      facebookUrl: normalizedSocials.facebookUrl ?? null,
      instagramUrl: normalizedSocials.instagramUrl ?? null,
      tiktokUrl: normalizedSocials.tiktokUrl ?? null,
      websiteUrl,
      coverUrl: data.coverUrl || null,
      menuPdfUrl: data.menuPdfUrl || null,
      menuPdfName: data.menuPdfUrl ? sanitizeDisplayFileName(data.menuPdfName) : null,
      menuPdfSize: data.menuPdfUrl ? (data.menuPdfSize ?? null) : null,
    });
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    log.error('saveMyRestaurantAction failed', errFields(err));
    return { ok: false, code: 'unknown' };
  }

  revalidatePath('/menu');
  revalidatePath('/menu/manage');
  revalidatePath('/admin/restaurants');
  return { ok: true };
}

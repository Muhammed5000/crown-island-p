'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/server/auth/guards';
import { mediaUrl } from '@/lib/media-url';
import {
  updateSettings,
  updateTerms,
  updateRefundPolicy,
  updateRefundTiers,
  type SettingsInput,
} from '@/server/settings/settings';
import { log, errFields } from '@/lib/log';

// ... (existing schemas and settings code)

const termsSchema = z.object({
  termsEn: z.string().trim().min(1),
  termsAr: z.string().trim().min(1),
});

export async function updateTermsAction(
  formData: FormData,
): Promise<UpdateSettingsResult> {
  const admin = await requireAdmin();

  const raw = {
    termsEn: String(formData.get('termsEn') ?? ''),
    termsAr: String(formData.get('termsAr') ?? ''),
  };

  const parsed = termsSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid_input',
      fields: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await updateTerms(parsed.data, admin.id);
  } catch (err) {
    log.error('updateTerms failed', errFields(err));
    return { ok: false, code: 'save_failed' };
  }
  revalidatePath('/admin/terms');
  return { ok: true };
}

const refundPolicySchema = z.object({
  refundPolicyEn: z.string().trim().min(1),
  refundPolicyAr: z.string().trim().min(1),
});

export async function updateRefundPolicyAction(
  formData: FormData,
): Promise<UpdateSettingsResult> {
  const admin = await requireAdmin();

  const raw = {
    refundPolicyEn: String(formData.get('refundPolicyEn') ?? ''),
    refundPolicyAr: String(formData.get('refundPolicyAr') ?? ''),
  };

  const parsed = refundPolicySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid_input',
      fields: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await updateRefundPolicy(parsed.data, admin.id);
  } catch (err) {
    log.error('updateRefundPolicy failed', errFields(err));
    return { ok: false, code: 'save_failed' };
  }
  revalidatePath('/admin/refund-policy');
  return { ok: true };
}

/**
 * Refund tier schedule. Validated hard so an admin can't persist a nonsensical
 * schedule that would mis-charge real refunds:
 *  - each band: integer hours 0..1y, integer percent 0..100
 *  - thresholds are unique
 *  - MONOTONIC: refund % must not increase as the lead time shrinks (i.e. you
 *    can't offer MORE money for cancelling closer to the visit)
 */
const refundTierSchema = z.object({
  minHoursBeforeStart: z.number().int().min(0).max(24 * 365),
  refundPercent: z.number().int().min(0).max(100),
});
const refundTiersSchema = z
  .array(refundTierSchema)
  .min(1)
  .max(12)
  .superRefine((tiers, ctx) => {
    const seen = new Set<number>();
    for (const t of tiers) {
      if (seen.has(t.minHoursBeforeStart)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate_threshold' });
      }
      seen.add(t.minHoursBeforeStart);
    }
    const sorted = [...tiers].sort((a, b) => b.minHoursBeforeStart - a.minHoursBeforeStart);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.refundPercent > sorted[i - 1]!.refundPercent) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'non_monotonic' });
        break;
      }
    }
  });

export async function updateRefundTiersAction(input: unknown): Promise<UpdateSettingsResult> {
  const admin = await requireAdmin();

  const parsed = refundTiersSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'invalid_input' };
  }

  try {
    // Persist sorted descending by lead time — the canonical order the engine
    // and display both expect.
    const sorted = [...parsed.data].sort((a, b) => b.minHoursBeforeStart - a.minHoursBeforeStart);
    await updateRefundTiers(sorted, admin.id);
  } catch (err) {
    log.error('updateRefundTiers failed', errFields(err));
    return { ok: false, code: 'save_failed' };
  }
  revalidatePath('/admin/refund-policy');
  return { ok: true };
}

/**
 * Server actions for the admin settings screen.
 *
 * Same shape as the catalog actions: each action returns a discriminated
 * union — `{ ok: true }` on success, `{ ok: false, code }` on a recoverable
 * failure. The form maps codes to friendly text inline.
 */

const settingsSchema = z.object({
  siteName: z.string().trim().min(1).max(120),
  supportEmail: z
    .string()
    .trim()
    .email()
    .max(254)
    .optional()
    .or(z.literal(''))
    .transform((v) => v || null),
  supportPhone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .or(z.literal(''))
    .transform((v) => v || null),
  adminNotifyEmail: z
    .string()
    .trim()
    .email()
    .max(254)
    .optional()
    .or(z.literal(''))
    .transform((v) => v || null),
  defaultCurrency: z
    .string()
    .trim()
    .min(3)
    .max(6)
    .regex(/^[A-Z]+$/, { message: 'must_be_uppercase_iso_4217' }),
  defaultLocale: z.enum(['ar', 'en']),
  bookingLeadTimeHours: z.number().int().min(0).max(24 * 30),
  cancellationCutoffHours: z.number().int().min(0).max(24 * 30),
  holdTtlMinutes: z.number().int().min(1).max(60 * 24),
  bookingsEnabled: z.boolean(),
  // Homepage hero "video slot". Accepts an uploaded /uploads/… path or a full
  // URL; blank/empty clears the slot (page falls back to the rotating spotlight).
  heroVideoUrl: z
    .union([mediaUrl('Upload a video, or paste a direct mp4/webm URL.'), z.literal(''), z.null()])
    .transform((v) => v || null),
  heroPosterUrl: z
    .union([mediaUrl('Upload an image, or paste a full URL (https://…).'), z.literal(''), z.null()])
    .transform((v) => v || null),
  // Support availability (shown on /support): working-day range + clock times.
  supportOpenDay: z.number().int().min(0).max(6),
  supportCloseDay: z.number().int().min(0).max(6),
  supportOpenTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'invalid_time' }),
  supportCloseTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'invalid_time' }),
  // ZKBio CVSecurity access-control connection (the API token is a SECRET and
  // lives in the ZK_ACCESS_TOKEN env var, never here).
  zkEnabled: z.boolean(),
  zkServerUrl: z.string().trim().max(200).transform((v) => v || null),
  zkServerPort: z.number().int().min(1).max(65_535).nullable(),
  zkGuestDeptCode: z.string().trim().max(64).transform((v) => v || null),
}).refine((d) => d.supportOpenTime !== d.supportCloseTime, {
  // Equal open/close would render a valid-looking "9 AM – 9 AM" yet always
  // compute as closed — force a real window instead.
  message: 'open_and_close_must_differ',
  path: ['supportCloseTime'],
}).refine((d) => !d.zkServerUrl || /^https?:\/\//i.test(d.zkServerUrl), {
  // A misspelled URL would only surface as a runtime provisioning failure — catch
  // it at save time. Full parsing/port checks happen in buildZkBaseUrl.
  message: 'invalid_zk_url',
  path: ['zkServerUrl'],
}).refine((d) => !d.zkEnabled || !!d.zkServerUrl, {
  // Turning the integration on without a server URL would silently do nothing.
  message: 'zk_url_required_when_enabled',
  path: ['zkServerUrl'],
});

export type UpdateSettingsResult =
  | { ok: true }
  | { ok: false; code: 'invalid_input'; fields?: Record<string, string[]> }
  // Infrastructure failure (DB/transaction/audit). The service throws on these;
  // catching them here turns a hard 500 / unhandled promise rejection (which
  // just leaves the Save button spinning) into a recoverable "try again".
  | { ok: false; code: 'save_failed' };

function asInt(v: FormDataEntryValue | null, fallback: number): number {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

export async function updateSettingsAction(
  formData: FormData,
): Promise<UpdateSettingsResult> {
  const admin = await requireAdmin();

  const raw: SettingsInput = {
    siteName: String(formData.get('siteName') ?? ''),
    supportEmail: (formData.get('supportEmail') as string) || null,
    supportPhone: (formData.get('supportPhone') as string) || null,
    adminNotifyEmail: (formData.get('adminNotifyEmail') as string) || null,
    defaultCurrency: String(formData.get('defaultCurrency') ?? 'EGP').toUpperCase(),
    defaultLocale: (formData.get('defaultLocale') === 'en' ? 'en' : 'ar'),
    bookingLeadTimeHours: asInt(formData.get('bookingLeadTimeHours'), 0),
    cancellationCutoffHours: asInt(formData.get('cancellationCutoffHours'), 24),
    holdTtlMinutes: asInt(formData.get('holdTtlMinutes'), 15),
    bookingsEnabled: formData.get('bookingsEnabled') === 'on',
    heroVideoUrl: (formData.get('heroVideoUrl') as string) || null,
    heroPosterUrl: (formData.get('heroPosterUrl') as string) || null,
    supportOpenDay: asInt(formData.get('supportOpenDay'), 6),
    supportCloseDay: asInt(formData.get('supportCloseDay'), 4),
    supportOpenTime: String(formData.get('supportOpenTime') ?? '09:00'),
    supportCloseTime: String(formData.get('supportCloseTime') ?? '23:00'),
    zkEnabled: formData.get('zkEnabled') === 'on',
    zkServerUrl: String(formData.get('zkServerUrl') ?? ''),
    zkServerPort: formData.get('zkServerPort') ? asInt(formData.get('zkServerPort'), 8098) : null,
    zkGuestDeptCode: String(formData.get('zkGuestDeptCode') ?? ''),
  };

  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid_input',
      fields: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await updateSettings(parsed.data, admin.id);
  } catch (err) {
    log.error('updateSettings failed', errFields(err));
    return { ok: false, code: 'save_failed' };
  }
  revalidatePath('/admin/settings');
  return { ok: true };
}

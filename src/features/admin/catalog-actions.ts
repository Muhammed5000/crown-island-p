'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { mediaUrl } from '@/lib/media-url';
import { requireAdmin } from '@/server/auth/guards';
import {
  adminCreateCategory,
  adminUpdateCategory,
  adminDeleteCategory,
  adminCreateService,
  adminUpdateService,
  adminDeleteService,
  adminTogglePriceRule,
} from '@/server/services/admin-catalog';
import { DomainError } from '@/server/services/errors';

/**
 * Slugs reserved for the static customer booking tabs (/booking/beaches,
 * /booking/activities, plus "all"). A category may not claim one, or its detail
 * page at /booking/[categorySlug] would be shadowed by the tab route.
 */
const RESERVED_CATEGORY_SLUGS = new Set(['beaches', 'activities', 'all']);

const categorySchema = z.object({
  slug: z
    .string()
    .min(2, { message: 'Must be at least 2 characters.' })
    .max(60, { message: 'Must be at most 60 characters.' })
    .regex(/^[a-z0-9-]+$/, {
      message: 'Use lowercase letters, digits, and hyphens only (e.g. crown-surge).',
    })
    .refine((s) => !RESERVED_CATEGORY_SLUGS.has(s), {
      message: 'This slug is reserved. Pick a different one.',
    }),
  /** Beach (normal) vs activities category. Defaults to NORMAL. */
  type: z.enum(['NORMAL', 'ACTIVITY']).default('NORMAL'),
  nameEn: z
    .string()
    .min(1, { message: 'Required.' })
    .max(120, { message: 'Must be at most 120 characters.' }),
  nameAr: z
    .string()
    .min(1, { message: 'Required.' })
    .max(120, { message: 'Must be at most 120 characters.' }),
  descEn: z.string().max(2000).nullish(),
  descAr: z.string().max(2000).nullish(),
  /** Long-form story shown on the dedicated about-this-experience page. */
  longDescEn: z.string().max(8000).nullish(),
  longDescAr: z.string().max(8000).nullish(),
  coverUrl: mediaUrl('Upload a file, or paste a full URL (https://…).').nullish(),
  logoUrl: mediaUrl('Upload a logo, or paste a full URL (https://…).').nullish(),
  logoDarkUrl: mediaUrl('Upload a dark-mode logo, or paste a full URL (https://…).').nullish(),
  /** Each entry is an uploaded path or a full URL — split by newline in the parser. */
  galleryUrls: z
    .array(mediaUrl('Each gallery item must be an uploaded file or a full URL (https://…).'))
    .max(20, { message: 'Maximum 20 gallery images.' })
    .nullish(),
  videoUrl: mediaUrl('Upload a file, or paste a full URL (mp4/webm, or YouTube/Vimeo embed).').nullish(),
  highlightsEn: z
    .array(z.string().min(1).max(120))
    .max(12, { message: 'Maximum 12 highlights.' })
    .nullish(),
  highlightsAr: z
    .array(z.string().min(1).max(120))
    .max(12, { message: 'Maximum 12 highlights.' })
    .nullish(),
  /** Bilingual Terms & Policy bullet points. */
  termsEn: z
    .array(z.string().min(1).max(400))
    .max(30, { message: 'Maximum 30 terms.' })
    .nullish(),
  termsAr: z
    .array(z.string().min(1).max(400))
    .max(30, { message: 'Maximum 30 terms.' })
    .nullish(),
  latitude: z
    .number()
    .min(-90, { message: 'Must be between -90 and 90.' })
    .max(90, { message: 'Must be between -90 and 90.' })
    .nullish(),
  longitude: z
    .number()
    .min(-180, { message: 'Must be between -180 and 180.' })
    .max(180, { message: 'Must be between -180 and 180.' })
    .nullish(),
  addressEn: z.string().max(400).nullish(),
  addressAr: z.string().max(400).nullish(),
  /** Minimum age to enter the category. Blank/0 = open to everyone. */
  minAge: z
    .number()
    .int({ message: 'Must be a whole number.' })
    .min(0, { message: 'Must be 0 or more.' })
    .max(120, { message: 'Must be 120 or less.' })
    .nullish(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

/**
 * Read a FormData string entry with consistent normalisation:
 *  - trims whitespace,
 *  - returns null when blank so optional Zod fields don't see `""`.
 */
function readString(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/** Read a numeric field — blank → null, non-numeric → undefined so Zod flags it. */
function readNumber(formData: FormData, key: string): number | null | undefined {
  const raw = formData.get(key);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined; // undefined = bad value, let Zod reject
}

/**
 * Read a textarea where each non-empty line is one list item. Used for the
 * about-page gallery URLs and highlights — keeps the admin form a single
 * `<textarea>` instead of a dynamic field-array repeater.
 *
 * Returns null when the textarea is blank so optional Zod fields don't see
 * an empty array (which would still pass `.max()` but fail nicer "leave
 * blank to skip" UX).
 */
function readLines(formData: FormData, key: string): string[] | null {
  const raw = formData.get(key);
  if (typeof raw !== 'string') return null;
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length ? lines : null;
}

function parseCategoryForm(formData: FormData) {
  // Slug normalisation: lowercase + trim is forgiving — admins typing
  // "Crown-Surge" or " crown-surge " still pass validation. Spaces /
  // unicode are still rejected by the regex below so the URL stays clean.
  const rawSlug = (formData.get('slug') as string | null)?.trim().toLowerCase() ?? '';

  return categorySchema.safeParse({
    slug: rawSlug,
    type: formData.get('type') === 'ACTIVITY' ? 'ACTIVITY' : 'NORMAL',
    nameEn: readString(formData, 'nameEn') ?? '',
    nameAr: readString(formData, 'nameAr') ?? '',
    descEn: readString(formData, 'descEn'),
    descAr: readString(formData, 'descAr'),
    longDescEn: readString(formData, 'longDescEn'),
    longDescAr: readString(formData, 'longDescAr'),
    coverUrl: readString(formData, 'coverUrl'),
    logoUrl: readString(formData, 'logoUrl'),
    logoDarkUrl: readString(formData, 'logoDarkUrl'),
    galleryUrls: readLines(formData, 'galleryUrls'),
    videoUrl: readString(formData, 'videoUrl'),
    highlightsEn: readLines(formData, 'highlightsEn'),
    highlightsAr: readLines(formData, 'highlightsAr'),
    termsEn: readLines(formData, 'termsEn'),
    termsAr: readLines(formData, 'termsAr'),
    latitude: readNumber(formData, 'latitude'),
    longitude: readNumber(formData, 'longitude'),
    addressEn: readString(formData, 'addressEn'),
    addressAr: readString(formData, 'addressAr'),
    minAge: readNumber(formData, 'minAge'),
    isActive: formData.get('isActive') === 'on',
    sortOrder: readNumber(formData, 'sortOrder') ?? 0,
  });
}

/** Shape every catalog mutation returns on a recoverable failure. On success
 *  the action throws NEXT_REDIRECT instead of returning — the client form
 *  treats that as the happy path.
 *
 *  When the validation step rejects the payload we ALSO return per-field
 *  messages so the form can highlight the exact inputs that failed instead
 *  of dropping a generic "invalid_input" on the user. */
export type CatalogActionResult = {
  ok: false;
  code: string;
  fields?: Record<string, string[]>;
};

/** Convert a Zod `flatten().fieldErrors` map into a stable shape for the UI. */
function flattenFieldErrors(parsed: ReturnType<typeof categorySchema.safeParse>) {
  if (parsed.success) return undefined;
  const flat = parsed.error.flatten().fieldErrors;
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(flat)) {
    if (v && v.length) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export async function createCategoryAction(
  formData: FormData,
): Promise<CatalogActionResult | void> {
  const admin = await requireAdmin();
  const parsed = parseCategoryForm(formData);
  if (!parsed.success) {
    return { ok: false, code: 'invalid_input', fields: flattenFieldErrors(parsed) };
  }
  try {
    await adminCreateCategory(
      {
        ...parsed.data,
        coverUrl: parsed.data.coverUrl || null,
        logoUrl: parsed.data.logoUrl || null,
        logoDarkUrl: parsed.data.logoDarkUrl || null,
        videoUrl: parsed.data.videoUrl || null,
      },
      admin.id,
    );
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    throw err;
  }
  const dest = parsed.data.type === 'ACTIVITY' ? '/admin/activities-categories' : '/admin/categories';
  revalidatePath('/admin/categories');
  revalidatePath('/admin/activities-categories');
  redirect(dest);
}

export async function updateCategoryAction(
  id: string,
  formData: FormData,
): Promise<CatalogActionResult | void> {
  const admin = await requireAdmin();
  const parsed = parseCategoryForm(formData);
  if (!parsed.success) {
    return { ok: false, code: 'invalid_input', fields: flattenFieldErrors(parsed) };
  }
  try {
    await adminUpdateCategory(
      id,
      {
        ...parsed.data,
        coverUrl: parsed.data.coverUrl || null,
        logoUrl: parsed.data.logoUrl || null,
        logoDarkUrl: parsed.data.logoDarkUrl || null,
        videoUrl: parsed.data.videoUrl || null,
      },
      admin.id,
    );
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    throw err;
  }
  const dest = parsed.data.type === 'ACTIVITY' ? '/admin/activities-categories' : '/admin/categories';
  revalidatePath('/admin/categories');
  revalidatePath('/admin/activities-categories');
  redirect(dest);
}

export async function deleteCategoryAction(input: { id: string }) {
  const admin = await requireAdmin();
  try {
    await adminDeleteCategory(input.id, admin.id);
    revalidatePath('/admin/categories');
    revalidatePath('/admin/activities-categories');
    return { ok: true as const };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false as const, code: err.code };
    // A row deleted concurrently (between our existence check and the delete)
    // surfaces as Prisma P2025; report it as the accurate not_found so the UI
    // shows "This category no longer exists." instead of a generic failure.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return { ok: false as const, code: 'not_found' };
    }
    return { ok: false as const, code: 'unknown' };
  }
}

// ───── Services ─────────────────────────────────────────────────────────────

const serviceSchema = z.object({
  categoryId: z.string().min(1, { message: 'Pick a category.' }),
  slug: z
    .string()
    .min(2, { message: 'Must be at least 2 characters.' })
    .max(60, { message: 'Must be at most 60 characters.' })
    .regex(/^[a-z0-9-]+$/, {
      message: 'Use lowercase letters, digits, and hyphens only (e.g. day-use).',
    }),
  nameEn: z.string().min(1, { message: 'Required.' }).max(120),
  nameAr: z.string().min(1, { message: 'Required.' }).max(120),
  descEn: z.string().max(2000).nullish(),
  descAr: z.string().max(2000).nullish(),
  longDescEn: z.string().max(8000).nullish(),
  longDescAr: z.string().max(8000).nullish(),
  highlightsEn: z.array(z.string().min(1).max(120)).max(12).nullish(),
  highlightsAr: z.array(z.string().min(1).max(120)).max(12).nullish(),
  galleryUrls: z.array(mediaUrl()).max(20).nullish(),
  kind: z.enum(['DAY_USE', 'CABANA', 'EVENT', 'OTHER']),
  coverUrl: mediaUrl('Upload a file, or paste a full URL (https://…).').nullish(),
  /** Primary ticket price (covers 1st person), in piastres. */
  basePriceCents: z
    .number()
    .int()
    .nonnegative({ message: 'Must be 0 or positive.' }),
  /** Price for each additional person beyond the included allowance, in piastres. */
  extraPersonPriceCents: z
    .number()
    .int()
    .nonnegative({ message: 'Must be 0 or positive.' }),
  /** Per-car price, in piastres. 0 means "no car surcharge". */
  perCarPriceCents: z.number().int().nonnegative().optional(),

  // ── Per-unit people & extra-people behaviour ───────────────────────────────
  includedPersonsPerUnit: z
    .number()
    .int()
    .positive({ message: 'Must be at least 1.' })
    .default(1),
  maxPersonsPerUnit: z.number().int().positive().nullish(),
  allowExtraPeople: z.boolean().optional(),
  extraPersonMode: z.enum(['NEW_UNIT', 'EXTRA_CHARGE']).default('NEW_UNIT'),
  /** Per-unit cap on the paid Extra Person add-on (null/blank = no limit). */
  maxExtraPersonsPerUnit: z.number().int().positive().nullish(),

  // ── Children ───────────────────────────────────────────────────────────────
  allowChildren: z.boolean().optional(),
  maxChildAge: z.number().int().min(0).max(17).default(8),
  freeChildrenPerUnit: z.number().int().nonnegative().default(0),
  /** Hard cap on total children per booking (null/blank = no limit). */
  maxChildrenPerBooking: z.number().int().positive().nullish(),
  /** Extra-child price in piastres. */
  extraChildPriceCents: z.number().int().nonnegative().default(0),
  childrenCountAsPersons: z.boolean().optional(),

  // ── Insurance deposit (docs/INSURANCE.md) ──────────────────────────────────
  insuranceEnabled: z.boolean().optional(),
  insuranceType: z.enum(['PERCENT', 'FIXED']).default('FIXED'),
  /** Whole percent of the pre-discount service total (1..100 when PERCENT). */
  insurancePercent: z.number().int().min(0).max(100).default(0),
  /** Flat deposit in piastres (> 0 when FIXED). */
  insuranceFixedCents: z.number().int().nonnegative().default(0),

  // ── Multi-day ────────────────────────────────────────────────────────────--
  allowMultiDay: z.boolean().optional(),
  maxBookingDays: z.number().int().positive().nullish(),

  // ── Place assignment ─────────────────────────────────────────────────────--
  placeAssignmentRequired: z.boolean().optional(),
  placeType: z.enum(['CABIN', 'CABANA', 'UMBRELLA', 'SEAT', 'SPOT']).default('SEAT'),
  // ── ZKBio physical access control ─────────────────────────────────────────--
  requiresAccessControl: z.boolean().optional(),

  dailyCapacityPeople: z.number().int().positive().nullish(),
  dailyCapacityCars: z.number().int().nonnegative().nullish(),
  maxPeoplePerBooking: z.number().int().positive().nullish(),
  maxCarsPerBooking: z.number().int().nonnegative().nullish(),
  openTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).nullish(),
  closeTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).nullish(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
}).superRefine((data, ctx) => {
  // A place-assigned service MUST carry a positive daily capacity: it is the
  // only per-day sell gate (booking-calc / webhook / reception all skip the
  // check when the cap is NULL), so a blank cap silently allows unlimited
  // overbooking against finite cabanas/umbrellas. Require it here so the admin
  // can never persist that hole from the form.
  if (
    data.placeAssignmentRequired === true &&
    (data.dailyCapacityPeople == null || data.dailyCapacityPeople <= 0)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dailyCapacityPeople'],
      message: 'Required (> 0) when place assignment is on — it caps how many units sell per day.',
    });
  }
  // ZK access is scoped per specific place (each cabin's door → its ServicePlace
  // access level), so a ZK service MUST assign places. Block the inconsistent
  // combo at the form instead of silently never opening a door.
  if (data.requiresAccessControl === true && data.placeAssignmentRequired !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['requiresAccessControl'],
      message: 'Turn on place assignment first — ZK access is granted per assigned place.',
    });
  }
  // Insurance deposit: an ENABLED config must carry a usable value for its
  // type, or every booking of this service would charge a 0 deposit while the
  // admin believes insurance is on. Mirrors validateInsuranceConfig (the
  // service layer re-validates — this gives the form a field-level message).
  if (data.insuranceEnabled === true) {
    if (data.insuranceType === 'PERCENT' && (data.insurancePercent < 1 || data.insurancePercent > 100)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['insurancePercent'],
        message: 'Enter a whole percent between 1 and 100.',
      });
    }
    if (data.insuranceType === 'FIXED' && data.insuranceFixedCents <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['insuranceFixedCents'],
        message: 'Enter a fixed insurance amount greater than zero.',
      });
    }
  }
});

/** Convert "100" or "100.50" EGP → 10000 / 10050 piastres. */
function egpToPiastres(raw: FormDataEntryValue | null): number {
  if (raw == null || raw === '') return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  // Round to avoid 99.99 * 100 = 9998.999999999... floats.
  return Math.round(n * 100);
}

function nullableInt(v: FormDataEntryValue | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseServiceForm(formData: FormData) {
  const rawSlug = (formData.get('slug') as string | null)?.trim().toLowerCase() ?? '';
  const rawKind = String(formData.get('kind') ?? 'DAY_USE');
  const allowedKinds = new Set(['DAY_USE', 'CABANA', 'EVENT', 'OTHER']);

  return serviceSchema.safeParse({
    categoryId: readString(formData, 'categoryId') ?? '',
    slug: rawSlug,
    nameEn: readString(formData, 'nameEn') ?? '',
    nameAr: readString(formData, 'nameAr') ?? '',
    descEn: readString(formData, 'descEn'),
    descAr: readString(formData, 'descAr'),
    longDescEn: readString(formData, 'longDescEn'),
    longDescAr: readString(formData, 'longDescAr'),
    highlightsEn: readLines(formData, 'highlightsEn'),
    highlightsAr: readLines(formData, 'highlightsAr'),
    galleryUrls: readLines(formData, 'galleryUrls'),
    kind: (allowedKinds.has(rawKind) ? rawKind : 'DAY_USE') as
      | 'DAY_USE'
      | 'CABANA'
      | 'EVENT'
      | 'OTHER',
    coverUrl: readString(formData, 'coverUrl'),
    // Admin types EGP; persist piastres.
    basePriceCents: egpToPiastres(formData.get('pricePerPersonEgp')),
    extraPersonPriceCents: egpToPiastres(formData.get('extraPersonPriceEgp')),
    perCarPriceCents: egpToPiastres(formData.get('pricePerCarEgp')),
    // Per-unit people & extra-people behaviour.
    includedPersonsPerUnit: nullableInt(formData.get('includedPersonsPerUnit')) ?? 1,
    maxPersonsPerUnit: nullableInt(formData.get('maxPersonsPerUnit')),
    allowExtraPeople: formData.get('allowExtraPeople') === 'on',
    extraPersonMode: formData.get('extraPersonMode') === 'EXTRA_CHARGE' ? 'EXTRA_CHARGE' : 'NEW_UNIT',
    maxExtraPersonsPerUnit: nullableInt(formData.get('maxExtraPersonsPerUnit')),
    // Children.
    allowChildren: formData.get('allowChildren') === 'on',
    maxChildAge: nullableInt(formData.get('maxChildAge')) ?? 8,
    freeChildrenPerUnit: nullableInt(formData.get('freeChildrenPerUnit')) ?? 0,
    maxChildrenPerBooking: nullableInt(formData.get('maxChildrenPerBooking')),
    extraChildPriceCents: egpToPiastres(formData.get('extraChildPriceEgp')),
    childrenCountAsPersons: formData.get('childrenCountAsPersons') === 'on',
    // Insurance deposit (admin types EGP; persist piastres).
    insuranceEnabled: formData.get('insuranceEnabled') === 'on',
    insuranceType: formData.get('insuranceType') === 'PERCENT' ? 'PERCENT' : 'FIXED',
    insurancePercent: nullableInt(formData.get('insurancePercent')) ?? 0,
    insuranceFixedCents: egpToPiastres(formData.get('insuranceFixedEgp')),
    // Multi-day.
    allowMultiDay: formData.get('allowMultiDay') === 'on',
    maxBookingDays: nullableInt(formData.get('maxBookingDays')),
    // Place assignment.
    placeAssignmentRequired: formData.get('placeAssignmentRequired') === 'on',
    placeType: ((): 'CABIN' | 'CABANA' | 'UMBRELLA' | 'SEAT' | 'SPOT' => {
      const v = String(formData.get('placeType') ?? 'SEAT');
      return (['CABIN', 'CABANA', 'UMBRELLA', 'SEAT', 'SPOT'] as const).includes(v as never)
        ? (v as 'CABIN' | 'CABANA' | 'UMBRELLA' | 'SEAT' | 'SPOT')
        : 'SEAT';
    })(),
    requiresAccessControl: formData.get('requiresAccessControl') === 'on',
    dailyCapacityPeople: nullableInt(formData.get('dailyCapacityPeople')),
    dailyCapacityCars: nullableInt(formData.get('dailyCapacityCars')),
    maxPeoplePerBooking: nullableInt(formData.get('maxPeoplePerBooking')),
    maxCarsPerBooking: nullableInt(formData.get('maxCarsPerBooking')),
    openTime: readString(formData, 'openTime') ?? '09:00',
    closeTime: readString(formData, 'closeTime') ?? '18:00',
    isActive: formData.get('isActive') === 'on',
    sortOrder: readNumber(formData, 'sortOrder') ?? 0,
  });
}

function flattenServiceFieldErrors(
  parsed: ReturnType<typeof serviceSchema.safeParse>,
) {
  if (parsed.success) return undefined;
  const flat = parsed.error.flatten().fieldErrors;
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(flat)) {
    if (v && v.length) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export async function createServiceAction(
  formData: FormData,
): Promise<CatalogActionResult | void> {
  const admin = await requireAdmin();
  const parsed = parseServiceForm(formData);
  if (!parsed.success) {
    return { ok: false, code: 'invalid_input', fields: flattenServiceFieldErrors(parsed) };
  }
  try {
    await adminCreateService(
      { ...parsed.data, coverUrl: parsed.data.coverUrl || null },
      admin.id,
    );
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    throw err;
  }
  revalidatePath('/admin/services');
  redirect('/admin/services');
}

export async function updateServiceAction(
  id: string,
  formData: FormData,
): Promise<CatalogActionResult | void> {
  const admin = await requireAdmin();
  const parsed = parseServiceForm(formData);
  if (!parsed.success) {
    return { ok: false, code: 'invalid_input', fields: flattenServiceFieldErrors(parsed) };
  }
  try {
    await adminUpdateService(
      id,
      { ...parsed.data, coverUrl: parsed.data.coverUrl || null },
      admin.id,
    );
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, code: err.code };
    throw err;
  }
  revalidatePath('/admin/services');
  redirect('/admin/services');
}

export async function deleteServiceAction(input: { id: string }) {
  const admin = await requireAdmin();
  try {
    await adminDeleteService(input.id, admin.id);
    revalidatePath('/admin/services');
    return { ok: true as const };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false as const, code: err.code };
    return { ok: false as const, code: 'unknown' };
  }
}

export async function togglePriceRuleAction(input: { id: string; isActive: boolean }) {
  const admin = await requireAdmin();
  try {
    await adminTogglePriceRule(input.id, input.isActive, admin.id);
    revalidatePath('/admin/pricing');
    return { ok: true as const };
  } catch (err) {
    if (err instanceof DomainError) return { ok: false as const, code: err.code };
    return { ok: false as const, code: 'unknown' };
  }
}

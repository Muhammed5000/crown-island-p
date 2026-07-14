import 'server-only';
import { revalidateTag } from 'next/cache';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { audit } from '@/server/audit/audit';
import { assertNotLocalNode } from '@/server/sync/node-guard';
import { CATALOG_CACHE_TAG } from '@/server/repositories/catalog';
import { behaviorFor } from './booking-calc-core';
import { topUpPlacesForCapacity } from './admin-places';
import { DomainError } from './errors';
import { validateInsuranceConfig } from './insurance-core';

/**
 * Admin-side catalogue management. Every mutation runs in a transaction with
 * an `AuditLog` row so before/after state is recoverable.
 *
 * Constraint violations from the DB (uniqueness on `Category.slug` and on
 * `(Service.categoryId, Service.slug)`) are translated into typed
 * `DomainError`s so the action layer can return clean discriminated unions
 * to the UI — no Prisma stack traces leak to the browser.
 *
 * Every successful mutation also calls `revalidateTag('catalog')` (after the
 * transaction commits) so the cached public-catalog reads in
 * `src/server/repositories/catalog.ts` reflect the edit immediately.
 */

/** Drop the cached public-catalog reads after a successful catalog write. */
function invalidateCatalogCache() {
  // 'max' = Next 16's equivalent of the legacy revalidateTag(tag) behaviour.
  revalidateTag(CATALOG_CACHE_TAG, 'max');
}

/** Translate a Prisma uniqueness collision into a domain-level error. */
function rethrowAsSlugTaken(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new DomainError('slug_taken', 'slug_taken', 409);
  }
  throw err;
}

/**
 * Slug of the built-in "Uncategorized" bucket. When a category is deleted, its
 * services are re-homed here instead of blocking the delete — the service keeps
 * all its data, only its category link changes to "none". The bucket is kept
 * inactive so it (and any orphaned services) never surface in the public
 * catalog, which filters on `isActive`.
 */
export const UNCATEGORIZED_SLUG = 'uncategorized';

/** Find the Uncategorized bucket, creating it on first use. */
async function getOrCreateUncategorized(tx: Prisma.TransactionClient) {
  const existing = await tx.category.findUnique({ where: { slug: UNCATEGORIZED_SLUG } });
  if (existing) return existing;
  return tx.category.create({
    data: {
      slug: UNCATEGORIZED_SLUG,
      nameEn: 'Uncategorized',
      nameAr: 'بدون تصنيف',
      isActive: false,
      sortOrder: 9999,
    },
  });
}

export interface CategoryInput {
  slug: string;
  /** NORMAL (beach) vs ACTIVITY category. Defaults to NORMAL when omitted. */
  type?: 'NORMAL' | 'ACTIVITY';
  nameEn: string;
  nameAr: string;
  descEn?: string | null;
  descAr?: string | null;
  /** Long-form copy for the "About this experience" page. */
  longDescEn?: string | null;
  longDescAr?: string | null;
  coverUrl?: string | null;
  /** Category logo / brand mark (light mode) — shown on entry + the ticket. */
  logoUrl?: string | null;
  /** Dark-mode variant of the logo (dark theme + the dark downloadable ticket). */
  logoDarkUrl?: string | null;
  /** Additional image URLs for the about-page gallery. */
  galleryUrls?: string[] | null;
  /** Direct video URL or YouTube/Vimeo embed URL. */
  videoUrl?: string | null;
  /** Short bullet highlights (e.g. "Private cabana", "Sunset access"). */
  highlightsEn?: string[] | null;
  highlightsAr?: string[] | null;
  /** Terms & Policy bullet points shown on the category about page. */
  termsEn?: string[] | null;
  termsAr?: string[] | null;
  latitude?: number | null;
  longitude?: number | null;
  addressEn?: string | null;
  addressAr?: string | null;
  /** Minimum age (years) required to enter this category; null = no limit. */
  minAge?: number | null;
  isActive?: boolean;
  sortOrder?: number;
}

/** Normalise a terms value (stored JSON or fresh input) to a trimmed string[]. */
function normalizeTerms(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
}

/** Whether two terms values represent the same ordered list of bullet points. */
function sameTerms(a: unknown, b: unknown): boolean {
  const na = normalizeTerms(a);
  const nb = normalizeTerms(b);
  return na.length === nb.length && na.every((v, i) => v === nb[i]);
}

/** True when an input carries at least one terms bullet in either language. */
function hasAnyTerms(data: CategoryInput): boolean {
  return normalizeTerms(data.termsEn).length > 0 || normalizeTerms(data.termsAr).length > 0;
}

export async function adminCreateCategory(data: CategoryInput, actorUserId: string) {
  assertNotLocalNode('The catalog');
  try {
    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.category.create({
        data: {
          ...data,
          isActive: data.isActive ?? true,
          sortOrder: data.sortOrder ?? 0,
          galleryUrls: data.galleryUrls ?? Prisma.JsonNull,
          highlightsEn: data.highlightsEn ?? Prisma.JsonNull,
          highlightsAr: data.highlightsAr ?? Prisma.JsonNull,
          termsEn: data.termsEn ?? Prisma.JsonNull,
          termsAr: data.termsAr ?? Prisma.JsonNull,
          // Stamp the terms version so the per-category terms gate can force a
          // re-accept whenever the terms later change (only when terms exist).
          ...(hasAnyTerms(data) ? { termsUpdatedAt: new Date() } : {}),
        },
      });
      await audit(tx, {
        actorUserId,
        action: 'CREATE',
        entityType: 'Category',
        entityId: created.id,
        after: created,
      });
      return created;
    });
    invalidateCatalogCache();
    return result;
  } catch (err) {
    rethrowAsSlugTaken(err);
  }
}

export async function adminUpdateCategory(id: string, data: CategoryInput, actorUserId: string) {
  assertNotLocalNode('The catalog');
  try {
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.category.findUnique({ where: { id } });
      if (!before) throw new DomainError('not_found', 'not_found', 404);
      // Re-stamp the terms version only when the terms actually changed, so the
      // per-category terms gate re-prompts everyone who accepted the old copy
      // without disturbing unrelated category edits.
      const termsChanged =
        !sameTerms(before.termsEn, data.termsEn) || !sameTerms(before.termsAr, data.termsAr);
      const after = await tx.category.update({
        where: { id },
        data: {
          ...data,
          galleryUrls: data.galleryUrls ?? Prisma.JsonNull,
          highlightsEn: data.highlightsEn ?? Prisma.JsonNull,
          highlightsAr: data.highlightsAr ?? Prisma.JsonNull,
          termsEn: data.termsEn ?? Prisma.JsonNull,
          termsAr: data.termsAr ?? Prisma.JsonNull,
          ...(termsChanged ? { termsUpdatedAt: new Date() } : {}),
        },
      });
      await audit(tx, {
        actorUserId,
        action: 'UPDATE',
        entityType: 'Category',
        entityId: id,
        before,
        after,
      });
      return after;
    });
    invalidateCatalogCache();
    return result;
  } catch (err) {
    rethrowAsSlugTaken(err);
  }
}

export async function adminDeleteCategory(id: string, actorUserId: string) {
  assertNotLocalNode('The catalog');
  await prisma.$transaction(async (tx) => {
    const before = await tx.category.findUnique({
      where: { id },
      include: { services: { select: { id: true, slug: true } } },
    });
    if (!before) throw new DomainError('not_found', 'not_found', 404);

    // The Uncategorized bucket is the re-homing target for orphaned services, so
    // it cannot move its OWN services to itself. It may be deleted ONLY when it is
    // empty; while it still holds services the admin must first move them to a
    // real category. Deleting the empty bucket is safe — getOrCreateUncategorized
    // recreates it on demand the next time a category deletion needs to re-home.
    if (before.slug === UNCATEGORIZED_SLUG && before.services.length > 0) {
      throw new DomainError('uncategorized_has_services', 'uncategorized_has_services', 409);
    }

    // Re-home any attached services to the Uncategorized bucket instead of
    // refusing the delete. Each service keeps all of its data; only its
    // category link changes to "none".
    const movedServiceIds: string[] = [];
    if (before.services.length > 0) {
      const bucket = await getOrCreateUncategorized(tx);
      // Slugs already taken under the bucket — avoid the
      // @@unique([categoryId, slug]) collision when two categories each had a
      // service sharing the same slug.
      const taken = new Set(
        (
          await tx.service.findMany({
            where: { categoryId: bucket.id },
            select: { slug: true },
          })
        ).map((s) => s.slug),
      );
      for (const svc of before.services) {
        let slug = svc.slug;
        let n = 1;
        while (taken.has(slug)) {
          n += 1;
          slug = `${svc.slug}-${n}`;
        }
        taken.add(slug);
        await tx.service.update({
          where: { id: svc.id },
          data: { categoryId: bucket.id, ...(slug !== svc.slug ? { slug } : {}) },
        });
        movedServiceIds.push(svc.id);
      }
    }

    await tx.category.delete({ where: { id } });
    await audit(tx, {
      actorUserId,
      action: 'DELETE',
      entityType: 'Category',
      entityId: id,
      before,
      after: { movedServiceIds, movedTo: movedServiceIds.length > 0 ? UNCATEGORIZED_SLUG : null },
    });
  });
  invalidateCatalogCache();
}

export interface ServiceInput {
  categoryId: string;
  slug: string;
  nameEn: string;
  nameAr: string;
  descEn?: string | null;
  descAr?: string | null;
  longDescEn?: string | null;
  longDescAr?: string | null;
  highlightsEn?: string[] | null;
  highlightsAr?: string[] | null;
  galleryUrls?: string[] | null;
  kind: 'DAY_USE' | 'CABANA' | 'EVENT' | 'OTHER';
  coverUrl?: string | null;
  /**
   * Price for the first person, in piastres. Drives the BASE price line.
   */
  basePriceCents: number;
  /**
   * Price for each additional person beyond the first.
   */
  extraPersonPriceCents: number;
  /**
   * Price per car, in piastres. When > 0, a matching PER_CAR price rule is
   * created so the total scales with the car count the user picks.
   */
  perCarPriceCents?: number;
  // Per-unit people & extra-people behaviour.
  includedPersonsPerUnit?: number;
  maxPersonsPerUnit?: number | null;
  allowExtraPeople?: boolean;
  extraPersonMode?: 'NEW_UNIT' | 'EXTRA_CHARGE';
  maxExtraPersonsPerUnit?: number | null;
  // Children.
  allowChildren?: boolean;
  maxChildAge?: number;
  freeChildrenPerUnit?: number;
  maxChildrenPerBooking?: number | null;
  extraChildPriceCents?: number;
  childrenCountAsPersons?: boolean;
  // Insurance deposit (docs/INSURANCE.md) — snapshotted per booking at commit.
  insuranceEnabled?: boolean;
  insuranceType?: 'PERCENT' | 'FIXED';
  insurancePercent?: number;
  insuranceFixedCents?: number;
  // Multi-day.
  allowMultiDay?: boolean;
  maxBookingDays?: number | null;
  // Place assignment.
  placeAssignmentRequired?: boolean;
  placeType?: 'CABIN' | 'CABANA' | 'UMBRELLA' | 'SEAT' | 'SPOT';
  // ZKBio physical access control (per-place door access).
  requiresAccessControl?: boolean;
  dailyCapacityPeople?: number | null;
  dailyCapacityCars?: number | null;
  maxPeoplePerBooking?: number | null;
  maxCarsPerBooking?: number | null;
  openTime?: string | null;
  closeTime?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

/**
 * Replace the auto-generated PER_PERSON / PER_CAR rules for a service with
 * fresh ones matching the input prices, AND purge any FLAT rule. Runs inside the
 * caller's transaction. Dated exceptions (WEEKEND_SURCHARGE / DATE_OVERRIDE) are
 * left untouched; FLAT is a retired, redundant duplicate of `basePriceCents` (the
 * single source of truth) and must never shadow the admin-set base price.
 *
 * `legacyKind` is true only for the LEGACY (OTHER) head-count regime. The
 * EVENT / CABANA / BEACH regimes price extra people via the engine
 * (`extraPersonPriceCents` / additional tickets / per-head base), so a
 * PER_PERSON rule there would double-charge and is never created.
 */
async function syncBasePriceRules(
  tx: Prisma.TransactionClient,
  serviceId: string,
  extraPersonCents: number,
  perCarCents: number,
  legacyKind: boolean,
) {
  // Remove the auto-managed base lines (PER_PERSON/PER_CAR @ priority 10) AND any
  // FLAT rule. FLAT silently overrode `basePriceCents` and is now retired, so every
  // save re-establishes the admin-set base price as the source of truth. Dated
  // exceptions (WEEKEND_SURCHARGE / DATE_OVERRIDE) keep their state.
  const deleteWhere: Prisma.PriceRuleWhereInput = {
    serviceId,
    OR: [
      { kind: { in: ['PER_PERSON', 'PER_CAR'] }, priority: 10 },
      { kind: 'FLAT' },
    ],
  };
  await tx.priceRule.deleteMany({ where: deleteWhere });

  const fresh: Prisma.PriceRuleCreateManyInput[] = [];
  // Only the legacy head-count regime uses a PER_PERSON rule; the kind-driven
  // regimes price extra people in the engine, so creating one would double-charge.
  if (extraPersonCents > 0 && legacyKind) {
    fresh.push({
      serviceId,
      kind: 'PER_PERSON',
      amountCents: extraPersonCents,
      priority: 10,
    });
  }
  if (perCarCents > 0) {
    fresh.push({
      serviceId,
      kind: 'PER_CAR',
      amountCents: perCarCents,
      priority: 10,
    });
  }
  if (fresh.length) {
    await tx.priceRule.createMany({ data: fresh });
  }
}

/**
 * A place-required service MUST carry a positive daily capacity — it is the only
 * per-day sell gate, so a NULL cap is the unlimited-overbooking hole. Enforced
 * here (in addition to the form's Zod refine) so API / import / mobile callers
 * can never persist it either.
 */
/**
 * Service-layer re-validation of the insurance config (the form validates too,
 * but the API boundary is the real gate — docs/INSURANCE.md §2). Existing
 * bookings are NEVER affected by config edits (frozen BookingInsurance rows).
 */
function assertInsuranceConfig(data: ServiceInput) {
  validateInsuranceConfig({
    insuranceEnabled: data.insuranceEnabled ?? false,
    insuranceType: data.insuranceType ?? 'FIXED',
    insurancePercent: data.insurancePercent ?? 0,
    insuranceFixedCents: data.insuranceFixedCents ?? 0,
  });
}

function assertCapacityForPlaceService(data: ServiceInput) {
  if (
    data.placeAssignmentRequired === true &&
    (data.dailyCapacityPeople == null || data.dailyCapacityPeople <= 0)
  ) {
    throw new DomainError('capacity_required', 'capacity_required', 400);
  }
}

export async function adminCreateService(data: ServiceInput, actorUserId: string) {
  assertNotLocalNode('The catalog');
  assertCapacityForPlaceService(data);
  assertInsuranceConfig(data);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const { perCarPriceCents, ...serviceData } = data;
      const created = await tx.service.create({
        data: {
          ...serviceData,
          isActive: data.isActive ?? true,
          sortOrder: data.sortOrder ?? 0,
          galleryUrls: data.galleryUrls ?? Prisma.JsonNull,
          highlightsEn: data.highlightsEn ?? Prisma.JsonNull,
          highlightsAr: data.highlightsAr ?? Prisma.JsonNull,
        },
      });

      // Auto-create the per-person + per-car price rules so the booking
      // total actually scales with the steppers. Without these, the user
      // sees the same total regardless of party size. PER_PERSON is skipped
      // for unit-model services (extra people priced via the allocation).
      await syncBasePriceRules(
        tx,
        created.id,
        data.extraPersonPriceCents,
        perCarPriceCents ?? 0,
        behaviorFor(data.kind) === 'LEGACY',
      );

      // Keep the physical place inventory in step with capacity so the
      // reception/gate picker always shows every place the service can hold.
      await topUpPlacesForCapacity(tx, created.id);

      await audit(tx, {
        actorUserId,
        action: 'CREATE',
        entityType: 'Service',
        entityId: created.id,
        after: created,
      });
      return created;
    });
    invalidateCatalogCache();
    return result;
  } catch (err) {
    rethrowAsSlugTaken(err);
  }
}

export async function adminUpdateService(id: string, data: ServiceInput, actorUserId: string) {
  assertNotLocalNode('The catalog');
  assertCapacityForPlaceService(data);
  assertInsuranceConfig(data);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.service.findUnique({ where: { id } });
      if (!before) throw new DomainError('not_found', 'not_found', 404);

      const { perCarPriceCents, ...serviceData } = data;
      const after = await tx.service.update({
        where: { id },
        data: {
          ...serviceData,
          galleryUrls: data.galleryUrls ?? Prisma.JsonNull,
          highlightsEn: data.highlightsEn ?? Prisma.JsonNull,
          highlightsAr: data.highlightsAr ?? Prisma.JsonNull,
        },
      });

      // Keep the auto-managed PER_PERSON / PER_CAR rules in sync with the
      // values the admin just typed.
      await syncBasePriceRules(
        tx,
        id,
        data.extraPersonPriceCents,
        perCarPriceCents ?? 0,
        behaviorFor(data.kind) === 'LEGACY',
      );

      // Top up the place inventory to match (possibly newly raised) capacity.
      await topUpPlacesForCapacity(tx, id);

      const action =
        before.basePriceCents !== data.basePriceCents ||
        before.extraPersonPriceCents !== data.extraPersonPriceCents ||
        // Insurance config edits change what NEW bookings pay — a money event.
        before.insuranceEnabled !== (data.insuranceEnabled ?? false) ||
        before.insuranceType !== (data.insuranceType ?? 'FIXED') ||
        before.insurancePercent !== (data.insurancePercent ?? 0) ||
        before.insuranceFixedCents !== (data.insuranceFixedCents ?? 0)
          ? 'PRICE_CHANGE'
          : 'UPDATE';
      await audit(tx, {
        actorUserId,
        action,
        entityType: 'Service',
        entityId: id,
        before,
        after,
      });
      return after;
    });
    invalidateCatalogCache();
    return result;
  } catch (err) {
    rethrowAsSlugTaken(err);
  }
}

export async function adminDeleteService(id: string, actorUserId: string) {
  assertNotLocalNode('The catalog');
  await prisma.$transaction(async (tx) => {
    const before = await tx.service.findUnique({
      where: { id },
      include: { bookings: { select: { id: true }, take: 1 } },
    });
    if (!before) throw new DomainError('not_found', 'not_found', 404);
    if (before.bookings.length > 0) {
      throw new DomainError('service_has_bookings', 'service_has_bookings', 409);
    }
    await tx.service.delete({ where: { id } });
    await audit(tx, {
      actorUserId,
      action: 'DELETE',
      entityType: 'Service',
      entityId: id,
      before,
    });
  });
  invalidateCatalogCache();
}

export async function adminTogglePriceRule(id: string, isActive: boolean, actorUserId: string) {
  assertNotLocalNode('The catalog');
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.priceRule.findUnique({ where: { id } });
    if (!before) throw new DomainError('not_found', 'not_found', 404);
    const after = await tx.priceRule.update({ where: { id }, data: { isActive } });
    await audit(tx, {
      actorUserId,
      action: 'PRICE_CHANGE',
      entityType: 'PriceRule',
      entityId: id,
      before,
      after,
    });
    return after;
  });
  invalidateCatalogCache();
  return result;
}

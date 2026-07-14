import 'server-only';
import { unstable_cache } from 'next/cache';
import type { CategoryType } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { resortCivilDayUTC } from '@/lib/date';

/**
 * Thin read-side queries for the public booking flow. Service-layer code calls
 * Prisma directly; these helpers exist to keep page components from importing
 * Prisma themselves.
 *
 * Caching strategy
 * ────────────────
 * The catalog (categories, services, copy, images, prices) only changes when
 * an admin edits it, yet every customer page view used to re-query it. The
 * pure-catalog reads below are wrapped in `unstable_cache` under the
 * {@link CATALOG_CACHE_TAG} tag: admin mutations call
 * `revalidateTag('catalog')` (see `admin-catalog.ts`) so edits show up
 * immediately, and `revalidate: 300` is a safety net for out-of-band writes
 * (e.g. the seed script).
 *
 * LIVE data (today's booked capacity) is deliberately kept OUT of the cached
 * payload — `listActiveCategoriesWithServices` merges it in per request from
 * one cheap `groupBy`.
 *
 * NOTE: `unstable_cache` JSON-serialises results, so `Date` fields
 * (`createdAt`/`updatedAt`) come back as ISO strings on cache hits. No caller
 * renders those fields; if a future page needs them, parse explicitly.
 */

/** Cache tag covering every cached catalog read. */
export const CATALOG_CACHE_TAG = 'catalog';

const CATALOG_CACHE_OPTS = { tags: [CATALOG_CACHE_TAG], revalidate: 300 };

export const listActiveCategories = unstable_cache(
  async () =>
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    }),
  ['catalog:categories'],
  CATALOG_CACHE_OPTS,
);

/**
 * Cached catalog skeleton for the booking landing/tab pages: active categories
 * with a slim projection of each active service. Contains NO live data, so the
 * whole payload is shared across visitors until an admin edits the catalog.
 *
 * The Beaches / Activities tabs render straight from this (they only show
 * copy + "from" price). The AURELIA landing page layers live capacity on top —
 * use {@link listActiveCategoriesWithServices} there.
 */
export const listActiveCategoryCards = unstable_cache(
  async (type?: CategoryType) =>
    prisma.category.findMany({
      where: { isActive: true, ...(type ? { type } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
      include: {
        services: {
          where: { isActive: true },
          select: {
            id: true,
            slug: true,
            kind: true,
            basePriceCents: true,
            dailyCapacityPeople: true,
            dailyCapacityCars: true,
            highlightsEn: true,
            highlightsAr: true,
            openTime: true,
            closeTime: true,
          },
        },
      },
    }),
  ['catalog:category-cards'],
  CATALOG_CACHE_OPTS,
);

/**
 * Catalog cards + TODAY'S booked capacity per service (drives the
 * open/filling/closed status + occupancy meter on the AURELIA landing page).
 *
 * The catalog part comes from the shared cache; the live part is read from the
 * AUTHORITATIVE per-day reservation counter (`BookingSlot`), the exact same
 * number the booking engine checks the cap against (`booking-calc`). It is
 * critical this matches the engine: the previous version counted BOOKING ROWS
 * (`booking.groupBy._count`), so a single 3-umbrella booking showed as "1"
 * while it reserved 3 units — the meter rendered a sold-out day as open. Reading
 * `reservedPeople` fixes that and, for free, the multi-day (day 2..N has its own
 * slot row) and PENDING-hold (holds reserve no slot) desyncs in one shot.
 */
export async function listActiveCategoriesWithServices(type?: CategoryType) {
  // Resort-LOCAL civil day (TZ-independent), matching how BookingSlot.date is
  // keyed (Date.UTC of the civil day) and the gate/engine — otherwise the
  // occupancy meter shows the wrong day for ~2-3h around Cairo midnight.
  const todayStart = new Date(resortCivilDayUTC());
  const todayEnd = new Date(resortCivilDayUTC() + 86_400_000);

  const [categories, slots] = await Promise.all([
    listActiveCategoryCards(type),
    prisma.bookingSlot.findMany({
      where: { date: { gte: todayStart, lt: todayEnd } },
      select: { serviceId: true, reservedPeople: true, reservedCars: true },
    }),
  ]);

  // One slot row per (serviceId, date); `reservedPeople` already equals the
  // summed `unitCapacityCost` (units for ticket kinds, headcount for EVENT), so
  // it is the directly-comparable "slots used today" the cap is measured in.
  const byService = new Map(
    slots.map((s) => [s.serviceId, { slotsUsed: s.reservedPeople, cars: s.reservedCars }]),
  );

  return categories.map((c) => ({
    ...c,
    services: c.services.map((s) => ({
      ...s,
      todayBooked: byService.get(s.id) ?? { slotsUsed: 0, cars: 0 },
    })),
  }));
}

export const getCategoryBySlug = unstable_cache(
  async (slug: string) =>
    prisma.category.findFirst({
      where: { slug, isActive: true },
      include: {
        services: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
        },
      },
    }),
  ['catalog:category-by-slug'],
  CATALOG_CACHE_OPTS,
);

/** Coerce a stored JSON column into a plain `string[]`, skipping non-string entries. */
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/**
 * Read a category plus the parsed about-page extras (gallery + highlights).
 * Returns null when the slug doesn't exist or the category is hidden.
 */
export const getCategoryAboutBySlug = unstable_cache(
  async (slug: string) => {
    const cat = await prisma.category.findFirst({ where: { slug, isActive: true } });
    if (!cat) return null;
    return {
      ...cat,
      galleryUrls: asStringArray(cat.galleryUrls),
      highlightsEn: asStringArray(cat.highlightsEn),
      highlightsAr: asStringArray(cat.highlightsAr),
      termsEn: asStringArray(cat.termsEn),
      termsAr: asStringArray(cat.termsAr),
    };
  },
  ['catalog:category-about'],
  CATALOG_CACHE_OPTS,
);

export const getServiceBySlug = unstable_cache(
  async (categorySlug: string, serviceSlug: string) =>
    prisma.service.findFirst({
      where: {
        slug: serviceSlug,
        isActive: true,
        category: { slug: categorySlug, isActive: true },
      },
      // NOTE: price rules are deliberately NOT included — quoting happens
      // server-side in booking-calc; the selection page only renders the
      // service/category copy and base price.
      include: { category: true },
    }),
  ['catalog:service-by-slug'],
  CATALOG_CACHE_OPTS,
);

import type { Locale } from '@/i18n/config';
import { resortHourMinute } from '@/lib/date';

/**
 * Bridges the database `Category` model to the AURELIA card props. The
 * design surfaces a few fields the DB doesn't store (status, vibe, hours,
 * price tier, kicker, tags); each is derived from real data where possible
 * and falls back to neutral defaults so a sparsely-populated category still
 * renders the AURELIA layout cleanly.
 *
 * Pure functions only — no Prisma, no React. Safe to import anywhere.
 */

import type { AureliaStatus } from './StatusDot';

export interface CategoryWithExtras {
  id: string;
  slug: string;
  /** NORMAL = beach category, ACTIVITY = activities category. Drives the card kicker. */
  type?: 'NORMAL' | 'ACTIVITY';
  nameEn: string;
  nameAr: string;
  descEn: string | null;
  descAr: string | null;
  /** Long-form storytelling shown inside the detail sheet. */
  longDescEn?: string | null;
  longDescAr?: string | null;
  coverUrl: string | null;
  isActive: boolean;
  galleryUrls?: unknown; // Prisma Json column
  videoUrl?: string | null;
  highlightsEn?: unknown;
  highlightsAr?: unknown;
  /**
   * JSON-encoded `string[]` of Terms & Policy bullets shown in the detail
   * sheet's collapsible section. Same shape as `highlightsEn/Ar`.
   */
  termsEn?: unknown;
  termsAr?: unknown;
  addressEn?: string | null;
  addressAr?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  services: Array<{
    id: string;
    kind: 'DAY_USE' | 'CABANA' | 'EVENT' | 'OTHER';
    basePriceCents: number;
    dailyCapacityPeople: number | null;
    dailyCapacityCars?: number | null;
    highlightsEn?: unknown;
    highlightsAr?: unknown;
    openTime?: string | null;
    closeTime?: string | null;
    /**
     * TODAY's AUTHORITATIVE reservation, read straight from `BookingSlot`:
     *  - `slotsUsed` = `reservedPeople` (units for ticket kinds, headcount for
     *    EVENT) — the same number the booking engine checks the cap against.
     *  - `cars` = `reservedCars`.
     * This is the exact value `dailyCapacityPeople` / `dailyCapacityCars` gate,
     * so the meter can never disagree with what actually sells.
     */
    todayBooked: { slotsUsed: number; cars: number };
  }>;
}

/**
 * Card "kicker" — the badge text on the top-left of each card. Reflects the
 * category type: a beach (NORMAL) category reads "Beach", an activities
 * (ACTIVITY) category reads "Activity". Defaults to Beach when the type is
 * absent (legacy rows default to NORMAL in the schema).
 */
export function deriveKicker(c: CategoryWithExtras, locale: Locale): string {
  if (c.type === 'ACTIVITY') return locale === 'ar' ? 'نشاط' : 'Activity';
  return locale === 'ar' ? 'شاطئ' : 'Beach';
}

/**
 * Price tier 1–4 from the cheapest active service. Buckets:
 *  ≤ 200 EGP → 1, ≤ 500 → 2, ≤ 1500 → 3, > 1500 → 4.
 * Categories with no services default to tier 2 (mid) so the dollar marks
 * never look empty.
 */
export function derivePriceTier(c: CategoryWithExtras): number {
  if (c.services.length === 0) return 2;
  const cheapest = Math.min(...c.services.map((s) => s.basePriceCents));
  const egp = cheapest / 100;
  if (egp <= 200) return 1;
  if (egp <= 500) return 2;
  if (egp <= 1500) return 3;
  return 4;
}

/**
 * Status derivation. Now checks the current time against the operational hours.
 * This reflects the CURRENT state of the experience (Live status).
 */
export function deriveStatus(c: CategoryWithExtras): AureliaStatus {
  if (!c.isActive) return 'closed';
  // A category with no bookable services yet is "coming soon" — never open or
  // closed (there is nothing to open or sell out).
  if (c.services.length === 0) return 'soon';

  // Calculate occupancy first to see if we should flag as "filling".
  // `slotsUsed` is the authoritative reserved-units counter, the same value the
  // engine checks the cap against — so the meter sells out exactly when booking
  // does. A service is also sold out if its CARS cap is reached (the engine
  // rejects further car bookings even when people-light).
  let totalCapacity = 0;
  let totalBooked = 0;
  let carsFull = false;
  c.services.forEach((s) => {
    if (s.dailyCapacityPeople) {
      totalCapacity += s.dailyCapacityPeople;
      totalBooked += s.todayBooked.slotsUsed;
    }
    if (s.dailyCapacityCars != null && s.todayBooked.cars >= s.dailyCapacityCars) {
      carsFull = true;
    }
  });

  const isFullToday = (totalCapacity > 0 && totalBooked >= totalCapacity) || carsFull;
  if (isFullToday) return 'closed'; // Sold out for today

  // If no times are set, default to "open" for active categories.
  const servicesWithTime = c.services.filter((s) => s.openTime && s.closeTime);
  if (servicesWithTime.length === 0) return 'open';

  // Check current time against the RESORT (Africa/Cairo) clock — never the
  // visitor's browser timezone — so a non-Cairo guest sees the same open/closed
  // state the gate enforces.
  const currentHM = resortHourMinute();

  // Is any service currently open?
  const isAnyOpen = servicesWithTime.some((s) => {
    const { openTime, closeTime } = s;
    if (!openTime || !closeTime) return false;

    // Handle overnight shifts (e.g. 18:00 - 02:00)
    if (closeTime < openTime) {
      return currentHM >= openTime || currentHM <= closeTime;
    }
    return currentHM >= openTime && currentHM <= closeTime;
  });

  if (!isAnyOpen) return 'closed';

  // Flag as "filling" if occupancy is high (>85%) or capacity is critically low
  const occupancy = totalCapacity > 0 ? totalBooked / totalCapacity : 0;
  if (occupancy > 0.85 || (totalCapacity > 0 && totalCapacity - totalBooked <= 10)) {
    return 'filling';
  }

  return 'open';
}

/** Localised "next slot" copy. Pure stub for now. */
export function deriveSlotLabel(
  c: CategoryWithExtras,
  copy: { now: string; opens: string; closed: string },
): string {
  const status = deriveStatus(c);
  if (status === 'closed') return copy.closed;
  // "Coming soon" categories reuse the "opens soon" slot copy.
  if (status === 'soon') return copy.opens;
  return copy.now;
}

/**
 * Tags shown inside the cards. Reads the `highlightsEn`/`highlightsAr`
 * from the Category first, then appends any highlights from its Services.
 * Returns up to 5 unique tags.
 */
export function deriveTags(c: CategoryWithExtras, locale: Locale): string[] {
  const tags = new Set<string>();

  // 1. Add Category highlights
  const catRaw = locale === 'ar' ? c.highlightsAr : c.highlightsEn;
  if (Array.isArray(catRaw)) {
    catRaw.forEach((v) => {
      if (typeof v === 'string' && v.length > 0) tags.add(v);
    });
  }

  // 2. Add Service highlights
  c.services.forEach((s) => {
    const sRaw = locale === 'ar' ? s.highlightsAr : s.highlightsEn;
    if (Array.isArray(sRaw)) {
      sRaw.forEach((v) => {
        if (typeof v === 'string' && v.length > 0) tags.add(v);
      });
    }
  });

  if (tags.size > 0) {
    return Array.from(tags).slice(0, 5);
  }

  // 3. Fallback to kind-based defaults if nothing is defined.
  const dominantKind = c.services[0]?.kind ?? 'OTHER';
  const defaults: Record<string, { en: string[]; ar: string[] }> = {
    DAY_USE: { en: ['Day pass', 'Lunch'], ar: ['دخول يومي', 'غداء'] },
    CABANA: { en: ['Cabana', 'Butler'], ar: ['كبانة', 'خدمة'] },
    EVENT: { en: ['Event', 'Private'], ar: ['فعالية', 'خاص'] },
    OTHER: { en: ['Crown', 'Premium'], ar: ['كراون', 'مميز'] },
  };
  const set = defaults[dominantKind] ?? defaults.OTHER!;
  return locale === 'ar' ? set.ar : set.en;
}

/** Pick a stable hero image, preferring real upload → gallery → unsplash. */
export function deriveImage(c: CategoryWithExtras): string {
  if (c.coverUrl && c.coverUrl.length > 0) return c.coverUrl;
  if (Array.isArray(c.galleryUrls) && typeof c.galleryUrls[0] === 'string') {
    return c.galleryUrls[0] as string;
  }
  // Final fallback — Unsplash beach scene so cards never show black.
  return 'https://images.unsplash.com/photo-1506929562872-bb421503ef21?auto=format&fit=crop&w=1200&q=80';
}

/**
 * A directly-playable video file (mp4/webm/mov/…) — the kind we can drop into a
 * native muted-autoplay `<video>` as the detail-sheet hero. YouTube / Vimeo and
 * other embed URLs return false (they can't be an inline looping background, so
 * they fall back to the image hero + the dedicated video section). Mirrors the
 * extension set in `ExperienceVideo`.
 */
const DIRECT_VIDEO_RE = /\.(mp4|webm|mov|m4v|ogg|ogv)(\?.*)?$/i;
export function isDirectVideoFile(url: string | null | undefined): url is string {
  return typeof url === 'string' && DIRECT_VIDEO_RE.test(url);
}

/** Parsed `string[]` of gallery URLs for the detail-sheet horizontal strip. */
export function deriveGallery(c: CategoryWithExtras): string[] {
  if (!Array.isArray(c.galleryUrls)) return [];
  return (c.galleryUrls as unknown[]).filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
}

/**
 * Hours-of-operation summary. Now reads from the services if available.
 */
export function deriveHours(c: CategoryWithExtras, locale: Locale): string {
  // Find the earliest open and latest close across all services.
  const servicesWithTime = c.services.filter((s) => s.openTime && s.closeTime);

  if (servicesWithTime.length === 0) {
    // Fallback if admin hasn't set any times yet.
    const dominantKind = c.services[0]?.kind ?? 'OTHER';
    const en: Record<string, string> = {
      DAY_USE: '10:00 – 22:00',
      CABANA: 'All day',
      EVENT: '18:00 – late',
      OTHER: 'See schedule',
    };
    const ar: Record<string, string> = {
      DAY_USE: '٢٢:٠٠ - ١٠:٠٠',
      CABANA: 'طوال اليوم',
      EVENT: 'من ١٨:٠٠',
      OTHER: 'حسب الجدول',
    };
    return (locale === 'ar' ? ar : en)[dominantKind] ?? '';
  }

  const times = servicesWithTime.map((s) => ({
    open: s.openTime!,
    close: s.closeTime!,
  }));

  const earliestOpen = [...times].sort((a, b) => a.open.localeCompare(b.open))[0]?.open;
  const latestClose = [...times].sort((a, b) => b.close.localeCompare(a.close))[0]?.close;

  if (locale === 'ar') {
    return `${latestClose} - ${earliestOpen}`;
  }
  return `${earliestOpen} – ${latestClose}`;
}

/**
 * Google Maps link for the category's location. Prefers exact coordinates
 * (`latitude`/`longitude`); otherwise falls back to a text search on the
 * localized address. Returns null when the category has neither, so the caller
 * renders the address as plain (non-clickable) text.
 */
export function deriveMapsUrl(c: CategoryWithExtras, locale: Locale): string | null {
  const lat = typeof c.latitude === 'number' ? c.latitude : null;
  const lng = typeof c.longitude === 'number' ? c.longitude : null;
  if (lat != null && lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${lat}%2C${lng}`;
  }
  const address = (locale === 'ar' ? c.addressAr : c.addressEn)?.trim();
  if (address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  }
  return null;
}

/**
 * Real capacity calculation based on today's bookings.
 */
export function deriveCapacity(c: CategoryWithExtras): number {
  const status = deriveStatus(c);
  // No services → nothing booked/available; show an empty occupancy meter
  // rather than the pseudo-random fallback.
  if (status === 'closed' || status === 'soon') return 0;

  let totalCapacity = 0;
  let totalBooked = 0;

  c.services.forEach((s) => {
    if (s.dailyCapacityPeople) {
      totalCapacity += s.dailyCapacityPeople;
      totalBooked += s.todayBooked.slotsUsed;
    }
  });

  if (totalCapacity > 0) {
    // Return actual percentage (0.0 to 1.0)
    return Math.min(1, totalBooked / totalCapacity);
  }

  // Stable 30%–90% pseudo-capacity fallback if no capacity is set.
  if (status === 'filling') return 0.91;
  let h = 0;
  for (let i = 0; i < c.slug.length; i++) {
    h = (h * 31 + c.slug.charCodeAt(i)) | 0;
  }
  return 0.3 + (Math.abs(h) % 60) / 100;
}

/** "from EGP 350" / "من ٣٥٠ ج.م" — uses the cheapest active service. */
export function deriveFromPrice(
  c: CategoryWithExtras,
  copy: { fromLabel: string; currency: string },
): string | null {
  if (c.services.length === 0) return null;
  const cheapest = Math.min(...c.services.map((s) => s.basePriceCents));
  const egp = cheapest / 100;
  if (!Number.isFinite(egp) || egp <= 0) return null;
  return `${copy.fromLabel} ${copy.currency} ${egp.toFixed(0)}`;
}

/** Labels for the price tier inside the detail sheet's InfoBlock. */
export const PRICE_TIER_LABELS_EN = ['', 'Budget', 'Mid', 'Premium', 'Signature'] as const;
export const PRICE_TIER_LABELS_AR = ['', 'اقتصادي', 'متوسط', 'مميز', 'سيجنتشر'] as const;

/**
 * Available filter ids — derived from the actual service kinds present in
 * the catalog so the chip rail only offers buckets that match real data.
 */
export function deriveAvailableKinds(categories: CategoryWithExtras[]): string[] {
  const kinds = new Set<string>();
  for (const c of categories) for (const s of c.services) kinds.add(s.kind);
  return Array.from(kinds);
}

/** Apply the current chip filter. `'all'` shows everything. */
export function filterByKind(
  categories: CategoryWithExtras[],
  filterId: string,
): CategoryWithExtras[] {
  if (filterId === 'all') return categories;
  return categories.filter((c) => c.services.some((s) => s.kind === filterId));
}

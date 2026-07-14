'use client';

import { Fragment } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, HomeIcon, MoreHorizontalIcon } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

/**
 * Breadcrumb trail derived from the current pathname.
 *
 * Design notes
 * ────────────
 * - Locale-aware: `usePathname()` from `@/i18n/navigation` already strips the
 *   `/ar` / `/en` prefix, so `/ar/admin/bookings/clxyz` resolves to
 *   `/admin/bookings/clxyz` here. The locale is read separately so the chevron
 *   separator flips under RTL.
 * - Labels come from the `breadcrumbs` translation namespace. Segments not in
 *   the map are humanised: kebab/snake-case → Title Case. Cuid-shaped IDs and
 *   long opaque strings are rendered as a short generic label
 *   (`breadcrumbs._detail`) so they don't dump 24 random characters into the
 *   header.
 * - Anything that looks like a UUID/cuid/cuid2 or is ≥ 16 chars without a
 *   space is treated as an opaque id. Reduces noise without needing a per-page
 *   override.
 * - Single-segment paths (e.g. `/admin` itself) render nothing — there's
 *   nowhere to navigate "up" to, so the breadcrumb adds no value.
 *
 * If a page wants precise labels (e.g. resolving a service slug to its
 * display name), it can pass `items` to override the auto-derivation entirely.
 */

export interface BreadcrumbItem {
  /** Display label. Render as-is, not translated. */
  label: string;
  /** Optional href. Last item is rendered as plain text regardless. */
  href?: string;
}

interface Props {
  /** Optional explicit trail. When provided, auto-derivation is skipped. */
  items?: BreadcrumbItem[];
  /** Hide the leading "Home" link. Defaults to false. */
  hideHome?: boolean;
  /**
   * Where the leading "Home" link points. Defaults to `/booking` (customer
   * surface). The admin shell passes `/admin` so the home anchor lands on
   * the dashboard instead of the customer booking root.
   */
  homeHref?: string;
  /**
   * Segment names that should be rendered as plain text (no link) when they
   * appear as intermediate trail items. Use this for URL prefixes that have
   * no `page.tsx` — e.g. `/map` in the customer app is only reachable as
   * `/map/[bookingId]`, so the breadcrumb "Map" should not be clickable.
   *
   * Compared against the raw segment string (`'map'`, `'bookings'`, …) not
   * the full href. Match is exact, case-sensitive.
   *
   * If a segment also belongs to a real page, prefer creating that page
   * (often a tiny `redirect()`) over adding it here — a clickable trail item
   * is better UX than a dead one when there's a sensible destination.
   */
  nonClickableSegments?: ReadonlyArray<string>;
  className?: string;
}

/**
 * Detect opaque-id segments so we don't dump 24-character cuids into the
 * breadcrumb. Tight on purpose — we'd rather miss the occasional unusual id
 * than misclassify a long but human-readable slug.
 *
 *  - cuid       (Prisma default): `c` + 24+ lowercase/digit chars
 *  - cuid2      : 24-32 lowercase/digit chars
 *  - uuid v1-v5 : 8-4-4-4-12 hex
 */
const OPAQUE_PATTERNS: ReadonlyArray<RegExp> = [
  /^c[a-z0-9]{20,}$/,                                                 // cuid
  /^[a-z0-9]{24,32}$/,                                                // cuid2-ish
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,  // uuid
];

function isOpaqueId(segment: string): boolean {
  return OPAQUE_PATTERNS.some((re) => re.test(segment));
}

function humanise(segment: string): string {
  return segment
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Breadcrumbs({
  items,
  hideHome = false,
  homeHref = '/booking',
  nonClickableSegments,
  className,
}: Props) {
  const t = useTranslations('breadcrumbs');
  const locale = useLocale();
  const pathname = usePathname();
  const Chevron = locale === 'ar' ? ChevronLeftIcon : ChevronRightIcon;

  const trail: BreadcrumbItem[] = items ?? buildTrailFromPath(
    pathname,
    (key) => {
      // We can't probe the message catalogue at runtime; tolerate misses by
      // falling back to the humanised segment.
      try {
        const v = t(key);
        // next-intl returns the key itself when the translation is missing,
        // so detect that and use the humanised form instead.
        return v === `breadcrumbs.${key}` ? null : v;
      } catch {
        return null;
      }
    },
    nonClickableSegments,
  );

  if (trail.length === 0) return null;
  const homeLabel = (() => {
    try {
      return t('_home');
    } catch {
      return 'Home';
    }
  })();

  // The current page is always shown; everything before it is the "middle".
  // On small screens the middle collapses to a single ellipsis so the trail
  // stays on ONE line (no wrap, no horizontal scroll); the full trail returns
  // at `sm:` and up.
  const current = trail[trail.length - 1]!;
  const middle = trail.slice(0, -1);
  const hasMiddle = middle.length > 0;

  return (
    // `flex` (not block) so the `justify-end` the shell passes actually aligns
    // the trail to the trailing edge — and `min-w-0` lets it shrink + truncate
    // instead of overflowing.
    <nav aria-label="breadcrumb" className={cn('flex min-w-0 text-xs text-muted-foreground', className)}>
      <ol className="flex min-w-0 items-center gap-0.5 sm:gap-1">
        {!hideHome && (
          <>
            <li className="flex shrink-0">
              <Link
                href={homeHref}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-accent/10 hover:text-accent"
              >
                <HomeIcon className="size-3.5 shrink-0" aria-hidden />
                <span className="sr-only sm:not-sr-only">{homeLabel}</span>
              </Link>
            </li>
            <Separator Chevron={Chevron} />
          </>
        )}

        {/* Collapsed middle — mobile only, shown when there are middle crumbs. */}
        {hasMiddle && (
          <>
            <li className="flex shrink-0 sm:hidden">
              <span
                className="flex min-h-8 items-center rounded-md px-1.5 text-muted-foreground/70"
                aria-label="Show path"
              >
                <MoreHorizontalIcon className="size-4" aria-hidden />
              </span>
            </li>
            <Separator Chevron={Chevron} className="sm:hidden" />
          </>
        )}

        {/* Middle crumbs — desktop only (collapsed into the ellipsis on mobile). */}
        {middle.map((item, i) => (
          <Fragment key={`${item.label}-${i}`}>
            <li className="hidden min-w-0 shrink sm:flex">
              {item.href ? (
                <Link
                  href={item.href}
                  className="inline-block max-w-[16ch] truncate rounded-md px-2 py-1 transition-colors hover:bg-muted/60 hover:text-foreground"
                >
                  {item.label}
                </Link>
              ) : (
                <span className="inline-block max-w-[16ch] truncate px-2 py-1">{item.label}</span>
              )}
            </li>
            <Separator Chevron={Chevron} className="hidden sm:flex" />
          </Fragment>
        ))}

        {/* Current page — always shown, emphasised, truncates if long. */}
        <li className="flex min-w-0 shrink">
          <span aria-current="page" className="min-w-0 truncate px-2 py-1 font-medium text-foreground">
            {current.label}
          </span>
        </li>
      </ol>
    </nav>
  );
}

/** Breadcrumb separator — a direction-aware chevron, hidden from a11y. */
function Separator({
  Chevron,
  className,
}: {
  Chevron: typeof ChevronRightIcon;
  className?: string;
}) {
  return (
    <li role="presentation" aria-hidden="true" className={cn('flex shrink-0 items-center', className)}>
      <Chevron className="size-3.5 opacity-40" strokeWidth={2.5} />
    </li>
  );
}

/**
 * Derive the breadcrumb trail from a locale-stripped pathname.
 *
 * `lookup` is a tiny indirection over the translation catalogue: returns a
 * translated label if the key exists, otherwise null. Kept as a parameter so
 * the function is unit-testable without next-intl context.
 *
 * `nonClickableSegments` (optional): raw segment names that must NOT be
 * rendered as links even when they appear in the middle of the trail. The
 * caller uses this for URL prefixes that have no `page.tsx` and therefore
 * shouldn't be clickable.
 *
 * Exported for tests.
 */
export function buildTrailFromPath(
  pathname: string,
  lookup: (key: string) => string | null,
  nonClickableSegments?: ReadonlyArray<string>,
): BreadcrumbItem[] {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length <= 1) return [];

  const blocked = nonClickableSegments
    ? new Set(nonClickableSegments)
    : null;

  const trail: BreadcrumbItem[] = [];
  let href = '';

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    href += `/${seg}`;

    let label: string;
    if (isOpaqueId(seg)) {
      label = lookup('_detail') ?? '…';
    } else {
      label = lookup(seg) ?? humanise(seg);
    }

    const isLast = i === segments.length - 1;
    const isBlocked = blocked?.has(seg) ?? false;
    // Suppress href for: the last segment (page itself, ARIA current), AND
    // for any segment the caller flagged as a dead-end prefix.
    trail.push({ label, href: isLast || isBlocked ? undefined : href });
  }

  return trail;
}

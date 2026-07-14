'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import { Breadcrumbs } from './Breadcrumbs';
import { BackButton } from './BackButton';
import { cn } from '@/lib/cn';

/**
 * Composite "page header" — the breadcrumb trail on the leading side and a
 * `BackButton` on the trailing side. Rendered just inside the main scroll area
 * by each shell so it sticks under whatever sticky chrome already exists.
 *
 * Hidden when the current path is a top-level entry point — those pages are
 * the bottom-nav anchors / dashboard root, so "back" and "trail" both add
 * noise. The shell decides which prefixes count as top-level via the
 * `topLevelPaths` prop.
 *
 * NOTE on history-aware behaviour: `BackButton` falls back to `fallbackHref`
 * when there's no browser history. Make sure each shell passes a sensible
 * fallback — `/booking` for the customer app, `/admin` for the panel.
 */

interface Props {
  /**
   * Exact paths that should NOT render this nav. Compared against the
   * locale-stripped pathname for equality only (sub-pages still show the
   * nav — that's the whole point).
   */
  topLevelPaths?: string[];
  /** Fallback target for the back button when no history is available. */
  backFallbackHref?: string;
  /** Override the breadcrumb home target. Defaults to the back fallback. */
  homeHref?: string;
  /**
   * Forwarded to `<Breadcrumbs>`. Use for URL prefixes that have no
   * rendered page (e.g. customer-side `/map` only exists as
   * `/map/[bookingId]`). See the prop docs on `<Breadcrumbs>`.
   */
  nonClickableSegments?: ReadonlyArray<string>;
  className?: string;
}

export function PageNav({
  topLevelPaths = [],
  backFallbackHref = '/booking',
  homeHref,
  nonClickableSegments,
  className,
}: Props) {
  const pathname = usePathname();
  const tCommon = useTranslations('common');

  if (topLevelPaths.includes(pathname)) return null;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-6',
        className,
      )}
    >
      <Breadcrumbs
        className="min-w-0 flex-1 justify-start"
        // Anchor the "Home" pip at the shell's home (customer `/booking` or
        // admin `/admin`). Defaults match `backFallbackHref` to keep the
        // common case one prop instead of two.
        homeHref={homeHref ?? backFallbackHref}
        nonClickableSegments={nonClickableSegments}
      />
      <BackButton fallbackHref={backFallbackHref} label={tCommon('back')} />
    </div>
  );
}

'use client';

import { usePathname } from '@/i18n/navigation';

/**
 * A spacer that appears on pages where {@link AppHeader} steps aside, so
 * the page content doesn't slide under the iOS notch / Android status bar.
 *
 * The prefix list MUST stay in sync with the one inside `AppHeader.tsx`.
 * It would be possible to lift that constant to a shared file, but the
 * coupling is tight enough (two files, three lines each) that duplication
 * is cheaper than the import dance.
 */
const HEADERLESS_PREFIXES = ['/booking', '/bookings', '/menu', '/settings'];

export function HeaderlessTopPad() {
  const pathname = usePathname();
  const headerless = HEADERLESS_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (!headerless) return null;
  // `env(safe-area-inset-top)` is 0 on desktop and ~44–47 px on iOS with a
  // notch. `min-h-5` (20 px) is a comfortable floor so the first element of
  // the page never sits flush against the viewport top on non-notched
  // devices — works equally well for the AURELIA brand bar (booking) and
  // for the smaller `TopNav` headers (menu, settings, bookings/history).
  return (
    <div
      aria-hidden
      className="min-h-5 w-full pt-[env(safe-area-inset-top)]"
    />
  );
}

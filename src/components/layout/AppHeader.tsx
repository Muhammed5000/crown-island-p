'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { Avatar } from '@/components/ui/Avatar';
import { CrownLogo } from '@/components/brand/CrownLogo';
import { NotificationBell } from './NotificationBell';
import { cn } from '@/lib/cn';

interface Props {
  userName?: string | null;
  userImage?: string | null;
  isAuthenticated?: boolean;
  variant?: 'home' | 'app';
}

/**
 * Top app bar used inside the booking app.
 * Compact: crown mark + greeting on the left, notifications + avatar on the right.
 * For guests the avatar links to sign-in instead of the (gated) settings page.
 */
export function AppHeader({ userName, userImage, isAuthenticated = true, variant = 'app' }: Props) {
  const t = useTranslations('nav');
  const tBrand = useTranslations('common');
  // Pages that bring their own top chrome (e.g. AURELIA booking) or are
  // intentionally header-less per design (menu, more/settings) opt out by
  // path prefix. usePathname() from next-intl already strips the locale,
  // so `/en/booking` and `/booking` both resolve to "/booking" here.
  const pathname = usePathname();
  // Note: `/booking` (singular = booking funnel) and `/bookings` (plural =
  // history) are separate routes. Both opt out — the four primary tabs in
  // the bottom nav are all headerless now.
  const HEADERLESS_PREFIXES = ['/booking', '/bookings', '/menu', '/settings'];
  const isHeaderless = HEADERLESS_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (isHeaderless) return null;

  // The notifications inbox/detail bring their own header. On desktop (≥ xl) the
  // left DesktopRail already provides the bell + avatar + nav, so this top bar is
  // redundant there — hide it at xl while keeping it below xl (no rail/bottom nav
  // in that range), so navigation is never lost.
  const isNotifications =
    pathname === '/notifications' || pathname.startsWith('/notifications/');

  return (
    <header
      className={cn(
        'sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-border',
        'bg-card/80 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+8px)] backdrop-blur-xl',
        variant === 'home' && 'border-transparent bg-transparent backdrop-blur-none',
        isNotifications && 'xl:hidden',
      )}
    >
      {/* Brand logo doubles as the home affordance — points at /booking so it
          matches the Home tab in the bottom nav. The marketing landing at /
          redirects authenticated visitors back here anyway, so this just
          avoids a redirect round-trip when the logo is tapped. */}
      <Link href="/booking" className="flex items-center gap-2" aria-label={tBrand('appName')}>
        {/* Wordmark logo enlarged on phones only; tablet/desktop keep 150px.
            `!w-` overrides CrownLogo's inline width on the `max-sm` breakpoint. */}
        <CrownLogo size="sm" className="max-sm:!w-[182px]" />
      </Link>

      <div className="flex items-center gap-2">
        {isAuthenticated ? <NotificationBell /> : null}
        <Link
          href={isAuthenticated ? '/settings' : '/login'}
          aria-label={isAuthenticated ? t('profile') : t('signIn')}
        >
          <Avatar src={userImage} name={userName} />
        </Link>
      </div>
    </header>
  );
}

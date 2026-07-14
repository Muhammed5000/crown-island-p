'use client';

import {
  CalendarDaysIcon,
  CompassIcon,
  HomeIcon,
  SettingsIcon,
  UmbrellaIcon,
  UtensilsIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { Avatar } from '@/components/ui/Avatar';
import { CrownIcon } from '@/components/brand/CrownIcon';
import { NotificationBell } from './NotificationBell';
import { cn } from '@/lib/cn';
import { isNavItemActive } from './navActive';

interface Props {
  userName?: string | null;
  userImage?: string | null;
  isAuthenticated?: boolean;
}

/**
 * Desktop-only left navigation rail (≥ xl). The wide-canvas counterpart of the
 * mobile {@link BottomNav}: same four destinations, same active logic and the
 * same `nav` labels, so navigation is consistent across breakpoints.
 *
 * Rendered once by {@link AppShell}, so it appears on every authenticated app
 * page. It's `position: fixed` (full viewport height) so it stays put while the
 * page scrolls — the profile avatar at its foot is always reachable without
 * scrolling to the end. Hidden below `xl`, where the bottom tab bar takes over,
 * so the mobile/tablet experience is unchanged.
 */
const ITEMS = [
  { href: '/booking', key: 'home' as const, Icon: HomeIcon },
  { href: '/booking/beaches', key: 'beaches' as const, Icon: UmbrellaIcon },
  { href: '/booking/activities', key: 'activities' as const, Icon: CompassIcon },
  { href: '/bookings/history', key: 'bookings' as const, Icon: CalendarDaysIcon },
  { href: '/menu', key: 'menu' as const, Icon: UtensilsIcon },
  { href: '/settings', key: 'settings' as const, Icon: SettingsIcon },
];

export function DesktopRail({ userName, userImage, isAuthenticated = true }: Props) {
  const pathname = usePathname();
  const t = useTranslations('nav');

  return (
    <nav
      aria-label={t('home')}
      className={cn(
        'fixed inset-y-0 start-0 z-40 hidden w-[78px] flex-col items-center py-6',
        'border-e border-border bg-card/85 backdrop-blur-xl xl:flex',
      )}
    >
      <Link href="/booking" aria-label={t('home')} className="mb-[30px]">
        <CrownIcon size={44} />
      </Link>

      <div className="flex flex-1 flex-col items-center gap-1.5">
        {ITEMS.map(({ href, key, Icon }) => {
          const active = isNavItemActive(key, href, pathname);
          return (
            <Link
              key={key}
              href={href}
              title={t(key)}
              aria-label={t(key)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'grid size-[52px] place-items-center rounded-[14px] border transition-all',
                active
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="size-[22px]" strokeWidth={1.6} aria-hidden />
            </Link>
          );
        })}
      </div>

      {isAuthenticated ? <NotificationBell variant="link" className="mb-3" /> : null}
      <Link
        href={isAuthenticated ? '/settings' : '/login'}
        aria-label={isAuthenticated ? t('profile') : t('signIn')}
        className="rounded-full transition-transform hover:scale-105 active:scale-95"
      >
        <Avatar src={userImage} name={userName} size={38} />
      </Link>
    </nav>
  );
}


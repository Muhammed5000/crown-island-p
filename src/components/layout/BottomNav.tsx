'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { isNavItemActive } from './navActive';

/**
 * Mobile bottom tab bar.
 *
 * Matches the design source's `TabBar` (4 tabs, 70px tall, deep navy footer
 * with a soft top border). The 4 tabs are: Home / Bookings / Restaurant / More.
 * Hidden on `md+` where the desktop nav takes over.
 */

interface IconProps {
  className?: string;
}

function HomeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 22 22" fill="none" className={className} aria-hidden>
      <path
        d="M3 10 L11 3 L19 10 V19 H13 V13 H9 V19 H3 Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function BookingsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 22 22" fill="none" className={className} aria-hidden>
      <rect x="3" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M3 9 H19 M8 3 V7 M14 3 V7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
function RestaurantIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 22 22" fill="none" className={className} aria-hidden>
      <path
        d="M5 3 V11 M5 11 C5 12.5 6 13 7 13 M5 11 C5 12.5 4 13 3 13 M11 3 C11 3 9 4 9 7 C9 9 10 10 11 10 V19 M15 11 V19 M15 11 C18 11 19 9 19 6 C19 4 18 3 17 3 L15 5 V11 Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function SettingsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function BeachesIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 22 22" fill="none" className={className} aria-hidden>
      <path
        d="M2 7 q2.25 -2.4 4.5 0 t4.5 0 t4.5 0 t4.5 0 M2 12 q2.25 -2.4 4.5 0 t4.5 0 t4.5 0 t4.5 0 M2 17 q2.25 -2.4 4.5 0 t4.5 0 t4.5 0 t4.5 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function ActivitiesIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 22 22" fill="none" className={className} aria-hidden>
      <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M14.8 7.2 L9.4 9.4 L7.2 14.8 L12.6 12.6 Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// "Home" for signed-in users is the booking dashboard, not the marketing
// landing page — the landing redirects authenticated visitors back here
// anyway. `exact: false` so deeper booking subroutes (category, service,
// review, payment) still light the Home tab.
const ITEMS = [
  { href: '/booking', key: 'home' as const, Icon: HomeIcon },
  { href: '/booking/beaches', key: 'beaches' as const, Icon: BeachesIcon },
  { href: '/booking/activities', key: 'activities' as const, Icon: ActivitiesIcon },
  { href: '/bookings/history', key: 'bookings' as const, Icon: BookingsIcon },
  { href: '/menu', key: 'menu' as const, Icon: RestaurantIcon },
  { href: '/settings', key: 'settings' as const, Icon: SettingsIcon },
];

export function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations('nav');

  return (
    <nav
      aria-label={t('home')}
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/90 backdrop-blur-xl',
        'pb-[env(safe-area-inset-bottom)] xl:hidden',
      )}
    >
      <ul className="mx-auto flex h-16 max-w-md items-center justify-around px-1">
        {ITEMS.map(({ href, key, Icon }) => {
          const active = isNavItemActive(key, href, pathname);
          return (
            <li key={key} className="min-w-0 flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex flex-col items-center gap-1.5 px-0.5 py-2 text-[9px] font-bold tracking-wide transition-all',
                  active ? 'text-accent' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className={cn('size-[20px] transition-transform duration-300', active && 'scale-110')} />
                <span className={cn('max-w-full truncate transition-colors', active && 'text-accent')}>{t(key)}</span>
                {active && (
                  <span className="absolute -bottom-1 h-1 w-1 rounded-full bg-accent shadow-[0_0_8px_rgba(42,157,168,0.55)]" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

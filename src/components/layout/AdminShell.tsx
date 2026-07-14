'use client';

import {
  BellIcon,
  CalendarCheckIcon,
  CalendarXIcon,
  CreditCardIcon,
  FileTextIcon,
  HelpCircleIcon,
  HomeIcon,
  LayersIcon,
  LogOutIcon,
  ScanLineIcon,
  ScrollTextIcon,
  SettingsIcon,
  TagIcon,
  TagsIcon,
  BadgePercentIcon,
  PercentIcon,
  TicketIcon,
  UsersIcon,
  TerminalIcon,
  LayoutGridIcon,
  CompassIcon,
  UserRoundIcon,
  UserCogIcon,
  MessageSquareIcon,
  BarChart3Icon,
  WrenchIcon,
  UtensilsIcon,
  GavelIcon,
  KeyRoundIcon,
  ReceiptTextIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { CrownLogo } from '@/components/brand/CrownLogo';
import { cn } from '@/lib/cn';
import { signOutAction } from '@/features/auth/actions';
import { PageNav } from './PageNav';

interface Props {
  children: React.ReactNode;
  user: { name: string | null; email: string | null; role: string };
}

const items = [
  { key: 'dashboard' as const, href: '/admin', icon: HomeIcon, exact: true },
  { key: 'reports' as const, href: '/admin/reports', icon: BarChart3Icon },
  { key: 'bookings' as const, href: '/admin/bookings', icon: CalendarCheckIcon },
  { key: 'cancellationRequests' as const, href: '/admin/cancellation-requests', icon: CalendarXIcon },
  { key: 'insuranceRefunds' as const, href: '/admin/insurance-refunds', icon: ShieldCheckIcon },
  { key: 'customers' as const, href: '/admin/customers', icon: UserRoundIcon },
  { key: 'guestComments' as const, href: '/admin/guest-comments', icon: MessageSquareIcon },
  { key: 'notifications' as const, href: '/admin/notifications', icon: BellIcon },
  { key: 'sanctions' as const, href: '/admin/sanctions', icon: GavelIcon },
  { key: 'tags' as const, href: '/admin/tags', icon: TagsIcon },
  { key: 'capacityPreview' as const, href: '/admin/capacity', icon: LayoutGridIcon },
  { key: 'categories' as const, href: '/admin/categories', icon: LayersIcon },
  { key: 'activitiesCategories' as const, href: '/admin/activities-categories', icon: CompassIcon },
  { key: 'services' as const, href: '/admin/services', icon: TicketIcon },
  { key: 'pricing' as const, href: '/admin/pricing', icon: TagIcon },
  { key: 'promos' as const, href: '/admin/promos', icon: BadgePercentIcon },
  { key: 'discounts' as const, href: '/admin/discounts', icon: PercentIcon },
  { key: 'users' as const, href: '/admin/users', icon: UsersIcon },
  { key: 'invoices' as const, href: '/admin/invoices', icon: FileTextIcon },
  { key: 'payments' as const, href: '/admin/payments', icon: CreditCardIcon },
  { key: 'gateActivity' as const, href: '/admin/gate-activity', icon: ScanLineIcon },
  { key: 'zkCards' as const, href: '/admin/zk-cards', icon: KeyRoundIcon },
  { key: 'staff' as const, href: '/admin/staff', icon: UserCogIcon },
  { key: 'restaurants' as const, href: '/admin/restaurants', icon: UtensilsIcon },
  { key: 'operations' as const, href: '/gate/ops', icon: WrenchIcon },
  { key: 'auditLogs' as const, href: '/admin/audit-logs', icon: ScrollTextIcon },
  { key: 'terms' as const, href: '/admin/terms', icon: ScrollTextIcon },
  { key: 'refundPolicy' as const, href: '/admin/refund-policy', icon: ReceiptTextIcon },
  { key: 'settings' as const, href: '/admin/settings', icon: SettingsIcon },
  { key: 'developer' as const, href: '/admin/developer', icon: TerminalIcon },
];

/**
 * Admin layout — fixed sidebar on `md+`, slide-down panel on mobile.
 */
export function AdminShell({ children, user }: Props) {
  const t = useTranslations('admin');
  const tAuth = useTranslations('auth');
  const tCommon = useTranslations('common');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-dvh bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 z-40 flex w-64 flex-col border-e border-border/40 bg-card/95 backdrop-blur-lg transition-transform duration-300 md:static md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full rtl:md:translate-x-0',
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border/40 px-5 py-4">
          <Link href="/admin" className="flex items-center gap-2">
            <CrownLogo size="sm" />
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto p-3" aria-label={t('dashboard')}>
          <ul className="space-y-1">
            {items
              .filter((item) => {
                if (item.key === 'users' && user.role !== 'SUPER_ADMIN' && user.role !== 'DEVELOPER') return false;
                // Audit trail (IPs + PII snapshots) is SUPER_ADMIN/DEVELOPER only —
                // matches the page-level requireSuperAdminOrNull guard.
                if (item.key === 'auditLogs' && user.role !== 'SUPER_ADMIN' && user.role !== 'DEVELOPER') return false;
                if (item.key === 'developer' && user.role !== 'DEVELOPER') return false;
                return true;
              })
              .map(({ key, href, icon: Icon, exact }) => {
                const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <li key={key}>
                    <Link
                      href={href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-colors',
                        active
                          ? 'bg-accent/10 text-accent'
                          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                      )}
                    >
                      <Icon className="size-4" />
                      <span>{t(key)}</span>
                    </Link>
                  </li>
                );
              })}
          </ul>
        </nav>

        <div className="space-y-1 border-t border-border/40 p-3">
          <div className="px-3 py-2 text-xs">
            <p className="truncate font-medium text-foreground">{user.name ?? user.email ?? user.role}</p>
            <p className="truncate text-muted-foreground">{user.role}</p>
          </div>
          <form action={signOutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <LogOutIcon className="size-4" />
              <span>{tAuth('signOut')}</span>
            </button>
          </form>
          <Link
            href="/support"
            className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <HelpCircleIcon className="size-4" />
            <span>{tCommon('appName')}</span>
          </Link>
        </div>
      </aside>

      {/* Mobile backdrop */}
      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-navy-950/40 backdrop-blur-sm md:hidden"
          aria-label="close"
          onClick={() => setOpen(false)}
        />
      ) : null}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border/40 bg-background/85 px-4 py-3 backdrop-blur-lg md:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="grid size-9 place-items-center rounded-full bg-muted/60 text-foreground"
            aria-label="menu"
          >
            ☰
          </button>
          <span className="font-display text-sm tracking-[0.2em] text-gold-600">
            {tCommon('appName').toUpperCase()}
          </span>
          <div className="size-9" />
        </header>
        {/* Breadcrumb + back-button strip. Hidden on the dashboard root
            (`/admin`) — that's the sidebar anchor, "back" and "trail" both
            add noise. Every sub-page still gets it. */}
        <PageNav
          topLevelPaths={['/admin']}
          backFallbackHref="/admin"
          className="border-b border-border/40"
        />
        <main className="flex-1 overflow-x-auto px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}

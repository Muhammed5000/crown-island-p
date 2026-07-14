'use client';

import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { CrownLogo } from '@/components/brand/CrownLogo';
import { Button } from '@/components/ui/Button';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { cn } from '@/lib/cn';

interface Props {
  /** Only guests get this bar; signed-in users keep their own chrome. */
  isAuthenticated?: boolean;
}

/**
 * Global guest top bar — pinned at the very top of every booking-app page on
 * all breakpoints (mobile, tablet AND desktop) whenever the visitor is signed
 * out. Carries the Crown Island wordmark (→ booking home) and a clear Login
 * button.
 *
 * Signed-in users never see it; they keep their authenticated chrome (the app
 * header, the AURELIA brand bar with notifications, the desktop rail). To avoid
 * a doubled logo, those guest affordances are suppressed for signed-out users
 * (AppShell renders the AppHeader only when authenticated; BookingExperience
 * renders the AURELIA bar only when authenticated).
 */
export function GuestTopBar({ isAuthenticated = true }: Props) {
  const t = useTranslations('nav');
  const tCommon = useTranslations('common');
  const router = useRouter();

  if (isAuthenticated) return null;

  return (
    <header
      className={cn(
        'sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-border',
        'bg-card/80 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+8px)] backdrop-blur-xl',
      )}
    >
      {/* Wordmark → booking home. Both theme variants render; CSS shows the one
          matching the active theme (see CrownLogo / globals.css). Compact on
          phones (the bar should stay slim), a touch larger from `sm` up. */}
      <Link href="/booking" className="flex items-center gap-2" aria-label={tCommon('appName')}>
        <CrownLogo size="sm" className="!w-[124px] sm:!w-[150px]" />
      </Link>

      {/* Right cluster — language toggle (E / ع) + Login CTA. */}
      <div className="flex shrink-0 items-center gap-2">
        <LanguageToggle />

        {/* Login CTA — the shared UI Button (primary/navy). It's a real <button>,
            so we navigate via the router instead of nesting it inside a link. */}
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => router.push('/login')}
          aria-label={t('signIn')}
        >
          {t('signIn')}
        </Button>
      </div>
    </header>
  );
}

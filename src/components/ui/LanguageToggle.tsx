'use client';

import { useTransition } from 'react';
import { useLocale } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { localeLabels, type Locale } from '@/i18n/config';
import { cn } from '@/lib/cn';

/**
 * Language toggle — a compact, elegant segmented control (shadcn-idiom: a muted
 * pill "track" with a raised, gold-accented active "thumb") that flips the UI
 * between English ("E") and Arabic ("ع").
 *
 * Switching reuses next-intl's locale-aware router: `router.replace(pathname,
 * { locale })` re-renders the *same* page in the target language and persists
 * the choice via the NEXT_LOCALE cookie (see i18n/routing — localeDetection).
 *
 * The control is forced `dir="ltr"` so the two cells keep a stable position
 * regardless of the page's reading direction.
 */

const SEGMENTS: ReadonlyArray<{ locale: Locale; glyph: string }> = [
  { locale: 'en', glyph: 'E' },
  { locale: 'ar', glyph: 'ع' },
];

export function LanguageToggle({ className }: { className?: string }) {
  const active = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function switchTo(locale: Locale) {
    if (locale === active || pending) return;
    startTransition(() => {
      router.replace(pathname, { locale });
    });
  }

  return (
    <div
      dir="ltr"
      role="group"
      aria-label="Language"
      className={cn(
        'inline-flex h-9 items-center gap-0.5 rounded-full border border-border bg-muted/60 p-1',
        'shadow-[inset_0_1px_2px_rgba(22,48,79,0.06)] backdrop-blur',
        pending && 'pointer-events-none opacity-70',
        className,
      )}
    >
      {SEGMENTS.map(({ locale, glyph }) => {
        const isActive = locale === active;
        return (
          <button
            key={locale}
            type="button"
            onClick={() => switchTo(locale)}
            aria-pressed={isActive}
            aria-label={localeLabels[locale]}
            title={localeLabels[locale]}
            lang={locale}
            className={cn(
              'inline-flex h-7 min-w-[28px] items-center justify-center rounded-full px-2.5',
              'text-[13px] font-semibold leading-none tracking-[0.01em]',
              'transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
              isActive
                ? 'bg-card text-gold-700 shadow-[0_1px_3px_rgba(22,48,79,0.10)] ring-1 ring-gold-400/40'
                : 'text-muted-foreground hover:text-foreground active:scale-95',
            )}
          >
            {glyph}
          </button>
        );
      })}
    </div>
  );
}

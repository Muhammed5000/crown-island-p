'use client';

import { useTransition } from 'react';
import { useLocale } from 'next-intl';
import { GlobeIcon } from 'lucide-react';
import { useRouter, usePathname } from '@/i18n/navigation';
import { locales, localeLabels, isLocale, type Locale } from '@/i18n/config';
import { cn } from '@/lib/cn';

/**
 * Compact Arabic ⇆ English language toggle.
 *
 * Re-navigates the current pathname under the other locale (same approach used
 * by the settings panel). Self-contained client component so it can be dropped
 * onto server-rendered pages such as the landing page.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const active = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function switchLocale(next: Locale) {
    if (next === active) return;
    startTransition(() => {
      router.replace(pathname, { locale: next });
      router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label="Language"
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-border bg-card/80 p-1 backdrop-blur',
        className,
      )}
    >
      <GlobeIcon className="ms-1.5 size-3.5 text-muted-foreground" aria-hidden />
      {locales.map((loc) => {
        const isActive = isLocale(active) && loc === active;
        return (
          <button
            key={loc}
            type="button"
            onClick={() => switchLocale(loc)}
            disabled={isPending}
            aria-pressed={isActive}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors [touch-action:manipulation] disabled:opacity-60',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
              isActive
                ? 'bg-accent/15 text-accent'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {localeLabels[loc]}
          </button>
        );
      })}
    </div>
  );
}

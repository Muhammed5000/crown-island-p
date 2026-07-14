'use client';

import { useCallback } from 'react';
import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

/**
 * "Return to the previous page" button.
 *
 * Behaviour
 * ─────────
 * - Clicking calls `router.back()`, which pops the *browser's* history. That
 *   means "wherever the user was just looking at", not a static parent route.
 *   This is the behaviour the spec asked for.
 * - When there's no meaningful history (the user landed here from a bookmark
 *   or external link — `window.history.length <= 1`), we fall back to
 *   `fallbackHref`. Without that guard, `router.back()` does nothing and the
 *   user is stuck.
 * - Arrow direction flips under RTL via the locale prop. Lucide's
 *   `ArrowLeftIcon` is rendered as-is and mirrored visually only for RTL —
 *   we swap the icon component instead of relying on CSS `transform` to keep
 *   the visual weight (stroke ends) identical.
 *
 * Visual variants intentionally match the existing `TopNav` back affordance
 * so a future consolidation of "header back" and "page back" is mechanical.
 */

interface Props {
  /**
   * Where to go when there is no browser history to pop. Defaults to the
   * customer home (`/booking`) which is also the bottom-nav anchor — pick a
   * different one for admin pages.
   */
  fallbackHref?: string;
  /** Override the visible label. Defaults to `common.back`. */
  label?: string;
  /** Hide the text label, leaving just the icon (useful in tight headers). */
  iconOnly?: boolean;
  className?: string;
}

export function BackButton({
  fallbackHref = '/booking',
  label,
  iconOnly = false,
  className,
}: Props) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('common');
  const Arrow = locale === 'ar' ? ArrowRightIcon : ArrowLeftIcon;

  const onClick = useCallback(() => {
    // `window` exists because this is a client component; the SSR pass never
    // executes the handler.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }, [router, fallbackHref]);

  const text = label ?? t('back');

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={text}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-3 py-1.5 text-xs font-medium text-gold-600 transition-all',
        'hover:bg-muted active:scale-95',
        iconOnly && 'size-9 justify-center p-0',
        className,
      )}
    >
      <Arrow className="size-4" strokeWidth={2.5} aria-hidden />
      {!iconOnly && <span>{text}</span>}
    </button>
  );
}

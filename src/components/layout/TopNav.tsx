'use client';

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

interface Props {
  title: string;
  /** Override the back behaviour; defaults to `router.back()`. */
  onBack?: () => void;
  /** Hide the back chevron entirely (for top-level screens). */
  hideBack?: boolean;
  /** Element rendered on the trailing side (search icon, more menu, etc.). */
  trailing?: React.ReactNode;
  /** RTL-aware chevron direction — auto by default. */
  locale?: 'ar' | 'en';
  className?: string;
}

/**
 * Centered-title top bar. Matches the design's `TopNav` exactly:
 *  - 14px vertical / 20px horizontal padding
 *  - gold chevron on the back affordance, flipped under RTL
 *  - 17px bold cream title centered
 *  - placeholder spacer on the trailing side when no element is supplied
 */
export function TopNav({ title, onBack, hideBack, trailing, locale = 'ar', className }: Props) {
  const router = useRouter();
  const Chevron = locale === 'ar' ? ChevronRightIcon : ChevronLeftIcon;

  return (
    <div
      className={cn(
        'relative flex items-center justify-between px-5 py-3',
        className,
      )}
    >
      {hideBack ? (
        <span className="size-9" aria-hidden />
      ) : (
        <button
          type="button"
          onClick={() => (onBack ? onBack() : router.back())}
          aria-label="back"
          className="flex size-9 items-center justify-center rounded-full bg-muted/60 text-gold-600 transition-all hover:bg-muted active:scale-90"
        >
          <Chevron className="size-5" strokeWidth={2.5} />
        </button>
      )}
      <h1 className="text-[17px] font-bold tracking-tight text-foreground">{title}</h1>
      <span className="size-9 shrink-0 flex items-center justify-end">{trailing}</span>
    </div>
  );
}

import { CalendarDaysIcon } from 'lucide-react';
import type { Locale } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { TagChip } from '../TagChip';
import { deriveKicker, deriveSlotLabel, deriveTags, type CategoryWithExtras } from '../derive';
import type { CopyBundle, DeskCopy } from './types';

/**
 * The narrow, single-column card shown BEHIND the wide featured hero in the
 * desktop stacked carousel — the "fanned deck" look from the design reference.
 * It echoes the featured card's meta column (kicker · title · tagline · a tag ·
 * nearest availability · a Details affordance) with a coloured accent spine on
 * the leading edge. It is purely a preview: the slot that hosts it is `inert`,
 * so the real, clickable controls only ever live on the front (active) card.
 */

const ACCENTS = ['bg-accent', 'bg-gold-500', 'bg-primary', 'bg-rose-400/90'] as const;

interface Props {
  category: CategoryWithExtras;
  locale: Locale;
  copy: CopyBundle;
  desk: DeskCopy;
  /** Rotates the accent-spine colour so stacked previews read as distinct cards. */
  accentIndex: number;
}

export function StackPreviewCard({ category, locale, copy, desk, accentIndex }: Props) {
  const name = locale === 'ar' ? category.nameAr : category.nameEn;
  const tagline = locale === 'ar' ? category.descAr : category.descEn;
  const kicker = deriveKicker(category, locale);
  const tags = deriveTags(category, locale);
  const slot = deriveSlotLabel(category, {
    now: copy.nextSlotNow,
    opens: copy.nextSlotOpens,
    closed: copy.nextSlotClosed,
  });
  const accent = ACCENTS[((accentIndex % ACCENTS.length) + ACCENTS.length) % ACCENTS.length];

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[20px] border border-border bg-card py-[22px] pe-5 ps-7 shadow-[0_20px_48px_-28px_rgba(8,14,24,0.55)]">
      {/* Coloured accent spine on the leading (start) edge. */}
      <span aria-hidden className={cn('absolute inset-y-0 start-0 w-[5px]', accent)} />

      <div className="font-aurelia-sans text-[10px] font-semibold uppercase tracking-[0.24em] text-gold-600">
        {kicker}
      </div>
      <h3 className="mt-2 line-clamp-2 font-aurelia-display text-[25px] font-extrabold leading-[1.04] tracking-[-0.01em] text-foreground">
        {name}
      </h3>
      {tagline ? (
        <p className="mt-2.5 line-clamp-2 font-aurelia-sans text-[12.5px] leading-[1.5] text-muted-foreground">
          {tagline}
        </p>
      ) : null}
      {tags.length > 0 ? (
        <div className="mt-3.5">
          <TagChip>{tags[0]!}</TagChip>
        </div>
      ) : null}

      <div className="flex-1" />

      <div className="border-t border-border pt-3.5">
        <div className="flex items-start gap-2">
          <CalendarDaysIcon className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={1.6} aria-hidden />
          <div className="min-w-0">
            <div className="mb-0.5 font-aurelia-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {desk.nextAvailabilityLabel}
            </div>
            <div className="truncate font-aurelia-sans text-[12.5px] font-medium text-foreground">{slot}</div>
          </div>
        </div>
        <div className="mt-3.5 rounded-lg border border-border bg-muted px-4 py-2.5 text-center font-aurelia-sans text-[12px] font-medium text-foreground">
          {desk.detailsLabel}
        </div>
      </div>
    </div>
  );
}

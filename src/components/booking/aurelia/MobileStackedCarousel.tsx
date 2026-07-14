'use client';

import { cn } from '@/lib/cn';
import type { Locale } from '@/i18n/config';
import { FeaturedCard } from './FeaturedCard';
import { useCarousel, CrossfadeSlot } from './useCarousel';
import {
  deriveImage,
  deriveKicker,
  deriveStatus,
  deriveTags,
  type CategoryWithExtras,
} from './derive';

/**
 * AURELIA mobile — the booking hero as a stacked-card carousel (the small-screen
 * counterpart of the desktop fanned deck). The active item is a full-width
 * `FeaturedCard`; the next 1–2 items peek behind it, scaled down and offset up
 * so the deck reads clearly without overflowing a phone screen.
 *
 * Tuned for touch: NO wheel capture (so vertical page scroll is never hijacked),
 * `touch-action: pan-y` keeps the page scrolling, and horizontal swipe moves
 * between cards. Behind slots are `inert`. Autoplay 2s, dots, reduced-motion safe
 * — all shared with the desktop carousel via `useCarousel`.
 */

interface MobileCopy {
  reserveCta: string;
  statusOpen: string;
  statusFilling: string;
  statusClosed: string;
  statusSoon: string;
}

interface Props {
  items: CategoryWithExtras[];
  locale: Locale;
  copy: MobileCopy;
  onTap: (c: CategoryWithExtras) => void;
}

export function MobileStackedCarousel({ items, locale, copy, onTap }: Props) {
  const ar = locale === 'ar';
  const endSign = ar ? -1 : 1;
  const len = items.length;
  const itemsKey = items.map((i) => i.id).join('|');

  const { activeIndex, direction, reduced, goTo, stageRef, containerHandlers, stageHandlers } = useCarousel({
    len,
    rtl: ar,
    resetKey: itemsKey,
    wheel: false, // touch tree — never hijack the page's vertical scroll
  });

  const region = ar ? 'النشاطات المميزة' : 'Featured experiences';
  const dotLabel = (i: number) =>
    ar ? `الانتقال إلى النشاط ${i + 1} من ${len}` : `Go to item ${i + 1} of ${len}`;

  const statusLabel = (s: ReturnType<typeof deriveStatus>) =>
    s === 'filling'
      ? copy.statusFilling
      : s === 'closed'
        ? copy.statusClosed
        : s === 'soon'
          ? copy.statusSoon
          : copy.statusOpen;

  const card = (c: CategoryWithExtras, interactive: boolean) => (
    <FeaturedCard
      image={deriveImage(c)}
      kicker={deriveKicker(c, locale)}
      name={locale === 'ar' ? c.nameAr : c.nameEn}
      tagline={locale === 'ar' ? c.descAr : c.descEn}
      tags={deriveTags(c, locale)}
      status={deriveStatus(c)}
      statusLabel={statusLabel(deriveStatus(c))}
      reserveLabel={copy.reserveCta}
      locale={locale}
      onTap={interactive ? () => onTap(c) : () => {}}
    />
  );

  if (len === 0) return null;

  if (len === 1) {
    return <section aria-label={region}>{card(items[0]!, true)}</section>;
  }

  const front = items[activeIndex]!;
  const p1 = items[(activeIndex + 1) % len]!;
  const p2 = len >= 3 ? items[(activeIndex + 2) % len]! : null;

  return (
    <section
      aria-roledescription="carousel"
      aria-label={region}
      className="select-none"
      onMouseEnter={containerHandlers.onMouseEnter}
      onMouseLeave={containerHandlers.onMouseLeave}
      onFocus={containerHandlers.onFocus}
      onBlur={containerHandlers.onBlur}
    >
      <div
        ref={stageRef}
        role="group"
        aria-label={region}
        onKeyDown={stageHandlers.onKeyDown}
        onPointerDown={stageHandlers.onPointerDown}
        onPointerUp={stageHandlers.onPointerUp}
        className="relative h-[300px] [touch-action:pan-y]"
      >
        {p2 ? (
          <CrossfadeSlot
            itemKey={p2.id}
            direction={direction}
            reduced={reduced}
            endSign={endSign}
            nudge={14}
            zIndex={10}
            inert
            className="inset-x-0 h-[280px]"
            style={{ bottom: 0, transform: 'translateY(-52px) scale(0.88)', transformOrigin: 'bottom center', opacity: 0.78 }}
          >
            {card(p2, false)}
          </CrossfadeSlot>
        ) : null}

        <CrossfadeSlot
          itemKey={p1.id}
          direction={direction}
          reduced={reduced}
          endSign={endSign}
          nudge={18}
          zIndex={20}
          inert
          className="inset-x-0 h-[280px]"
          style={{ bottom: 0, transform: 'translateY(-28px) scale(0.94)', transformOrigin: 'bottom center', opacity: 0.9 }}
        >
          {card(p1, false)}
        </CrossfadeSlot>

        <CrossfadeSlot
          itemKey={front.id}
          direction={direction}
          reduced={reduced}
          endSign={endSign}
          nudge={26}
          zIndex={30}
          className="inset-x-0 h-[280px]"
          style={{ bottom: 0 }}
        >
          {card(front, true)}
        </CrossfadeSlot>
      </div>

      {/* Indicator */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
        <div className="flex max-w-full flex-wrap items-center justify-center gap-1.5">
          {items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              onClick={() => goTo(i)}
              aria-label={dotLabel(i)}
              aria-current={i === activeIndex || undefined}
              className="group/dot grid h-7 place-items-center px-0.5 focus-visible:outline-none"
            >
              <span
                className={cn(
                  'block h-1.5 rounded-full transition-all duration-300 group-focus-visible/dot:ring-2 group-focus-visible/dot:ring-accent/60',
                  i === activeIndex ? 'w-6 bg-foreground' : 'w-1.5 bg-border group-hover/dot:bg-muted-foreground/60',
                )}
              />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

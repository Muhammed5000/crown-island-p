'use client';

import { cn } from '@/lib/cn';
import type { Locale } from '@/i18n/config';
import { DeskFeatured } from './DesktopCards';
import { StackPreviewCard } from './StackPreviewCard';
import { useCarousel, CrossfadeSlot } from '../useCarousel';
import type { CategoryWithExtras } from '../derive';
import type { CopyBundle, DeskCopy } from './types';

/**
 * AURELIA desktop — "fanned deck" hero carousel (matches the design reference).
 *
 * The active item is a full, WIDE two-pane `DeskFeatured` anchored to the start
 * side and fully interactive (Details / Book Now work exactly as before). Behind
 * it, the next 1–2 items fan toward the end side as NARROW `StackPreviewCard`s —
 * progressively smaller, dimmer, and offset. It cycles through ALL the currently
 * filtered categories/activities.
 *
 * Layout uses fixed slots whose CONTENT crossfades (see `CrossfadeSlot`), so the
 * narrow previews and the wide hero swap without a jarring size-morph while the
 * deck still reads as advancing. All motion is transform + opacity (no layout
 * shift) and respects reduced-motion. Behind slots are `inert` (no focus trap /
 * no click interference). Autoplay 2s; manual via wheel, swipe, Arrow keys
 * (RTL-aware), and the dots — all sharing one engine (`useCarousel`).
 */

interface Props {
  items: CategoryWithExtras[];
  locale: Locale;
  copy: CopyBundle;
  desk: DeskCopy;
  onTap: (c: CategoryWithExtras) => void;
  onReserve: (c: CategoryWithExtras) => void;
}

export function StackedActivityCarousel({ items, locale, copy, desk, onTap, onReserve }: Props) {
  const ar = locale === 'ar';
  const endSign = ar ? -1 : 1; // the side the deck fans toward (left in RTL)
  const len = items.length;
  const itemsKey = items.map((i) => i.id).join('|');

  const { activeIndex, direction, reduced, goTo, stageRef, containerHandlers, stageHandlers } =
    useCarousel({ len, rtl: ar, resetKey: itemsKey });

  const region = ar ? 'النشاطات المميزة' : 'Featured experiences';
  const dotLabel = (i: number) =>
    ar ? `الانتقال إلى النشاط ${i + 1} من ${len}` : `Go to item ${i + 1} of ${len}`;

  // ── Empty (filters yielded nothing) ─────────────────────────────────────────
  if (len === 0) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-border bg-card p-8 text-center">
        <h3 className="m-0 font-aurelia-display text-[22px] font-medium text-foreground">{copy.emptyTitle}</h3>
        <p className="mt-2 font-aurelia-sans text-[13px] leading-relaxed text-muted-foreground">{copy.emptyBody}</p>
      </div>
    );
  }

  // ── Single item — a plain static card, no carousel chrome ───────────────────
  if (len === 1) {
    return (
      <section aria-label={region}>
        <div className="relative h-[380px] w-[78%] max-w-[1000px]">
          <DeskFeatured category={items[0]!} locale={locale} copy={copy} desk={desk} onTap={onTap} onReserve={onReserve} />
        </div>
      </section>
    );
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
        tabIndex={0}
        role="group"
        aria-label={region}
        onKeyDown={stageHandlers.onKeyDown}
        onPointerDown={stageHandlers.onPointerDown}
        onPointerUp={stageHandlers.onPointerUp}
        className="relative h-[400px] rounded-[24px] [touch-action:pan-y] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {/* Back preview (3rd card) */}
        {p2 ? (
          <CrossfadeSlot
            itemKey={p2.id}
            direction={direction}
            reduced={reduced}
            endSign={endSign}
            nudge={12}
            zIndex={10}
            inert
            className="h-[326px] w-[28%] max-w-[300px]"
            style={{
              insetInlineStart: '70%',
              top: '50%',
              transform: 'translateY(calc(-50% - 14px)) scale(0.93)',
              transformOrigin: 'center',
              opacity: 0.8,
            }}
          >
            <StackPreviewCard category={p2} locale={locale} copy={copy} desk={desk} accentIndex={activeIndex + 2} />
          </CrossfadeSlot>
        ) : null}

        {/* Middle preview (2nd card) */}
        <CrossfadeSlot
          itemKey={p1.id}
          direction={direction}
          reduced={reduced}
          endSign={endSign}
          nudge={16}
          zIndex={20}
          inert
          className="h-[348px] w-[30%] max-w-[322px]"
          style={{
            insetInlineStart: '58%',
            top: '50%',
            transform: 'translateY(calc(-50% - 7px)) scale(0.97)',
            transformOrigin: 'center',
            opacity: 0.95,
          }}
        >
          <StackPreviewCard category={p1} locale={locale} copy={copy} desk={desk} accentIndex={activeIndex + 1} />
        </CrossfadeSlot>

        {/* Front (active) card — wide, fully interactive */}
        <CrossfadeSlot
          itemKey={front.id}
          direction={direction}
          reduced={reduced}
          endSign={endSign}
          nudge={28}
          zIndex={30}
          className="h-[380px] w-[78%] max-w-[1000px] drop-shadow-[0_30px_60px_rgba(8,14,24,0.28)]"
          style={{ insetInlineStart: 0, top: '50%', transform: 'translateY(-50%)' }}
        >
          <DeskFeatured category={front} locale={locale} copy={copy} desk={desk} onTap={onTap} onReserve={onReserve} />
        </CrossfadeSlot>
      </div>

      {/* Indicator — dots + auto-rotate hint */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
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

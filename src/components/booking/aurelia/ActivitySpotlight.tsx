'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/config';
import { cn } from '@/lib/cn';
import {
  deriveImage,
  deriveKicker,
  deriveFromPrice,
  deriveStatus,
  type CategoryWithExtras,
} from './derive';

interface Props {
  categories: CategoryWithExtras[];
  locale: Locale;
  /**
   * Optional extra classes on the outer <section>. The hero is full-bleed
   * (edge-to-edge, flush to the top) by default, so the call sites pass nothing;
   * this hook stays for callers that want to inset it.
   */
  padClassName?: string;
  /** Dwell time per item before auto-advancing. Defaults to 3500ms. */
  intervalMs?: number;
}

/**
 * Status dot palette — copied VERBATIM from StatusDot.tsx's (non-exported)
 * STATUS_META so the spotlight uses the exact same colours/glow as the rest of
 * the AURELIA surface.
 */
const STATUS_META = {
  open: { color: '#2f9e6f', glow: '0 0 8px rgba(47,158,111,0.5)' },
  filling: { color: '#c2a14e', glow: 'none' },
  // Kept in sync with StatusDot: theme-aware muted dot (the old fixed navy-alpha
  // was invisible on dark surfaces). Visible over the photo scrim in both themes.
  closed: { color: 'rgb(var(--ci-muted-foreground))', glow: 'none' },
  // Kept in sync with StatusDot: "coming soon" periwinkle for service-less categories.
  soon: { color: '#6f86c9', glow: '0 0 8px rgba(111,134,201,0.45)' },
} as const;

const STATUS_LABEL = {
  ar: { open: 'متاح الآن', filling: 'يقترب الامتلاء', closed: 'مغلق اليوم', soon: 'قريباً' },
  en: { open: 'Open now', filling: 'Filling up', closed: 'Closed', soon: 'Coming soon' },
} as const;

// Premium easing shared with the project's PageTransition — gives the
// crossfade the same "expensive" deceleration curve.
const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * AURELIA "Activity Spotlight" — a dynamic, auto-rotating HERO banner pinned to
 * the very top of the booking page. The WHOLE bar is a tall, FULL-BLEED photo
 * (edge-to-edge, flush to the top, no rounding or border) of the spotlit
 * beach/activity, with its name + details laid over the image. It cross-
 * dissolves to the next item every `intervalMs`; each frame is the real
 * next-intl <Link> deep-linking into the existing `/booking/[slug]` page.
 *
 * Correctness invariants (unchanged):
 *  - SSR-safe: the FIRST render is deterministic (active index 0; no clock/random
 *    in the render body). Status (wall-clock) + motion are gated behind `mounted`.
 *  - StrictMode-safe timers: the single rotation interval clears itself in its
 *    effect cleanup → no leaked/duplicated ticks, no setState-after-unmount.
 *  - Zero CLS: the stage is a fixed height and frames stack `absolute inset-0`.
 *  - prefers-reduced-motion: no auto-advance, no motion — a calm static frame.
 */
export function ActivitySpotlight({
  categories,
  locale,
  padClassName,
  intervalMs = 3500,
}: Props) {
  const len = categories.length;
  const single = len === 1;
  const rotatable = len > 1;
  const ar = locale === 'ar';

  // `active` starts at 0 on BOTH server and first client render → deterministic
  // first paint, no hydration mismatch.
  const [active, setActive] = useState(0);
  // `mounted` flips true only after the first client effect runs; gates motion
  // and deriveStatus() (which reads the wall clock — see derive.ts ~line 128).
  const [mounted, setMounted] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);

  // SSR-safe reduced-motion hook (false on server + first client render).
  const reduced = useReducedMotion();

  const paused = hovered || focused || hidden;
  const canRotate = mounted && !reduced && rotatable;
  const isAnimated = mounted && !reduced;

  // Clamp to the current list so a shrinking `categories` prop can't index OOB.
  const safeActive = active < len ? active : 0;

  const copy = ar
    ? { fromLabel: 'من', currency: 'ج.م', carousel: 'الأنشطة المميزة' }
    : { fromLabel: 'from', currency: 'EGP', carousel: 'Featured experiences' };

  // (a) Mark mounted — the hydration gate.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // (b) Track tab visibility (seeded inside the effect so SSR stays deterministic).
  useEffect(() => {
    const sync = () => setHidden(document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  // (c) THE single rotation interval — the only timer. Bails while paused/non-
  //     rotatable; functional updater avoids stale closures; cleanup always
  //     clears → StrictMode-safe (create → clear → create, no leak/dup).
  useEffect(() => {
    if (!canRotate || paused) return;
    const id = setInterval(() => setActive((i) => (i + 1) % len), intervalMs);
    return () => clearInterval(id);
  }, [canRotate, paused, intervalMs, len, active]);

  // (d) Warm the NEXT photo so each crossfade reveals an already-decoded image.
  useEffect(() => {
    if (!rotatable || typeof window === 'undefined') return;
    const img = new window.Image();
    img.src = deriveImage(categories[(safeActive + 1) % len]!);
  }, [safeActive, len, rotatable, categories]);

  // Length 0 → render nothing (AFTER all hooks).
  if (len === 0) return null;

  // ── Frame renderer ───────────────────────────────────────────────────────
  // The whole frame IS the photo: a full-bleed next/image fill, two scrims, and
  // the name + kicker + status + price laid OVER it with per-glyph text-shadow
  // so the copy stays legible over an arbitrary (possibly bright) photo. The
  // entire frame is one keyboard-reachable <Link> to `/booking/[slug]`.
  const renderFrame = (c: CategoryWithExtras) => {
    const name = ar ? c.nameAr : c.nameEn;
    const kicker = deriveKicker(c, locale);
    const price = deriveFromPrice(c, { fromLabel: copy.fromLabel, currency: copy.currency });
    const status = mounted ? deriveStatus(c) : null;
    const statusLabel = status ? (ar ? STATUS_LABEL.ar : STATUS_LABEL.en)[status] : null;

    return (
      <Link
        href={`/booking/${c.slug}`}
        prefetch
        aria-label={`${kicker}: ${name}`}
        className="group/frame relative block size-full overflow-hidden text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold-400/70"
      >
        {/* Full-bleed photo. A very slow zoom on hover adds a premium, alive feel. */}
        <Image
          src={deriveImage(c)}
          alt=""
          fill
          // 75vw on the wide desktop canvas (the stage spans most of the content
          // column) so object-cover doesn't upscale on large monitors.
          sizes="(max-width: 1280px) 100vw, 75vw"
          className="object-cover [filter:saturate(105%)] transition-transform duration-[7000ms] ease-out group-hover/frame:scale-[1.06]"
        />
        {/* Bottom scrim — a lighter darkening at the foot of the photo; the
            overlaid copy carries its own text-shadow so it stays readable. */}
        <span
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(180deg,transparent_22%,rgba(8,14,24,0.28)_52%,rgba(8,14,24,0.48)_76%,rgba(8,14,24,0.68)_100%)]"
        />

        {/* Overlaid copy, bottom-start; chevron affordance bottom-end. */}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 sm:p-6">
          <div className="flex min-w-0 flex-col gap-1 [text-shadow:0_1px_3px_rgba(0,0,0,0.7)]">
            <div className="flex items-center gap-2 font-aurelia-sans text-[10.5px] font-semibold uppercase tracking-[0.18em] text-aurelia-cream/90">
              <span>{kicker}</span>
              {statusLabel ? (
                <>
                  <span aria-hidden className="size-1 rounded-full bg-aurelia-cream/50" />
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="size-1.5 rounded-full"
                      style={{ background: STATUS_META[status!].color, boxShadow: STATUS_META[status!].glow }}
                    />
                    {statusLabel}
                  </span>
                </>
              ) : null}
            </div>
            <div className="truncate font-aurelia-sans text-[24px] font-bold leading-tight text-aurelia-cream [text-shadow:0_2px_12px_rgba(0,0,0,0.75)] sm:text-[34px]">
              {name}
            </div>
            {price ? (
              <div className="font-aurelia-sans text-[12px] tabular-nums text-aurelia-cream/90 sm:text-[13px]">
                {price}
              </div>
            ) : null}
          </div>
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-full border border-white/25 bg-black/30 text-aurelia-cream shadow-[0_2px_10px_-4px_rgba(0,0,0,0.6)] backdrop-blur-sm transition-transform group-hover/frame:scale-105 group-active/frame:scale-95 sm:size-11"
          >
            <ChevronRight className="size-4 rtl:rotate-180 sm:size-5" />
          </span>
        </div>
      </Link>
    );
  };

  // Fixed-height, full-bleed stage (no radius/border) → no CLS, edge-to-edge.
  // Desktop (xl) is 1.4× the 240px tablet height (336px); the mobile column is
  // xl:hidden, so this only affects the desktop BookingDesktop view.
  const STAGE = 'relative h-[180px] overflow-hidden sm:h-[240px] xl:h-[336px]';

  // ── Single-item path ─────────────────────────────────────────────────────
  if (single) {
    return (
      <section aria-label={copy.carousel} className={cn(padClassName)}>
        <div className={STAGE}>
          <div className="absolute inset-0">{renderFrame(categories[0]!)}</div>
        </div>
      </section>
    );
  }

  // ── Rotating path ────────────────────────────────────────────────────────
  const current = categories[safeActive]!;
  const nextForPreload = categories[(safeActive + 1) % len]!;
  // Slide direction: the incoming frame enters from the end edge and the old one
  // exits toward the start edge. Flip the sign for RTL (Arabic) so the motion
  // reads start→end naturally in both directions.
  const slideDir = ar ? -1 : 1;

  return (
    <section
      aria-label={copy.carousel}
      // Hover-pause is mouse-only (touch fires pointerenter without a matching
      // pointerleave, which would latch the bar paused). Focus pauses with a
      // containment guard so internal focus moves don't thrash the interval.
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') setHovered(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') setHovered(false);
      }}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocused(false);
      }}
      className={cn(padClassName)}
    >
      <div className={STAGE}>
        {/* Frames stack absolutely → zero CLS on swap. Both the incoming and the
            outgoing frame are mounted during the swap (sync mode, NOT "wait") and
            translate together: the new photo slides in from the end edge while
            the old one slides off toward the start edge — a clean carousel slide.
            The stage's overflow-hidden clips whatever is currently off-stage. */}
        {isAnimated ? (
          <AnimatePresence initial={false}>
            <motion.div
              key={current.id}
              className="absolute inset-0"
              initial={{ x: `${100 * slideDir}%` }}
              animate={{ x: '0%' }}
              exit={{ x: `${-100 * slideDir}%` }}
              transition={{ duration: 0.6, ease: EASE }}
            >
              {renderFrame(current)}
            </motion.div>
          </AnimatePresence>
        ) : (
          <div className="absolute inset-0">{renderFrame(current)}</div>
        )}

        {/* Off-screen warmer for the NEXT photo's optimised URL. */}
        <span aria-hidden className="pointer-events-none absolute size-px overflow-hidden opacity-0">
          <Image src={deriveImage(nextForPreload)} alt="" width={64} height={64} sizes="64px" />
        </span>
      </div>
    </section>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion';
import { cn } from '@/lib/cn';

/**
 * Headless carousel engine shared by the desktop fan (`StackedActivityCarousel`)
 * and the mobile stack (`MobileStackedCarousel`). Owns: active index + direction,
 * autoplay (every `autoMs`, restarted on ANY change so manual input never fights
 * it), pause-on-hover/focus/tab-hidden, wheel (throttled, one card per gesture),
 * horizontal swipe, and RTL-aware Arrow keys. Presentation lives in the callers.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

interface UseCarouselArgs {
  len: number;
  rtl: boolean;
  /** Changing this (e.g. the filtered id list) resets to the first card. */
  resetKey: string;
  autoMs?: number;
  /** Capture wheel → card nav. Desktop only; off on touch trees so the page scrolls. */
  wheel?: boolean;
}

export function useCarousel({ len, rtl, resetKey, autoMs = 2000, wheel = true }: UseCarouselArgs) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState(1); // 1 = next, -1 = prev
  const [mounted, setMounted] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);

  const reduced = useReducedMotion() ?? false;
  const stageRef = useRef<HTMLDivElement | null>(null);
  const wheelLock = useRef(false);
  const pointer = useRef<{ x: number; y: number } | null>(null);

  const rotatable = len > 1;
  const paused = hovered || focused || hidden;
  const canAuto = mounted && !reduced && rotatable && !paused;

  const step = useCallback(
    (dir: number) => {
      if (len <= 1) return;
      const d = dir >= 0 ? 1 : -1;
      setDirection(d);
      setActiveIndex((i) => (i + d + len) % len);
    },
    [len],
  );

  const goTo = useCallback(
    (idx: number) => {
      if (len <= 1) return;
      const next = ((idx % len) + len) % len;
      setActiveIndex((cur) => {
        if (next !== cur) setDirection(next > cur ? 1 : -1);
        return next;
      });
    },
    [len],
  );

  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setActiveIndex(0);
      setDirection(1);
    }, 0);
    return () => window.clearTimeout(id);
  }, [resetKey]);

  useEffect(() => {
    const sync = () => setHidden(document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  // Autoplay — depends on activeIndex so every change (auto OR manual) restarts
  // the countdown.
  useEffect(() => {
    if (!canAuto) return;
    const id = setInterval(() => {
      setDirection(1);
      setActiveIndex((i) => (i + 1) % len);
    }, autoMs);
    return () => clearInterval(id);
  }, [canAuto, len, activeIndex, autoMs]);

  // Wheel → one card per gesture. preventDefault only when we act, so sub-threshold
  // / locked wheels fall through to normal page scroll (never hard-traps the page).
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !wheel || len <= 1) return;
    const onWheel = (e: WheelEvent) => {
      if (wheelLock.current) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 10) return;
      e.preventDefault();
      wheelLock.current = true;
      step(delta > 0 ? 1 : -1);
      window.setTimeout(() => {
        wheelLock.current = false;
      }, 650);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [len, step, wheel]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (len <= 1) return;
    pointer.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const p = pointer.current;
    pointer.current = null;
    if (!p || len <= 1) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (Math.abs(dx) < 44 || Math.abs(dx) <= Math.abs(dy)) return; // horizontal only
    step(dx < 0 ? 1 : -1); // swipe left → next, right → prev
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (len <= 1) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      step(rtl ? -1 : 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      step(rtl ? 1 : -1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      goTo(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      goTo(len - 1);
    }
  };

  return {
    activeIndex,
    direction,
    reduced,
    mounted,
    rotatable,
    step,
    goTo,
    stageRef,
    containerHandlers: {
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
      onFocus: () => setFocused(true),
      onBlur: (e: React.FocusEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocused(false);
      },
    },
    stageHandlers: { onKeyDown, onPointerDown, onPointerUp },
  };
}

interface CrossfadeSlotProps {
  /** The id of the item currently in this slot — changing it triggers the crossfade. */
  itemKey: string;
  direction: number;
  reduced: boolean;
  /** +1 LTR / −1 RTL — the side the deck fans toward. */
  endSign: number;
  /** px the incoming content travels in on. */
  nudge?: number;
  className?: string;
  style?: React.CSSProperties;
  zIndex: number;
  /** Behind slots are inert (no focus/click) + aria-hidden. */
  inert?: boolean;
  children: ReactNode;
}

/**
 * A fixed-position deck "slot". When its `itemKey` changes, the old card
 * crossfades out (with a small directional drift) while the new one drifts in —
 * so a narrow behind-card and the wide front hero can swap without a jarring
 * size morph, and the deck reads as advancing.
 */
export function CrossfadeSlot({
  itemKey,
  direction,
  reduced,
  endSign,
  nudge = 24,
  className,
  style,
  zIndex,
  inert,
  children,
}: CrossfadeSlotProps) {
  const variants: Variants = {
    enter: (d: number) => ({ opacity: 0, x: reduced ? 0 : d >= 0 ? endSign * nudge : -endSign * nudge }),
    center: { opacity: 1, x: 0 },
    exit: (d: number) => ({ opacity: 0, x: reduced ? 0 : d >= 0 ? -endSign * nudge : endSign * nudge }),
  };
  return (
    <div
      className={cn('absolute', className)}
      style={{ ...style, zIndex }}
      aria-hidden={inert || undefined}
      {...(inert ? { inert: true } : {})}
    >
      <AnimatePresence initial={false} custom={direction}>
        <motion.div
          key={itemKey}
          custom={direction}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={reduced ? { duration: 0 } : { duration: 0.5, ease: EASE }}
          className="absolute inset-0"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

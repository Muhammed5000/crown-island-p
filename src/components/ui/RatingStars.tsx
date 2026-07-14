'use client';

import { useRef, useState } from 'react';
import { Star } from 'lucide-react';

interface Props {
  /** Current rating 0–5 (0 = none selected). */
  value: number;
  /** Provide to make the widget interactive; omit for a read-only display. */
  onChange?: (value: number) => void;
  readOnly?: boolean;
  /** Star size in px. */
  size?: number;
  className?: string;
  /** Accessible name for the group (interactive) — e.g. "Rate your visit". */
  label?: string;
}

/**
 * Five-star rating — read-only display OR interactive input (pass `onChange`).
 * Reused on the customer review form, the booking detail, the public service
 * page and the admin dashboard.
 *
 * A11Y-002: when interactive this is a real ARIA radiogroup — each star is a
 * `role="radio"` with `aria-checked`, a single roving tabstop, and Arrow-key
 * navigation — instead of the previous radiogroup-of-toggle-buttons, which read
 * inconsistently to assistive tech.
 */
export function RatingStars({ value, onChange, readOnly, size = 24, className, label }: Props) {
  const [hover, setHover] = useState(0);
  const groupRef = useRef<HTMLDivElement>(null);
  const interactive = !readOnly && typeof onChange === 'function';
  const active = interactive ? hover || value : value;

  // The single tabbable radio: the checked star, or the first if none checked.
  const tabbable = value || 1;

  const focusStar = (star: number) => {
    groupRef.current
      ?.querySelectorAll<HTMLElement>('[role="radio"]')
      ?.[star - 1]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, star: number) => {
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(5, star + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(1, star - 1);
    else if (e.key === 'Home') next = 1;
    else if (e.key === 'End') next = 5;
    if (next != null) {
      e.preventDefault();
      onChange?.(next);
      focusStar(next);
    }
  };

  return (
    <div
      ref={groupRef}
      className={`inline-flex items-center gap-1 ${className ?? ''}`}
      role={interactive ? 'radiogroup' : 'img'}
      aria-label={interactive ? label ?? 'Rating' : `${value} out of 5`}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= active;
        const icon = (
          <Star
            style={{ width: size, height: size }}
            strokeWidth={1.5}
            className={filled ? 'fill-gold-400 text-gold-500' : 'fill-transparent text-muted-foreground/40'}
          />
        );
        if (!interactive) return <span key={star}>{icon}</span>;
        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={star === value}
            aria-label={`${star} star${star > 1 ? 's' : ''}`}
            tabIndex={star === tabbable ? 0 : -1}
            className="rounded-md transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
            onMouseEnter={() => setHover(star)}
            onMouseLeave={() => setHover(0)}
            onFocus={() => setHover(star)}
            onBlur={() => setHover(0)}
            onKeyDown={(e) => onKeyDown(e, star)}
            onClick={() => onChange?.(star)}
          >
            {icon}
          </button>
        );
      })}
    </div>
  );
}

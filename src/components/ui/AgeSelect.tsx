'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronsUpDownIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

interface AgeSelectProps {
  id?: string;
  name?: string;
  /** Controlled value (string to match the settings forms' string state). */
  value?: string | number;
  /** Uncontrolled initial value (FormData forms). Pass exactly one of value/defaultValue. */
  defaultValue?: string | number;
  /** Controlled change handler — receives the selected value as a string. */
  onChange?: (value: string) => void;
  /** Inclusive age range shown in the wheel. */
  min?: number;
  max?: number;
  required?: boolean;
  disabled?: boolean;
  dir?: 'ltr' | 'rtl';
  /** Classes for the trigger button — pass the surrounding form's field styling. */
  className?: string;
  /** Classes for the picker surface (background + text), so it blends per theme/form. */
  optionClassName?: string;
  /** Shown on the trigger while nothing is chosen. */
  placeholder?: string;
  invalid?: boolean;
  'aria-label'?: string;
}

const ITEM_H = 40; // px per row
const VISIBLE = 5; // odd → one row centered under the selection band
const PAD = (ITEM_H * (VISIBLE - 1)) / 2;
const DEFAULT_ANCHOR = 25; // where the wheel opens when no value is set yet

/**
 * Age picker — an iOS-style scrolling number wheel.
 *
 * A field-styled trigger shows the current value; tapping it opens the wheel in
 * a bottom sheet on mobile and a centered card on desktop (responsive via the
 * same portal overlay). The wheel uses native CSS scroll-snap, so it gets
 * momentum + snapping for free on touch and mouse-wheel/drag on desktop, with
 * arrow-key support for accessibility.
 *
 * Drop-in for the previous native <select>: same public API. Works both
 * controlled (`value` + `onChange`, the desktop settings form) and uncontrolled
 * (`name` + `defaultValue`, the FormData profile/settings forms — a hidden input
 * carries the value so form submission is unchanged). Style the trigger via
 * `className` and the picker surface via `optionClassName`.
 */
export function AgeSelect({
  id,
  name,
  value,
  defaultValue,
  onChange,
  min = 16,
  max = 100,
  required,
  disabled,
  dir,
  className,
  optionClassName,
  placeholder,
  invalid,
  ...rest
}: AgeSelectProps) {
  const ages = Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i);
  const clampAge = (n: number) => Math.min(max, Math.max(min, n));

  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<string>(
    defaultValue !== undefined && defaultValue !== '' ? String(defaultValue) : '',
  );
  const currentRaw = isControlled ? value : internal;
  const current = currentRaw === undefined || currentRaw === '' ? '' : String(currentRaw);

  const [open, setOpen] = useState(false);
  const [temp, setTemp] = useState<number>(DEFAULT_ANCHOR);
  const [mounted, setMounted] = useState(false);
  const [show, setShow] = useState(false); // drives enter/exit transition
  const labelId = useId();

  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(id);
  }, []);

  const commit = useCallback(
    (v: number) => {
      const s = String(v);
      if (!isControlled) setInternal(s);
      onChange?.(s);
    },
    [isControlled, onChange],
  );

  const openPicker = useCallback(() => {
    if (disabled) return;
    const start = current ? clampAge(Number(current)) : clampAge(DEFAULT_ANCHOR);
    setTemp(start);
    setOpen(true);
  }, [disabled, current]); // eslint-disable-line react-hooks/exhaustive-deps

  const closePicker = useCallback(() => setShow(false), []);

  // Lock body scroll + run enter transition while the sheet is open.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    const raf = requestAnimationFrame(() => setShow(true));
    return () => {
      document.body.style.overflow = '';
      cancelAnimationFrame(raf);
    };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') closePicker();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closePicker]);

  // After the exit transition, actually unmount the overlay.
  const handleTransitionEnd = () => {
    if (!show) setOpen(false);
  };

  const confirm = () => {
    commit(temp);
    closePicker();
  };

  const overlay = open ? (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
      dir={dir}
    >
      {/* Backdrop */}
      <div
        className={cn(
          'absolute inset-0 bg-black/45 backdrop-blur-[2px] transition-opacity duration-200',
          show ? 'opacity-100' : 'opacity-0',
        )}
        onClick={closePicker}
      />

      {/* Panel: bottom sheet on mobile, centered card on desktop. */}
      <div
        onTransitionEnd={handleTransitionEnd}
        className={cn(
          'relative z-10 w-full max-w-md overflow-hidden rounded-t-3xl border border-border shadow-2xl',
          'sm:w-[320px] sm:rounded-3xl',
          'transition-all duration-250 ease-out',
          show
            ? 'translate-y-0 opacity-100 sm:scale-100'
            : 'translate-y-full opacity-0 sm:translate-y-2 sm:scale-95 sm:opacity-0',
          optionClassName || 'bg-background text-foreground',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <button
            type="button"
            onClick={closePicker}
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {dir === 'rtl' ? 'إلغاء' : 'Cancel'}
          </button>
          <span id={labelId} className="text-sm font-semibold">
            {placeholder || 'Age'}
          </span>
          <button
            type="button"
            onClick={confirm}
            className="text-sm font-bold text-accent transition-opacity hover:opacity-80"
          >
            {dir === 'rtl' ? 'تم' : 'Done'}
          </button>
        </div>

        <Wheel ages={ages} value={temp} onChange={setTemp} />
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={openPicker}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-invalid={invalid || undefined}
        className={cn(
          className,
          'inline-flex items-center justify-between gap-2 text-start',
          'disabled:cursor-not-allowed disabled:opacity-50',
          invalid && 'border-danger focus:ring-danger/40',
        )}
        {...rest}
      >
        <span className={cn('truncate tabular-nums', !current && 'opacity-50')} dir="ltr">
          {current || placeholder || ''}
        </span>
        <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" aria-hidden />
      </button>

      {/* Carries the value for FormData submission in the uncontrolled forms. */}
      {name ? <input type="hidden" name={name} value={current} required={required} /> : null}

      {mounted && overlay ? createPortal(overlay, document.body) : null}
    </>
  );
}

/**
 * The scroll wheel itself. Native scroll-snap does the snapping/momentum; we read
 * the centered row after scrolling settles and report it up. Arrow keys and row
 * taps scroll to (and select) a row.
 */
function Wheel({
  ages,
  value,
  onChange,
}: {
  ages: number[];
  value: number;
  onChange: (v: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueIndex = Math.max(0, ages.indexOf(value));

  // Position the wheel on the initial value when it first opens (no animation).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = valueIndex * ITEM_H;
    // Mount-only: subsequent value changes come FROM scrolling, so re-syncing
    // here would fight the user's drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrollToIndex = (idx: number, smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: idx * ITEM_H, behavior: smooth ? 'smooth' : 'auto' });
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => {
      const idx = Math.min(ages.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_H)));
      const a = ages[idx];
      if (a !== undefined && a !== value) onChange(a);
    }, 70);
  };

  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const next = e.key === 'ArrowDown' ? valueIndex + 1 : valueIndex - 1;
    const clamped = Math.min(ages.length - 1, Math.max(0, next));
    const a = ages[clamped];
    if (a === undefined) return;
    onChange(a);
    scrollToIndex(clamped, true);
  };

  return (
    <div
      className="relative select-none"
      style={{ height: ITEM_H * VISIBLE }}
      role="listbox"
      tabIndex={0}
      aria-label="Age"
      aria-activedescendant={`age-opt-${ages[valueIndex]}`}
      onKeyDown={handleKey}
    >
      {/* Center selection band */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-3 z-10 rounded-xl border-y border-accent/30 bg-accent/[0.07]"
        style={{ top: PAD, height: ITEM_H }}
      />

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto overscroll-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          scrollSnapType: 'y mandatory',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent, #000 28%, #000 72%, transparent)',
          maskImage: 'linear-gradient(to bottom, transparent, #000 28%, #000 72%, transparent)',
        }}
      >
        <div style={{ height: PAD }} aria-hidden />
        {ages.map((a) => {
          const selected = a === value;
          return (
            <button
              key={a}
              id={`age-opt-${a}`}
              type="button"
              role="option"
              aria-selected={selected}
              tabIndex={-1}
              onClick={() => {
                onChange(a);
                scrollToIndex(ages.indexOf(a), true);
              }}
              className={cn(
                'flex w-full items-center justify-center tabular-nums transition-[opacity,transform,color] duration-150',
                selected
                  ? 'scale-100 font-bold text-accent opacity-100'
                  : 'scale-90 font-medium opacity-35',
              )}
              style={{ height: ITEM_H, scrollSnapAlign: 'center' }}
              dir="ltr"
            >
              {a}
            </button>
          );
        })}
        <div style={{ height: PAD }} aria-hidden />
      </div>
    </div>
  );
}

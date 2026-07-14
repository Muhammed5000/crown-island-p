'use client';

import { useMemo, useState, useRef } from 'react';
import { CalendarIcon } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setDate as setFlowDate } from '@/store/slices/bookingFlow';
import { toIsoDate } from '@/lib/date';
import { cn } from '@/lib/cn';

/**
 * Horizontal 7-day strip starting today. The selected day is mirrored into the
 * `bookingFlow` Redux slice so that when the customer drills into a category /
 * service, the booking form defaults to the day they picked here (instead of
 * always defaulting to today).
 *
 * Locale-aware: day-of-week + "today"/"tomorrow" labels come from the parent
 * so the strip works in Arabic too.
 */
interface Props {
  weekdayLabels: string[]; // length 7, indexed by getDay() (0 = Sunday)
  todayLabel: string;
  tomorrowLabel: string;
  pickDateLabel: string;
}

interface Day {
  key: string;
  num: number;
  label: string;
}

export function DateScrubber({
  weekdayLabels,
  todayLabel,
  tomorrowLabel,
  pickDateLabel,
}: Props) {
  const days = useMemo<Day[]>(() => {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(base.getTime() + i * 86_400_000);
      return {
        // LOCAL yyyy-mm-dd, NOT toISOString() (which is UTC). `base` is local
        // midnight, so in a UTC+ timezone (e.g. Cairo) toISOString() rolls back
        // to the previous day — the strip would show "19" but store "18", and
        // the booking form would then default to the 18th. toIsoDate keeps the
        // stored key in lockstep with the displayed `num` (both local).
        key: toIsoDate(d),
        num: d.getDate(),
        label:
          i === 0
            ? todayLabel
            : i === 1
              ? tomorrowLabel
              : (weekdayLabels[d.getDay()] ?? ''),
      };
    });
  }, [weekdayLabels, todayLabel, tomorrowLabel]);

  const dispatch = useAppDispatch();
  const flowDate = useAppSelector((s) => s.bookingFlow.date);
  // Pre-select the day already chosen for this booking flow when it falls in
  // the visible 7-day window; otherwise default to today.
  const [selected, setSelected] = useState<string>(flowDate ?? days[0]!.key);

  const pick = (key: string) => {
    setSelected(key);
    dispatch(setFlowDate(key));
  };

  const inputRef = useRef<HTMLInputElement>(null);
  const todayIso = useMemo(() => toIsoDate(new Date()), []);

  const isPickedExternal = useMemo(
    () => selected && !days.some((d) => d.key === selected),
    [selected, days],
  );

  return (
    <div
      role="tablist"
      aria-label="Date"
      className="flex items-center gap-1.5 overflow-x-auto px-4 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {days.map((d) => {
        const active = d.key === selected;
        return (
          <button
            key={d.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => pick(d.key)}
            className={[
              'flex min-w-[54px] shrink-0 flex-col items-center gap-0.5 rounded-2xl px-1.5 pb-2.5 pt-2 transition rtl:min-w-[76px] rtl:px-2.5',
              // The picked day stands out larger than the rest (scale is purely
              // visual, so the strip doesn't reflow); z-10 keeps it above its
              // neighbours as it grows into the gaps.
              active
                ? 'z-10 scale-[1.16] bg-accent text-accent-foreground shadow-[0_8px_20px_-8px_rgba(42,157,168,0.55)]'
                : 'bg-muted text-foreground hover:bg-border',
            ].join(' ')}
          >
            <span
              className={[
                'whitespace-nowrap font-aurelia-sans text-[9.5px] font-semibold uppercase tracking-[0.15em] rtl:text-[11px] rtl:normal-case rtl:tracking-normal',
                active ? 'opacity-80' : 'opacity-55',
              ].join(' ')}
            >
              {d.label}
            </span>
            <span className="font-aurelia-display text-[22px] font-medium leading-none">
              {d.num}
            </span>
          </button>
        );
      })}

      <div className="relative">
        <button
          type="button"
          onClick={() => {
            const el = inputRef.current;
            if (!el) return;
            try {
              const picker = el as HTMLInputElement & { showPicker?: () => void };
              if (typeof picker.showPicker === 'function') {
                picker.showPicker();
              } else {
                el.click();
              }
            } catch {
              el.click();
            }
          }}
          className={cn(
            'flex min-w-[54px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl px-1.5 pb-2.5 pt-2 transition active:scale-95 rtl:min-w-[76px]',
            isPickedExternal
              ? 'z-10 scale-[1.16] bg-accent text-accent-foreground shadow-[0_8px_20px_-8px_rgba(42,157,168,0.55)]'
              : 'bg-muted text-foreground hover:bg-border',
          )}
        >
          <CalendarIcon
            className={cn('size-4', isPickedExternal ? 'opacity-90' : 'opacity-60')}
            strokeWidth={1.8}
          />
          <span
            className={cn(
              'mt-1 whitespace-nowrap font-aurelia-sans text-[9px] font-semibold uppercase tracking-[0.05em] rtl:normal-case rtl:tracking-normal rtl:text-[10.5px]',
              isPickedExternal ? 'opacity-80' : 'opacity-55',
            )}
          >
            {isPickedExternal ? selected.slice(5) : pickDateLabel}
          </span>
        </button>
        <input
          ref={inputRef}
          type="date"
          className="pointer-events-none absolute inset-0 opacity-0"
          min={todayIso}
          onChange={(e) => {
            if (e.target.value) pick(e.target.value);
          }}
        />
      </div>
    </div>
  );
}


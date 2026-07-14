'use client';

import { useMemo, useState, useRef } from 'react';
import { CalendarIcon, MapPinIcon, StarIcon, WavesIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setDate as setFlowDate } from '@/store/slices/bookingFlow';
import { toIsoDate } from '@/lib/date';
import type { DeskCopy, DeskDate } from './types';

// ─────────────────────────────────────────────────────────
// Header strip — eyebrow + headline + at-a-glance stats
// ─────────────────────────────────────────────────────────
export function DeskHeader({
  eyebrow,
  headline,
  desk,
  stats,
}: {
  eyebrow: string;
  headline: string;
  desk: DeskCopy;
  stats: { openNow: number; reservations: number; experiences: number };
}) {
  const lines = headline.split('\n');
  const cells = [
    { k: desk.statOpenNow, v: stats.openNow, Icon: WavesIcon },
    { k: desk.statReservations, v: stats.reservations, Icon: MapPinIcon },
    { k: desk.statExperiences, v: stats.experiences, Icon: StarIcon },
  ];

  return (
    <div className="flex items-end gap-10 px-10 pb-6 pt-9">
      <div className="max-w-[720px] flex-1">
        <div className="mb-3 font-aurelia-sans text-[11px] font-semibold uppercase tracking-[0.28em] text-gold-600 rtl:tracking-normal rtl:normal-case">
          {eyebrow}
        </div>
        <h1 className="m-0 font-aurelia-display text-[56px] font-extrabold leading-[0.98] tracking-[-0.01em] text-foreground">
          {lines.map((line, i) => (
            <span key={i} className="block">
              {line}
            </span>
          ))}
        </h1>
        <p className="mt-3.5 max-w-[480px] font-aurelia-display text-[17px] leading-[1.4] text-muted-foreground">
          {desk.headingSub}
        </p>
      </div>

      <div className="flex gap-3">
        {cells.map((s) => (
          <div
            key={s.k}
            className="flex min-w-[104px] flex-1 flex-col items-center gap-2 rounded-[16px] border border-border bg-card px-5 py-4 text-center shadow-soft"
          >
            <div className="font-aurelia-sans text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {s.k}
            </div>
            <div className="font-aurelia-display text-[32px] font-extrabold leading-none text-foreground">
              {s.v}
            </div>
            <s.Icon className="size-5 text-accent" strokeWidth={1.6} aria-hidden />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Filter row — date scrubber + filter chips
// ─────────────────────────────────────────────────────────
export function DeskFilterRow({
  dates,
  filters,
  filterId,
  onFilter,
  desk,
}: {
  dates: DeskDate[];
  filters: Array<{ id: string; label: string }>;
  filterId: string;
  onFilter: (id: string) => void;
  desk: DeskCopy;
}) {
  // Mirror the picked day into the booking flow so the service form defaults
  // to it (same behaviour as the mobile DateScrubber).
  const dispatch = useAppDispatch();
  const flowDate = useAppSelector((s) => s.bookingFlow.date);
  const [activeDate, setActiveDate] = useState(flowDate ?? (dates[0]?.key ?? ''));

  const inputRef = useRef<HTMLInputElement>(null);

  const pickDate = (key: string) => {
    setActiveDate(key);
    dispatch(setFlowDate(key));
  };

  const todayIso = useMemo(() => toIsoDate(new Date()), []);

  const isPickedExternal = useMemo(
    () => activeDate && !dates.some((d) => d.key === activeDate),
    [activeDate, dates],
  );

  return (
    <div className="flex flex-col gap-3.5 border-b border-border px-10 pb-6">
      {/* Date scrubber */}
      <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {dates.map((d) => {
          const active = d.key === activeDate;
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => pickDate(d.key)}
              className={cn(
                'flex min-w-[58px] shrink-0 flex-col items-center gap-0.5 rounded-[12px] px-2 pb-2.5 pt-2 transition-colors rtl:min-w-[78px] rtl:px-3',
                active ? 'bg-accent text-accent-foreground' : 'bg-muted text-foreground',
              )}
            >
              <span
                className={cn(
                  'whitespace-nowrap font-aurelia-sans text-[9.5px] font-semibold uppercase tracking-[0.12em] rtl:text-[11px] rtl:normal-case rtl:tracking-normal',
                  active ? 'opacity-80' : 'opacity-55',
                )}
              >
                {d.weekday}
              </span>
              <span className="font-aurelia-display text-[22px] font-extrabold leading-none">
                {d.day}
              </span>
            </button>
          );
        })}

        <div className="relative ms-1.5 shrink-0">
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
              'flex h-[50px] items-center gap-1.5 rounded-[12px] border border-dashed px-3.5 font-aurelia-sans text-[11.5px] transition-colors',
              isPickedExternal
                ? 'border-accent bg-accent text-accent-foreground'
                : 'border-border bg-muted text-muted-foreground hover:border-accent/40 hover:bg-muted/70',
            )}
          >
            <CalendarIcon
              className={cn('size-3', isPickedExternal ? 'text-accent-foreground' : 'text-muted-foreground')}
              strokeWidth={1.6}
              aria-hidden
            />
            {isPickedExternal ? activeDate : desk.pickDate}
          </button>
          <input
            ref={inputRef}
            type="date"
            className="pointer-events-none absolute inset-0 opacity-0"
            min={todayIso}
            onChange={(e) => {
              if (e.target.value) pickDate(e.target.value);
            }}
          />
        </div>
      </div>

      {/* Filter chips + sort */}
      <div className="flex items-center gap-1.5">
        {filters.map((f) => {
          const active = f.id === filterId;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onFilter(f.id)}
              className={cn(
                'rounded-full border px-3.5 py-2 font-aurelia-sans text-[12px] font-medium tracking-[0.02em] transition',
                active
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

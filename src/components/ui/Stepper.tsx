'use client';

import { MinusIcon, PlusIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

interface Props {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  label?: string;
  decrementLabel?: string;
  incrementLabel?: string;
  className?: string;
}

/**
 * Numeric stepper — used for people / cars selection.
 * Keeps the value clamped between [min, max].
 */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  label,
  decrementLabel = '-',
  incrementLabel = '+',
  className,
}: Props) {
  const decDisabled = value <= min;
  const incDisabled = value >= max;

  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      {label ? <span className="text-sm text-muted-foreground">{label}</span> : null}
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={decrementLabel}
          disabled={decDisabled}
          onClick={() => onChange(Math.max(min, value - 1))}
          className={cn(
            'grid size-10 place-items-center rounded-full border border-accent/40 bg-accent/[0.06] text-accent transition-colors',
            'hover:border-accent hover:bg-accent/[0.12] disabled:cursor-not-allowed disabled:opacity-40',
          )}
        >
          <MinusIcon className="size-4" />
        </button>
        <span className="min-w-[2.5rem] text-center font-display text-xl tabular-nums text-foreground">
          {value}
        </span>
        <button
          type="button"
          aria-label={incrementLabel}
          disabled={incDisabled}
          onClick={() => onChange(Math.min(max, value + 1))}
          className={cn(
            'grid size-10 place-items-center rounded-full border border-accent/40 bg-accent/[0.06] text-accent transition-colors',
            'hover:border-accent hover:bg-accent/[0.12] disabled:cursor-not-allowed disabled:opacity-40',
          )}
        >
          <PlusIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}

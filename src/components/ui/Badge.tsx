import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'gold' | 'navy' | 'success' | 'warning' | 'danger' | 'info' | 'muted';
/** Public alias for the Badge tone union — used by tag chips, status pills, etc. */
export type BadgeTone = Tone;

const tones: Record<Tone, string> = {
  gold: 'bg-gold-400/15 text-gold-700 border-gold-400/35',
  navy: 'bg-primary/10 text-primary border-primary/25',
  success: 'bg-green-500/12 text-green-700 border-green-500/30',
  warning: 'bg-amber-500/15 text-amber-700 border-amber-500/35',
  danger: 'bg-red-500/12 text-red-700 border-red-500/30',
  info: 'bg-teal-500/12 text-teal-700 border-teal-500/30',
  muted: 'bg-muted text-muted-foreground border-border',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = 'gold', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold tracking-tight',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

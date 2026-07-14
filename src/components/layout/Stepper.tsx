import { cn } from '@/lib/cn';

interface Props {
  /** Current step 1-based. Past steps are filled, future steps are outlined. */
  current: 1 | 2 | 3;
  className?: string;
}

/**
 * 3-step horizontal progress indicator for the booking flow
 * (1 = date & guests, 2 = review, 3 = payment).
 *
 *  - Always rendered LTR so the "1 → 2 → 3" order is preserved even
 *    inside RTL pages.
 *  - Filled circles use gold; future circles are outlined with cream text.
 *  - Connector line glows gold for the segment between past/current.
 */
export function Stepper({ current, className }: Props) {
  const steps = [1, 2, 3] as const;
  return (
    <div
      dir="ltr"
      className={cn('flex items-center justify-center gap-0 px-8 pb-6 pt-2', className)}
    >
      {steps.map((n, i) => {
        const reached = n <= current;
        const active = n === current;
        return (
          <div key={n} className="flex flex-1 items-center last:flex-none">
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold transition-all duration-500',
                reached
                  ? 'bg-gradient-to-br from-[#f7e4a8] to-[#d4a557] text-[#1a1206] shadow-[0_0_15px_rgba(212,165,87,0.3)]'
                  : 'border-[1.5px] border-border text-muted-foreground/60',
                active && 'scale-110 ring-4 ring-gold-400/10',
              )}
            >
              {n}
            </span>
            {i < steps.length - 1 ? (
              <span
                className={cn(
                  'mx-2 h-px flex-1 min-w-[20px] transition-colors duration-700',
                  n < current ? 'bg-gold-400/60' : 'bg-border',
                )}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

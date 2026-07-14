import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  /** Small label shown inside the field, above the value. */
  hint: string;
  /** Optional trailing icon / element. */
  trailing?: ReactNode;
}

/**
 * "Inline-hint" input — matches the design's `Field` component on Screen 05:
 * a card-styled wrapper with a tiny muted hint label and the value below.
 */
export const Field = forwardRef<HTMLInputElement, Props>(function Field(
  { hint, trailing, className, ...inputProps },
  ref,
) {
  return (
    <label
      className={cn(
        'flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5',
        'transition-colors focus-within:ring-2 focus-within:ring-accent/55 focus-within:border-accent/50',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <span className="block text-[10px] text-muted-foreground">{hint}</span>
        <input
          ref={ref}
          {...inputProps}
          className="block w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      </div>
      {trailing}
    </label>
  );
});

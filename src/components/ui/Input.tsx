import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /**
   * Id of the element describing an error for this input. When `invalid` is
   * true, it's wired to `aria-describedby` so assistive tech reads the error
   * alongside the field. Render the error element with this same id.
   */
  errorId?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, errorId, 'aria-describedby': describedBy, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'block h-12 w-full rounded-xl border bg-card px-4 text-foreground placeholder:text-muted-foreground',
        'transition-colors focus:outline-none focus:ring-2 focus:ring-accent/55 focus:border-accent/50',
        invalid ? 'border-danger/60' : 'border-border',
        className,
      )}
      aria-invalid={invalid || undefined}
      aria-describedby={(invalid && errorId ? errorId : undefined) ?? describedBy}
      {...props}
    />
  );
});

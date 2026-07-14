import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'solid' | 'outline' | 'glass' | 'flat';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
}

/**
 * Card surface.
 *
 * Light "Seaside Daylight" surface — white card on the off-white canvas with a
 * 1px hairline border and a soft, low-opacity shadow. `flat` is the muted tone
 * used for callouts. Large rounded corners as in the reference.
 */
const variants: Record<Variant, string> = {
  solid: 'bg-card border border-border shadow-soft',
  outline: 'border border-border bg-card',
  glass: 'bg-card/70 backdrop-blur-xl saturate-150 border border-border shadow-soft',
  flat: 'bg-muted border border-border',
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, variant = 'solid', ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-2xl overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
});

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 pt-4 pb-2', className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 border-t border-border px-5 py-4',
        className,
      )}
      {...props}
    />
  );
}

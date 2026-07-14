import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-xl bg-gradient-to-r from-muted via-muted/60 to-muted bg-[length:200%_100%]',
        className,
      )}
      aria-hidden
      {...props}
    />
  );
}

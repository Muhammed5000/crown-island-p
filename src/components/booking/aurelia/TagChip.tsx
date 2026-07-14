import { cn } from '@/lib/cn';

/**
 * Inline pill used inside cards (highlight chips, "what's included"). Matches
 * the AURELIA prototype's `<TagChip>` — translucent, hair-line border.
 */
export function TagChip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-border bg-muted px-2 py-[3px]',
        'font-aurelia-sans text-[9.5px] font-medium tracking-[0.025em] text-foreground/85',
        className,
      )}
    >
      {children}
    </span>
  );
}

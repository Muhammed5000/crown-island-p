import { cn } from '@/lib/cn';

/**
 * Status pill used across every AURELIA card. Three states map to colours and
 * a label; the `open` dot glows softly to draw the eye.
 */
export type AureliaStatus = 'open' | 'filling' | 'closed' | 'soon';

const STATUS_META: Record<AureliaStatus, { color: string; glow: string }> = {
  open: { color: '#2f9e6f', glow: '0 0 8px rgba(47,158,111,0.5)' },
  filling: { color: '#c2a14e', glow: 'none' },
  // Theme-aware muted dot. The old fixed navy-alpha vanished on dark surfaces;
  // the muted-foreground token stays visible in both themes (slate on light,
  // cool slate on dark).
  closed: { color: 'rgb(var(--ci-muted-foreground))', glow: 'none' },
  // "Coming soon" — a category with no services yet. A calm periwinkle blue,
  // distinct from open (green) / filling (gold) / closed (muted), softly glowing
  // to read as an upcoming-experience teaser rather than an availability state.
  soon: { color: '#6f86c9', glow: '0 0 8px rgba(111,134,201,0.45)' },
};

interface Props {
  status: AureliaStatus;
  label: string;
  className?: string;
}

export function StatusDot({ status, label, className }: Props) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-aurelia-sans text-[10.5px] font-medium tracking-[0.02em] text-foreground/85',
        className,
      )}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ background: meta.color, boxShadow: meta.glow }}
      />
      {label}
    </span>
  );
}

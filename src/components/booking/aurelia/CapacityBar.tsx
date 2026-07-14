/**
 * Horizontal capacity gauge from the AURELIA prototype. Bar turns warm coral
 * past ~85% so "filling up" is visually distinct from comfortable openings.
 */
interface Props {
  /** 0–1 fraction of capacity already taken. */
  value: number;
  /** "{pct}% full" / "{remaining}% left" copy template. */
  copy: { full: (pct: number) => string; left: (pct: number) => string };
}

export function CapacityBar({ value, copy }: Props) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  const hot = value > 0.85;
  return (
    <div className="flex items-center gap-3">
      <div className="h-[3px] w-12 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${pct}%`,
            background: hot ? '#d97a5a' : '#c2a14e',
          }}
        />
      </div>
      <span className="font-aurelia-sans text-[9.5px] tracking-[0.025em] text-muted-foreground">
        {hot ? copy.left(100 - pct) : copy.full(pct)}
      </span>
    </div>
  );
}

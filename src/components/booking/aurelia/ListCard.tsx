import Image from 'next/image';
import { ChevronLeftIcon } from 'lucide-react';
import { StatusDot, type AureliaStatus } from './StatusDot';

/**
 * Compact horizontal AURELIA list card. Whole tile is one `<button>` that
 * defers to the parent grid to open the detail sheet; the info chip from
 * the previous iteration is gone — the sheet hosts those details now.
 */
export interface ListCardProps {
  image: string;
  kicker: string;
  name: string;
  tagline?: string | null;
  status: AureliaStatus;
  statusLabel: string;
  /** "Available" / "Opens soon" / "Closed today". */
  slotLabel: string;
  onTap: () => void;
}

export function ListCard({
  image,
  kicker,
  name,
  tagline,
  status,
  statusLabel,
  slotLabel,
  onTap,
}: ListCardProps) {
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`${kicker} — ${name}`}
      className="relative flex w-full overflow-hidden rounded-[18px] border border-border bg-card p-0 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <div className="relative h-[124px] w-[108px] flex-shrink-0 overflow-hidden bg-black">
        <Image
          src={image}
          alt=""
          fill
          sizes="108px"
          className="object-cover"
        />
        <span className="absolute start-2 top-2 rounded-full bg-aurelia-bg-2/70 px-1.5 py-[3px] font-aurelia-sans text-[8.5px] font-bold uppercase tracking-[0.15em] text-aurelia-cream backdrop-blur-md">
          {kicker.toUpperCase()}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5 p-3.5">
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="truncate font-aurelia-display text-[22px] font-medium leading-none tracking-[0.01em] text-foreground">
              {name}
            </h3>
          </div>
          {tagline ? (
            <p className="mt-1 line-clamp-2 font-aurelia-sans text-[11.5px] leading-snug text-muted-foreground">
              {tagline}
            </p>
          ) : null}
        </div>
        <div className="flex items-center justify-between">
          <StatusDot status={status} label={statusLabel} />
          <span className="inline-flex items-center gap-1 font-aurelia-sans text-[10.5px] font-semibold tracking-[0.04em] text-gold-700">
            {slotLabel}
            <ChevronLeftIcon className="size-3 ltr:rotate-180" strokeWidth={2} aria-hidden />
          </span>
        </div>
      </div>
    </button>
  );
}

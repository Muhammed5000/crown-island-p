import Image from 'next/image';
import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react';
import type { Locale } from '@/i18n/config';
import { StatusDot, type AureliaStatus } from './StatusDot';
import { TagChip } from './TagChip';

/**
 * Full-bleed AURELIA hero card. Whole card is one `<button>` that asks the
 * parent grid to open the detail sheet — there's no separate info chip
 * anymore, since the sheet contains everything the about page used to.
 */
export interface FeaturedCardProps {
  image: string;
  kicker: string;
  vibe?: string;
  name: string;
  tagline?: string | null;
  tags: string[];
  status: AureliaStatus;
  /** Localised "Open now" / "Filling up" / "Closed" copy. */
  statusLabel: string;
  /** "Reserve now" CTA label inside the pill. */
  reserveLabel: string;
  locale: Locale;
  onTap: () => void;
}

export function FeaturedCard({
  image,
  kicker,
  vibe,
  name,
  tagline,
  tags,
  status,
  statusLabel,
  reserveLabel,
  locale,
  onTap,
}: FeaturedCardProps) {
  const Arrow = locale === 'ar' ? ArrowLeftIcon : ArrowRightIcon;

  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`${name} — ${reserveLabel}`}
      className="relative block h-[280px] w-full overflow-hidden rounded-3xl border-0 bg-black p-0 text-start text-aurelia-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {/* Background photo */}
      <Image
        src={image}
        alt=""
        fill
        priority
        sizes="(max-width: 768px) 100vw, 640px"
        className="object-cover [filter:saturate(105%)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_30%,rgba(8,14,24,0.85)_100%)]"
      />

      {/* Status pill */}
      <span className="absolute end-4 top-4 rounded-full border border-border bg-card/85 px-2.5 py-[5px] backdrop-blur-md">
        <StatusDot status={status} label={statusLabel} />
      </span>

      <div className="absolute inset-x-0 bottom-0 px-5 pb-[18px]">
        <div className="mb-1.5 font-aurelia-sans text-[10px] font-semibold uppercase tracking-[0.24em] text-aurelia-cream/70">
          {kicker.toUpperCase()}
          {vibe ? <> · {vibe.toUpperCase()}</> : null}
        </div>
        <h2 className="m-0 font-aurelia-display text-[38px] font-medium leading-[0.98] tracking-[-0.015em]">
          {name}
        </h2>
        {tagline ? (
          <p className="mt-2 max-w-[92%] font-aurelia-sans text-[13px] leading-snug text-aurelia-cream/80">
            {tagline}
          </p>
        ) : null}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex gap-1.5">
            {tags.slice(0, 2).map((t) => (
              <TagChip key={t}>{t}</TagChip>
            ))}
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 font-aurelia-sans text-[11.5px] font-bold tracking-[0.04em] text-primary-foreground shadow-[0_8px_20px_-6px_rgba(22,48,79,0.5)]">
            {reserveLabel}
            <Arrow className="size-3.5" strokeWidth={2.5} aria-hidden />
          </span>
        </div>
      </div>
    </button>
  );
}

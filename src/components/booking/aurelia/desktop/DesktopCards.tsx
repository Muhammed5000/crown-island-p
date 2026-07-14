'use client';

import Image from 'next/image';
import { CalendarDaysIcon, ClockIcon } from 'lucide-react';
import type { Locale } from '@/i18n/config';
import { StatusDot, type AureliaStatus } from '../StatusDot';
import { TagChip } from '../TagChip';
import {
  deriveHours,
  deriveImage,
  deriveKicker,
  deriveSlotLabel,
  deriveStatus,
  deriveTags,
  type CategoryWithExtras,
} from '../derive';
import type { CopyBundle, DeskCopy } from './types';

/** Maps a derived status to its localised label. Shared by both desktop cards. */
export function statusLabelFor(status: AureliaStatus, copy: CopyBundle): string {
  if (status === 'filling') return copy.statusFilling;
  if (status === 'closed') return copy.statusClosed;
  if (status === 'soon') return copy.statusSoon;
  return copy.statusOpen;
}

interface CardProps {
  category: CategoryWithExtras;
  locale: Locale;
  copy: CopyBundle;
  desk: DeskCopy;
  onTap: (c: CategoryWithExtras) => void;
  onReserve: (c: CategoryWithExtras) => void;
}

/**
 * Cinematic featured strip — full width, two-pane (photo + meta). The whole
 * card is a single button that opens the detail sheet, mirroring the mobile
 * `FeaturedCard` interaction so the booking funnel stays single-entry.
 */
export function DeskFeatured({ category, locale, copy, desk, onTap, onReserve }: CardProps) {
  const name = locale === 'ar' ? category.nameAr : category.nameEn;
  const tagline = locale === 'ar' ? category.descAr : category.descEn;
  const kicker = deriveKicker(category, locale);
  const status = deriveStatus(category);
  const tags = deriveTags(category, locale);
  const hours = deriveHours(category, locale);
  const slot = deriveSlotLabel(category, {
    now: copy.nextSlotNow,
    opens: copy.nextSlotOpens,
    closed: copy.nextSlotClosed,
  });

  return (
    <div
      onClick={() => onTap(category)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onTap(category);
        }
      }}
      role="button"
      tabIndex={0}
      className="group block h-[380px] w-full cursor-pointer overflow-hidden rounded-[22px] border border-border bg-card text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
    >
      <div className="grid h-full grid-cols-[1.1fr_1fr]">
        {/* Photo pane */}
        <div className="relative overflow-hidden bg-black">
          <Image
            src={deriveImage(category)}
            alt=""
            fill
            sizes="(min-width: 1280px) 640px, 100vw"
            className="object-cover saturate-[1.08] transition-transform duration-[600ms] ease-out group-hover:scale-[1.04]"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-[linear-gradient(120deg,rgba(8,14,24,0.5)_0%,rgba(8,14,24,0)_50%)]"
          />
          <div className="absolute start-[22px] top-[22px] flex gap-2">
            <span className="rounded-full border border-border bg-card/85 px-3 py-1.5 font-aurelia-sans text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground backdrop-blur-[10px]">
              {kicker}
            </span>
          </div>
          <div className="absolute end-[22px] top-[22px] rounded-full border border-border bg-card/85 px-3 py-1.5 backdrop-blur-[10px]">
            <StatusDot status={status} label={statusLabelFor(status, copy)} />
          </div>
        </div>

        {/* Meta pane — density tuned so the content always fits the fixed card
            height even when the carousel narrows it (no clipped buttons). */}
        <div className="flex min-w-0 flex-col bg-card px-7 py-[26px]">
          <div className="mb-2 font-aurelia-sans text-[10px] font-semibold uppercase tracking-[0.24em] text-gold-600">
            {kicker}
          </div>
          <h2 className="m-0 line-clamp-2 font-aurelia-display text-[clamp(28px,2.5vw,46px)] font-extrabold leading-[1.0] tracking-[-0.01em] text-foreground">
            {name}
          </h2>
          {tagline ? (
            <p className="mt-2.5 line-clamp-2 font-aurelia-sans text-[13px] leading-[1.5] text-muted-foreground">
              {tagline}
            </p>
          ) : null}

          {tags.length > 0 ? (
            // Single, height-bounded row: admin highlights have no length cap, so
            // flex-nowrap + overflow-hidden keeps the tags from wrapping to extra
            // rows and pushing the buttons past the card's fixed-height clip.
            <div className="mt-3 flex flex-nowrap gap-1.5 overflow-hidden">
              {tags.slice(0, 3).map((t) => (
                <TagChip key={t} className="shrink-0 whitespace-nowrap">
                  {t}
                </TagChip>
              ))}
            </div>
          ) : null}

          <div className="flex-1" />

          <div className="mt-3.5 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3.5">
            <div className="flex min-w-0 items-start gap-2">
              <ClockIcon className="mt-0.5 size-[15px] shrink-0 text-accent" strokeWidth={1.6} aria-hidden />
              <div className="min-w-0">
                <div className="mb-0.5 font-aurelia-sans text-[8.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {desk.hoursLabel}
                </div>
                <div className="truncate font-aurelia-sans text-[12px] font-medium text-foreground">
                  {hours || '—'}
                </div>
              </div>
            </div>
            <div className="flex min-w-0 items-start gap-2">
              <CalendarDaysIcon className="mt-0.5 size-[15px] shrink-0 text-accent" strokeWidth={1.6} aria-hidden />
              <div className="min-w-0">
                <div className="mb-0.5 font-aurelia-sans text-[8.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {desk.nextAvailabilityLabel}
                </div>
                <div className="truncate font-aurelia-sans text-[12px] font-medium text-foreground">
                  {slot}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3.5 flex gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onReserve(category);
              }}
              className="min-w-0 flex-1 truncate rounded-xl bg-primary py-3 text-center font-aurelia-sans text-[12.5px] font-bold tracking-[0.02em] text-primary-foreground transition hover:bg-primary/90 group-hover:-translate-y-0.5 active:translate-y-0"
            >
              {copy.reserveCta} · {slot}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTap(category);
              }}
              className="shrink-0 rounded-xl border border-border bg-muted px-4 py-3 font-aurelia-sans text-[12.5px] font-medium text-foreground transition hover:bg-muted/70"
            >
              {desk.detailsLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Daily-offer card — the design's `.ocard` from "Crown Island Home (Arabic)":
 * a clean photo on top, then a navy ExtraBold title, a muted place/subtitle,
 * and a muted LTR time. The whole tile opens the detail sheet (where the
 * status + reserve CTA live), so the booking funnel stays single-entry.
 */
export function DeskCard({ category, locale, copy, onTap }: CardProps) {
  const name = locale === 'ar' ? category.nameAr : category.nameEn;
  const tagline = locale === 'ar' ? category.descAr : category.descEn;
  const kicker = deriveKicker(category, locale);
  const status = deriveStatus(category);
  const hours = deriveHours(category, locale);
  const slot = deriveSlotLabel(category, {
    now: copy.nextSlotNow,
    opens: copy.nextSlotOpens,
    closed: copy.nextSlotClosed,
  });

  return (
    <div
      onClick={() => onTap(category)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onTap(category);
        }
      }}
      role="button"
      tabIndex={0}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-[18px] border border-border bg-card text-start shadow-soft transition-all duration-300 hover:-translate-y-[3px] hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
    >
      {/* Photo with a compact open/closed status chip sized for the small card. */}
      <div className="relative h-[130px] overflow-hidden bg-muted">
        <Image
          src={deriveImage(category)}
          alt=""
          fill
          sizes="(min-width: 1280px) 260px, 100vw"
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.05]"
        />
        <div className="absolute end-2 top-2 rounded-full border border-border bg-card/90 px-2 py-[3px] backdrop-blur-[6px]">
          <StatusDot
            status={status}
            label={statusLabelFor(status, copy)}
            className="gap-1 text-[9.5px]"
          />
        </div>
      </div>

      {/* Body — `.ocard .b`: navy-800 title, muted place, muted LTR time. */}
      <div className="flex flex-1 flex-col px-4 pb-[17px] pt-[15px]">
        <h3 className="m-0 font-aurelia-display text-[17px] font-extrabold leading-tight text-foreground">
          {name}
        </h3>
        {tagline || kicker ? (
          <p className="mt-[5px] line-clamp-1 text-[13px] font-medium text-muted-foreground">
            {tagline || kicker}
          </p>
        ) : null}
        <div className="flex-1" />
        <div dir="ltr" className="mt-[9px] text-end text-[13px] font-semibold text-muted-foreground">
          {hours || slot}
        </div>
      </div>
    </div>
  );
}

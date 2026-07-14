'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Image from 'next/image';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  MapPinIcon,
  ScrollTextIcon,
  XIcon,
} from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/config';
import { ExperienceVideo } from '@/components/brand/ExperienceVideo';
import { InfoBlock } from './InfoBlock';
import { StatusDot } from './StatusDot';
import { PriceMark } from './PriceMark';
import { TagChip } from './TagChip';
import {
  deriveFromPrice,
  deriveGallery,
  deriveHours,
  deriveImage,
  deriveKicker,
  deriveMapsUrl,
  derivePriceTier,
  deriveSlotLabel,
  deriveStatus,
  deriveTags,
  isDirectVideoFile,
  PRICE_TIER_LABELS_AR,
  PRICE_TIER_LABELS_EN,
  type CategoryWithExtras,
} from './derive';

/**
 * AURELIA "detail" bottom sheet (Stage 1 of the prototype's detail-sheet
 * flow — booking + confirmation stages live on the actual `/booking/[slug]`
 * route, so the sheet's primary CTA hands off to them).
 *
 * Mirrors the prototype's `DetailBody`:
 *   - 240px hero with kicker · vibe + serif name overlay
 *   - tagline / long-form description paragraphs
 *   - 2-column InfoBlock grid (hours · price · status · from-price)
 *   - "What's included" tag chips
 *   - "Capacity today" gauge
 *   - optional video preview, gallery strip, address block
 *   - sticky gold CTA → /booking/[slug]
 *
 * Accessibility:
 *   - Renders with role="dialog" aria-modal="true"
 *   - Backdrop click + Escape key close
 *   - Body scroll locked while open
 *   - Focus moves to the close button on open and returns to the trigger
 *     when the sheet unmounts (handled by the parent ref).
 */

export interface DetailSheetCopy {
  close: string;
  infoHours: string;
  infoPrice: string;
  infoStatus: string;
  infoFromPrice: string;
  whatsIncluded: string;
  capacityToday: string;
  whereTitle: string;
  /** Cue shown on the tappable address, e.g. "Open in Google Maps". */
  openInMaps: string;
  galleryTitle: string;
  videoTitle: string;
  /** Section label for the collapsible Terms & policy panel. */
  termsTitle: string;
  /** ICU-style template with a `{pct}` placeholder, e.g. "{pct}% full". */
  capacityFullTemplate: string;
  /** ICU-style template with a `{pct}` placeholder, e.g. "{pct}% left". */
  capacityLeftTemplate: string;
  reservationsClosed: string;
  /** ICU-style template with a `{slot}` placeholder, e.g. "Reserve · {slot}". */
  reserveCtaTemplate: string;
  currency: string;
  statusOpen: string;
  statusFilling: string;
  statusClosed: string;
  statusSoon: string;
  slotNow: string;
  slotOpens: string;
  slotClosed: string;
}

interface Props {
  category: CategoryWithExtras | null;
  locale: Locale;
  copy: DetailSheetCopy;
  onClose: () => void;
  /**
   * Desktop opens the popup as a centered modal (per the AURELIA desktop
   * design); mobile/tablet keep the slide-up bottom sheet. Defaults to the
   * bottom sheet so the mobile callers are unaffected.
   */
  centered?: boolean;
}

export function DetailSheet({ category, locale, copy, onClose, centered = false }: Props) {
  const labelledById = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const router = useRouter();

  // Escape to close + body-scroll lock + focus the close affordance.
  useEffect(() => {
    if (!category) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => closeRef.current?.focus(), 50);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
    };
  }, [category, onClose]);

  return (
    <AnimatePresence>
      {category ? (
        <Body
          key={category.id}
          category={category}
          locale={locale}
          copy={copy}
          centered={centered}
          onClose={onClose}
          labelledById={labelledById}
          closeRef={closeRef}
          onReserve={() => {
            router.push(`/booking/${category.slug}`);
          }}
        />
      ) : null}
    </AnimatePresence>
  );
}

interface BodyProps {
  category: CategoryWithExtras;
  locale: Locale;
  copy: DetailSheetCopy;
  centered: boolean;
  onClose: () => void;
  labelledById: string;
  closeRef: React.RefObject<HTMLButtonElement | null>;
  onReserve: () => void;
}

function Body({
  category,
  locale,
  copy,
  centered,
  onClose,
  labelledById,
  closeRef,
  onReserve,
}: BodyProps) {
  const name = locale === 'ar' ? category.nameAr : category.nameEn;
  const tagline = locale === 'ar' ? category.descAr : category.descEn;

  // Localised Terms & policy list (declared up here so we can both render
  // the section and skip rendering when empty).
  const termsRaw = locale === 'ar' ? category.termsAr : category.termsEn;
  const terms = Array.isArray(termsRaw)
    ? (termsRaw as unknown[]).filter(
        (v): v is string => typeof v === 'string' && v.trim().length > 0,
      )
    : [];
  const [termsOpen, setTermsOpen] = useState(false);
  const longDesc = locale === 'ar' ? category.longDescAr : category.longDescEn;
  const address = locale === 'ar' ? category.addressAr : category.addressEn;
  // Tapping the location opens Google Maps (exact coords when set, else an
  // address search). Null when the category has no location at all.
  const mapsUrl = deriveMapsUrl(category, locale);
  const kicker = deriveKicker(category, locale);
  const status = deriveStatus(category);
  const priceTier = derivePriceTier(category);
  const tags = deriveTags(category, locale);
  const gallery = deriveGallery(category);
  // When the category has a directly-playable uploaded video, it becomes the
  // hero — autoplaying, muted + looping behind the name overlay, in place of the
  // cover image. Embeds (YouTube/Vimeo) can't be an inline background, so they
  // keep the image hero and surface in the dedicated video section below.
  const heroImage = deriveImage(category);
  const heroVideo = isDirectVideoFile(category.videoUrl) ? category.videoUrl : null;
  const hours = deriveHours(category, locale);
  const fromPrice = deriveFromPrice(category, {
    fromLabel: copy.infoFromPrice,
    currency: copy.currency,
  });
  const priceLabel =
    (locale === 'ar' ? PRICE_TIER_LABELS_AR : PRICE_TIER_LABELS_EN)[priceTier] ?? '';

  const statusLabel =
    status === 'filling'
      ? copy.statusFilling
      : status === 'closed'
        ? copy.statusClosed
        : status === 'soon'
          ? copy.statusSoon
          : copy.statusOpen;

  const slot = deriveSlotLabel(category, {
    now: copy.slotNow,
    opens: copy.slotOpens,
    closed: copy.slotClosed,
  });

  const Arrow = locale === 'ar' ? ArrowLeftIcon : ArrowRightIcon;
  // Only the category's `isActive` flag blocks the funnel here. The
  // per-day full / past-hours checks live on the date-selection screen
  // (server-side via the `quote` action) so the user can still pick
  // tomorrow or any later date when today happens to be closed.
  const canInitiateBooking = category.isActive;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledById}
      className={
        centered
          ? 'fixed inset-0 z-[80] flex items-center justify-center p-4'
          : 'fixed inset-0 z-[80] flex flex-col'
      }
    >
      {/* Scrim */}
      <motion.button
        type="button"
        aria-label={copy.close}
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="absolute inset-0 cursor-default bg-[rgba(6,10,18,0.55)] backdrop-blur-[4px]"
      />

      {/* Sheet panel — centered modal on desktop, slide-up bottom sheet on
          mobile/tablet. */}
      <motion.div
        initial={centered ? { opacity: 0, scale: 0.96 } : { y: '100%' }}
        animate={centered ? { opacity: 1, scale: 1 } : { y: 0 }}
        exit={centered ? { opacity: 0, scale: 0.96 } : { y: '100%' }}
        transition={
          centered
            ? { duration: 0.2, ease: 'easeOut' }
            : { duration: 0.34, ease: [0.22, 0.7, 0.3, 1] }
        }
        className={
          centered
            ? 'relative flex h-[720px] max-h-[90dvh] w-[560px] max-w-full flex-col overflow-hidden rounded-[24px] border border-border bg-card shadow-[0_30px_80px_rgba(22,48,79,0.25)]'
            : 'relative mt-auto flex h-[92dvh] max-h-[92dvh] flex-col overflow-hidden rounded-t-[28px] bg-card shadow-[0_-20px_60px_rgba(22,48,79,0.18)]'
        }
      >
        {/* Drag handle */}
        <div className="mt-2.5 flex shrink-0 justify-center">
          <span
            aria-hidden
            className="h-1 w-9 rounded-full bg-foreground/20"
          />
        </div>

        {/* Close */}
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={copy.close}
          className="absolute end-4 top-3.5 z-10 inline-flex size-[30px] items-center justify-center rounded-full bg-card/80 text-foreground backdrop-blur-md transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
        >
          <XIcon className="size-4" strokeWidth={2} aria-hidden />
        </button>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto pb-[120px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* Hero — autoplaying category video when one is uploaded, else the
              cover image. The video is muted + looping + inline so browsers allow
              autoplay; the poster is the cover image so there's no black flash or
              layout shift while it loads. The name/kicker overlay sits on top of
              either. */}
          <div className="mx-4 mt-3.5 h-[240px] overflow-hidden rounded-[20px] bg-black">
            <div className="relative h-full w-full">
              {heroVideo ? (
                <video
                  key={heroVideo}
                  src={heroVideo}
                  poster={heroImage}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="auto"
                  aria-hidden
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <Image
                  src={heroImage}
                  alt=""
                  fill
                  priority
                  sizes="(max-width: 768px) 100vw, 640px"
                  className="object-cover"
                />
              )}
              <div
                aria-hidden
                className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_50%,rgba(8,14,24,0.85)_100%)]"
              />
              <div className="absolute inset-x-4 bottom-3.5 text-aurelia-cream">
                <div className="mb-1 font-aurelia-sans text-[10px] font-semibold uppercase tracking-[0.24em] text-aurelia-gold">
                  {kicker.toUpperCase()}
                </div>
                <h2
                  id={labelledById}
                  className="m-0 font-aurelia-display text-[36px] font-medium leading-none"
                >
                  {name}
                </h2>
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="px-5 pb-6 pt-[18px]">
            {tagline ? (
              <p className="m-0 font-aurelia-sans text-[14px] leading-[1.55] text-foreground/80">
                {tagline}
              </p>
            ) : null}
            {longDesc ? (
              <div className="mt-4 space-y-3">
                {longDesc.split(/\n{2,}/).map((para, i) => (
                  <p
                    key={i}
                    className="m-0 font-aurelia-sans text-[14px] leading-[1.55] text-muted-foreground"
                  >
                    {para}
                  </p>
                ))}
              </div>
            ) : null}

            {/* Info grid */}
            <div className="mt-[18px] grid grid-cols-2 gap-2.5">
              <InfoBlock label={copy.infoHours} value={hours || '—'} />
              <InfoBlock
                label={copy.infoPrice}
                value={
                  <span className="flex items-center gap-2">
                    <PriceMark tier={priceTier} />
                    <span className="opacity-70">· {priceLabel}</span>
                  </span>
                }
              />
              <InfoBlock
                label={copy.infoStatus}
                value={<StatusDot status={status} label={statusLabel} />}
              />
              <InfoBlock
                label={copy.infoFromPrice}
                value={fromPrice ?? '—'}
              />
            </div>

            {/* Tags */}
            {tags.length > 0 ? (
              <>
                <h4 className="mb-2.5 mt-[22px] font-aurelia-sans text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  {copy.whatsIncluded}
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <TagChip key={t}>{t}</TagChip>
                  ))}
                </div>
              </>
            ) : null}

            {/* Video — only for embeds (YouTube/Vimeo). A direct uploaded video
                is already the autoplaying hero above, so we don't repeat it here. */}
            {category.videoUrl && !heroVideo ? (
              <>
                <h4 className="mb-2.5 mt-[22px] font-aurelia-sans text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  {copy.videoTitle}
                </h4>
                <div className="overflow-hidden rounded-2xl border border-border bg-black">
                  <div className="relative aspect-video w-full">
                    <ExperienceVideo
                      url={category.videoUrl}
                      poster={category.coverUrl ?? undefined}
                      title={name}
                    />
                  </div>
                </div>
              </>
            ) : null}

            {/* Gallery strip */}
            {gallery.length > 0 ? (
              <>
                <h4 className="mb-2.5 mt-[22px] font-aurelia-sans text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  {copy.galleryTitle}
                </h4>
                <div className="-mx-5 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {gallery.map((src, i) => (
                    <div
                      key={i}
                      className="relative h-28 w-40 shrink-0 overflow-hidden rounded-2xl border border-border bg-black"
                    >
                      <Image
                        src={src}
                        alt=""
                        fill
                        sizes="160px"
                        className="object-cover"
                      />
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {/* Address — tappable, opens Google Maps in a new tab. Falls back to
                a static block when the category has no mappable location. */}
            {address || mapsUrl ? (
              <>
                <h4 className="mb-2.5 mt-[22px] font-aurelia-sans text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  {copy.whereTitle}
                </h4>
                {mapsUrl ? (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start gap-3 rounded-2xl border border-border bg-muted px-3.5 py-3 transition hover:border-gold-400/50 hover:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                  >
                    <MapPinIcon
                      className="mt-0.5 size-4 shrink-0 text-gold-600"
                      strokeWidth={1.8}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      {address ? (
                        <span className="block font-aurelia-sans text-[13px] leading-[1.5] text-foreground/90">
                          {address}
                        </span>
                      ) : null}
                      <span className="mt-1 inline-flex items-center gap-1 font-aurelia-sans text-[11px] font-semibold text-gold-700 transition group-hover:text-gold-800">
                        {copy.openInMaps}
                        <ExternalLinkIcon className="size-3" strokeWidth={2} aria-hidden />
                      </span>
                    </span>
                  </a>
                ) : (
                  <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted px-3.5 py-3">
                    <MapPinIcon
                      className="mt-0.5 size-4 shrink-0 text-gold-600"
                      strokeWidth={1.8}
                      aria-hidden
                    />
                    <p className="m-0 font-aurelia-sans text-[13px] leading-[1.5] text-foreground/90">
                      {address}
                    </p>
                  </div>
                )}
              </>
            ) : null}

            {/* Terms & policy — collapsible. The whole row is the trigger; an
                aria-controlled panel slides open with the numbered list. We
                use a native <button> so keyboard users get the expected
                Enter/Space toggle for free. */}
            {terms.length > 0 ? (
              <div className="mt-[22px]">
                <button
                  type="button"
                  onClick={() => setTermsOpen((v) => !v)}
                  aria-expanded={termsOpen}
                  aria-controls={`${labelledById}-terms`}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-muted px-3.5 py-3 text-start transition hover:bg-border"
                >
                  <span className="flex items-center gap-3">
                    <ScrollTextIcon
                      className="size-4 shrink-0 text-gold-600"
                      strokeWidth={1.8}
                      aria-hidden
                    />
                    <span className="font-aurelia-sans text-[12px] font-semibold uppercase tracking-[0.18em] text-foreground/85">
                      {copy.termsTitle}
                    </span>
                  </span>
                  <ChevronDownIcon
                    className={[
                      'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
                      termsOpen ? 'rotate-180' : '',
                    ].join(' ')}
                    aria-hidden
                  />
                </button>
                <AnimatePresence initial={false}>
                  {termsOpen ? (
                    <motion.div
                      id={`${labelledById}-terms`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                      className="overflow-hidden"
                    >
                      <ol className="mt-2 space-y-2 rounded-2xl border border-border bg-muted px-3.5 py-3">
                        {terms.map((point, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-3 font-aurelia-sans text-[13px] leading-[1.55] text-foreground/85"
                          >
                            <span className="mt-[1px] inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-gold-400/15 text-[10px] font-bold text-gold-700 ring-1 ring-gold-400/30">
                              {i + 1}
                            </span>
                            <span>{point}</span>
                          </li>
                        ))}
                      </ol>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            ) : null}
          </div>
        </div>

        {/* Sticky CTA — the fade behind the button must use the theme `card`
            colour (white in light, dark navy in dark). It was hardcoded to
            #ffffff, which made the sheet's bottom turn white in dark mode. */}
        <div className="absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,rgb(var(--ci-card)_/_0)_0%,rgb(var(--ci-card))_35%)] px-4 pb-[18px] pt-3.5">
          <button
            type="button"
            onClick={onReserve}
            disabled={!canInitiateBooking}
            className={[
              'flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl font-aurelia-sans text-[14px] font-bold tracking-[0.04em] transition',
              canInitiateBooking
                ? 'bg-primary text-primary-foreground shadow-[0_18px_40px_-10px_rgba(22,48,79,0.45)] hover:-translate-y-0.5 active:translate-y-0'
                : 'cursor-not-allowed bg-muted text-muted-foreground',
            ].join(' ')}
          >
            {canInitiateBooking ? (
              <>
                {copy.reserveCtaTemplate.replace('{slot}', slot)}
                <Arrow className="size-4" strokeWidth={2.5} aria-hidden />
              </>
            ) : (
              copy.reservationsClosed
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

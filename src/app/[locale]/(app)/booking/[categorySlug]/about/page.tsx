import Image from 'next/image';
import { notFound } from 'next/navigation';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CrownIcon,
  MapPinIcon,
  ScrollTextIcon,
  SparklesIcon,
} from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { PageTransition } from '@/components/layout/PageTransition';
import { ExperienceVideo } from '@/components/brand/ExperienceVideo';
import { getCategoryAboutBySlug } from '@/server/repositories/catalog';
import { isLocale } from '@/i18n/config';

/**
 * "About this experience" — the long-form storytelling page reached from
 * the info button on a category card. Designed to *sell* the trip: cinematic
 * hero, video, narrative copy, highlight rail, gallery, address, and a
 * sticky gold CTA pinned to the bottom of the viewport.
 *
 * Everything below the hero gracefully no-ops when the admin hasn't filled
 * in the corresponding field, so the page stays presentable even with
 * partial content.
 */

interface Props {
  params: Promise<{ locale: string; categorySlug: string }>;
}

export default async function CategoryAboutPage({ params }: Props) {
  const { locale, categorySlug } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const category = await getCategoryAboutBySlug(categorySlug);
  if (!category) notFound();

  const t = await getTranslations('about');

  const title = locale === 'ar' ? category.nameAr : category.nameEn;
  const shortDesc = locale === 'ar' ? category.descAr : category.descEn;
  const longDesc = locale === 'ar' ? category.longDescAr : category.longDescEn;
  const address = locale === 'ar' ? category.addressAr : category.addressEn;
  const highlights = locale === 'ar' ? category.highlightsAr : category.highlightsEn;
  const terms = locale === 'ar' ? category.termsAr : category.termsEn;

  const heroImage =
    category.coverUrl ||
    category.galleryUrls[0] ||
    'https://images.unsplash.com/photo-1506929562872-bb421503ef21?auto=format&fit=crop&w=1600&q=80';

  const BackArrow = locale === 'ar' ? ArrowRightIcon : ArrowLeftIcon;
  const ForwardArrow = locale === 'ar' ? ArrowLeftIcon : ArrowRightIcon;

  return (
    <PageTransition className="relative bg-background text-foreground">
      {/* ───────────────────────── Cinematic hero ───────────────────────── */}
      <section className="relative h-[78dvh] min-h-[520px] w-full overflow-hidden">
        <Image
          src={heroImage}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        {/* Sunset wash on top half */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(13,26,43,0.05) 0%, rgba(13,26,43,0.45) 45%, rgba(9,19,34,0.95) 100%)',
          }}
        />
        {/* Warm gold haze sweeping from one corner */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 mix-blend-soft-light"
          style={{
            background:
              'radial-gradient(80% 70% at 18% 22%, rgba(232,196,127,0.45) 0%, rgba(232,196,127,0) 60%)',
          }}
        />
        {/* Subtle vignette ring at edges */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            boxShadow: 'inset 0 0 220px rgba(0,0,0,0.55)',
          }}
        />

        {/* Top-bar back link */}
        <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-5 py-5 md:px-10">
          <Link
            href={`/booking/${category.slug}`}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em] text-cream/90 backdrop-blur-md transition hover:border-gold-400/50 hover:text-gold-200"
          >
            <BackArrow className="size-4" strokeWidth={2.5} />
            {t('backToList')}
          </Link>
        </div>

        {/* Title block */}
        <div className="absolute inset-x-0 bottom-0 z-10 px-6 pb-14 md:px-12 md:pb-20">
          <div className="mx-auto max-w-4xl">
            <div className="mb-5 flex items-center gap-3">
              <span className="h-px w-12 bg-gradient-to-r from-transparent via-gold-300 to-gold-300" />
              <span className="text-[10px] font-bold uppercase tracking-[0.5em] text-gold-200/90">
                {t('heroEyebrow')}
              </span>
            </div>
            <h1 className="font-display text-[40px] font-black leading-[1.02] tracking-tight text-white drop-shadow-[0_3px_18px_rgba(0,0,0,0.65)] md:text-[68px]">
              {title}
            </h1>
            {shortDesc ? (
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-cream/85 drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)] md:text-lg">
                {shortDesc}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {/* ─────────────── Story ─────────────── */}
      <section className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        {longDesc ? (
          <>
            <SectionHeading icon={<CrownIcon className="size-5" strokeWidth={2.25} />}>
              {t('storyHeading')}
            </SectionHeading>
            <div className="mt-6 space-y-5 text-[16px] leading-[1.85] text-foreground/85 md:text-[17px]">
              {longDesc.split(/\n{2,}/).map((para, i) => (
                <p key={i} className="text-balance">
                  {para}
                </p>
              ))}
            </div>
          </>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            {t('missingContent')}
          </p>
        )}
      </section>

      {/* ─────────────── Video ─────────────── */}
      {category.videoUrl ? (
        <section className="mx-auto max-w-5xl px-6 pb-16 md:pb-24">
          <SectionHeading icon={<SparklesIcon className="size-5" strokeWidth={2.25} />}>
            {t('videoHeading')}
          </SectionHeading>
          <div className="mt-6 overflow-hidden rounded-3xl border border-gold-400/20 bg-black shadow-[0_30px_60px_-20px_rgba(0,0,0,0.7)]">
            <div className="relative aspect-video w-full">
              <ExperienceVideo
                url={category.videoUrl}
                poster={category.coverUrl ?? undefined}
                title={title}
              />
            </div>
          </div>
        </section>
      ) : null}

      {/* ─────────────── Highlights ─────────────── */}
      {highlights.length > 0 ? (
        <section className="mx-auto max-w-4xl px-6 pb-16 md:pb-24">
          <SectionHeading icon={<SparklesIcon className="size-5" strokeWidth={2.25} />}>
            {t('highlightsHeading')}
          </SectionHeading>
          <ul className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
            {highlights.map((h, i) => (
              <li
                key={i}
                className="group relative flex items-start gap-4 overflow-hidden rounded-2xl border border-gold-400/20 bg-card p-5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-gold-400/40 hover:shadow-[0_18px_40px_-20px_rgba(194,161,78,0.35)]"
              >
                <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-gold-400/15 text-gold-700 ring-1 ring-gold-400/30 transition group-hover:bg-gold-400/25 group-hover:text-gold-600">
                  <CrownIcon className="size-4" strokeWidth={2.25} />
                </span>
                <span className="pt-1 text-[15px] font-medium leading-snug text-foreground">
                  {h}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ─────────────── Terms & Policy ─────────────── */}
      {terms.length > 0 ? (
        <section className="mx-auto max-w-4xl px-6 pb-16 md:pb-24">
          <SectionHeading icon={<ScrollTextIcon className="size-5" strokeWidth={2.25} />}>
            {t('termsHeading')}
          </SectionHeading>
          <ul className="mt-6 space-y-3">
            {terms.map((point, i) => (
              <li
                key={i}
                className="group relative flex items-start gap-4 overflow-hidden rounded-2xl border border-gold-400/20 bg-card p-5 backdrop-blur-sm transition-colors hover:border-gold-400/40"
              >
                <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-gold-400/15 font-display text-[12px] font-bold text-gold-700 ring-1 ring-gold-400/30">
                  {i + 1}
                </span>
                <p className="pt-0.5 text-[15px] leading-relaxed text-foreground/90">
                  {point}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ─────────────── Gallery ─────────────── */}
      {category.galleryUrls.length > 0 ? (
        <section className="mx-auto max-w-6xl px-6 pb-16 md:pb-24">
          <SectionHeading icon={<SparklesIcon className="size-5" strokeWidth={2.25} />}>
            {t('galleryHeading')}
          </SectionHeading>
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
            {category.galleryUrls.map((src, i) => {
              // First photo gets a wider tile on md+ for a magazine layout.
              const wide = i === 0;
              return (
                <div
                  key={i}
                  className={[
                    'group relative overflow-hidden rounded-2xl border border-gold-400/20 bg-muted',
                    wide ? 'md:col-span-2 md:row-span-2 aspect-[4/3] md:aspect-[16/10]' : 'aspect-[4/5]',
                  ].join(' ')}
                >
                  <Image
                    src={src}
                    alt=""
                    fill
                    sizes={wide ? '(max-width: 768px) 100vw, 66vw' : '(max-width: 768px) 50vw, 33vw'}
                    className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]"
                  />
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-gradient-to-t from-navy-950/40 via-transparent to-transparent opacity-90 transition-opacity group-hover:opacity-60"
                  />
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* ─────────────── Location ─────────────── */}
      {address || (category.latitude != null && category.longitude != null) ? (
        <section className="mx-auto max-w-4xl px-6 pb-28 md:pb-32">
          <SectionHeading icon={<MapPinIcon className="size-5" strokeWidth={2.25} />}>
            {t('locationHeading')}
          </SectionHeading>
          <div className="mt-6 rounded-2xl border border-gold-400/20 bg-card p-6 backdrop-blur-sm">
            {address ? (
              <p className="text-[16px] font-medium leading-relaxed text-foreground">
                {address}
              </p>
            ) : null}
            {category.latitude != null && category.longitude != null ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${category.latitude},${category.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.15em] text-accent transition hover:text-accent/80"
              >
                {`${category.latitude.toFixed(4)}, ${category.longitude.toFixed(4)}`}
                <ForwardArrow className="size-4" strokeWidth={2.5} />
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* ─────────────── Sticky bottom CTA ─────────────── */}
      <div className="pointer-events-none sticky bottom-0 z-30 px-4 pb-5 md:px-8 md:pb-8">
        <div className="mx-auto flex max-w-3xl justify-center">
          <Link
            href={`/booking/${category.slug}`}
            className="pointer-events-auto group/cta relative isolate inline-flex h-14 items-center gap-3 overflow-hidden rounded-full px-8 text-[13px] font-bold uppercase tracking-[0.22em] text-[#2a1a05] shadow-[0_18px_40px_-10px_rgba(212,165,87,0.65)] transition-transform duration-300 ease-out hover:-translate-y-0.5 active:translate-y-0"
            style={{
              background:
                'linear-gradient(135deg, #f7e4a8 0%, #e8c47f 25%, #d4a557 55%, #b88a3a 100%)',
              border: '1px solid rgba(120, 82, 26, 0.55)',
            }}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-full"
              style={{
                background:
                  'linear-gradient(180deg, rgba(255,250,230,0.55) 0%, rgba(255,250,230,0) 100%)',
              }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 opacity-0 transition-all duration-700 ease-out group-hover/cta:left-[120%] group-hover/cta:opacity-100"
              style={{
                background:
                  'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.6) 50%, transparent 100%)',
              }}
            />
            <CrownIcon className="relative size-4" strokeWidth={2.5} aria-hidden />
            <span className="relative">{t('bookCta')}</span>
            <ForwardArrow className="relative size-4" strokeWidth={2.75} aria-hidden />
          </Link>
        </div>
      </div>
    </PageTransition>
  );
}

function SectionHeading({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="inline-flex size-9 items-center justify-center rounded-full bg-gold-400/15 text-gold-700 ring-1 ring-gold-400/30">
        {icon}
      </span>
      <h2 className="font-display text-2xl font-bold tracking-tight text-gold-700 md:text-3xl">
        {children}
      </h2>
      <span className="h-px flex-1 bg-gradient-to-r from-gold-400/40 to-transparent" />
    </div>
  );
}

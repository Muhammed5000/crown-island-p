import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { PageTransition } from '@/components/layout/PageTransition';
import { formatMoney } from '@/lib/money';
import type { Locale } from '@/i18n/config';

interface Category {
  slug: string;
  nameEn: string;
  nameAr: string;
  descEn: string | null;
  descAr: string | null;
  coverUrl: string | null;
  highlightsEn?: unknown;
  highlightsAr?: unknown;
  services: { basePriceCents: number }[];
}

interface Props {
  locale: Locale;
  categories: Category[];
  /** Localized section title (e.g. "Beaches" / "Activities"). */
  title: string;
}

/** Coerce a stored JSON column into a short list of tag strings. */
function asTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0).slice(0, 3);
}

/** Sun-meets-crown glyph, matching the design's CrownMark (image fallback). */
function CrownMark({ size = 42 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d="M4 11 L9 21 L23 21 L28 11 L21.5 15 L16 7 L10.5 15 Z"
        stroke="#c2a14e"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M8.5 24 L23.5 24" stroke="#c2a14e" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="4" cy="11" r="1.6" fill="#c2a14e" />
      <circle cx="28" cy="11" r="1.6" fill="#c2a14e" />
      <circle cx="16" cy="7" r="1.6" fill="#c2a14e" />
    </svg>
  );
}

/**
 * Beaches / Activities catalog — implements the "Crown Beaches Desktop" design
 * handoff (claude.ai/design): a uniform 3-up grid of experience cards on a dark
 * #0a1220 canvas with a gold radial glow, Cormorant serif headings + Manrope
 * body. The app shell already supplies the left rail (DesktopRail) and the
 * breadcrumb (PageNav), so only the page's main column is rendered here.
 *
 * Both the Beaches and Activities tabs share this one component; only the
 * filtered `categories` and the `title` differ. Each card links into the
 * existing /booking/[slug] flow — data, routing and backend are unchanged.
 */
export async function CategoryListView({ locale, categories, title }: Props) {
  const tCommon = await getTranslations('common');
  const eyebrow = locale === 'ar' ? 'احجز يومك' : 'BOOK YOUR DAY';
  const subtitle =
    locale === 'ar'
      ? 'اختر تجربة لبدء حجزك.'
      : 'Choose an experience to begin your reservation.';
  const availLabel = locale === 'ar' ? 'تجربة متاحة' : 'experiences available';
  const continueLabel = tCommon('continue');

  return (
    <PageTransition>
      <div
        className="relative min-h-dvh w-full bg-background font-aurelia-sans text-foreground"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 60% 45% at 60% 0%, rgba(194,161,78,0.06), transparent 60%)',
        }}
      >
        <div className="mx-auto max-w-[1180px] px-6 pb-14 pt-5 sm:px-11">
          {/* header */}
          <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-7">
            <div>
              <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-gold-600">
                {eyebrow}
              </div>
              <h1 className="font-aurelia-display text-[40px] font-semibold leading-none tracking-tight text-foreground sm:text-[52px]">
                {title}
              </h1>
              <p className="mt-3 max-w-[520px] text-sm leading-relaxed text-muted-foreground">
                {subtitle}
              </p>
            </div>
            <div className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-border bg-muted px-4 py-2.5 text-[12.5px] font-medium text-muted-foreground sm:mb-1.5 sm:self-auto">
              <span className="font-bold text-gold-600">{categories.length}</span> {availLabel}
            </div>
          </div>

          {/* grid */}
          {categories.length === 0 ? (
            <div className="rounded-[20px] border border-border bg-card py-16 text-center text-sm text-muted-foreground">
              {locale === 'ar' ? 'لا توجد عناصر متاحة حالياً.' : 'Nothing available here yet.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-[22px] sm:grid-cols-2 xl:grid-cols-3">
              {categories.map((c) => {
                const name = locale === 'ar' ? c.nameAr : c.nameEn;
                const desc = locale === 'ar' ? c.descAr : c.descEn;
                const tags = asTags(locale === 'ar' ? c.highlightsAr : c.highlightsEn);
                const fromCents = c.services.length
                  ? Math.min(...c.services.map((s) => s.basePriceCents))
                  : null;

                return (
                  <Link
                    key={c.slug}
                    href={`/booking/${c.slug}`}
                    className="group block focus-visible:outline-none"
                  >
                    <div className="flex h-full flex-col overflow-hidden rounded-[20px] border border-border bg-card transition-all duration-200 group-hover:-translate-y-1 group-hover:border-gold-400/40 group-hover:shadow-lift">
                      {/* image */}
                      <div className="relative h-[200px] overflow-hidden bg-muted">
                        {c.coverUrl ? (
                          // next/image: lazy-loads off-screen cards, serves
                          // resized WebP/AVIF through the optimizer (works for
                          // relative uploads and remote https URLs alike).
                          <Image
                            src={c.coverUrl}
                            alt=""
                            fill
                            sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw"
                            className="object-cover transition-transform duration-500 group-hover:scale-105"
                          />
                        ) : (
                          <div
                            className="absolute inset-0 flex flex-col items-center justify-center gap-3"
                            style={{
                              background:
                                'radial-gradient(ellipse at 50% 35%, #eef1f3 0%, #e2e7ea 75%)',
                            }}
                          >
                            <div className="opacity-80">
                              <CrownMark size={42} />
                            </div>
                            <div className="text-[10.5px] font-semibold tracking-[0.22em] text-muted-foreground">
                              CROWN ISLAND
                            </div>
                          </div>
                        )}
                        <div
                          className="absolute inset-0"
                          style={{
                            background:
                              'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0) 35%, rgba(8,14,24,0.55) 100%)',
                          }}
                        />
                        {fromCents != null ? (
                          <div className="absolute right-3.5 top-3.5 rounded-full border border-gold-400/50 bg-gold-50/90 px-3 py-1.5 text-[11.5px] font-bold text-gold-700 backdrop-blur">
                            {locale === 'ar' ? 'من ' : 'from '}
                            {formatMoney(fromCents, { locale, currency: 'EGP' })}
                          </div>
                        ) : null}
                      </div>

                      {/* body */}
                      <div className="flex flex-1 flex-col px-[22px] pt-5">
                        <h3 className="font-aurelia-display text-[26px] font-semibold leading-none tracking-tight text-foreground transition-colors group-hover:text-gold-700">
                          {name}
                        </h3>
                        {desc ? (
                          <p className="mt-2.5 line-clamp-2 min-h-[39px] text-[13px] leading-[1.5] text-muted-foreground">
                            {desc}
                          </p>
                        ) : (
                          <div className="min-h-[39px]" />
                        )}
                        {tags.length ? (
                          <div className="mt-3.5 flex flex-wrap gap-1.5">
                            {tags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full border border-border bg-muted px-2.5 py-1 text-[10.5px] font-medium text-muted-foreground"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <div className="flex-1" />
                      </div>

                      {/* footer CTA */}
                      <div className="mt-[18px] flex items-center justify-between border-t border-border bg-muted/40 px-[22px] py-[15px] transition-colors group-hover:bg-gold-400/10">
                        <span className="text-[12.5px] font-bold uppercase tracking-[0.12em] text-gold-600">
                          {continueLabel}
                        </span>
                        <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-gold-400/15 text-lg text-gold-600 transition-all group-hover:translate-x-0.5 group-hover:bg-gold-400 group-hover:text-white">
                          →
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </PageTransition>
  );
}

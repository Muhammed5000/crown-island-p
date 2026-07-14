import { notFound } from 'next/navigation';
import Image from 'next/image';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Card, CardBody, CardFooter } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { CategoryLogo } from '@/components/brand/CategoryLogo';
import { PageTransition } from '@/components/layout/PageTransition';
import { BookingsDisabledState } from '@/components/booking/BookingsDisabledState';
import { AgeRestricted } from '@/components/booking/AgeRestricted';
import { SelectServiceWizard, type ServiceItem } from './SelectServiceWizard';
import { CategoryTermsGate } from '@/components/booking/CategoryTermsGate';
import { getCategoryBySlug } from '@/server/repositories/catalog';
import { getServiceRatingSummary } from '@/server/services/review';
import { evaluateCategoryAgeGate } from '@/server/catalog/age-gate';
import {
  categoryTermsBullets,
  needsCategoryTermsAcceptance,
} from '@/server/catalog/category-terms';
import { getSettings } from '@/server/settings/settings';
import { getSessionUser } from '@/server/auth/guards';
import { formatMoney } from '@/lib/money';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string; categorySlug: string }>;
}

/** Coerce a stored JSON column into a plain `string[]`, skipping non-strings. */
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

const FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1506929562872-bb421503ef21?auto=format&fit=crop&w=1200&q=80';

export default async function CategoryServicesPage({ params }: Props) {
  const { locale, categorySlug } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const settings = await getSettings();
  if (!settings.bookingsEnabled) {
    return <BookingsDisabledState />;
  }

  const category = await getCategoryBySlug(categorySlug);
  if (!category) notFound();

  // Age gate — a category with a `minAge` won't open for visitors who are too
  // young (or whose age can't be verified). Block before showing any services.
  const ageGate = await evaluateCategoryAgeGate(category.minAge);
  if (!ageGate.allowed) {
    return <AgeRestricted minAge={ageGate.minAge} signedIn={ageGate.signedIn} />;
  }

  const ar = locale === 'ar';
  const user = await getSessionUser();

  // Per-category Terms gate — a signed-in customer must accept this category's
  // terms before its services unlock. Guests browse freely (booking itself
  // still requires sign-in); categories without terms are never gated, and an
  // edit to the terms forces previous accepters to re-accept (termsUpdatedAt).
  const termsBullets = categoryTermsBullets(category.termsEn, category.termsAr, locale);
  const mustAcceptTerms = await needsCategoryTermsAcceptance({
    userId: user?.id,
    categoryId: category.id,
    hasTerms: termsBullets.length > 0,
    termsUpdatedAt: category.termsUpdatedAt,
  });
  if (mustAcceptTerms) {
    return (
      <PageTransition>
        <CategoryTermsGate
          categoryId={category.id}
          categoryName={ar ? category.nameAr : category.nameEn}
          terms={termsBullets}
          logoUrl={category.logoUrl}
          logoDarkUrl={category.logoDarkUrl}
        />
      </PageTransition>
    );
  }

  const t = await getTranslations('services');
  const tCommon = await getTranslations('common');

  // Category cover doubles as the fallback for any service that has no image
  // of its own, so every service card always shows a relevant picture.
  const categoryImage =
    category.coverUrl || asStringArray(category.galleryUrls)[0] || FALLBACK_IMAGE;

  /** A service's own cover, falling back to the category cover. */
  const serviceImage = (cover: string | null) => cover || categoryImage;

  // Public rating summaries (desktop wizard shows a "see reviews" link per
  // service; the summaries are cached under the `reviews` tag).
  const ratings = await Promise.all(
    category.services.map((s) => getServiceRatingSummary(s.id)),
  );

  const services: ServiceItem[] = category.services.map((s, i) => ({
    id: s.id,
    slug: s.slug,
    name: ar ? s.nameAr : s.nameEn,
    desc: (ar ? s.descAr : s.descEn) ?? null,
    priceCents: s.basePriceCents,
    kind: s.kind,
    image: serviceImage(s.coverUrl),
    tags: asStringArray(ar ? s.highlightsAr : s.highlightsEn).slice(0, 3),
    maxPeoplePerBooking: s.maxPeoplePerBooking,
    maxCarsPerBooking: s.maxCarsPerBooking,
    includedPersonsPerUnit: s.includedPersonsPerUnit,
    allowExtraPeople: s.allowExtraPeople,
    extraPersonPriceCents: s.extraPersonPriceCents,
    maxExtraPersonsPerUnit: s.maxExtraPersonsPerUnit,
    allowChildren: s.allowChildren,
    maxChildAge: s.maxChildAge,
    freeChildrenPerUnit: s.freeChildrenPerUnit,
    maxChildrenPerBooking: s.maxChildrenPerBooking,
    childrenCountAsPersons: s.childrenCountAsPersons,
    allowMultiDay: s.allowMultiDay,
    maxBookingDays: s.maxBookingDays,
    rating:
      ratings[i]!.enabled && ratings[i]!.count > 0
        ? { average: ratings[i]!.average, count: ratings[i]!.count }
        : null,
  }));

  return (
    <PageTransition>
      {/* ── Mobile / tablet (< xl): original list-of-services flow ── */}
      <div className="container mx-auto max-w-3xl px-4 py-6 xl:hidden">
        <header className="mb-8 space-y-2">
          {category.logoUrl ? (
            <CategoryLogo
              lightUrl={category.logoUrl}
              darkUrl={category.logoDarkUrl}
              className="mb-1 h-14 w-auto max-w-[150px] object-contain"
            />
          ) : null}
          <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-gold-600">
            {ar ? category.nameAr : category.nameEn}
          </p>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
              {t('selectService')}
            </h1>
            <div className="h-px flex-1 bg-gradient-to-r from-gold-400/40 to-transparent" />
          </div>
          {(ar ? category.descAr : category.descEn) ? (
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              {ar ? category.descAr : category.descEn}
            </p>
          ) : null}
        </header>

        <div className="space-y-4">
          {category.services.map((s) => (
            <Link
              key={s.id}
              href={`/booking/${category.slug}/${s.slug}`}
              className="group block focus-visible:outline-none"
            >
              <Card className="transition-all duration-300 group-hover:-translate-y-1 group-hover:border-accent/30 group-hover:shadow-[0_8px_30px_rgba(28,43,64,0.12)]">
                <CardBody className="flex items-start gap-4 p-6">
                  <Image
                    src={serviceImage(s.coverUrl)}
                    alt=""
                    width={68}
                    height={68}
                    className="size-[68px] shrink-0 rounded-2xl border border-border object-cover"
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <h2 className="font-display text-xl font-bold tracking-tight text-foreground transition-colors group-hover:text-accent">
                      {ar ? s.nameAr : s.nameEn}
                    </h2>
                    {(ar ? s.descAr : s.descEn) ? (
                      <p className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground group-hover:text-muted-foreground/80">
                        {ar ? s.descAr : s.descEn}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge tone="gold" className="px-3 py-1 text-[12px]">
                      {formatMoney(s.basePriceCents, { locale, currency: 'EGP' })}
                    </Badge>
                  </div>
                </CardBody>
                <CardFooter className="bg-muted/50 py-3 transition-colors group-hover:bg-muted">
                  <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-accent transition-all group-hover:gap-2 group-hover:text-accent/80">
                    {tCommon('continue')}
                    <span className="text-lg">→</span>
                  </span>
                </CardFooter>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Desktop (≥ xl): single-page wizard (select → date & guests → review & pay) ── */}
      <div className="hidden xl:block">
        <SelectServiceWizard
          locale={locale}
          category={{
            slug: category.slug,
            name: ar ? category.nameAr : category.nameEn,
            desc: (ar ? category.descAr : category.descEn) ?? null,
            image: categoryImage,
            logoUrl: category.logoUrl,
            logoDarkUrl: category.logoDarkUrl,
            isActivity: category.type === 'ACTIVITY',
          }}
          services={services}
          userId={user?.id ?? ''}
        />
      </div>
    </PageTransition>
  );
}

import { notFound } from 'next/navigation';
import Image from 'next/image';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { TopNav } from '@/components/layout/TopNav';
import { Stepper } from '@/components/layout/Stepper';
import { PageTransition } from '@/components/layout/PageTransition';
import { BookingsDisabledState } from '@/components/booking/BookingsDisabledState';
import { AgeRestricted } from '@/components/booking/AgeRestricted';
import { SelectionForm } from './SelectionForm';
import { PublicServiceReviews } from '@/components/booking/PublicServiceReviews';
import { ReviewsSummaryButton } from '@/components/booking/ReviewsSummaryButton';
import { CategoryTermsGate } from '@/components/booking/CategoryTermsGate';
import { getServiceBySlug } from '@/server/repositories/catalog';
import { evaluateCategoryAgeGate } from '@/server/catalog/age-gate';
import {
  categoryTermsBullets,
  needsCategoryTermsAcceptance,
} from '@/server/catalog/category-terms';
import { getSettings } from '@/server/settings/settings';
import { getSessionUser } from '@/server/auth/guards';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string; categorySlug: string; serviceSlug: string }>;
}

export default async function ServiceSelectionPage({ params }: Props) {
  const { locale, categorySlug, serviceSlug } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const settings = await getSettings();
  if (!settings.bookingsEnabled) {
    return <BookingsDisabledState />;
  }

  const service = await getServiceBySlug(categorySlug, serviceSlug);
  if (!service) notFound();

  // Age gate — enforce the category's minimum age here too, since a service URL
  // is reachable directly without passing through the category page.
  const ageGate = await evaluateCategoryAgeGate(service.category.minAge);
  if (!ageGate.allowed) {
    // Booking stays gated, but the (public) guest reviews are social proof — show
    // them beneath the age panel so public/guest visitors can still read them.
    return (
      <>
        <AgeRestricted minAge={ageGate.minAge} signedIn={ageGate.signedIn} />
        <div className="mx-auto max-w-md px-5 pb-10 md:max-w-xl">
          <PublicServiceReviews
            serviceId={service.id}
            reviewsHref={`/booking/${categorySlug}/${serviceSlug}/reviews`}
          />
        </div>
      </>
    );
  }

  const user = await getSessionUser();

  // Per-category Terms gate — also enforced here because a service URL is
  // reachable directly without passing through the category page. A signed-in
  // customer must accept the category's terms before this service unlocks.
  const termsBullets = categoryTermsBullets(
    service.category.termsEn,
    service.category.termsAr,
    locale,
  );
  const mustAcceptTerms = await needsCategoryTermsAcceptance({
    userId: user?.id,
    categoryId: service.category.id,
    hasTerms: termsBullets.length > 0,
    termsUpdatedAt: service.category.termsUpdatedAt,
  });
  if (mustAcceptTerms) {
    return (
      <PageTransition>
        <CategoryTermsGate
          categoryId={service.category.id}
          categoryName={locale === 'ar' ? service.category.nameAr : service.category.nameEn}
          terms={termsBullets}
          logoUrl={service.category.logoUrl}
          logoDarkUrl={service.category.logoDarkUrl}
        />
      </PageTransition>
    );
  }

  const t = await getTranslations('booking');

  return (
    <PageTransition>
      <TopNav title={t('stepDate')} locale={locale} />
      <Stepper current={1} />
      <div className="mx-auto max-w-md px-5 pb-10 md:max-w-xl">
        {/* Service cover — mirrors the category hero so each service has its
            own image. Falls back to the category cover when unset. */}
        {service.coverUrl || service.category.coverUrl ? (
          <div className="relative mb-5 h-44 w-full overflow-hidden rounded-2xl border border-white/[0.06]">
            <Image
              src={(service.coverUrl || service.category.coverUrl)!}
              alt=""
              fill
              priority
              sizes="(max-width: 768px) 100vw, 640px"
              className="object-cover"
            />
          </div>
        ) : null}
        {/* Prominent jump-to-reviews bar near the top (hidden when there are no
            approved reviews or the master toggle is off). */}
        <ReviewsSummaryButton
          serviceId={service.id}
          reviewsHref={`/booking/${categorySlug}/${serviceSlug}/reviews`}
          locale={locale}
        />
        <SelectionForm
          locale={locale}
          service={{
            id: service.id,
            nameEn: service.nameEn,
            nameAr: service.nameAr,
            descEn: service.descEn,
            descAr: service.descAr,
            basePriceCents: service.basePriceCents,
            kind: service.kind,
            maxPeoplePerBooking: service.maxPeoplePerBooking,
            maxCarsPerBooking: service.maxCarsPerBooking,
            includedPersonsPerUnit: service.includedPersonsPerUnit,
            allowExtraPeople: service.allowExtraPeople,
            extraPersonPriceCents: service.extraPersonPriceCents,
            maxExtraPersonsPerUnit: service.maxExtraPersonsPerUnit,
            allowChildren: service.allowChildren,
            maxChildAge: service.maxChildAge,
            freeChildrenPerUnit: service.freeChildrenPerUnit,
            maxChildrenPerBooking: service.maxChildrenPerBooking,
            childrenCountAsPersons: service.childrenCountAsPersons,
            allowMultiDay: service.allowMultiDay,
            maxBookingDays: service.maxBookingDays,
          }}
          category={{
            slug: service.category.slug,
            nameEn: service.category.nameEn,
            nameAr: service.category.nameAr,
          }}
          isAuthenticated={!!user}
        />

        {/* Public guest reviews for this service (hidden when the master toggle
            is off or there are none yet). Links to the full paginated list. */}
        <PublicServiceReviews
          serviceId={service.id}
          reviewsHref={`/booking/${categorySlug}/${serviceSlug}/reviews`}
        />
      </div>
    </PageTransition>
  );
}

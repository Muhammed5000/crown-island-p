import { setRequestLocale } from 'next-intl/server';
import { BookingsDisabledState } from '@/components/booking/BookingsDisabledState';
import { BookingExperience } from '@/components/booking/BookingExperience';
import type { CategoryWithExtras } from '@/components/booking/aurelia/derive';
import { listActiveCategoriesWithServices } from '@/server/repositories/catalog';
import { getSettings } from '@/server/settings/settings';
import { isLocale } from '@/i18n/config';

/**
 * Booking landing (AURELIA design). Shows ALL active categories (beaches +
 * activities). The "Beaches" and "Activities" tabs link to the filtered pages
 * at /booking/beaches and /booking/activities. Rendering lives in the shared
 * <BookingExperience/> so all three routes stay byte-identical in design.
 */
export default async function BookingCategoriesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const settings = await getSettings();
  if (!settings.bookingsEnabled) {
    return <BookingsDisabledState />;
  }

  const categories = await listActiveCategoriesWithServices();

  return (
    <BookingExperience locale={locale} categories={categories as CategoryWithExtras[]} />
  );
}

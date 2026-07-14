import { setRequestLocale, getTranslations } from 'next-intl/server';
import { BookingsDisabledState } from '@/components/booking/BookingsDisabledState';
import { CategoryListView } from '@/components/booking/CategoryListView';
import { listActiveCategoryCards } from '@/server/repositories/catalog';
import { getSettings } from '@/server/settings/settings';
import { isLocale } from '@/i18n/config';

/** Activities tab — a simple grid of only the ACTIVITY categories. */
export default async function BookingActivitiesPage({
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

  // Cards only need catalog copy + the "from" price — the cached cards query
  // skips the live capacity merge entirely.
  const [categories, tNav] = await Promise.all([
    listActiveCategoryCards('ACTIVITY'),
    getTranslations('nav'),
  ]);

  return <CategoryListView locale={locale} categories={categories} title={tNav('activities')} />;
}

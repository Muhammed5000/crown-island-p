import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ExternalLinkIcon } from 'lucide-react';
import { PageTransition } from '@/components/layout/PageTransition';
import { Card, CardBody } from '@/components/ui/Card';
import { MapClient } from './MapClient';
import { requireUser } from '@/server/auth/guards';
import { getBookingDetail } from '@/server/services/bookings-read';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string; bookingId: string }>;
}

export default async function BookingMapPage({ params }: Props) {
  const { locale, bookingId } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const user = await requireUser();
  const booking = await getBookingDetail(bookingId, user.id);
  if (!booking) notFound();

  const category = booking.service.category;
  const lat = category.latitude;
  const lng = category.longitude;

  const t = await getTranslations('map');

  const label =
    locale === 'ar'
      ? `${category.nameAr}${category.addressAr ? ' · ' + category.addressAr : ''}`
      : `${category.nameEn}${category.addressEn ? ' · ' + category.addressEn : ''}`;

  return (
    <PageTransition className="container mx-auto max-w-2xl px-4 py-6">
      <header className="mb-4">
        <h1 className="font-display text-2xl font-semibold text-foreground">
          {t('yourBookingLocation')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{label}</p>
      </header>

      {lat != null && lng != null ? (
        <>
          <MapClient lat={lat} lng={lng} label={label} />

          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 font-medium text-primary-foreground"
          >
            <ExternalLinkIcon className="size-4" />
            <span>{t('openDirections')}</span>
          </a>
        </>
      ) : (
        <Card variant="glass">
          <CardBody className="p-8 text-center text-sm text-muted-foreground">
            {t('title')} — {category.nameEn}
          </CardBody>
        </Card>
      )}
    </PageTransition>
  );
}

import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { PageTransition } from '@/components/layout/PageTransition';
import { SuccessTicket } from './SuccessTicket';
import { ConfirmationDesktop } from './ConfirmationDesktop';
import { IframeBreakout } from '@/components/booking/IframeBreakout';
import { Card, CardBody } from '@/components/ui/Card';
import { requireUser } from '@/server/auth/guards';
import { getBookingForUser } from '@/server/services/booking';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/date';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ bid?: string; success?: string }>;
}

export default async function SuccessPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const { bid, success } = await searchParams;
  if (!bid) redirect('/booking');

  const user = await requireUser();
  const booking = await getBookingForUser(bid, user.id);
  if (!booking) redirect('/booking');

  // CANCELLED is terminal — including a capture that was AUTO-REFUNDED because
  // the booking could never confirm (capacity race / amount mismatch). Without
  // this redirect the page rendered an eternal "Processing payment…" ticket for
  // money that was already returned; the failed page shows the refund notice.
  if (success === 'false' || booking.status === 'FAILED' || booking.status === 'CANCELLED') {
    redirect(`/booking/failed?bid=${bid}`);
  }

  const t = await getTranslations('booking');

  const extendedBookingData = {
    bookingDate: booking.bookingDate,
    people: booking.people,
    cars: booking.cars,
    userName: booking.user.name || 'Guest',
    serviceName: locale === 'ar' ? booking.service.nameAr : booking.service.nameEn,
    categoryName: locale === 'ar' ? booking.service.category.nameAr : booking.service.category.nameEn,
    categorySlug: booking.service.category.slug,
    totalCents: booking.invoice?.totalCents || 0,
    status: booking.status,
    coverUrl: booking.service.coverUrl,
    // The ticket is a dark card, so prefer the dark-mode logo; fall back to light.
    logoUrl: booking.service.category.logoDarkUrl ?? booking.service.category.logoUrl ?? null,
  };

  const totalLabel = booking.invoice
    ? formatMoney(booking.invoice.totalCents, { locale, currency: 'EGP' })
    : '—';

  // One-line breakdown under the total: the paid amount includes a refundable
  // insurance deposit (VOIDED = never collected, so nothing to point out).
  const depositNote =
    booking.insurance && booking.insurance.collectionStatus !== 'VOIDED'
      ? t('insuranceIncludedInTotal', {
          amount: formatMoney(booking.insurance.amountCents, { locale, currency: 'EGP' }),
        })
      : null;

  return (
    <PageTransition>
      <IframeBreakout />

      {/* Mobile + tablet (< xl) — unchanged centered column. */}
      <div className="container mx-auto max-w-xl px-4 py-6 xl:hidden">
        <SuccessTicket
          bookingId={booking.id}
          reference={booking.reference}
          initialConfirmed={booking.status === 'CONFIRMED'}
          bookingData={extendedBookingData}
          locale={locale}
        />

        <Card className="mt-4">
          <CardBody className="grid grid-cols-2 gap-3 text-sm">
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">{t('stepDate')}</p>
              <p className="text-foreground">{formatDate(booking.bookingDate, locale)}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">{t('total')}</p>
              <p className="tabular-nums text-foreground">{totalLabel}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">{t('stepPeople')}</p>
              <p className="text-foreground">{booking.people}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">{t('stepCars')}</p>
              <p className="text-foreground">{booking.cars}</p>
            </div>
            {depositNote ? (
              <p className="col-span-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                {depositNote}
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>

      {/* Desktop (≥ xl) — wide-canvas Crown Confirmation redesign (boarding pass). */}
      <div className="hidden xl:block">
        <ConfirmationDesktop
          bookingId={booking.id}
          reference={booking.reference}
          initialConfirmed={booking.status === 'CONFIRMED'}
          locale={locale}
          bookingData={extendedBookingData}
          tier={extendedBookingData.categoryName}
          experience={extendedBookingData.serviceName}
          dateLabel={formatDate(booking.bookingDate, locale, {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
          weekday={formatDate(booking.bookingDate, locale, { weekday: 'long' })}
          openTime={booking.service.openTime ?? null}
          totalLabel={totalLabel}
          depositNote={depositNote}
        />
      </div>
    </PageTransition>
  );
}

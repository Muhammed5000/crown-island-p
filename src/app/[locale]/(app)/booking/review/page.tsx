import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Card, CardBody } from '@/components/ui/Card';
import { TopNav } from '@/components/layout/TopNav';
import { Stepper } from '@/components/layout/Stepper';
import { PageTransition } from '@/components/layout/PageTransition';
import { BookingsDisabledState } from '@/components/booking/BookingsDisabledState';
import { ConfirmButton } from './ConfirmButton';
import { calcBooking } from '@/server/services/booking-calc';
import { expandDateRange } from '@/server/services/booking';
import { getPayableSanctionsForUser } from '@/server/services/sanctions';
import { DomainError } from '@/server/services/errors';
import { prisma } from '@/server/db/prisma';
import { requireUser } from '@/server/auth/guards';
import { getSettings } from '@/server/settings/settings';
import { formatMoney } from '@/lib/money';
import { formatDate, formatDateRange } from '@/lib/date';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    service?: string;
    cat?: string;
    date?: string;
    endDate?: string;
    people?: string;
    adults?: string;
    children?: string;
    extraPersons?: string;
    cars?: string;
    total?: string;
  }>;
}

/**
 * Booking summary — Screen 06 from the design.
 * Step 2 of the booking flow stepper.
 */
export default async function ReviewPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const sp = await searchParams;
  if (!sp.service || !sp.date || !(sp.adults || sp.people)) {
    redirect('/booking');
  }

  // Last gate before commit. Without this a stale tab opened before the
  // admin flipped the switch could still POST `commitBooking` — that's
  // also defended at the service layer, but checking here gives the user
  // a friendlier message instead of a generic error after clicking Pay.
  const settings = await getSettings();
  if (!settings.bookingsEnabled) {
    return <BookingsDisabledState />;
  }

  const user = await requireUser();
  const t = await getTranslations('booking');
  const tServices = await getTranslations('services');

  const service = await prisma.service.findUnique({
    where: { id: sp.service! },
    include: { category: true },
  });
  if (!service) redirect('/booking');

  // Untrusted query params — coerce to a safe non-negative integer so a tampered
  // non-numeric value can't propagate NaN into pricing. Authoritative validation
  // (including the children cap) still runs server-side in calcBooking below and
  // again in commitBooking on submit.
  const toInt = (v: string | undefined, min: number) => {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) ? Math.max(min, n) : min;
  };
  const adults = toInt(sp.adults ?? sp.people, 1);
  const children = toInt(sp.children, 0);
  const extraPersons = toInt(sp.extraPersons, 0);
  const cars = toInt(sp.cars, 0);
  const dates = expandDateRange(sp.date!, sp.endDate);

  let priceQuote;
  try {
    priceQuote = await calcBooking({
      serviceId: service.id,
      adults,
      children,
      extraPersons,
      cars,
      dates,
      checkAvailability: true,
    });
  } catch (err) {
    if (err instanceof DomainError) {
      redirect(`/booking/${service.category.slug}/${service.slug}?error=${err.code}`);
    }
    throw err;
  }

  // Unpaid penalties + the insurance deposit ride on this booking: shown here,
  // priced authoritatively again inside `createBooking` (the commit fails with
  // price_changed if they shift between this render and the click). The deposit
  // is a separate, never-discountable balance (docs/INSURANCE.md).
  const penalties = await getPayableSanctionsForUser(user.id);
  const grandTotalCents =
    priceQuote.totalCents + penalties.totalCents + priceQuote.insuranceCents;

  const expName = locale === 'ar' ? service.category.nameAr : service.category.nameEn;
  const svcName = locale === 'ar' ? service.nameAr : service.nameEn;

  return (
    <PageTransition>
      <TopNav title={t('reviewTitle')} locale={locale} />
      <Stepper current={2} />

      <div className="mx-auto max-w-md px-5 pb-10 md:max-w-xl">
        <Card>
          <CardBody className="space-y-0 py-1">
            <SummaryRow label={t('reviewTitle')} value={`${expName} - ${svcName}`} />
            <SummaryRow
              label={t('stepDate')}
              dirLtr={priceQuote.dates.length > 1}
              value={
                priceQuote.dates.length > 1
                  ? formatDateRange(priceQuote.dates[0]!, priceQuote.dates[priceQuote.dates.length - 1]!, locale)
                  : formatDate(priceQuote.dates[0]!, locale)
              }
            />
            <SummaryRow
              label={service.includedPersonsPerUnit > 1 ? t('stepAdults') : t('stepPeople')}
              value={`${adults}`}
            />
            {children > 0 && (
              <SummaryRow label={t('stepChildren')} value={`${children}`} />
            )}
            {priceQuote.extraPersons > 0 && (
              <SummaryRow label={t('stepExtraPersons')} value={`${priceQuote.extraPersons}`} />
            )}
            {service.kind === 'DAY_USE' ? (
              // Beach: one umbrella per `includedPersonsPerUnit` counted people.
              <SummaryRow
                label={t('umbrellasLabel', { capacity: priceQuote.includedPersonsPerUnit })}
                value={`${priceQuote.unitsPerDay}`}
              />
            ) : priceQuote.unitsPerDay > 1 ? (
              <SummaryRow label={t('explainUnits', { units: priceQuote.unitsPerDay })} value={`×${priceQuote.unitsPerDay}`} />
            ) : null}
            <SummaryRow label={t('stepCars')} value={`${cars}`} />
            <div className="my-1.5 h-px bg-border" />
            {penalties.totalCents > 0 || priceQuote.insuranceCents > 0 ? (
              <SummaryRow
                label={t('bookingValue')}
                value={formatMoney(priceQuote.totalCents, { locale, currency: 'EGP' })}
              />
            ) : null}
            {priceQuote.insuranceCents > 0 ? (
              <SummaryRow
                label={t('insuranceDeposit')}
                value={`+ ${formatMoney(priceQuote.insuranceCents, { locale, currency: 'EGP' })}`}
              />
            ) : null}
            {penalties.totalCents > 0 ? (
              <SummaryRow
                label={t('penalties')}
                value={`+ ${formatMoney(penalties.totalCents, { locale, currency: 'EGP' })}`}
              />
            ) : null}
            <SummaryRow
              label={t('total')}
              value={formatMoney(grandTotalCents, { locale, currency: 'EGP' })}
              bold
            />
          </CardBody>
        </Card>

        {priceQuote.insuranceCents > 0 ? (
          <Card className="mt-4">
            <CardBody className="space-y-2 py-4">
              <p className="text-[13px] font-bold text-foreground">{t('insuranceDeposit')}</p>
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                {t('insuranceHint')}
              </p>
            </CardBody>
          </Card>
        ) : null}

        {penalties.totalCents > 0 ? (
          <Card className="mt-4">
            <CardBody className="space-y-2 py-4">
              <p className="text-[13px] font-bold text-warning">{t('penaltiesTitle')}</p>
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                {t('penaltiesHint')}
              </p>
              <div className="divide-y divide-border">
                {penalties.sanctions.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="text-muted-foreground">{s.reason}</span>
                    <span className="shrink-0 tabular-nums text-foreground">
                      {formatMoney(s.amountCents, { locale, currency: 'EGP' })}
                    </span>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        ) : null}

        {priceQuote.lines.length > 0 ? (
          <Card className="mt-4">
            <CardBody className="divide-y divide-border py-1">
              {priceQuote.lines.map((line, idx) => (
                <div key={idx} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-muted-foreground">
                    {line.labelKey.startsWith('services.')
                      ? tServices(line.labelKey.replace('services.', '') as Parameters<typeof tServices>[0])
                      : line.labelKey.startsWith('booking.')
                        ? t(line.labelKey.replace('booking.', '') as Parameters<typeof t>[0])
                        : t(line.labelKey as Parameters<typeof t>[0])}{' '}
                    × {line.quantity}
                  </span>
                  <span className="tabular-nums text-foreground">
                    {formatMoney(line.totalCents, { locale, currency: 'EGP' })}
                  </span>
                </div>
              ))}
            </CardBody>
          </Card>
        ) : null}

        <div className="mt-6">
          <ConfirmButton
            serviceId={service.id}
            date={priceQuote.dates[0]!}
            endDate={priceQuote.dates.length > 1 ? priceQuote.dates[priceQuote.dates.length - 1]! : undefined}
            adults={adults}
            childCount={children}
            extraPersons={priceQuote.extraPersons}
            cars={cars}
            totalCents={grandTotalCents}
            locale={locale}
            userId={user.id}
          />
        </div>
      </div>
    </PageTransition>
  );
}

function SummaryRow({ label, value, bold, dirLtr }: { label: string; value: string; bold?: boolean; dirLtr?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span
        className={
          bold
            ? 'text-[13px] font-bold text-foreground'
            : 'text-[13px] font-medium text-muted-foreground'
        }
      >
        {label}
      </span>
      <span
        {...(dirLtr ? { dir: 'ltr' as const } : {})}
        className={
          bold
            ? 'text-[13px] font-bold text-gold-700 tabular-nums'
            : 'text-[13px] font-semibold text-foreground'
        }
      >
        {value}
      </span>
    </div>
  );
}


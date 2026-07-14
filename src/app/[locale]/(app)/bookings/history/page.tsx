import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { PageTransition } from '@/components/layout/PageTransition';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { BookingRowCard } from '@/components/booking/BookingRowCard';
import {
  BookingHistoryDesktop,
  type DesktopBooking,
  type HistoryStatus,
} from '@/components/booking/BookingHistoryDesktop';
import { Card, CardBody } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { requireUser } from '@/server/auth/guards';
import { listUserBookings, type HistoryFilter } from '@/server/services/bookings-read';
import { customerInsuranceState } from '@/server/services/insurance-core';
import { isLocale } from '@/i18n/config';
import { formatDate } from '@/lib/date';
import { formatMoney } from '@/lib/money';
import { ErrorIllustration } from '@/components/ui/ErrorIllustration';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ f?: string }>;
}

function asFilter(value: string | undefined): HistoryFilter {
  return value === 'upcoming' || value === 'past' ? value : 'all';
}

export default async function HistoryPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const sp = await searchParams;
  const filter = asFilter(sp.f);

  const user = await requireUser();
  const bookings = await listUserBookings(user.id, filter);
  // Desktop (≥ xl) renders the full set so its tabs/search can show live
  // counts; reuse the mobile query when it's already the unfiltered list.
  const allBookings = filter === 'all' ? bookings : await listUserBookings(user.id, 'all');

  const t = await getTranslations('history');
  const tBooking = await getTranslations('booking');
  const tCommon = await getTranslations('common');

  // Tiny deposit chip on mobile rows — only the states a customer is waiting
  // on (refund in progress) or should see resolved (refunded). Conservative
  // mapping via customerInsuranceState: pending payouts never show as done.
  const depositChipOf = (b: (typeof bookings)[number]) => {
    if (!b.insurance) return null;
    const state = customerInsuranceState({
      bookingStatus: b.status,
      collectionStatus: b.insurance.collectionStatus,
      decision: b.insurance.decision,
      refunds: b.insurance.refunds,
    });
    if (state?.kind === 'refund_pending') {
      return { label: tBooking('insuranceRefundPending'), tone: 'warning' as const };
    }
    if (state?.kind === 'refunded') {
      return { label: tBooking('insuranceRefunded'), tone: 'success' as const };
    }
    return null;
  };

  const tabs: Array<{ value: HistoryFilter; label: string }> = [
    { value: 'all', label: t('filterAll') },
    { value: 'upcoming', label: t('filterUpcoming') },
    { value: 'past', label: t('filterPast') },
  ];

  // ── Desktop view model — derived from the same rows as the mobile list. ──
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  const whenOf = (status: HistoryStatus, date: Date): 'upcoming' | 'past' =>
    (status === 'PENDING_PAYMENT' || status === 'CONFIRMED') && date >= todayUtc
      ? 'upcoming'
      : 'past';

  const deskBookings: DesktopBooking[] = allBookings.map((b) => ({
    id: b.id,
    reference: b.reference,
    status: b.status as HistoryStatus,
    tier: locale === 'ar' ? b.service.category.nameAr : b.service.category.nameEn,
    title: locale === 'ar' ? b.service.nameAr : b.service.nameEn,
    date: formatDate(b.bookingDate, locale, { month: 'long', day: 'numeric', year: 'numeric' }),
    total: b.invoice ? formatMoney(b.invoice.totalCents, { locale, currency: 'EGP' }) : null,
    people: b.people,
    cars: b.cars,
    when: whenOf(b.status as HistoryStatus, b.bookingDate),
  }));

  const nextUpcoming = allBookings
    .filter((b) => whenOf(b.status as HistoryStatus, b.bookingDate) === 'upcoming')
    .sort((a, b) => a.bookingDate.getTime() - b.bookingDate.getTime())[0];
  const statUpcomingSub = nextUpcoming
    ? t('statUpcomingNext', {
        date: formatDate(nextUpcoming.bookingDate, locale, { month: 'long', day: 'numeric', year: 'numeric' }),
      })
    : t('statUpcomingNone');

  const deskCopy = {
    title: t('title'),
    subtitle: t('subtitle'),
    newBooking: t('newBooking'),
    statTotalLabel: t('statTotalLabel'),
    statTotalSub: t('statTotalSub'),
    statUpcomingLabel: t('filterUpcoming'),
    statUpcomingSub,
    statConfirmedLabel: t('status.CONFIRMED'),
    statConfirmedSub: t('statConfirmedSub'),
    tabAll: t('filterAll'),
    tabUpcoming: t('filterUpcoming'),
    tabPast: t('filterPast'),
    searchPlaceholder: t('searchPlaceholder'),
    sortNewest: t('sortNewest'),
    metaDate: tBooking('stepDate'),
    metaGuests: t('guests'),
    totalLabel: tBooking('total'),
    referenceLabel: tBooking('reference'),
    viewDetails: t('viewDetails'),
    rebook: t('rebook'),
    noMatch: t('noMatch'),
    emptyTitle: t('empty'),
    payNow: tBooking('payNow'),
    carWord: tCommon('car'),
    carsWord: tCommon('cars'),
    statusLabels: {
      PENDING_PAYMENT: t('status.PENDING_PAYMENT'),
      CONFIRMED: t('status.CONFIRMED'),
      EXPIRED: t('status.EXPIRED'),
      CANCELLED: t('status.CANCELLED'),
      FAILED: t('status.FAILED'),
    },
  };

  return (
    <PageTransition>
      {/* Mobile + tablet (< xl) — unchanged centered column. */}
      <div className="container mx-auto max-w-2xl px-4 py-6 xl:hidden">
      <header className="mb-6 space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">{t('title')}</h1>
          <div className="h-px flex-1 bg-gradient-to-r from-gold-400/40 to-transparent" />
          <NotificationBell />
        </div>

        <div className="flex gap-2.5 overflow-x-auto no-scrollbar py-1">
          {tabs.map((tab) => {
            const isActive = filter === tab.value;
            const href = tab.value === 'all' ? '/bookings/history' : `/bookings/history?f=${tab.value}`;
            return (
              <Link
                key={tab.value}
                href={href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'inline-flex h-10 items-center justify-center rounded-full border px-5 text-[13px] font-bold tracking-tight transition-all duration-300',
                  isActive
                    ? 'border-gold-400/40 bg-gold-400/15 text-gold-700 shadow-[0_0_15px_rgba(194,161,78,0.12)] ring-1 ring-gold-400/30'
                    : 'border-border bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </header>

      {bookings.length === 0 ? (
        <Card variant="glass">
          <CardBody className="flex flex-col items-center gap-4 p-12 text-center">
            <ErrorIllustration type="empty" className="opacity-60" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{t('empty')}</p>
              <Link
                href="/booking"
                className="text-xs text-gold-700 underline underline-offset-4 hover:text-gold-600"
              >
                {tBooking('payNow')}
              </Link>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => (
            <BookingRowCard
              key={b.id}
              locale={locale}
              booking={b}
              dateLabel={tBooking('stepDate')}
              totalLabel={tBooking('total')}
              referenceLabel={tBooking('reference')}
              depositChip={depositChipOf(b)}
            />
          ))}
        </div>
      )}
      </div>

      {/* Desktop (≥ xl) — wide-canvas Crown Booking History redesign. Hidden
          below xl so the mobile/tablet view above stays byte-identical. */}
      <div className="hidden xl:block">
        <BookingHistoryDesktop bookings={deskBookings} copy={deskCopy} />
      </div>
    </PageTransition>
  );
}

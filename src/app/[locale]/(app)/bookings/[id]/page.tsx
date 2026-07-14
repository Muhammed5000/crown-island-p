import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { CreditCardIcon, MapPinIcon } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card';
import { BookingStatusBadge } from '@/components/booking/BookingStatusBadge';
import { PageTransition } from '@/components/layout/PageTransition';
import { SuccessTicket } from '@/app/[locale]/(app)/booking/success/SuccessTicket';
import { CancelButton } from './CancelButton';
import { BookingDetailDesktop } from './BookingDetailDesktop';
import { CancellationRequestCard } from '@/components/booking/CancellationRequestCard';
import { InsuranceDepositCard } from '@/components/booking/InsuranceDepositCard';
import type { BadgeTone } from '@/components/ui/Badge';
import { requireUser } from '@/server/auth/guards';
import { getBookingDetail } from '@/server/services/bookings-read';
import { customerInsuranceState } from '@/server/services/insurance-core';
import { getMyReview } from '@/server/services/review';
import { getMyCancellationRequest } from '@/server/services/cancellation-request';
import { isBookingReviewable } from '@/server/services/review-core';
import { ReviewSection } from '@/components/booking/ReviewSection';
import { getRefundTiers } from '@/server/settings/settings';
import { computeTieredRefund, formatRefundTiers } from '@/lib/refund-policy';
import { formatMoney } from '@/lib/money';
import { formatDate, formatDateRange } from '@/lib/date';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

export default async function BookingDetailPage({ params }: Props) {
  const { locale, id } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const user = await requireUser();
  const booking = await getBookingDetail(id, user.id);
  if (!booking) notFound();

  const t = await getTranslations('booking');
  const tHistory = await getTranslations('history');
  const tMap = await getTranslations('map');

  // Guest review: the customer's own review (if any) + whether the booking is
  // reviewable (available from confirmation onward). The session user owns this
  // booking (getBookingDetail scopes by userId), so `user.role` is the reviewer's.
  const myReview = await getMyReview(booking.id, user.id);
  const canReview =
    !myReview &&
    isBookingReviewable({ status: booking.status, userRole: user.role, hasReview: false });

  const category =
    locale === 'ar' ? booking.service.category.nameAr : booking.service.category.nameEn;
  const service = locale === 'ar' ? booking.service.nameAr : booking.service.nameEn;

  // Self-service cancel is allowed ONLY while the booking is unpaid
  // (PENDING_PAYMENT). A CONFIRMED (paid) booking is cancelled by reception,
  // which applies the tiered refund — the customer sees the policy instead of a
  // button (matches the server-side cancelBooking guard).
  const cancellable = booking.status === 'PENDING_PAYMENT';
  // Paid booking → the cancellation-request control (schedule + frozen-refund
  // promise + request/withdraw). The refund tier is locked server-side at the
  // moment the customer submits; here we only PREVIEW the current tier. Replaces
  // the old passive "contact reception" notice.
  const showRefundPolicy = booking.status === 'CONFIRMED';
  let refundNotice: React.ReactNode = null;
  if (showRefundPolicy) {
    const tiers = await getRefundTiers();
    const totalCents = booking.invoice?.totalCents ?? 0;
    const preview = computeTieredRefund({ bookingDate: booking.bookingDate, totalCents, tiers });
    const myCancellation = await getMyCancellationRequest(booking.id, user.id);
    const money = (c: number) => formatMoney(c, { locale, currency: 'EGP' });
    refundNotice = (
      <CancellationRequestCard
        bookingId={booking.id}
        scheduleLines={formatRefundTiers(tiers, locale)}
        previewPercent={preview.percent}
        previewRefundLabel={money(preview.refundCents)}
        request={
          myCancellation
            ? {
                status: myCancellation.status,
                requestedAtLabel: formatDate(myCancellation.requestedAt, locale, {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                }),
                lockedPercent: myCancellation.lockedRefundPercent,
                lockedRefundLabel: money(myCancellation.lockedRefundCents),
                adminNote: myCancellation.adminNote,
              }
            : null
        }
      />
    );
  }

  const totalLabel = booking.invoice
    ? formatMoney(booking.invoice.totalCents, { locale, currency: 'EGP' })
    : '—';

  // ── Insurance deposit visibility (docs/INSURANCE.md §10 — read-only). The
  // pure mapper is deliberately conservative: a refund is only ever presented
  // as done when a COMPLETED payout row exists.
  const insState = booking.insurance
    ? customerInsuranceState({
        bookingStatus: booking.status,
        collectionStatus: booking.insurance.collectionStatus,
        decision: booking.insurance.decision,
        refunds: booking.insurance.refunds,
      })
    : null;
  let insuranceCard: React.ReactNode = null;
  if (booking.insurance && insState) {
    const chip: Record<typeof insState.kind, { label: string; tone: BadgeTone }> = {
      awaiting_capture: { label: t('insuranceAwaitingPayment'), tone: 'warning' },
      collected: { label: t('insuranceCollected'), tone: 'info' },
      refund_pending: { label: t('insuranceRefundPending'), tone: 'warning' },
      refunded: { label: t('insuranceRefunded'), tone: 'success' },
      retained: { label: t('insuranceRetained'), tone: 'muted' },
    };
    const refunded = insState.kind === 'refunded' ? insState : null;
    insuranceCard = (
      <InsuranceDepositCard
        title={t('insuranceDeposit')}
        amountLabel={formatMoney(booking.insurance.amountCents, { locale, currency: 'EGP' })}
        statusLabel={chip[insState.kind].label}
        statusTone={chip[insState.kind].tone}
        methodLabel={refunded ? t(`insuranceRefundMethod${refunded.method}`) : undefined}
        dateLabel={
          refunded?.completedAt
            ? t('insuranceRefundedOn', { date: formatDate(refunded.completedAt, locale) })
            : undefined
        }
        hint={
          insState.kind === 'retained'
            ? t('insuranceRetainedHint')
            : refunded?.method === 'PROVIDER'
              ? t('insuranceCardRefundDelay')
              : insState.kind === 'awaiting_capture' || insState.kind === 'collected'
                ? t('insuranceHint')
                : undefined
        }
      />
    );
  }

  const extendedBookingData = {
    bookingDate: booking.bookingDate,
    people: booking.people,
    cars: booking.cars,
    userName: booking.user.name || 'Guest',
    serviceName: service,
    categoryName: category,
    categorySlug: booking.service.category.slug,
    totalCents: booking.invoice?.totalCents || 0,
    status: booking.status,
    coverUrl: booking.service.coverUrl,
  };

  const breakdownLines =
    booking.invoice?.lines.map((line) => ({
      id: line.id,
      label: line.label,
      quantity: line.quantity,
      amount: formatMoney(line.totalCents, { locale, currency: 'EGP' }),
    })) ?? [];

  // Distinct assigned places (a unit keeps the same place across all days).
  const assignedPlaces = Array.from(
    new Map(
      booking.units
        .filter((u) => u.place)
        .map((u) => [u.place!.id, u.place!.label]),
    ).values(),
  );

  return (
    <PageTransition>
      {/* Mobile + tablet (< xl) — unchanged centered column. */}
      <div className="container mx-auto max-w-xl px-4 py-6 xl:hidden">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.3em] text-gold-700/80">{category}</p>
          <h1 className="mt-0.5 font-display text-2xl font-semibold text-foreground">{service}</h1>
        </div>
        <BookingStatusBadge status={booking.status} />
      </header>

      {booking.status === 'CONFIRMED' ? (
        <div className="mb-4">
          <SuccessTicket
            bookingId={booking.id}
            reference={booking.reference}
            initialConfirmed
            bookingData={{
              bookingDate: booking.bookingDate,
              people: booking.people,
              cars: booking.cars,
              userName: booking.user.name || 'Guest',
              serviceName: locale === 'ar' ? booking.service.nameAr : booking.service.nameEn,
              categoryName:
                locale === 'ar' ? booking.service.category.nameAr : booking.service.category.nameEn,
              categorySlug: booking.service.category.slug,
              totalCents: booking.invoice?.totalCents || 0,
              status: booking.status,
              coverUrl: booking.service.coverUrl,
            }}
            locale={locale}
          />
        </div>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <h2 className="font-display text-base text-gold-700">{t('reviewTitle')}</h2>
        </CardHeader>
        <CardBody className="grid grid-cols-2 gap-3 text-sm">
          <RowLabel
            label={t('stepDate')}
            dirLtr={!!(booking.endDate && booking.endDate > booking.bookingDate)}
            value={
              booking.endDate && booking.endDate > booking.bookingDate
                ? formatDateRange(booking.bookingDate, booking.endDate, locale)
                : formatDate(booking.bookingDate, locale)
            }
          />
          <RowLabel label={t('reference')} value={booking.reference} dirLtr />
          <RowLabel
            label={booking.children > 0 ? t('stepAdults') : t('stepPeople')}
            value={String(booking.adults)}
          />
          {booking.children > 0 && <RowLabel label={t('stepChildren')} value={String(booking.children)} />}
          {booking.extraPersons > 0 && <RowLabel label={t('stepExtraPersons')} value={String(booking.extraPersons)} />}
          {booking.unitsPerDay > 1 && <RowLabel label={t('explainUnits', { units: booking.unitsPerDay })} value={`×${booking.unitsPerDay}`} />}
          <RowLabel label={t('stepCars')} value={String(booking.cars)} />
        </CardBody>
        <CardFooter>
          <span className="text-sm text-muted-foreground">{t('total')}</span>
          <span className="font-display text-xl font-semibold text-gold-700 tabular-nums">
            {booking.invoice
              ? formatMoney(booking.invoice.totalCents, { locale, currency: 'EGP' })
              : '—'}
          </span>
        </CardFooter>
      </Card>

      {assignedPlaces.length > 0 ? (
        <Card className="mb-4">
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('yourPlaces')}</h2>
          </CardHeader>
          <CardBody>
            <div className="flex flex-wrap gap-2">
              {assignedPlaces.map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-gold-400/30 bg-gold-400/15 px-3 py-1.5 text-sm font-semibold tabular-nums text-gold-700"
                >
                  <MapPinIcon className="size-3.5" />
                  {label}
                </span>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {booking.invoice && booking.invoice.lines.length > 0 ? (
        <Card className="mb-4">
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('priceBreakdown')}</h2>
          </CardHeader>
          <CardBody className="divide-y divide-border/40">
            {booking.invoice.lines.map((line) => (
              <div key={line.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-muted-foreground">
                  {line.label} × {line.quantity}
                </span>
                <span className="tabular-nums text-foreground">
                  {formatMoney(line.totalCents, { locale, currency: 'EGP' })}
                </span>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      {insuranceCard ? <div className="mb-4">{insuranceCard}</div> : null}

      <div className="space-y-2">
        {booking.status === 'PENDING_PAYMENT' ? (
          <Link
            href={`/booking/payment?bid=${booking.id}`}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary font-bold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
          >
            <CreditCardIcon className="size-4" />
            <span>{t('completePayment')}</span>
          </Link>
        ) : null}

        <Link
          href={`/map/${booking.id}`}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-gold-400/40 text-gold-700 transition-colors hover:bg-gold-400/15"
        >
          <MapPinIcon className="size-4" />
          <span>{tMap('title')}</span>
        </Link>

        {cancellable ? (
          <CancelButton bookingId={booking.id} />
        ) : booking.status === 'EXPIRED' ? (
          <p className="pt-2 text-center text-xs text-muted-foreground">
            {tHistory('status.EXPIRED')}
          </p>
        ) : null}

        {refundNotice}
      </div>
      </div>

      {/* Desktop (≥ xl) — wide-canvas Crown Booking Details redesign. */}
      <div className="hidden xl:block">
        <BookingDetailDesktop
          bookingId={booking.id}
          reference={booking.reference}
          status={booking.status}
          initialConfirmed={booking.status === 'CONFIRMED'}
          locale={locale}
          bookingData={extendedBookingData}
          tier={category}
          title={service}
          dateLabel={formatDate(booking.bookingDate, locale, {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
          statusLabel={tHistory(`status.${booking.status}`)}
          totalLabel={totalLabel}
          lines={breakdownLines}
          cancellable={cancellable}
          refundNotice={refundNotice}
          insuranceNotice={insuranceCard}
          places={assignedPlaces}
          childCount={booking.children}
          extraPersons={booking.extraPersons}
          dateRangeLabel={
            booking.endDate && booking.endDate > booking.bookingDate
              ? formatDateRange(booking.bookingDate, booking.endDate, locale, {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })
              : undefined
          }
        />
      </div>

      {/* Guest review — shown on all breakpoints, below the booking details. */}
      {canReview || myReview ? (
        <div className="container mx-auto max-w-xl px-4 pb-6 xl:max-w-3xl">
          <ReviewSection bookingId={booking.id} canReview={canReview} review={myReview} />
        </div>
      ) : null}
    </PageTransition>
  );
}

function RowLabel({ label, value, dirLtr }: { label: string; value: string; dirLtr?: boolean }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-foreground" {...(dirLtr ? { dir: 'ltr' } : {})}>
        {value}
      </p>
    </div>
  );
}

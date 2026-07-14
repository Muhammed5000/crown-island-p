'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { CheckIcon, CopyIcon, CreditCardIcon, DownloadIcon, MapPinIcon, XIcon } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { cancelMyBooking } from '@/features/booking/bookings-actions';
import { useBookingQr } from '@/app/[locale]/(app)/booking/success/useBookingQr';
import { BookingTicket } from '@/app/[locale]/(app)/booking/success/BookingTicket';
import {
  PremiumTicketTemplate,
  useTicketExport,
  type ExportBookingData,
} from '@/app/[locale]/(app)/booking/success/TicketExport';

export interface BreakdownLine {
  id: string;
  label: string;
  quantity: number;
  amount: string;
}

interface Props {
  bookingId: string;
  reference: string;
  status: string;
  initialConfirmed: boolean;
  locale: string;
  bookingData: ExportBookingData;
  /** Category name — eyebrow + ticket tier chip. */
  tier: string;
  /** Service name — the serif page title. */
  title: string;
  dateLabel: string;
  statusLabel: string;
  totalLabel: string;
  lines: BreakdownLine[];
  cancellable: boolean;
  /** Refund-policy panel for PAID bookings (rendered in place of a cancel button). */
  refundNotice?: ReactNode;
  /** Insurance-deposit status panel (server-resolved, like `refundNotice`). */
  insuranceNotice?: ReactNode;
  /** Assigned physical place labels (cabins/cabanas/seats), if any. */
  places?: string[];
  /** Children count (shown when > 0). */
  childCount?: number;
  /** Paid "Extra Person" add-on count (shown when > 0). */
  extraPersons?: number;
  /** Multi-day date range label; falls back to the single `dateLabel`. */
  dateRangeLabel?: string;
}

const STATUS_COLOR: Record<string, string> = {
  CONFIRMED: '#7dd6a1',
  PENDING_PAYMENT: '#f0c14b',
  EXPIRED: '#a3a3a3',
  CANCELLED: '#e8836a',
  FAILED: '#e8836a',
};

/** Maps a cancel server-action code to a localized message via the booking namespace. */
function pickCancelErrorKey(code: string): string {
  switch (code) {
    case 'cancellation_cutoff':
      return 'errors.cancellationCutoff';
    case 'booking_already_used':
      return 'errors.bookingAlreadyUsed';
    case 'booking_not_cancellable':
      return 'errors.bookingNotCancellable';
    case 'paid_cancellation_requires_reception':
      return 'errors.paidCancellationReception';
    default:
      return '';
  }
}

/**
 * Desktop (≥ xl) redesign of the booking-details page, built from the Claude
 * Design handoff "Crown Booking Details Desktop.html".
 *
 * Two-column layout: the boarding-pass ticket + ticket actions on the left,
 * the "Review your booking" card (gold total), the price breakdown, and the
 * location / cancel actions on the right. Shares the ticket, QR polling and
 * premium export with the confirmation page. The left rail + breadcrumb come
 * from the authenticated `AppShell`.
 */
export function BookingDetailDesktop({
  bookingId,
  reference,
  status,
  initialConfirmed,
  locale,
  bookingData,
  tier,
  title,
  dateLabel,
  statusLabel,
  totalLabel,
  lines,
  cancellable,
  refundNotice,
  insuranceNotice,
  places = [],
  childCount = 0,
  extraPersons = 0,
  dateRangeLabel,
}: Props) {
  const t = useTranslations('booking');
  const tCommon = useTranslations('common');
  const tMap = useTranslations('map');
  const router = useRouter();

  // Only poll the live QR for bookings that can actually have one. A terminal
  // booking (EXPIRED / CANCELLED / FAILED) returns 410, which would otherwise
  // redirect the viewer to the payment-failed page — so viewing an expired
  // booking (e.g. to leave a review) must NOT poll.
  const canShowLiveQr = status === 'CONFIRMED' || status === 'PENDING_PAYMENT';
  const { confirmed, qrDataUrl } = useBookingQr(bookingId, initialConfirmed, canShowLiveQr);
  const { cardRef, handleExport, exportLoading, logoDataUrl, coverDataUrl } = useTicketExport({
    reference,
    coverUrl: bookingData.coverUrl,
  });

  const [copied, setCopied] = useState(false);
  function copyReference() {
    navigator.clipboard?.writeText(reference).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      },
      () => {},
    );
  }

  // Cancel flow — reuses the same server action + error mapping as the mobile
  // CancelButton, with a two-step confirm.
  const [confirming, setConfirming] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  function doCancel() {
    setCancelError(null);
    startTransition(async () => {
      const res = await cancelMyBooking({ bookingId });
      if (!res.ok) {
        const key = pickCancelErrorKey(res.code);
        setCancelError(key ? t(key) : tCommon('error'));
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  const statusColor = STATUS_COLOR[status] ?? '#a3a3a3';
  const carWord = bookingData.cars === 1 ? tCommon('car') : tCommon('cars');

  return (
    <div
      className="relative min-h-dvh w-full bg-background font-aurelia-sans text-foreground"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 55% 45% at 70% 0%, rgba(194,161,78,0.08), transparent 60%)',
      }}
    >
      <div className="mx-auto max-w-[1040px] px-11 pb-12 pt-5">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="mb-8 flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.24em] text-gold-700">
              {tier} · {t('detailEyebrow')}
            </div>
            <h1 className="m-0 font-aurelia-display text-[46px] font-semibold leading-none tracking-[-0.01em] text-foreground">
              {title}
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              {dateLabel} · {t('guestsValue', { count: bookingData.people })} · {bookingData.cars}{' '}
              {carWord}
            </p>
          </div>
          <span
            className="mt-1.5 inline-flex shrink-0 items-center gap-2 rounded-full px-[15px] py-2 text-[12.5px] font-semibold tracking-[0.02em]"
            style={{ color: statusColor, background: `${statusColor}1c`, border: `1px solid ${statusColor}44` }}
          >
            <span className="size-[7px] rounded-full" style={{ background: statusColor }} />
            {statusLabel}
          </span>
        </div>

        {/* ── Two columns ────────────────────────────────────────── */}
        <div className="grid grid-cols-[380px_1fr] items-start gap-8">
          {/* LEFT — ticket + ticket actions */}
          <div className="flex flex-col gap-4">
            <BookingTicket
              tier={tier}
              reference={reference}
              confirmed={confirmed}
              qrDataUrl={qrDataUrl}
              brandLabel={tCommon('appName')}
              entryLabel={t('entryTicket')}
              referenceLabel={t('reference')}
              confirmedCaption={t('qrCaption')}
              pendingCaption={statusLabel}
            />
            <button
              type="button"
              onClick={handleExport}
              disabled={!confirmed || exportLoading}
              className="inline-flex h-[54px] w-full items-center justify-center gap-2.5 rounded-[14px] bg-gradient-to-b from-[#e8c87f] to-[#cba45f] text-[14.5px] font-bold tracking-[0.02em] text-aurelia-ink shadow-[0_12px_30px_rgba(227,191,115,0.28)] transition-opacity disabled:opacity-60"
            >
              <DownloadIcon className="size-[18px]" />
              {t('downloadTicket')}
            </button>
            <button
              type="button"
              onClick={copyReference}
              className={[
                'inline-flex h-[50px] w-full items-center justify-center gap-2 rounded-[14px] border bg-card text-[13.5px] font-semibold tracking-[0.02em] transition-colors',
                copied ? 'border-success text-success' : 'border-border text-foreground',
              ].join(' ')}
            >
              {copied ? (
                <>
                  <CheckIcon className="size-4" /> {t('referenceCopied')}
                </>
              ) : (
                <>
                  <CopyIcon className="size-4" /> {t('copyReference')}
                </>
              )}
            </button>
          </div>

          {/* RIGHT — review + breakdown + actions */}
          <div className="flex flex-col gap-5">
            {/* review */}
            <div className="overflow-hidden rounded-[20px] border border-border bg-card">
              <div className="px-[26px] py-[22px]">
                <h2 className="m-0 mb-[18px] font-aurelia-display text-[22px] font-semibold text-foreground">
                  {t('reviewTitle')}
                </h2>
                <div className="grid grid-cols-2 gap-x-6 gap-y-[22px]">
                  <ReviewItem label={t('dateOfVisit')} value={dateRangeLabel ?? dateLabel} dirLtr={!!dateRangeLabel} />
                  <ReviewItem label={t('reference')} value={reference} dirLtr />
                  <ReviewItem
                    label={childCount > 0 ? t('stepAdults') : t('stepPeople')}
                    value={String(childCount > 0 ? bookingData.people - childCount : bookingData.people)}
                  />
                  {childCount > 0 && (
                    <ReviewItem label={t('stepChildren')} value={String(childCount)} />
                  )}
                  {extraPersons > 0 && (
                    <ReviewItem label={t('stepExtraPersons')} value={String(extraPersons)} />
                  )}
                  <ReviewItem
                    label={t('stepCars')}
                    value={bookingData.cars === 0 ? t('noVehicle') : `${bookingData.cars} ${carWord}`}
                  />
                  {places.length > 0 && (
                    <ReviewItem label={t('yourPlaces')} value={places.join(', ')} />
                  )}
                </div>
              </div>
              <div
                className="flex items-center justify-between border-t border-gold-400/20 px-[26px] py-[18px]"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(194,161,78,0.12), rgba(194,161,78,0.03))',
                }}
              >
                <span className="text-[13px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
                  {t('total')}
                </span>
                <span className="font-aurelia-display text-[30px] font-semibold tabular-nums text-gold-700">
                  {totalLabel}
                </span>
              </div>
            </div>

            {/* breakdown */}
            {lines.length > 0 && (
              <div className="rounded-[20px] border border-border bg-card px-[26px] py-[22px]">
                <h2 className="m-0 mb-[18px] font-aurelia-display text-[22px] font-semibold text-foreground">
                  {t('priceBreakdown')}
                </h2>
                <div>
                  {lines.map((line, i) => (
                    <div
                      key={line.id}
                      className={[
                        'flex items-center justify-between py-3.5',
                        i > 0 ? 'border-t border-border' : '',
                      ].join(' ')}
                    >
                      <div className="flex items-center gap-3">
                        <span className="inline-flex h-[26px] min-w-[30px] items-center justify-center rounded-lg bg-gold-400/15 px-2 text-[11.5px] font-bold text-gold-700">
                          ×{line.quantity}
                        </span>
                        <span className="text-[14.5px] font-medium text-foreground">{line.label}</span>
                      </div>
                      <span className="text-[14.5px] font-semibold tabular-nums text-foreground">
                        {line.amount}
                      </span>
                    </div>
                  ))}
                  <div className="mt-1.5 flex items-center justify-between border-t border-border pb-1 pt-4">
                    <span className="text-[13.5px] font-semibold text-muted-foreground">{t('total')}</span>
                    <span className="font-aurelia-display text-[22px] font-semibold text-gold-700">
                      {totalLabel}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* insurance deposit — server-resolved status panel, when the
                booking carries a deposit (mirrors the mobile column). */}
            {insuranceNotice}

            {/* complete payment — only while the booking is awaiting payment.
                Navigates to the secure payment page, which re-verifies
                ownership, status and amount on the backend by booking id. */}
            {status === 'PENDING_PAYMENT' && (
              <div className="flex flex-col gap-2">
                <Link
                  href={`/booking/payment?bid=${bookingId}`}
                  className="inline-flex h-[54px] w-full items-center justify-center gap-2.5 rounded-[14px] bg-gradient-to-b from-[#e8c87f] to-[#cba45f] text-[14.5px] font-bold tracking-[0.02em] text-aurelia-ink shadow-[0_12px_30px_rgba(227,191,115,0.28)] transition-opacity hover:opacity-90"
                >
                  <CreditCardIcon className="size-[18px]" />
                  {t('completePayment')}
                </Link>
                <p className="text-center text-xs text-muted-foreground">{t('completePaymentHint')}</p>
              </div>
            )}

            {/* actions */}
            <div className="flex gap-3">
              <Link
                href={`/map/${bookingId}`}
                className="inline-flex h-[52px] flex-1 items-center justify-center gap-2.5 rounded-[14px] border border-border bg-card text-sm font-semibold tracking-[0.02em] text-foreground transition-colors hover:border-gold-400/40"
              >
                <MapPinIcon className="size-[17px] text-gold-700" />
                {tMap('title')}
              </Link>
              {cancellable && !confirming && (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="inline-flex h-[52px] flex-1 items-center justify-center gap-2.5 rounded-[14px] border border-[#e8836a]/35 bg-transparent text-sm font-semibold tracking-[0.02em] text-[#e8836a] transition-colors hover:bg-[#e8836a]/[0.08]"
                >
                  <XIcon className="size-4" />
                  {t('cancelBooking')}
                </button>
              )}
            </div>

            {/* cancel confirm */}
            {cancellable && confirming && (
              <div className="flex flex-col gap-2">
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    disabled={isPending}
                    className="inline-flex h-[52px] flex-1 items-center justify-center rounded-[14px] border border-border bg-card text-sm font-semibold text-foreground disabled:opacity-60"
                  >
                    {tCommon('back')}
                  </button>
                  <button
                    type="button"
                    onClick={doCancel}
                    disabled={isPending}
                    className="inline-flex h-[52px] flex-1 items-center justify-center rounded-[14px] bg-[#e8836a] text-sm font-bold text-aurelia-ink transition-opacity disabled:opacity-60"
                  >
                    {isPending ? '…' : tCommon('confirm')}
                  </button>
                </div>
                {cancelError && (
                  <p className="text-center text-sm text-[#e8836a]" role="alert">
                    {cancelError}
                  </p>
                )}
              </div>
            )}

            {refundNotice}
          </div>
        </div>
      </div>

      {/* Hidden 1080×1920 template backing "Download ticket". */}
      <PremiumTicketTemplate
        ref={cardRef}
        reference={reference}
        qrDataUrl={qrDataUrl}
        logoDataUrl={logoDataUrl}
        coverDataUrl={coverDataUrl}
        bookingData={bookingData}
        locale={locale}
      />
    </div>
  );
}

function ReviewItem({ label, value, dirLtr }: { label: string; value: ReactNode; dirLtr?: boolean }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div
        className="mt-1.5 text-base font-semibold text-foreground"
        {...(dirLtr ? { dir: 'ltr' as const } : {})}
      >
        {value}
      </div>
    </div>
  );
}

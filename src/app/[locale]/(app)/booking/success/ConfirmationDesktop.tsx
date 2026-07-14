'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  CalendarIcon,
  CarIcon,
  CheckIcon,
  CircleDollarSignIcon,
  CopyIcon,
  DownloadIcon,
  TicketIcon,
  UsersIcon,
  Loader2Icon,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useBookingQr } from './useBookingQr';
import { BookingTicket } from './BookingTicket';
import { PremiumTicketTemplate, useTicketExport, type ExportBookingData } from './TicketExport';

interface Props {
  bookingId: string;
  reference: string;
  initialConfirmed: boolean;
  locale: string;
  bookingData: ExportBookingData;
  /** Pre-resolved display values (formatted server-side to avoid hydration drift). */
  tier: string;
  experience: string;
  dateLabel: string;
  weekday: string;
  openTime: string | null;
  totalLabel: string;
  /** "Includes a {amount} refundable insurance deposit" — null when no deposit. */
  depositNote?: string | null;
}

/**
 * Desktop (≥ xl) redesign of the booking-confirmation page, built from the
 * Claude Design handoff "Crown Confirmation Desktop.html".
 *
 * A boarding-pass style ticket on the left (branded header, real QR on a cream
 * tile, dashed perforation, gold reference) and a details + actions column on
 * the right. The left icon rail and breadcrumb are provided by the
 * authenticated `AppShell`, so they're not re-implemented here.
 *
 * QR polling and the premium download are the SAME ones the mobile ticket uses
 * (`useBookingQr` + `TicketExport`). "Add to wallet" from the prototype has no
 * backend, so it's replaced with a real "View my bookings" action.
 */
export function ConfirmationDesktop({
  bookingId,
  reference,
  initialConfirmed,
  locale,
  bookingData,
  tier,
  experience,
  dateLabel,
  weekday,
  openTime,
  totalLabel,
  depositNote,
}: Props) {
  const t = useTranslations('booking');
  const tCommon = useTranslations('common');

  const { confirmed, qrDataUrl } = useBookingQr(bookingId, initialConfirmed);
  const { cardRef, handleExport, exportLoading, logoDataUrl, coverDataUrl, categoryLogoDataUrl } =
    useTicketExport({
      reference,
      coverUrl: bookingData.coverUrl,
      categoryLogoUrl: bookingData.logoUrl,
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

  const dateSub = openTime ? `${weekday} · ${t('gatesOpen', { time: openTime })}` : weekday;
  const carWord = bookingData.cars === 1 ? tCommon('car') : tCommon('cars');
  const vehiclesValue = bookingData.cars === 0 ? t('noVehicle') : `${bookingData.cars} ${carWord}`;

  return (
    <div
      className="relative min-h-dvh w-full bg-background font-aurelia-sans text-foreground"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 55% 45% at 50% -5%, rgba(125,214,161,0.10), transparent 55%)',
      }}
    >
      <div className="mx-auto max-w-[1040px] px-11 pb-12 pt-5">
        {/* ── Success banner ─────────────────────────────────────── */}
        <div className="mb-9 flex items-center gap-[18px]">
          {confirmed ? (
            <>
              <div
                className="flex size-16 shrink-0 items-center justify-center rounded-full"
                style={{ background: 'radial-gradient(circle, rgba(125,214,161,0.45), transparent 72%)' }}
              >
                <div className="flex size-[46px] items-center justify-center rounded-full bg-[#7dd6a1] text-aurelia-ink">
                  <CheckIcon className="size-6" strokeWidth={3} />
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-success">
                  {t('paymentConfirmed')}
                </div>
                <h1 className="m-0 font-aurelia-display text-[44px] font-semibold leading-none tracking-[-0.01em] text-foreground">
                  {t('successTitle')}
                </h1>
                <p className="mt-2.5 text-sm text-muted-foreground">
                  {t('confirmedSubtitle', { experience, date: dateLabel })}
                </p>
              </div>
            </>
          ) : (
            <>
              <div
                className="flex size-16 shrink-0 items-center justify-center rounded-full"
                style={{ background: 'radial-gradient(circle, rgba(227,191,115,0.45), transparent 72%)' }}
              >
                <div className="flex size-[46px] items-center justify-center rounded-full bg-aurelia-gold text-aurelia-ink">
                  <Loader2Icon className="size-6 animate-spin" strokeWidth={3} />
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-gold-700">
                  {tCommon('loading')}
                </div>
                <h1 className="m-0 font-aurelia-display text-[44px] font-semibold leading-none tracking-[-0.01em] text-foreground">
                  Processing payment...
                </h1>
                <p className="mt-2.5 text-sm text-muted-foreground">
                  Please wait while we confirm your transaction.
                </p>
              </div>
            </>
          )}
        </div>

        {/* ── Two columns ────────────────────────────────────────── */}
        <div className="grid grid-cols-[380px_1fr] items-start gap-8">
          {/* LEFT — boarding-pass ticket */}
          <BookingTicket
            tier={tier}
            reference={reference}
            confirmed={confirmed}
            qrDataUrl={qrDataUrl}
            brandLabel={tCommon('appName')}
            entryLabel={t('entryTicket')}
            referenceLabel={t('reference')}
            confirmedCaption={t('qrCaption')}
            pendingCaption={tCommon('loading')}
          />

          {/* RIGHT — details + actions */}
          <div className="flex flex-col gap-5">
            <div className="rounded-[20px] border border-border bg-card px-6 py-2">
              <DetailRow
                icon={<CalendarIcon className="size-[18px] text-gold-700" />}
                label={t('dateOfVisit')}
                value={dateLabel}
                sub={dateSub}
              />
              <DetailRow
                icon={<UsersIcon className="size-[18px] text-gold-700" />}
                label={t('guests')}
                value={t('guestsValue', { count: bookingData.people })}
              />
              <DetailRow
                icon={<CarIcon className="size-[18px] text-gold-700" />}
                label={t('vehicles')}
                value={vehiclesValue}
              />
              <DetailRow
                last
                icon={<CircleDollarSignIcon className="size-[18px] text-gold-700" />}
                label={t('totalPaid')}
                value={
                  <span className="font-aurelia-display text-[22px] font-semibold text-gold-700">
                    {totalLabel}
                  </span>
                }
                sub={t('paidInFull')}
              />
              {depositNote ? (
                <p className="pb-3 pt-0.5 text-[12.5px] text-muted-foreground">{depositNote}</p>
              ) : null}
            </div>

            {/* actions */}
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={handleExport}
                disabled={!confirmed || exportLoading}
                className="inline-flex h-[54px] w-full items-center justify-center gap-2.5 rounded-[14px] bg-gradient-to-b from-[#e8c87f] to-[#cba45f] text-[14.5px] font-bold tracking-[0.02em] text-aurelia-ink shadow-[0_12px_30px_rgba(227,191,115,0.28)] transition-opacity disabled:opacity-60"
              >
                <DownloadIcon className="size-[18px]" />
                {t('downloadTicket')}
              </button>
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={copyReference}
                  className={[
                    'inline-flex h-[50px] flex-1 items-center justify-center gap-2 rounded-[14px] border bg-card text-[13.5px] font-semibold tracking-[0.02em] transition-colors',
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
                <Link
                  href="/bookings/history"
                  className="inline-flex h-[50px] flex-1 items-center justify-center gap-2 rounded-[14px] border border-border bg-card text-[13.5px] font-semibold tracking-[0.02em] text-foreground transition-colors hover:border-gold-400/40"
                >
                  <TicketIcon className="size-4" /> {t('viewMyBookings')}
                </Link>
              </div>
            </div>
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
        categoryLogoDataUrl={categoryLogoDataUrl}
        bookingData={bookingData}
        locale={locale}
      />
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
  sub,
  last,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: string;
  last?: boolean;
}) {
  return (
    <div
      className={[
        'flex items-center gap-4 py-[18px]',
        last ? '' : 'border-b border-border',
      ].join(' ')}
    >
      <div className="flex size-[42px] shrink-0 items-center justify-center rounded-xl border border-gold-400/30 bg-gold-400/15">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 text-base font-semibold text-foreground">{value}</div>
      </div>
      {sub && <div className="text-end text-[12.5px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

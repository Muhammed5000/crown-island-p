'use client';

import { useTranslations } from 'next-intl';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DownloadIcon, CheckCircle2Icon, Loader2Icon } from 'lucide-react';
import { useBookingQr } from './useBookingQr';
import { ZkPassCard } from './ZkPassCard';
import { PremiumTicketTemplate, useTicketExport, type ExportBookingData } from './TicketExport';

interface Props {
  bookingId: string;
  initialConfirmed: boolean;
  reference: string;
  bookingData?: ExportBookingData;
  locale: string;
}

/**
 * Renders the QR ticket once the booking is CONFIRMED, plus a premium
 * downloadable "Professional Card" export.
 *
 * QR polling and the export template are shared with the desktop confirmation
 * page via `useBookingQr` and `TicketExport`.
 */
export function SuccessTicket({ bookingId, initialConfirmed, reference, bookingData, locale }: Props) {
  const t = useTranslations('booking');
  const tCommon = useTranslations('common');

  const { confirmed, qrDataUrl } = useBookingQr(bookingId, initialConfirmed);
  const { cardRef, handleExport, exportLoading, logoDataUrl, coverDataUrl, categoryLogoDataUrl } =
    useTicketExport({
      reference,
      coverUrl: bookingData?.coverUrl,
      categoryLogoUrl: bookingData?.logoUrl,
    });

  return (
    <div className="space-y-4">
      {confirmed ? (
        <header className="mb-5 flex flex-col items-center text-center">
          <div className="mb-2 grid size-14 place-items-center rounded-full bg-gold-400/15 text-gold-700">
            <CheckCircle2Icon className="size-7" />
          </div>
          <h1 className="font-display text-2xl font-semibold text-foreground">{t('successTitle')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('successSubtitle')}</p>
        </header>
      ) : (
        <header className="mb-5 flex flex-col items-center text-center">
          <div className="mb-2 grid size-14 place-items-center rounded-full bg-gold-400/15 text-gold-700">
            <Loader2Icon className="size-7 animate-spin" />
          </div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Processing payment...</h1>
          <p className="mt-1 text-sm text-muted-foreground">Please wait while we confirm your transaction.</p>
        </header>
      )}

      <Card variant="glass" className="overflow-hidden">
        <CardBody className="flex flex-col items-center gap-4 p-6 text-center">
          {confirmed && qrDataUrl ? (
            <>
              <div className="rounded-2xl bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} alt={t('qrCaption')} className="size-48" />
              </div>

              <p className="text-sm text-muted-foreground">{t('qrCaption')}</p>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t('reference')}</p>
                <p dir="ltr" className="font-display text-base text-gold-700">
                  {reference}
                </p>
              </div>

              <div className="flex w-full flex-col gap-2 pt-2">
                {bookingData && (
                  <Button
                    onClick={handleExport}
                    loading={exportLoading}
                    variant="primary"
                    size="sm"
                    className="h-11 shadow-gold"
                  >
                    <DownloadIcon className="mr-2 size-4" />
                    {t('downloadTicket')}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="size-32 animate-pulse rounded-3xl bg-muted/40" />
              <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
              <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
                {tCommon('retry')}
              </Button>
            </>
          )}
        </CardBody>
      </Card>

      {/* Cabin (ZK) access pass — shown only for services that require it. */}
      {confirmed ? <ZkPassCard bookingId={bookingId} /> : null}

      {/* Hidden 1080×1920 template for the premium export. */}
      {bookingData && (
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
      )}
    </div>
  );
}

import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { PageTransition } from '@/components/layout/PageTransition';
import { IframeBreakout } from '@/components/booking/IframeBreakout';
import { Card, CardBody } from '@/components/ui/Card';
import { requireUser } from '@/server/auth/guards';
import { getBookingForUser } from '@/server/services/booking';
import { isLocale } from '@/i18n/config';
import { ErrorIllustration } from '@/components/ui/ErrorIllustration';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ bid?: string }>;
}

export default async function FailedPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const { bid } = await searchParams;
  if (!bid) redirect('/booking');

  const user = await requireUser();
  const booking = await getBookingForUser(bid, user.id);
  if (!booking) redirect('/booking');

  // The payment may have actually SUCCEEDED — e.g. the confirm race resolved on
  // the winning transaction while this request lost it, or the reconciler settled
  // it since. A CONFIRMED booking must never be shown as "failed": send the
  // customer to their paid booking instead of a dead-end, so they never pay twice.
  if (booking.status === 'CONFIRMED') redirect(`/booking/success?bid=${bid}`);

  // Still awaiting payment → let the customer retry THIS booking's payment. The
  // old button always linked to the landing page ("returns to home, does
  // nothing"); a payable booking should go straight back to its payment page.
  const payable = booking.status === 'PENDING_PAYMENT';

  // The charge was captured but the booking could never confirm (capacity race /
  // amount mismatch / booking cancelled mid-payment) and was auto-refunded —
  // "payment failed" alone would panic a customer who just saw the charge land.
  const refunded = !payable && booking.payments.some((p) => p.status === 'REFUNDED');

  const t = await getTranslations('booking');
  const tCommon = await getTranslations('common');

  return (
    <PageTransition className="container mx-auto max-w-xl px-4 py-10">
      <IframeBreakout />
      <Card variant="glass">
        <CardBody className="flex flex-col items-center gap-6 p-8 text-center">
          <ErrorIllustration type="failed" className="animate-pulse" />
          <div className="space-y-1">
            <h1 className="font-display text-3xl font-bold text-foreground">
              {refunded ? t('refundedTitle') : t('failedTitle')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {refunded ? t('refundedNotice') : t('failedSubtitle')}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {t('reference')}: <span dir="ltr">{booking.reference}</span>
            </p>
          </div>

          <div className="flex w-full flex-col items-center gap-3">
            {payable ? (
              <>
                <Link
                  href={`/booking/payment?bid=${bid}`}
                  className="inline-flex h-12 w-full max-w-xs items-center justify-center rounded-2xl bg-primary px-10 text-base font-bold text-primary-foreground shadow-sm transition-all hover:brightness-110 active:scale-95"
                >
                  {t('retryPayment')}
                </Link>
                <Link
                  href="/booking"
                  className="text-sm font-semibold text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                >
                  {t('bookAnother')}
                </Link>
              </>
            ) : (
              <Link
                href="/booking"
                className="inline-flex h-12 items-center justify-center rounded-2xl bg-primary px-10 text-base font-bold text-primary-foreground shadow-sm transition-all hover:brightness-110 active:scale-95"
              >
                {tCommon('retry')}
              </Link>
            )}
          </div>
        </CardBody>
      </Card>
    </PageTransition>
  );
}

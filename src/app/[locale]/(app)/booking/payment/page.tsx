import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { TopNav } from '@/components/layout/TopNav';
import { Stepper } from '@/components/layout/Stepper';
import { PageTransition } from '@/components/layout/PageTransition';
import { PaymentForm } from './PaymentForm';
import { requireUser } from '@/server/auth/guards';
import { getBookingForUser } from '@/server/services/booking';
import { isLocale } from '@/i18n/config';
import { getSettings } from '@/server/settings/settings';
import { getRequestOrigin } from '@/lib/origin';
import { verifyAndConfirmOrder } from '@/server/credit-agricole/verify';
import { MpgsNotConfiguredError } from '@/server/credit-agricole/client';
import { routeAfterVerify } from '@/server/credit-agricole/return-routing-core';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ bid?: string }>;
}

export default async function PaymentPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const { bid } = await searchParams;
  if (!bid) redirect('/booking');

  const user = await requireUser();
  const settings = await getSettings();
  const booking = await getBookingForUser(bid, user.id);
  if (!booking || !booking.invoice) redirect('/booking');

  // VERIFY-ON-RETURN (double-charge guard): a customer who closed the tab during
  // the post-payment redirect can land back here on a booking the gateway ALREADY
  // captured but the site never confirmed — the browser confirm paths died with
  // the tab. Rendering the pay form again would let them pay twice. So re-check
  // the authoritative order state once (idempotent; a no-op if nothing changed),
  // then re-read and route. Only for a pending booking that actually has a
  // Crédit Agricole order — cash/other bookings and non-pending states skip it.
  if (
    booking.status === 'PENDING_PAYMENT' &&
    booking.payments.some((p) => p.provider === 'CREDIT_AGRICOLE' && p.paymobOrderId)
  ) {
    try {
      // One attempt: a returning customer is not mid-capture, and 6 polls would
      // block the render for ~9s. If MPGS is unconfigured, just show the form.
      await verifyAndConfirmOrder(bid, { attempts: 1 });
    } catch (err) {
      if (!(err instanceof MpgsNotConfiguredError)) {
        console.error('[payment page] verify-on-return failed', bid, err);
      }
    }
    const fresh = await getBookingForUser(bid, user.id);
    // redirect() throws Next's control-flow signal — MUST be outside any catch.
    const route = fresh ? routeAfterVerify(fresh.status) : 'stay';
    if (route === 'success') redirect(`/booking/success?bid=${bid}`);
    if (route === 'failed') redirect(`/booking/failed?bid=${bid}`);
  }

  // Confirmed bookings shouldn't re-enter payment.
  if (booking.status === 'CONFIRMED') redirect(`/booking/success?bid=${bid}`);
  if (booking.status === 'FAILED') redirect(`/booking/failed?bid=${bid}`);

  const t = await getTranslations('booking');
  // Derive the success-redirect origin from the actual request, not a baked-in
  // `localhost:3000` fallback. `NEXT_PUBLIC_APP_URL` still wins if set (so an
  // operator can pin Paymob redirects to the canonical domain), but the
  // default is the host the customer is actually on — ngrok, preview deploy,
  // or prod — which is what they expect to land back at.
  const appUrl = await getRequestOrigin();
  const successUrl = `${appUrl}/${locale === 'en' ? 'en/' : ''}booking/success?bid=${booking.id}`;

  return (
    <PageTransition>
      <TopNav title={t('stepPayment')} locale={locale} />
      <Stepper current={3} />
      <div className="mx-auto max-w-md px-5 pb-10 md:max-w-xl">
        <PaymentForm
          bookingId={booking.id}
          reference={booking.reference}
          totalCents={booking.invoice.totalCents}
          insuranceCents={
            booking.insurance?.collectionStatus === 'PENDING'
              ? booking.insurance.amountCents
              : 0
          }
          locale={locale}
          successUrl={successUrl}
          isTester={user.role === 'TESTER' || user.role === 'DEVELOPER'}
          sandboxMode={settings.sandboxMode}
        />
      </div>
    </PageTransition>
  );
}

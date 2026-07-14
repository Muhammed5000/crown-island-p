import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { requireReceptionOrNull } from '@/server/auth/guards';
import { getInsuranceCheckoutForReception } from '@/server/services/insurance-reads';
import { isLocale } from '@/i18n/config';
import { InsuranceCheckout } from '@/components/gate/InsuranceCheckout';

interface Props {
  params: Promise<{ locale: string; bookingId: string }>;
}

/**
 * Reception deposit checkout (`/gate/reception/checkout/[bookingId]`).
 *
 * Reception-authorised staff land here from the search / today board / check-in
 * page to settle a booking's insurance deposit: decide REFUND vs NO_REFUND and
 * execute the desk payout (docs/INSURANCE.md §5). Read-only on any node; the
 * mutations proxy to online from the local venue node. 404s when the booking
 * has no deposit (absence of a BookingInsurance row = not applicable).
 */
export default async function ReceptionCheckoutPage({ params }: Props) {
  const { locale, bookingId } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const staff = await requireReceptionOrNull();
  if (!staff) {
    return (
      <main dir="ltr" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: 'radial-gradient(ellipse at top, #ffffff 0%, #f4f6f7 55%), #f4f6f7' }}>
        <div
          style={{
            maxWidth: 380, textAlign: 'center', padding: '32px 28px', borderRadius: 20,
            background: '#ffffff', border: '1px solid rgba(28,43,64,0.12)',
            boxShadow: '0 10px 30px rgba(28,43,64,0.08)',
            color: '#1c2b40', fontFamily: 'var(--font-aurelia-sans), system-ui, sans-serif',
          }}
        >
          <p style={{ fontFamily: 'var(--font-aurelia-display), serif', fontSize: 28, fontWeight: 600, color: '#9c7d34', margin: 0 }}>403</p>
          <h1 style={{ fontSize: 16, fontWeight: 600, margin: '12px 0 8px' }}>Reception access restricted</h1>
          <p style={{ fontSize: 13, lineHeight: 1.5, color: 'rgba(28,43,64,0.62)', margin: 0 }}>
            This account is not authorised for the reception desk.
          </p>
        </div>
      </main>
    );
  }

  const view = await getInsuranceCheckoutForReception(bookingId);
  if (!view) notFound();

  return <InsuranceCheckout locale={locale} initialView={view} />;
}

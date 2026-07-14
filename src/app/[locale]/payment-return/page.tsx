import { setRequestLocale } from 'next-intl/server';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ bid?: string; success?: string }>;
}

/**
 * Public landing for MOBILE-APP payments (`/payment-return?bid=…`).
 *
 * Paymob redirects the phone's system browser here after checkout. The
 * browser has NO app session (the app authenticates with bearer tokens), and
 * it may even carry an unrelated website session — e.g. a staff account that
 * the gate-only confinement would bounce to `/gate/scan`. This page is
 * therefore deliberately:
 *   - sessionless: no auth guard, no user data, nothing to leak — the app
 *     polls `GET /api/mobile/bookings/:id` for the real outcome;
 *   - exempt from the proxy's gate-only confinement (see authorized() in
 *     `src/server/auth/config.ts`);
 *   - self-contained: inline styles, bilingual copy, an "open the app" deep
 *     link and nothing else.
 */
export default async function PaymentReturnPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const { bid, success } = await searchParams;
  const ar = locale === 'ar';
  const failed = success === 'false';

  const title = failed
    ? ar
      ? 'لم يكتمل الدفع'
      : 'Payment not completed'
    : ar
      ? 'تم استلام الدفع'
      : 'Payment received';
  const body = failed
    ? ar
      ? 'لم تكتمل عملية الدفع. عد إلى تطبيق كراون آيلاند للمحاولة مرة أخرى.'
      : 'The payment was not completed. Return to the Crown Island app to try again.'
    : ar
      ? 'عد إلى تطبيق كراون آيلاند لمتابعة حالة حجزك — سيتم تأكيده خلال لحظات.'
      : 'Return to the Crown Island app to follow your booking — it will be confirmed in a few moments.';
  const cta = ar ? 'فتح التطبيق' : 'Open the app';
  const closeHint = ar ? 'يمكنك إغلاق هذه الصفحة.' : 'You can close this page.';

  const deepLink = bid
    ? `crownislandapp://payment/${encodeURIComponent(bid)}`
    : 'crownislandapp://';

  return (
    <main
      dir={ar ? 'rtl' : 'ltr'}
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        background: 'radial-gradient(ellipse at top, #1a2235 0%, #0c0f15 60%), #0c0f15',
        color: '#f5ead0',
        fontFamily: 'system-ui, sans-serif',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 380,
          textAlign: 'center',
          padding: '36px 28px',
          borderRadius: 20,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <p
          style={{
            fontSize: 40,
            margin: 0,
            lineHeight: 1,
          }}
          aria-hidden
        >
          {failed ? '✕' : '✓'}
        </p>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#e3bf73', margin: '16px 0 8px' }}>
          {title}
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'rgba(245,234,208,0.7)', margin: 0 }}>
          {body}
        </p>
        <a
          href={deepLink}
          style={{
            display: 'inline-block',
            marginTop: 24,
            padding: '14px 32px',
            borderRadius: 12,
            background: '#e3bf73',
            color: '#091322',
            fontWeight: 700,
            fontSize: 15,
            textDecoration: 'none',
          }}
        >
          {cta}
        </a>
        <p style={{ fontSize: 12, color: 'rgba(245,234,208,0.45)', marginTop: 16 }}>{closeHint}</p>
      </div>
    </main>
  );
}

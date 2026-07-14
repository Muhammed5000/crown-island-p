'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ShieldCheckIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { ErrorIllustration } from '@/components/ui/ErrorIllustration';
import { formatMoney } from '@/lib/money';

/**
 * MPGS Hosted Checkout — isolated in an IFRAME.
 *
 * The whole payment (card entry, 3-D Secure, inline declines/retries) runs inside
 * a chrome-free iframe served by `/api/credit-agricole/frame`, so nothing of the
 * payment is embedded into the site's own DOM. The iframe posts only the final
 * outcome to this parent, which then navigates the site. Card data is entered on
 * Mastercard's form and never touches our server.
 */

interface Props {
  bookingId: string;
  reference: string;
  totalCents: number;
  /** Refundable insurance deposit included in `totalCents` (0 = none). */
  insuranceCents?: number;
  currency: string;
  locale: 'ar' | 'en';
}

/** Opaque per-attempt message nonce (defense-in-depth on top of source identity). */
function makeNonce(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '');
  } catch {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }
}

/**
 * FESEC-001 (opt-in): when `NEXT_PUBLIC_MPGS_FRAME_SANDBOX=1`, sandbox the
 * payment iframe to an OPAQUE origin so a compromised provider script can't reach
 * the app origin's DOM/cookies/storage. Omitting `allow-same-origin` is what
 * provides the isolation; the tokens below keep scripts, the card form, and 3DS
 * redirects/popups working, and outcome messaging is validated by source+nonce
 * (not origin), so it survives the opaque origin. DEFAULT OFF — enabling it MUST
 * be validated against a live MPGS/3DS transaction first, since a hosted-checkout
 * script that needs same-origin storage could break under the sandbox.
 */
const FRAME_SANDBOX =
  process.env.NEXT_PUBLIC_MPGS_FRAME_SANDBOX === '1'
    ? 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation'
    : undefined;

export function MpgsLightbox({
  bookingId,
  reference,
  totalCents,
  insuranceCents = 0,
  currency,
  locale,
}: Props) {
  const t = useTranslations('booking');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState('');
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const prefix = locale === 'en' ? '/en' : '';
  const frameSrc = `/api/credit-agricole/frame?bid=${encodeURIComponent(bookingId)}&locale=${locale}&n=${encodeURIComponent(nonce)}`;

  // React to the outcome posted by the payment iframe.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // FESEC-001/SEC-002: bind the outcome to OUR payment iframe (source
      // identity) AND this attempt's nonce — not merely "same origin". Any other
      // same-origin window, or a sandboxed opaque-origin frame, therefore cannot
      // spoof a `success`. (Source+nonce also work when the frame is sandboxed,
      // where `e.origin` would be "null".)
      const frame = iframeRef.current;
      if (!frame || e.source !== frame.contentWindow) return;
      const data = e.data as { mpgsStatus?: string; ciNonce?: string } | null;
      if (!data || typeof data !== 'object' || !data.mpgsStatus) return;
      if (!nonce || data.ciNonce !== nonce) return;
      switch (data.mpgsStatus) {
        case 'success':
          window.location.href = `${prefix}/booking/success?bid=${bookingId}`;
          break;
        case 'failed':
          window.location.href = `${prefix}/booking/failed?bid=${bookingId}`;
          break;
        case 'refunded':
          // Captured but the booking could not confirm (e.g. last unit taken by
          // another payer) — the charge was auto-refunded. Failed page explains.
          window.location.href = `${prefix}/booking/failed?bid=${bookingId}`;
          break;
        case 'declined':
          // No funds taken — reload the iframe for a fresh attempt, in place.
          setReloadKey((k) => k + 1);
          break;
        case 'cancel':
          setOpen(false);
          break;
        case 'error':
          setError('payment_error');
          setOpen(false);
          break;
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [bookingId, prefix, nonce]);

  // While the payment iframe is open, poll the order status. MPGS's embedded
  // `data-complete` does not reliably navigate out of the nested iframe, so this
  // is how the page learns the payment succeeded: it confirms the booking the
  // moment the gateway reports SUCCESS, then navigates. (Declines/retries are
  // handled by the customer inside the iframe; we keep polling until success or
  // the overlay is closed.)
  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let attempts = 0;
    const maxAttempts = 200; // ~10 minutes at 3s
    let timer = 0;

    const poll = async () => {
      if (stopped) return;
      attempts += 1;
      try {
        const res = await fetch('/api/credit-agricole/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId }),
        });
        const data = (await res.json().catch(() => null)) as { status?: string } | null;
        if (!stopped && data?.status === 'success') {
          stopped = true;
          window.location.href = `${prefix}/booking/success?bid=${bookingId}`;
          return;
        }
        if (!stopped && data?.status === 'refunded') {
          // Money was captured but the booking can never confirm — the charge
          // was automatically returned. Stop polling and explain on the failed
          // page instead of spinning here forever.
          stopped = true;
          window.location.href = `${prefix}/booking/failed?bid=${bookingId}`;
          return;
        }
        if (!stopped && data?.status === 'failed') {
          stopped = true;
          window.location.href = `${prefix}/booking/failed?bid=${bookingId}`;
          return;
        }
      } catch {
        // transient — keep polling
      }
      if (!stopped) {
        if (attempts < maxAttempts) {
          timer = window.setTimeout(poll, 3000);
        } else {
          stopped = true;
          setOpen(false);
          setError('payment_status_timeout');
        }
      }
    };

    timer = window.setTimeout(poll, 3000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [open, bookingId, prefix]);

  if (error) {
    return (
      <Card variant="glass">
        <CardBody className="flex flex-col items-center gap-6 py-10 text-center">
          <ErrorIllustration type="error" />
          <div className="space-y-1">
            <p className="text-sm font-bold uppercase tracking-widest text-gold-700">
              {locale === 'ar' ? 'تعذّر إتمام الدفع' : 'Payment could not start'}
            </p>
            <p className="text-sm text-muted-foreground">{tCommon('error')}</p>
            <Button variant="primary" size="sm" className="mt-4" onClick={() => setError(null)}>
              {locale === 'ar' ? 'إعادة المحاولة' : 'Try again'}
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{t('reference')}</p>
              <p dir="ltr" className="font-display text-sm text-gold-700">
                {reference}
              </p>
            </div>
            <div className="text-end">
              <p className="text-xs text-muted-foreground">{t('total')}</p>
              <p className="font-display text-2xl font-semibold text-gold-700 tabular-nums">
                {formatMoney(totalCents, { locale, currency })}
              </p>
            </div>
          </div>
          {insuranceCents > 0 ? (
            <p className="text-end text-xs text-muted-foreground">
              {t('insuranceIncludedInTotal', {
                amount: formatMoney(insuranceCents, { locale, currency }),
              })}
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-gold-400/15 ring-1 ring-gold-400/30">
            <ShieldCheckIcon className="size-6 text-gold-700" />
          </div>
          <p className="text-sm text-muted-foreground">
            {locale === 'ar'
              ? 'ادفع بأمان عبر بطاقتك. ستظهر نافذة الدفع فوق الصفحة دون مغادرة الموقع.'
              : 'Pay securely by card. The payment window opens over this page — you stay on our site.'}
          </p>
          <Button
            onClick={() => {
              // Fresh per-attempt nonce so the iframe's outcome messages bind to
              // this exact open. Set together with `open` (one render).
              setNonce(makeNonce());
              setOpen(true);
            }}
            fullWidth
            variant="primary"
            className="h-14 text-base font-bold shadow-sm"
          >
            {locale === 'ar' ? 'ادفع الآن' : 'Pay now'}
          </Button>
        </CardBody>
      </Card>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-950/60 p-4 backdrop-blur-sm">
          <div className="my-6 flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="font-display text-sm font-semibold text-foreground">
                {locale === 'ar' ? 'الدفع الآمن' : 'Secure payment'}
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                {tCommon('cancel')}
              </button>
            </div>
            <iframe
              key={reloadKey}
              ref={iframeRef}
              src={frameSrc}
              title={locale === 'ar' ? 'الدفع الآمن' : 'Secure payment'}
              className="h-[600px] w-full border-0 bg-white"
              allow="payment"
              sandbox={FRAME_SANDBOX}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

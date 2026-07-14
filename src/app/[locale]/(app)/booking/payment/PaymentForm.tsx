'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ZapIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatMoney } from '@/lib/money';
import { virtualPayAction } from '@/features/admin/developer-actions';
import { ErrorIllustration } from '@/components/ui/ErrorIllustration';
import { MpgsLightbox } from './MpgsLightbox';

interface Props {
  bookingId: string;
  reference: string;
  totalCents: number;
  /** Refundable insurance deposit included in `totalCents` (0 = none). */
  insuranceCents?: number;
  locale: 'ar' | 'en';
  successUrl: string;
  isTester?: boolean;
  sandboxMode?: boolean;
}

interface MpgsConfig {
  sessionId: string;
  scriptUrl: string;
  completeUrl: string;
  cancelUrl: string;
}

interface IntentResponse {
  paymentId: string;
  providerOrderId: string;
  amountCents: number;
  currency?: string;
  /** MPGS Hosted Checkout (Lightbox) parameters (Crédit Agricole Egypt). */
  mpgs?: MpgsConfig;
}

export function PaymentForm({
  bookingId,
  reference,
  totalCents,
  insuranceCents = 0,
  locale,
  successUrl,
  isTester,
  sandboxMode,
}: Props) {
  const t = useTranslations('booking');
  const tCommon = useTranslations('common');
  const [isMpgs, setIsMpgs] = useState(false);
  const [currency, setCurrency] = useState('EGP');
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [isPending, startTransition] = useTransition();

  const handleVirtualPay = async () => {
    startTransition(async () => {
      try {
        const res = await virtualPayAction(bookingId);
        if (res.ok) {
          window.location.href = successUrl;
        }
      } catch {
        setFatalError('virtual_pay_failed');
      }
    });
  };

  useEffect(() => {
    if (sandboxMode && isTester) return; // Skip intent creation in sandbox.
    let cancelled = false;
    (async () => {
      try {
        const headers: HeadersInit = { 'Content-Type': 'application/json' };
        if (window.location.hostname.includes('ngrok')) {
          headers['ngrok-skip-browser-warning'] = 'true';
        }
        const res = await fetch('/api/payments/create-intent', {
          method: 'POST',
          headers,
          body: JSON.stringify({ bookingId, locale }),
        });
        const body = (await res.json()) as IntentResponse & { error?: string };
        if (cancelled) return;
        if (!res.ok || !body.mpgs) {
          setFatalError(body.error ?? 'intent_failed');
          return;
        }
        if (body.currency) setCurrency(body.currency);
        setIsMpgs(true);
      } catch {
        if (!cancelled) setFatalError('network_error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookingId, locale, isTester, sandboxMode, retryKey]);

  if (sandboxMode && isTester) {
    return (
      <Card variant="glass" className="border-gold-400/30">
        <CardBody className="space-y-6 p-8 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-gold-400/15 ring-1 ring-gold-400/30">
            <ZapIcon className="size-8 text-gold-700" />
          </div>
          <div className="space-y-2">
            <h2 className="font-display text-2xl font-bold text-foreground">Sandbox Environment</h2>
            <p className="text-sm text-muted-foreground">
              You are signed in as a <Badge tone="info">TESTER</Badge>. Real payments are disabled and can be skipped.
            </p>
          </div>

          <div className="rounded-2xl bg-muted p-4 ring-1 ring-border">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total to process</span>
              <span className="font-bold text-gold-700">
                {formatMoney(totalCents, { locale, currency: 'EGP' })}
              </span>
            </div>
            {insuranceCents > 0 ? (
              <p className="mt-2 text-start text-xs text-muted-foreground">
                {t('insuranceIncludedInTotal', {
                  amount: formatMoney(insuranceCents, { locale, currency: 'EGP' }),
                })}
              </p>
            ) : null}
          </div>

          <Button
            onClick={handleVirtualPay}
            loading={isPending}
            fullWidth
            variant="primary"
            className="h-14 text-base font-bold shadow-sm"
          >
            Confirm Virtual Payment
          </Button>

          <p className="text-[10px] uppercase tracking-widest text-gold-700/60">
            No real charge will occur
          </p>
        </CardBody>
      </Card>
    );
  }

  if (fatalError === 'payment_not_configured') {
    return (
      <Card>
        <CardBody className="space-y-2 text-center">
          <Badge tone="warning">Payment is not configured</Badge>
          <p className="text-sm text-muted-foreground">
            The active payment provider (selected by{' '}
            <code className="text-gold-700">PAYMENT_PROVIDER</code>) has no credentials set. Add the
            provider&apos;s keys to your environment to enable checkout.
          </p>
        </CardBody>
      </Card>
    );
  }

  // The pre-payment re-verification (calcBooking) reports these actionable
  // outcomes. Match the ACTUAL DomainError codes: capacity errors are
  // `capacity_people` / `capacity_cars` / …, hours is `working_hours_ended`,
  // and a stale slot is `past_date` — not the bare `capacity` / `working_hours`
  // this previously checked, which let them fall through to the generic error.
  const recheckKind = !fatalError
    ? null
    : fatalError.startsWith('capacity')
      ? 'capacity'
      : fatalError === 'working_hours_ended'
        ? 'hours'
        : fatalError === 'past_date'
          ? 'past_date'
          : fatalError === 'price_changed'
            ? 'price_changed'
            : null;

  if (recheckKind) {
    return (
      <Card variant="glass">
        <CardBody className="flex flex-col items-center gap-6 py-10 text-center">
          <ErrorIllustration type="error" />
          <div className="space-y-2">
            <p className="text-lg font-bold text-gold-700">
              {recheckKind === 'capacity'
                ? t('errors.capacity')
                : recheckKind === 'hours'
                  ? t('errors.workingHoursEnded')
                  : recheckKind === 'past_date'
                    ? t('errors.pastDate')
                    : t('errors.priceChanged')}
            </p>
            <p className="text-sm text-muted-foreground">
              {recheckKind === 'capacity'
                ? (locale === 'ar' ? 'لقد اكتملت السعة لهذا اليوم بينما كنت تكمل حجزك. يرجى اختيار موعد آخر.' : 'Capacity was filled while you were completing your booking. Please pick another date.')
                : (locale === 'ar' ? 'يرجى العودة واختيار موعد متاح.' : 'Please go back and select an available slot.')}
            </p>
            <Button
              variant="primary"
              size="sm"
              className="mt-4"
              onClick={() => window.location.href = '/booking'}
            >
              {locale === 'ar' ? 'العودة للاختيار' : 'Back to Selection'}
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (fatalError) {
    // UX-001: these are payment-STARTUP failures (network drop, intent/session
    // create failed) — the checkout never began, so NO charge occurred. Give the
    // customer an idempotent retry (re-creates the intent for the SAME booking)
    // and a safe way back to their bookings, instead of a dead end. `virtual_pay`
    // is tester-only; a reload is its simplest safe retry.
    const retry = () => {
      if (fatalError === 'virtual_pay_failed') {
        window.location.reload();
        return;
      }
      setFatalError(null);
      setIsMpgs(false);
      setRetryKey((k) => k + 1);
    };
    return (
      <Card variant="glass">
        <CardBody className="flex flex-col items-center gap-6 py-10 text-center">
          <ErrorIllustration type="error" />
          <div className="space-y-2">
            <p className="text-sm font-bold text-gold-700 uppercase tracking-widest">
              {locale === 'ar' ? 'تعذّر بدء الدفع' : 'Couldn’t start payment'}
            </p>
            {/* Friendly copy only — the raw internal code (`fatalError`) is NOT shown
                to the customer; it stays in component state for DevTools/logging. */}
            <p className="text-sm text-muted-foreground">
              {locale === 'ar'
                ? 'لم يبدأ الدفع ولم يتم خصم أي مبلغ. تحقّق من اتصالك وحاول مرة أخرى.'
                : 'Payment didn’t start and no charge was made. Check your connection and try again.'}
            </p>
            <div className="mt-4 flex flex-col items-center gap-2">
              <Button variant="primary" size="sm" onClick={retry} loading={isPending}>
                {locale === 'ar' ? 'إعادة المحاولة' : 'Try again'}
              </Button>
              <button
                type="button"
                onClick={() => (window.location.href = '/bookings')}
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                {locale === 'ar' ? 'العودة إلى حجوزاتي' : 'Back to my bookings'}
              </button>
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  // Crédit Agricole Egypt (MPGS): pay in an on-page Lightbox popup — the customer
  // stays on our site; card data is entered on Mastercard's hosted form.
  if (isMpgs) {
    return (
      <MpgsLightbox
        bookingId={bookingId}
        reference={reference}
        totalCents={totalCents}
        insuranceCents={insuranceCents}
        currency={currency}
        locale={locale}
      />
    );
  }

  return (
    <Card>
      <CardBody className="text-center text-sm text-muted-foreground">{tCommon('loading')}</CardBody>
    </Card>
  );
}

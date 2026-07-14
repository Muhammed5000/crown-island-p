'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { commitBooking } from '@/features/booking/actions';
import { ErrorIllustration } from '@/components/ui/ErrorIllustration';

interface Props {
  serviceId: string;
  date: string;
  endDate?: string;
  adults: number;
  childCount: number;
  extraPersons: number;
  cars: number;
  totalCents: number;
  locale: 'ar' | 'en';
  userId: string;
}

function makeRequestId(userId: string) {
  // Lazy-init only; never recomputed across re-renders. Safe from the purity rule.
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${userId}-${random}`;
}

/**
 * Final confirm action. Calls the transactional `commitBooking` server action,
 * forwarding the **server-quoted** totalCents as `expectedTotalCents` so an
 * out-of-band price change throws PriceChangedError back to the user.
 */
export function ConfirmButton({
  serviceId,
  date,
  endDate,
  adults,
  childCount,
  extraPersons,
  cars,
  totalCents,
  locale,
  userId,
}: Props) {
  const t = useTranslations('booking');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Idempotency key — generated once per component instance. Retries reuse it;
  // a full page refresh creates a fresh instance and therefore a fresh booking.
  const [clientRequestId] = useState(() => makeRequestId(userId));

  function onClick() {
    setError(null);
    startTransition(async () => {
      let res;
      try {
        res = await commitBooking({
          serviceId,
          date,
          endDate,
          adults,
          children: childCount,
          extraPersons,
          cars,
          clientRequestId,
          expectedTotalCents: totalCents,
          locale,
        });
      } catch {
        // A transient failure (network / a rejected preflight before the action's
        // own try/catch) must surface a retry-able error, not clear the spinner
        // silently and leave the button looking dead.
        setError(tCommon('error'));
        return;
      }
      if (!res.ok) {
        switch (res.code) {
          case 'capacity_people':
          case 'capacity_cars':
          case 'capacity_max_per_booking_people':
          case 'capacity_max_per_booking_cars':
            setError(t('errors.capacity'));
            break;
          case 'capacity_max_extra_persons':
            setError(t('errors.maxExtraPersons'));
            break;
          case 'price_changed':
            setError(t('errors.priceChanged'));
            break;
          case 'past_date':
            setError(t('errors.pastDate'));
            break;
          case 'service_inactive':
            setError(t('errors.serviceInactive'));
            break;
          case 'bookings_disabled':
          case 'sync_offline':
            setError(t('errors.bookingsDisabled'));
            break;
          case 'lead_time':
            setError(t('errors.leadTime'));
            break;
          default:
            setError(tCommon('error'));
        }
        return;
      }
      router.push(`/booking/payment?bid=${res.bookingId}`);
    });
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-danger/20 bg-danger/5 p-6 text-center animate-fade-in">
          <ErrorIllustration type="storm" className="size-20 opacity-80" />
          <p className="text-sm font-medium text-danger" role="alert">
            {error}
          </p>
        </div>
      ) : null}
      
      <Button
        type="button"
        variant="primary"
        size="lg"
        fullWidth
        loading={isPending}
        onClick={onClick}
      >
        {t('payNow')}
      </Button>
    </div>
  );
}

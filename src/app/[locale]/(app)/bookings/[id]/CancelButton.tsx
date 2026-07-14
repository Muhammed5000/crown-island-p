'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { cancelMyBooking } from '@/features/booking/bookings-actions';

/** Map a server-action code to a localized message via the booking namespace. */
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

interface Props {
  bookingId: string;
}

export function CancelButton({ bookingId }: Props) {
  const tCommon = useTranslations('common');
  const tBooking = useTranslations('booking');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function doCancel() {
    setError(null);
    startTransition(async () => {
      const res = await cancelMyBooking({ bookingId });
      if (!res.ok) {
        const key = pickCancelErrorKey(res.code);
        setError(key ? tBooking(key) : tCommon('error'));
        return;
      }
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="md"
        fullWidth
        onClick={() => setConfirming(true)}
      >
        {tCommon('cancel')}
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={() => setConfirming(false)}
        >
          {tCommon('back')}
        </Button>
        <Button
          type="button"
          variant="danger"
          size="md"
          fullWidth
          loading={isPending}
          onClick={doCancel}
        >
          {tCommon('confirm')}
        </Button>
      </div>
      {error ? (
        <p className="text-center text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { cancelBookingPayment } from '@/features/admin/bookings-actions';

interface Props {
  bookingId: string;
  /** Optional compact mode for table rows (no expanded confirm panel). */
  compact?: boolean;
}

/**
 * Two-step admin button: first click reveals a confirm pair, second click
 * executes. Mirrors `RefundButton` so the booking-detail page renders the
 * two actions with the same affordance.
 *
 * The action is idempotent on the server, so a double-click or a stale
 * tab can't double-cancel anything — we still gate the UI for clarity.
 */
export function CancelPaymentButton({ bookingId, compact = false }: Props) {
  const tCommon = useTranslations('common');
  const tAdmin = useTranslations('admin');
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function go() {
    setResult(null);
    startTransition(async () => {
      const res = await cancelBookingPayment({ bookingId });
      if (!res.ok) {
        setResult({ ok: false, message: res.code });
      } else {
        setResult({
          ok: true,
          message: res.alreadyCancelled ? tAdmin('alreadyCancelled') : tAdmin('cancelled'),
        });
      }
    });
  }

  if (!confirming) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(true)}
        aria-label={tAdmin('cancelPayment')}
      >
        {compact ? tCommon('cancel') : tAdmin('cancelPayment')}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        {tCommon('back')}
      </Button>
      <Button variant="danger" size="sm" loading={isPending} onClick={go}>
        {tCommon('confirm')}
      </Button>
      {result ? (
        <span className={result.ok ? 'text-xs text-success' : 'text-xs text-danger'}>
          {result.message}
        </span>
      ) : null}
    </div>
  );
}

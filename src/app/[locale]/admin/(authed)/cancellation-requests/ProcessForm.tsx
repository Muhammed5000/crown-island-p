'use client';

import { useState, useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { processCancellationRequestAction } from '@/features/admin/cancellation-actions';

/**
 * Approve (refund the LOCKED amount + cancel the booking) or reject a pending
 * cancellation request. Approve is two-step because it moves money.
 */
export function ProcessForm({
  requestId,
  lockedRefundLabel,
}: {
  requestId: string;
  lockedRefundLabel: string;
}) {
  const t = useTranslations('adminCancellations');
  const router = useRouter();
  const [note, setNote] = useState('');
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (decision: 'APPROVE' | 'REJECT') => {
    setError(null);
    startTransition(async () => {
      const res = await processCancellationRequestAction({
        requestId,
        decision,
        adminNote: note.trim() || undefined,
      });
      if (res.ok) router.refresh();
      else setError(t('errorGeneric'));
    });
  };

  return (
    <div className="space-y-3">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 500))}
        rows={3}
        maxLength={500}
        placeholder={t('notePlaceholder')}
        className="w-full resize-none rounded-2xl border border-border/50 bg-background/60 p-3 text-sm text-foreground outline-none transition-colors focus:border-gold-400"
      />
      <div className="flex flex-wrap gap-2">
        {confirmApprove ? (
          <>
            <button
              type="button"
              onClick={() => run('APPROVE')}
              disabled={pending}
              className="rounded-2xl bg-emerald-600 px-4 py-2.5 font-bold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {t('confirmApprove', { amount: lockedRefundLabel })}
            </button>
            <button
              type="button"
              onClick={() => setConfirmApprove(false)}
              disabled={pending}
              className="rounded-2xl border border-border/60 px-4 py-2.5 font-semibold text-foreground transition-colors hover:bg-muted/60 disabled:opacity-50"
            >
              {t('back')}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmApprove(true)}
            disabled={pending}
            className="rounded-2xl bg-emerald-600 px-4 py-2.5 font-bold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {t('approve')}
          </button>
        )}
        <button
          type="button"
          onClick={() => run('REJECT')}
          disabled={pending}
          className="rounded-2xl bg-red-600 px-4 py-2.5 font-bold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {t('reject')}
        </button>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

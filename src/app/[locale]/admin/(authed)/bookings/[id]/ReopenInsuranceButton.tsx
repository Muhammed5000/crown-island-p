'use client';

import { useState, useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { reopenInsuranceDecisionAction } from '@/features/admin/insurance-actions';

/**
 * Admin correction on the booking detail: NO_REFUND → UNDECIDED (e.g. the
 * guest successfully disputed the retention). Reason is mandatory; the server
 * refuses when a completed/active payout already exists.
 */
export function ReopenInsuranceButton({ bookingId }: { bookingId: string }) {
  const t = useTranslations('adminInsurance');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    if (!reason.trim()) {
      setError(t('errorNoteRequired'));
      return;
    }
    startTransition(async () => {
      const res = await reopenInsuranceDecisionAction({ bookingId, reason: reason.trim() });
      if (res.ok) {
        setOpen(false);
        setReason('');
        router.refresh();
      } else {
        setError(
          res.code === 'insurance_already_processed' ? t('errorAlreadyProcessed') : t('errorGeneric'),
        );
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl border border-gold-400/30 px-3 py-1.5 text-xs font-medium text-gold-700 hover:bg-gold-400/10"
      >
        {t('reopenDecision')}
      </button>
    );
  }

  return (
    <div className="w-full space-y-2">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value.slice(0, 500))}
        rows={2}
        maxLength={500}
        placeholder={t('reopenReasonPlaceholder')}
        className="w-full resize-none rounded-2xl border border-border/50 bg-background/60 p-3 text-sm text-foreground outline-none transition-colors focus:border-gold-400"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {t('reopenConfirm')}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="rounded-2xl border border-border/60 px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted/60 disabled:opacity-50"
        >
          {t('back')}
        </button>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

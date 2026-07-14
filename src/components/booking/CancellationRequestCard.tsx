'use client';

import { useState, useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import {
  requestCancellationAction,
  withdrawCancellationAction,
} from '@/features/booking/cancellation-actions';

export interface CancellationRequestView {
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
  requestedAtLabel: string;
  lockedPercent: number;
  lockedRefundLabel: string;
  adminNote: string | null;
}

interface Props {
  bookingId: string;
  scheduleLines: string[];
  previewPercent: number;
  previewRefundLabel: string;
  request: CancellationRequestView | null;
}

/**
 * Customer control for cancelling a PAID booking. Submitting a request FREEZES
 * the refund tier at that moment (server-side) — the copy makes that promise
 * explicit. A pending request can be withdrawn; a declined/withdrawn one can be
 * re-submitted. Reception still processes the actual refund.
 */
export function CancellationRequestCard({
  bookingId,
  scheduleLines,
  previewPercent,
  previewRefundLabel,
  request,
}: Props) {
  const t = useTranslations('cancellation');
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await requestCancellationAction({ bookingId, reason: reason.trim() || undefined });
      if (res.ok) {
        setExpanded(false);
        setReason('');
        router.refresh();
      } else {
        setError(t('errorGeneric'));
      }
    });
  };

  const withdraw = () => {
    setError(null);
    startTransition(async () => {
      const res = await withdrawCancellationAction({ bookingId });
      if (res.ok) router.refresh();
      else setError(t('errorGeneric'));
    });
  };

  const isPending = request?.status === 'PENDING';
  // A declined / withdrawn request no longer blocks a fresh submission.
  const showRequestUi = !isPending;

  return (
    <div className="rounded-2xl border border-gold-400/30 bg-gold-400/5 p-4 text-sm">
      <h3 className="font-display text-base text-gold-700">{t('title')}</h3>

      {/* Pending request — awaiting reception, with the FROZEN refund shown. */}
      {isPending && request ? (
        <div className="mt-2 space-y-3">
          <div className="rounded-xl bg-card px-3 py-2">
            <p className="font-semibold text-foreground">{t('pendingTitle')}</p>
            <p className="mt-1 text-muted-foreground">
              {t('pendingBody', {
                date: request.requestedAtLabel,
                percent: request.lockedPercent,
                amount: request.lockedRefundLabel,
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={withdraw}
            disabled={pending}
            className="h-11 w-full rounded-2xl border border-border/60 font-semibold text-foreground transition-colors hover:bg-muted/60 disabled:opacity-50"
          >
            {t('withdrawButton')}
          </button>
        </div>
      ) : null}

      {/* No live request — show the policy + let the customer request one. */}
      {showRequestUi ? (
        <div className="mt-2 space-y-3">
          {request?.status === 'REJECTED' ? (
            <div className="rounded-xl border border-red-400/30 bg-red-400/5 px-3 py-2">
              <p className="font-semibold text-red-600">{t('rejectedTitle')}</p>
              {request.adminNote ? (
                <p className="mt-1 text-muted-foreground">{request.adminNote}</p>
              ) : null}
            </div>
          ) : null}

          <p className="text-muted-foreground">{t('policyIntro')}</p>
          <ul className="space-y-1 text-foreground">
            {scheduleLines.map((l, i) => (
              <li key={i}>• {l}</li>
            ))}
          </ul>
          <p className="rounded-xl bg-card px-3 py-2 text-foreground">
            {t('previewNow')}{' '}
            <span className="font-semibold">{previewPercent}%</span>
            {' — '}
            <span className="font-semibold tabular-nums">{previewRefundLabel}</span>
          </p>

          {expanded ? (
            <div className="space-y-2">
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, 500))}
                rows={3}
                maxLength={500}
                placeholder={t('reasonPlaceholder')}
                className="w-full resize-none rounded-2xl border border-border/50 bg-background/60 p-3 text-sm text-foreground outline-none transition-colors focus:border-gold-400"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={submit}
                  disabled={pending}
                  className="h-11 flex-1 rounded-2xl bg-primary font-bold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {t('confirmButton')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExpanded(false);
                    setError(null);
                  }}
                  disabled={pending}
                  className="h-11 rounded-2xl border border-border/60 px-4 font-semibold text-foreground transition-colors hover:bg-muted/60 disabled:opacity-50"
                >
                  {t('back')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="h-11 w-full rounded-2xl border border-red-400/50 font-semibold text-red-600 transition-colors hover:bg-red-400/10"
            >
              {t('requestButton')}
            </button>
          )}
        </div>
      ) : null}

      {error ? <p className="mt-2 text-red-600">{error}</p> : null}
    </div>
  );
}

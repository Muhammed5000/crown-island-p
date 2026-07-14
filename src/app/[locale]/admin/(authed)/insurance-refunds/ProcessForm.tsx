'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import {
  approveInsuranceRefundAction,
  rejectInsuranceRefundAction,
  retryInsuranceRefundAction,
  completeDeskRefundByAdminAction,
  type InsuranceAdminResult,
} from '@/features/admin/insurance-actions';

type ActionableStatus = 'AWAITING_ADMIN' | 'PENDING_DESK' | 'FAILED' | 'MANUAL_ATTENTION';

/** Error codes with a specific message; everything else falls back to generic. */
const ERROR_KEYS: Record<string, string> = {
  insurance_already_processed: 'errorAlreadyProcessed',
  online_owned: 'errorOnlineOwned',
  insurance_over_refund: 'errorOverRefund',
  no_refundable_payment: 'errorNoPayment',
  insurance_refund_method_mismatch: 'errorMethodMismatch',
  insurance_reason_required: 'errorNoteRequired',
  insurance_proof_required: 'errorProofRequired',
};

/**
 * State-driven actions for one insurance-refund attempt. Approve is two-step
 * (it moves money through the gateway and cannot be undone); Reject always
 * requires a note; a stale PENDING_DESK payout can be completed remotely by
 * InstaPay with a mandatory transfer-proof image.
 */
export function ProcessForm({
  insuranceRefundId,
  status,
  amountLabel,
}: {
  insuranceRefundId: string;
  status: ActionableStatus;
  amountLabel: string;
}) {
  const t = useTranslations('adminInsurance');
  const router = useRouter();
  const [note, setNote] = useState('');
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [confirmDesk, setConfirmDesk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const busy = pending || uploading;

  const handle = (res: InsuranceAdminResult, successInfo?: string) => {
    if (res.ok) {
      if (successInfo) setInfo(successInfo);
      router.refresh();
    } else {
      const key = ERROR_KEYS[res.code];
      setError(key ? t(key) : t('errorGeneric'));
      // Double-submit / another admin won the race — the page state is stale.
      if (res.code === 'insurance_already_processed') router.refresh();
    }
  };

  const approve = () => {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const res = await approveInsuranceRefundAction({ insuranceRefundId });
      if (res.ok && res.status === 'FAILED') {
        setInfo(t('approveGatewayFailed'));
        router.refresh();
        return;
      }
      handle(res, t('approveDone'));
    });
  };

  const reject = () => {
    setError(null);
    setInfo(null);
    if (!note.trim()) {
      setError(t('errorNoteRequired'));
      return;
    }
    startTransition(async () => {
      handle(await rejectInsuranceRefundAction({ insuranceRefundId, note: note.trim() }));
    });
  };

  const retry = () => {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      handle(await retryInsuranceRefundAction({ insuranceRefundId }), t('retryDone'));
    });
  };

  const completeDeskByInstaPay = async () => {
    setError(null);
    setInfo(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError(t('errorProofRequired'));
      return;
    }
    setUploading(true);
    let proofUrl: string;
    try {
      // Proofs are SENSITIVE: the reception upload stores them in the private
      // secure-media root (admins pass its role gate). /api/admin/upload is
      // public storage and is deliberately NOT used here.
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/reception/upload', { method: 'POST', body: fd });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; url?: string } | null;
      if (!res.ok || !data?.ok || !data.url) {
        setError(t('errorUploadFailed'));
        return;
      }
      proofUrl = data.url;
    } catch {
      setError(t('errorUploadFailed'));
      return;
    } finally {
      setUploading(false);
    }
    startTransition(async () => {
      handle(
        await completeDeskRefundByAdminAction({ insuranceRefundId, proofUrl }),
        t('deskCompleteDone'),
      );
    });
  };

  const primaryBtn =
    'rounded-2xl bg-emerald-600 px-4 py-2.5 font-bold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50';
  const dangerBtn =
    'rounded-2xl bg-red-600 px-4 py-2.5 font-bold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50';
  const neutralBtn =
    'rounded-2xl border border-border/60 px-4 py-2.5 font-semibold text-foreground transition-colors hover:bg-muted/60 disabled:opacity-50';

  return (
    <div className="space-y-3">
      {status === 'PENDING_DESK' ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('deskPendingInfo')}</p>
          <div className="rounded-2xl border border-border/50 bg-background/60 p-4">
            <p className="mb-2 text-sm font-semibold text-foreground">{t('deskCompleteTitle')}</p>
            <p className="mb-3 text-xs text-muted-foreground">{t('deskCompleteHint')}</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
              disabled={busy}
              onChange={() => setConfirmDesk(false)}
              className="mb-3 block w-full text-sm text-muted-foreground file:me-3 file:rounded-xl file:border-0 file:bg-muted/60 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-foreground"
            />
            <div className="flex flex-wrap gap-2">
              {confirmDesk ? (
                <>
                  <button type="button" onClick={completeDeskByInstaPay} disabled={busy} className={primaryBtn}>
                    {uploading ? t('uploading') : t('confirmDeskComplete', { amount: amountLabel })}
                  </button>
                  <button type="button" onClick={() => setConfirmDesk(false)} disabled={busy} className={neutralBtn}>
                    {t('back')}
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmDesk(true)} disabled={busy} className={primaryBtn}>
                  {t('deskCompleteButton')}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            rows={3}
            maxLength={500}
            placeholder={t('notePlaceholder')}
            className="w-full resize-none rounded-2xl border border-border/50 bg-background/60 p-3 text-sm text-foreground outline-none transition-colors focus:border-gold-400"
          />
          <div className="flex flex-wrap gap-2">
            {status === 'AWAITING_ADMIN' ? (
              confirmApprove ? (
                <>
                  <button type="button" onClick={approve} disabled={busy} className={primaryBtn}>
                    {t('confirmApprove', { amount: amountLabel })}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmApprove(false)}
                    disabled={busy}
                    className={neutralBtn}
                  >
                    {t('back')}
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmApprove(true)} disabled={busy} className={primaryBtn}>
                  {t('approve')}
                </button>
              )
            ) : (
              <button type="button" onClick={retry} disabled={busy} className={primaryBtn}>
                {t('retry')}
              </button>
            )}
            <button type="button" onClick={reject} disabled={busy} className={dangerBtn}>
              {t('reject')}
            </button>
          </div>
        </>
      )}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {info ? <p className="text-sm text-emerald-700">{info}</p> : null}
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { refundBooking } from '@/features/admin/bookings-actions';
import { formatMoney, centsToMajor, majorToCents } from '@/lib/money';

interface Props {
  bookingId: string;
  locale: 'ar' | 'en';
  /** Policy-computed refund for the current lead time. */
  eligiblePercent: number;
  eligibleRefundCents: number;
  /** Most that can still be refunded (invoice total minus prior refunds). */
  maxRefundCents: number;
  hoursUntil: number;
  /** Offline payment (cash/instapay) — money is handed back at the desk. */
  isOffline: boolean;
}

/**
 * Cancel + refund a booking per the tiered policy. Shows the policy breakdown,
 * lets staff override the amount (which requires a reason), and confirms the
 * outcome — including the "keep the money" 0% case.
 */
export function RefundButton({
  bookingId,
  locale,
  eligiblePercent,
  eligibleRefundCents,
  maxRefundCents,
  hoursUntil,
  isOffline,
}: Props) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [amountMajor, setAmountMajor] = useState(String(centsToMajor(eligibleRefundCents)));
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; error?: string; refundedCents?: number } | null>(null);

  const money = (cents: number) => formatMoney(cents, { locale, currency: 'EGP' });
  const amountCents = Math.round(majorToCents(Number(amountMajor)));
  const validNumber = Number.isFinite(amountCents) && amountCents >= 0;
  const overCap = validNumber && amountCents > maxRefundCents;
  const isOverride = validNumber && amountCents !== eligibleRefundCents;
  const reasonRequired = isOverride && !reason.trim();
  const canSubmit = validNumber && !overCap && !reasonRequired;

  function leadTimeText(): string {
    if (hoursUntil < 0) return locale === 'ar' ? 'انقضى موعد الزيارة (عدم حضور)' : 'Visit date passed (no-show)';
    const h = Math.floor(hoursUntil);
    const d = Math.floor(h / 24);
    const rem = h % 24;
    if (locale === 'ar') return d > 0 ? `${d} يوم ${rem} ساعة حتى الزيارة` : `${rem} ساعة حتى الزيارة`;
    return d > 0 ? `${d}d ${rem}h until visit` : `${rem}h until visit`;
  }

  function getErrorMessage(code?: string) {
    if (!code) return t('error_unknown');
    if (code === 'refund_reason_required')
      return locale === 'ar' ? 'يجب إدخال سبب عند تغيير المبلغ.' : 'A reason is required when overriding the amount.';
    const baseCode = code.split(':')[0] || 'unknown';
    try {
      return t(`error_${baseCode}`);
    } catch {
      return t('error_unknown');
    }
  }

  function go() {
    if (!canSubmit) return;
    startTransition(async () => {
      const res = await refundBooking({
        bookingId,
        reason: reason.trim() || undefined,
        // Only send an override when the amount actually differs from the policy
        // figure — otherwise the unchanged tier amount would demand a reason.
        overrideAmountCents: isOverride ? amountCents : undefined,
      });
      setStatus(res.ok ? { ok: true, refundedCents: res.refundedCents } : { ok: false, error: res.code });
      setOpen(false);
    });
  }

  const zeroRefund = amountCents === 0;

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {tCommon('refund')}
      </Button>

      {/* Refund form */}
      <Modal isOpen={open} onClose={() => setOpen(false)} title={tCommon('refund')}>
        <div className="space-y-4 pt-2">
          <div className="rounded-xl bg-muted/40 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{leadTimeText()}</span>
              <span className="font-semibold text-foreground">{eligiblePercent}% policy refund</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-muted-foreground">Eligible refund</span>
              <span className="tabular-nums text-foreground">{money(eligibleRefundCents)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-muted-foreground">Withheld (penalty)</span>
              <span className="tabular-nums text-foreground">{money(Math.max(0, maxRefundCents - eligibleRefundCents))}</span>
            </div>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">
              Refund amount (EGP){isOffline ? ' — cash to return' : ''}
            </span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={amountMajor}
              onChange={(e) => setAmountMajor(e.target.value)}
              className="h-11 w-full rounded-xl border border-border/40 bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
            />
            {overCap ? (
              <span className="mt-1 block text-xs text-danger">
                Cannot exceed the refundable balance ({money(maxRefundCents)}).
              </span>
            ) : isOverride ? (
              <span className="mt-1 block text-xs text-amber-600">
                Overriding the policy amount — a reason is required.
              </span>
            ) : null}
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">
              Reason {isOverride ? '(required)' : '(optional)'}
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="w-full rounded-xl border border-border/40 bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder={isOverride ? 'e.g. weather closure / goodwill' : ''}
            />
          </label>

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {tCommon('back')}
            </Button>
            <Button variant="danger" size="sm" loading={isPending} disabled={!canSubmit} onClick={go}>
              {zeroRefund
                ? locale === 'ar' ? 'إلغاء بدون استرداد' : 'Cancel (no refund)'
                : `${tCommon('refund')} ${money(amountCents || 0)}`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Result */}
      <Modal
        isOpen={status !== null}
        onClose={() => setStatus(null)}
        title={status?.ok ? tCommon('confirm') : tCommon('error')}
      >
        <div className="space-y-4 pt-2">
          <p className="text-sm text-foreground">
            {status?.ok
              ? status.refundedCents === 0
                ? locale === 'ar'
                  ? 'تم إلغاء الحجز دون استرداد أي مبلغ (حسب السياسة).'
                  : 'Booking cancelled with no refund (per policy).'
                : `${t('refundSuccess')} — ${money(status.refundedCents ?? 0)}`
              : t('refundFailed', { error: getErrorMessage(status?.error) })}
          </p>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setStatus(null)}>
              {tCommon('close')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

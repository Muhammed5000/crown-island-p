import { getRefundTiers } from '@/server/settings/settings';
import { computeTieredRefund, formatRefundTiers } from '@/lib/refund-policy';
import { formatMoney } from '@/lib/money';

interface Props {
  bookingDate: Date;
  totalCents: number;
  locale: 'ar' | 'en';
}

/**
 * Customer-facing refund policy for a PAID booking. Shows the full schedule and
 * exactly what the guest would get if they cancelled right now — both rendered
 * from the SAME `getRefundTiers()` the system enforces, so the numbers can't
 * drift. Paid cancellations are handled by reception, so this replaces the
 * self-cancel button rather than accompanying it.
 */
export async function RefundPolicyNotice({ bookingDate, totalCents, locale }: Props) {
  const tiers = await getRefundTiers();
  const preview = computeTieredRefund({ bookingDate, totalCents, tiers });
  const lines = formatRefundTiers(tiers, locale);
  const money = (c: number) => formatMoney(c, { locale, currency: 'EGP' });
  const ar = locale === 'ar';

  return (
    <div className="rounded-2xl border border-gold-400/30 bg-gold-400/5 p-4 text-sm">
      <h3 className="font-display text-base text-gold-700">{ar ? 'سياسة الاسترداد' : 'Refund policy'}</h3>
      <p className="mt-1 text-muted-foreground">
        {ar
          ? 'لإلغاء حجز مدفوع، يُرجى التواصل مع الاستقبال. يتم الاسترداد وفقًا للجدول التالي:'
          : 'To cancel a paid booking, please contact reception. Refunds follow the schedule below:'}
      </p>
      <ul className="mt-2 space-y-1 text-foreground">
        {lines.map((l, i) => (
          <li key={i}>• {l}</li>
        ))}
      </ul>
      {totalCents > 0 ? (
        <p className="mt-3 rounded-xl bg-card px-3 py-2 text-foreground">
          {ar ? 'لو ألغيت الآن: ' : 'If you cancel now: '}
          <span className="font-semibold">{preview.percent}%</span>
          {' — '}
          <span className="font-semibold tabular-nums">{money(preview.refundCents)}</span>
        </p>
      ) : null}
    </div>
  );
}

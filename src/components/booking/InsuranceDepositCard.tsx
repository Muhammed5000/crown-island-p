import { ShieldCheckIcon } from 'lucide-react';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';

interface Props {
  /** t('insuranceDeposit') */
  title: string;
  /** Formatted deposit amount (formatMoney). */
  amountLabel: string;
  /** Customer-state chip text (insuranceCollected / insuranceRefundPending / …). */
  statusLabel: string;
  statusTone: BadgeTone;
  /** Context line under the amount (returned-at-checkout / retained / card delay…). */
  hint?: string;
  /** Refund method line, shown when the deposit was refunded. */
  methodLabel?: string;
  /** "Refunded on {date}" line, shown when the deposit was refunded. */
  dateLabel?: string;
}

/**
 * Customer "Insurance deposit" panel — booking detail (mobile column and,
 * as a passed-in node, the desktop redesign). Pure presentation: every string
 * is resolved server-side (locale + money formatting), so it renders
 * identically as a server or client child and stays RTL-safe via logical
 * flex/text utilities.
 */
export function InsuranceDepositCard({
  title,
  amountLabel,
  statusLabel,
  statusTone,
  hint,
  methodLabel,
  dateLabel,
}: Props) {
  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-base text-gold-700">
          <ShieldCheckIcon className="size-4" />
          {title}
        </h2>
        <Badge tone={statusTone}>{statusLabel}</Badge>
      </CardHeader>
      <CardBody className="space-y-2">
        <p className="font-display text-xl font-semibold tabular-nums text-foreground">
          {amountLabel}
        </p>
        {methodLabel ? <p className="text-sm text-foreground">{methodLabel}</p> : null}
        {dateLabel ? <p className="text-xs text-muted-foreground">{dateLabel}</p> : null}
        {hint ? (
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">{hint}</p>
        ) : null}
      </CardBody>
    </Card>
  );
}

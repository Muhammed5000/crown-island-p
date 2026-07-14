import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ProcessForm } from '../ProcessForm';
import { STATUS_TONE, ageLabel, ageDays } from '../insurance-ui';
import { getInsuranceRefundForAdmin } from '@/server/services/insurance-admin';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/date';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

/** Desk payouts older than this are flagged loudly (guest likely can't return). */
const STALE_DESK_DAYS = 7;

export default async function InsuranceRefundDetailPage({ params }: Props) {
  const { locale, id } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const [refund, t] = await Promise.all([
    getInsuranceRefundForAdmin(id),
    getTranslations('adminInsurance'),
  ]);
  if (!refund) notFound();
  const ar = locale === 'ar';
  const money = (c: number) => formatMoney(c, { locale, currency: 'EGP' });
  const now = new Date();
  const deskAgeDays = ageDays(refund.createdAt, now);
  const staleDesk = refund.status === 'PENDING_DESK' && deskAgeDays > STALE_DESK_DAYS;
  const ins = refund.insurance;

  return (
    <div className="space-y-6">
      <Link
        href="/admin/insurance-refunds"
        className="text-sm text-accent underline-offset-4 hover:underline"
      >
        ← {t('backToList')}
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-gold-700">
            {t('detailTitle', { reference: refund.booking.reference })}
          </h1>
          <p className="text-xs text-muted-foreground">
            {t('requestedOn', { date: formatDate(refund.createdAt, locale) })}
            {refund.requestedByName ? ` · ${refund.requestedByName}` : null}
          </p>
        </div>
        <span className="inline-flex items-center gap-2">
          <Badge tone={STATUS_TONE[refund.status]}>{t(`status${refund.status}`)}</Badge>
          <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
            {ageLabel(refund.createdAt, now)}
          </span>
        </span>
      </header>

      {/* Loud warning for rows the machine could not resolve on its own. */}
      {refund.status === 'MANUAL_ATTENTION' ? (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">
          <p className="font-bold">{t('manualAttentionTitle')}</p>
          <p className="mt-1">{refund.failureMessage ?? t('manualAttentionBody')}</p>
        </div>
      ) : null}
      {staleDesk ? (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
          {t('staleDeskWarning', { days: deskAgeDays })}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Deposit snapshot + collection */}
        <Card>
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('depositInfo')}</h2>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <Row label={t('guest')} value={refund.booking.guestName ?? '—'} />
            <Row
              label={t('service')}
              value={ar ? refund.booking.service.nameAr : refund.booking.service.nameEn}
            />
            <Row label={t('visitDate')} value={formatDate(refund.booking.bookingDate, locale)} />
            <Row
              label={t('depositConfig')}
              value={
                ins.type === 'PERCENT'
                  ? t('percentOfBase', { percent: ins.percent ?? 0, base: money(ins.baseCents) })
                  : t('fixedAmount', { amount: money(ins.fixedCents ?? 0) })
              }
            />
            <Row label={t('depositAmount')} value={money(ins.amountCents)} />
            <Row
              label={t('collection')}
              value={`${t(`collection${ins.collectionStatus}`)}${
                ins.collectedAt ? ` · ${formatDate(ins.collectedAt, locale)}` : ''
              }`}
            />
            <Row label={t('colPaidVia')} value={ins.paidVia ? t(`paidVia${ins.paidVia}`) : '—'} />
            <Row label={t('refundedSoFar')} value={money(refund.insuranceRefundedCents)} />
            <div className="pt-1">
              <Link
                href={`/admin/bookings/${refund.booking.id}`}
                className="text-xs text-accent underline-offset-4 hover:underline"
              >
                {t('openBooking')} →
              </Link>
            </div>
          </CardBody>
        </Card>

        {/* Decision + payment context */}
        <Card>
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('decisionAndPayment')}</h2>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <Row
              label={t('decision')}
              value={`${t(`decision${ins.decision}`)}${
                ins.decidedAt ? ` · ${formatDate(ins.decidedAt, locale)}` : ''
              }`}
            />
            {ins.decidedByName ? <Row label={t('decidedBy')} value={ins.decidedByName} /> : null}
            {ins.noRefundReason ? <Row label={t('noRefundReason')} value={ins.noRefundReason} /> : null}
            <Row label={t('refundMethod')} value={t(`method${refund.method}`)} />
            <div className="flex items-center justify-between rounded-xl bg-gold-400/10 px-3 py-2">
              <span className="text-muted-foreground">{t('refundAmount')}</span>
              <span className="font-bold tabular-nums text-gold-700">{money(refund.amountCents)}</span>
            </div>
            {refund.payment ? (
              <>
                <Row
                  label={t('payment')}
                  value={`${refund.payment.provider} · ${money(refund.payment.amountCents)}`}
                />
                <Row label={t('paymentStatus')} value={refund.payment.status} muted />
                {refund.method === 'PROVIDER' && !refund.payment.hasProviderOrder ? (
                  <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700">
                    {t('noProviderOrder')}
                  </p>
                ) : null}
              </>
            ) : (
              <Row label={t('payment')} value="—" muted />
            )}
            {refund.serviceRefundedCents > 0 ? (
              <Row label={t('serviceRefunded')} value={money(refund.serviceRefundedCents)} muted />
            ) : null}
            {refund.failureMessage && refund.status !== 'MANUAL_ATTENTION' ? (
              <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700">
                {t('failureMessage')}: {refund.failureMessage}
                {refund.status === 'FAILED' ? ` · ${t('attemptCount', { count: refund.attempt })}` : ''}
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>

      {/* InstaPay payout proof — same-origin secure-media (admin authz). */}
      {refund.proofUrl ? (
        <Card>
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('proofTitle')}</h2>
          </CardHeader>
          <CardBody>
            <a href={refund.proofUrl} target="_blank" rel="noreferrer" className="inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={refund.proofUrl}
                alt={t('proofTitle')}
                className="max-h-64 rounded-xl border border-border/40 object-contain"
              />
            </a>
          </CardBody>
        </Card>
      ) : null}

      {/* Attempts history — every row for this deposit, oldest first. */}
      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-700">{t('attemptsTitle')}</h2>
        </CardHeader>
        <CardBody className="p-0">
          <ul className="divide-y divide-border/40">
            {refund.attempts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <Badge tone={STATUS_TONE[a.status]}>{t(`status${a.status}`)}</Badge>
                <Badge tone={a.method === 'PROVIDER' ? 'navy' : 'gold'}>{t(`method${a.method}`)}</Badge>
                <span className="tabular-nums font-medium text-foreground">{money(a.amountCents)}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(a.createdAt, locale)}
                  {a.completedAt ? ` → ${formatDate(a.completedAt, locale)}` : ''}
                </span>
                {a.requestedByName ? (
                  <span className="text-xs text-muted-foreground">
                    {t('requestedBy')}: {a.requestedByName}
                  </span>
                ) : null}
                {a.approvedByName ? (
                  <span className="text-xs text-muted-foreground">
                    {t('approvedBy')}: {a.approvedByName}
                  </span>
                ) : null}
                {a.failureMessage ? (
                  <span className="w-full text-xs text-red-600">{a.failureMessage}</span>
                ) : null}
                {a.id === refund.id ? (
                  <Badge tone="info">{t('thisAttempt')}</Badge>
                ) : (
                  <Link
                    href={`/admin/insurance-refunds/${a.id}`}
                    className="text-xs text-accent underline-offset-4 hover:underline"
                  >
                    {t('viewAttempt')} →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {/* Actions by state */}
      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-700">{t('actionsTitle')}</h2>
        </CardHeader>
        <CardBody>
          {refund.status === 'AWAITING_ADMIN' ||
          refund.status === 'PENDING_DESK' ||
          refund.status === 'FAILED' ||
          refund.status === 'MANUAL_ATTENTION' ? (
            <ProcessForm
              insuranceRefundId={refund.id}
              status={refund.status}
              amountLabel={money(refund.amountCents)}
            />
          ) : refund.status === 'PROCESSING' ? (
            <p className="text-sm text-muted-foreground">{t('processingInfo')}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('finalOutcome', {
                status: t(`status${refund.status}`),
                date: formatDate(refund.completedAt ?? refund.updatedAt, locale),
              })}
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={muted ? 'text-end tabular-nums text-muted-foreground' : 'text-end font-medium text-foreground'}>
        {value}
      </span>
    </div>
  );
}

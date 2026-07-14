import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { CancellationRequestStatus } from '@prisma/client';
import { Link } from '@/i18n/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { ProcessForm } from '../ProcessForm';
import { getCancellationRequestForAdmin } from '@/server/services/cancellation-request';
import { getRefundTiers } from '@/server/settings/settings';
import { computeTieredRefund } from '@/lib/refund-policy';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/date';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

const STATUS_TONE: Record<CancellationRequestStatus, BadgeTone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'muted',
};

export default async function CancellationRequestDetailPage({ params }: Props) {
  const { locale, id } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const [req, t] = await Promise.all([
    getCancellationRequestForAdmin(id),
    getTranslations('adminCancellations'),
  ]);
  if (!req) notFound();
  const ar = locale === 'ar';
  const money = (c: number) => formatMoney(c, { locale, currency: 'EGP' });

  // What the tier WOULD pay if computed right now — shows how much the freeze
  // protects the guest (the locked amount is what actually gets refunded).
  const tiers = await getRefundTiers();
  const current = computeTieredRefund({
    bookingDate: req.booking.bookingDate,
    totalCents: req.totalCentsAtRequest,
    tiers,
  });
  const protectedByLock = req.lockedRefundCents > current.refundCents;

  return (
    <div className="space-y-6">
      <Link
        href="/admin/cancellation-requests"
        className="text-sm text-accent underline-offset-4 hover:underline"
      >
        ← {t('backToList')}
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-gold-700">
            {t('detailTitle', { reference: req.booking.reference })}
          </h1>
          <p className="text-xs text-muted-foreground">
            {t('requestedOn', { date: formatDate(req.requestedAt, locale) })}
          </p>
        </div>
        <Badge tone={STATUS_TONE[req.status]}>{t(`status${req.status}`)}</Badge>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Request context */}
        <Card>
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('requestInfo')}</h2>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <Row label={t('guest')} value={req.user.name || req.user.email || '—'} />
            <Row label={t('service')} value={ar ? req.booking.service.nameAr : req.booking.service.nameEn} />
            <Row label={t('bookingRef')} value={req.booking.reference} />
            <Row label={t('visitDate')} value={formatDate(req.booking.bookingDate, locale)} />
            <Row label={t('leadTime')} value={t('hoursBefore', { hours: req.hoursBeforeStart })} />
            {req.reason ? <Row label={t('reason')} value={req.reason} /> : null}
          </CardBody>
        </Card>

        {/* Refund breakdown — locked vs current */}
        <Card>
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('refundInfo')}</h2>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <Row label={t('paidTotal')} value={money(req.booking.invoice?.totalCents ?? req.totalCentsAtRequest)} />
            <div className="flex items-center justify-between rounded-xl bg-gold-400/10 px-3 py-2">
              <span className="text-muted-foreground">{t('lockedRefund')}</span>
              <span className="font-bold tabular-nums text-gold-700">
                {req.lockedRefundPercent}% · {money(req.lockedRefundCents)}
              </span>
            </div>
            <Row
              label={t('currentTier')}
              value={`${current.percent}% · ${money(current.refundCents)}`}
              muted
            />
            {protectedByLock ? (
              <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700">
                {t('protectedByLock')}
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>

      {/* Action / outcome */}
      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-700">{t('decision')}</h2>
        </CardHeader>
        <CardBody>
          {req.status === 'PENDING' ? (
            <ProcessForm requestId={req.id} lockedRefundLabel={money(req.lockedRefundCents)} />
          ) : (
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">
                {t('processedOutcome', {
                  status: t(`status${req.status}`),
                  date: req.processedAt ? formatDate(req.processedAt, locale) : '—',
                })}
              </p>
              {req.adminNote ? <p className="text-foreground">{t('note')}: {req.adminNote}</p> : null}
            </div>
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
      <span className={muted ? 'tabular-nums text-muted-foreground' : 'text-end font-medium text-foreground'}>
        {value}
      </span>
    </div>
  );
}

import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { InsuranceRefundStatus } from '@prisma/client';
import { Link } from '@/i18n/navigation';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Pagination } from '@/components/ui/Pagination';
import {
  listInsuranceRefundsForAdmin,
  getInsuranceSummaryForAdmin,
  type AdminInsuranceListStatus,
} from '@/server/services/insurance-admin';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/date';
import { isLocale } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { STATUS_TONE, ageLabel } from './insurance-ui';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Filter tabs → the service's status filter. Default tab = actionable-first view. */
const TABS: { key: string; status: AdminInsuranceListStatus | undefined }[] = [
  { key: 'tabActionable', status: undefined },
  { key: 'tabAwaiting', status: 'AWAITING_ADMIN' },
  { key: 'tabDesk', status: 'PENDING_DESK' },
  { key: 'tabManual', status: 'MANUAL_ATTENTION' },
  { key: 'tabHistory', status: 'HISTORY' },
];

const SUMMARY_ORDER: InsuranceRefundStatus[] = [
  'AWAITING_ADMIN',
  'MANUAL_ATTENTION',
  'PROCESSING',
  'PENDING_DESK',
  'FAILED',
  'COMPLETED',
  'REJECTED',
];

function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function InsuranceRefundsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);
  const sp = await searchParams;
  const ar = locale === 'ar';

  const page = Math.max(1, parseInt(str(sp.page) ?? '1', 10) || 1);
  const statusRaw = str(sp.status);
  const activeTab = TABS.find((tab) => tab.status === statusRaw) ?? TABS[0]!;

  const [list, summary, t] = await Promise.all([
    listInsuranceRefundsForAdmin({ status: activeTab.status, page }),
    getInsuranceSummaryForAdmin(),
    getTranslations('adminInsurance'),
  ]);
  const money = (c: number) => formatMoney(c, { locale, currency: 'EGP' });
  const now = new Date();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-gold-700">{t('title')}</h1>
          <p className="text-xs text-muted-foreground">
            {t('subtitle', { count: summary.AWAITING_ADMIN })}
          </p>
        </div>
      </header>

      {/* Summary chips — one per workflow status. */}
      <div className="flex flex-wrap gap-2">
        {SUMMARY_ORDER.map((s) => (
          <span
            key={s}
            className="inline-flex items-center gap-2 rounded-xl border border-border/50 bg-card/60 px-3 py-1.5 text-xs"
          >
            <Badge tone={STATUS_TONE[s]}>{t(`status${s}`)}</Badge>
            <span className="font-semibold tabular-nums text-foreground">{summary[s]}</span>
          </span>
        ))}
      </div>

      {/* Filter tabs */}
      <nav className="flex flex-wrap gap-2" aria-label={t('title')}>
        {TABS.map((tab) => {
          const active = tab.key === activeTab.key;
          return (
            <Link
              key={tab.key}
              href={
                tab.status
                  ? `/admin/insurance-refunds?status=${tab.status}`
                  : '/admin/insurance-refunds'
              }
              className={cn(
                'rounded-xl border px-3 py-1.5 text-sm transition-colors',
                active
                  ? 'border-accent/50 bg-accent/10 font-semibold text-accent'
                  : 'border-border/60 text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {t(tab.key)}
            </Link>
          );
        })}
      </nav>

      <Card>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{t('colBooking')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('colGuest')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('colService')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('colAmount')}</th>
                <th className="px-4 py-3 text-center font-medium">{t('colMethod')}</th>
                <th className="px-4 py-3 text-center font-medium">{t('colPaidVia')}</th>
                <th className="px-4 py-3 text-center font-medium">{t('colStatus')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('colRequestedBy')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {list.items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                    {t('empty')}
                  </td>
                </tr>
              ) : (
                list.items.map((r) => (
                  <tr key={r.id} className="group hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/insurance-refunds/${r.id}`}
                        dir="ltr"
                        className="font-medium text-accent underline-offset-4 group-hover:underline"
                      >
                        {r.booking.reference}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(r.booking.bookingDate, locale)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.booking.guestName ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {ar ? r.booking.service.nameAr : r.booking.service.nameEn}
                    </td>
                    <td className="px-4 py-3 text-end font-semibold tabular-nums text-foreground">
                      {money(r.amountCents)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge tone={r.method === 'PROVIDER' ? 'navy' : 'gold'}>
                        {t(`method${r.method}`)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.paidVia ? (
                        <Badge tone="muted">{t(`paidVia${r.paidVia}`)}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center gap-1.5">
                        <Badge tone={STATUS_TONE[r.status]}>{t(`status${r.status}`)}</Badge>
                        <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">
                          {ageLabel(r.createdAt, now)}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.requestedByName ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Pagination
        currentPage={list.page}
        totalPages={list.totalPages}
        baseUrl="/admin/insurance-refunds"
        searchParams={sp}
      />
    </div>
  );
}

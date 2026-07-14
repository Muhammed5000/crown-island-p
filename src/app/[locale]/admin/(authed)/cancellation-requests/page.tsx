import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { CancellationRequestStatus } from '@prisma/client';
import { Link } from '@/i18n/navigation';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Pagination } from '@/components/ui/Pagination';
import { listCancellationRequests } from '@/server/services/cancellation-request';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/date';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const STATUS_TONE: Record<CancellationRequestStatus, BadgeTone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'muted',
};

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const;

function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function CancellationRequestsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);
  const sp = await searchParams;
  const ar = locale === 'ar';

  const page = Math.max(1, parseInt(str(sp.page) ?? '1', 10) || 1);
  const statusRaw = str(sp.status);
  const status = STATUSES.includes(statusRaw as CancellationRequestStatus)
    ? (statusRaw as CancellationRequestStatus)
    : undefined;

  const [list, t] = await Promise.all([
    listCancellationRequests({ status, page }),
    getTranslations('adminCancellations'),
  ]);
  const money = (c: number) => formatMoney(c, { locale, currency: 'EGP' });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-gold-700">{t('title')}</h1>
          <p className="text-xs text-muted-foreground">{t('subtitle', { count: list.pendingCount })}</p>
        </div>
      </header>

      {/* Status filter */}
      <form className="flex flex-wrap items-end gap-2" method="get">
        <select
          name="status"
          defaultValue={status ?? ''}
          className="h-10 rounded-xl border border-border/60 bg-background/60 px-3 text-sm"
        >
          <option value="">{t('allStatuses')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status${s}`)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-10 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          {t('apply')}
        </button>
      </form>

      <Card>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{t('colGuest')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('colService')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('colBooking')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('colRequested')}</th>
                <th className="px-4 py-3 text-center font-medium">{t('colLocked')}</th>
                <th className="px-4 py-3 text-center font-medium">{t('colStatus')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {list.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    {t('empty')}
                  </td>
                </tr>
              ) : (
                list.items.map((r) => (
                  <tr key={r.id} className="group hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/cancellation-requests/${r.id}`}
                        className="font-medium text-accent underline-offset-4 group-hover:underline"
                      >
                        {r.user.name || r.user.email || '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {ar ? r.booking.service.nameAr : r.booking.service.nameEn}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.booking.reference}</td>
                    <td className="px-4 py-3 text-end text-xs text-muted-foreground">
                      {formatDate(r.requestedAt, locale)}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums">
                      <span className="font-semibold text-foreground">{r.lockedRefundPercent}%</span>
                      <span className="text-muted-foreground"> · {money(r.lockedRefundCents)}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge tone={STATUS_TONE[r.status]}>{t(`status${r.status}`)}</Badge>
                    </td>
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
        baseUrl="/admin/cancellation-requests"
        searchParams={sp}
      />
    </div>
  );
}

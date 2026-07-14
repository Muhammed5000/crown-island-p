import { setRequestLocale, getTranslations } from 'next-intl/server';
import type { ReviewStatus } from '@prisma/client';
import { Link } from '@/i18n/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Pagination } from '@/components/ui/Pagination';
import { RatingStars } from '@/components/ui/RatingStars';
import { StatCard } from '../reports/StatCard';
import { ReportBarChart, ReportAreaChart } from '../reports/ReportsCharts';
import { PublicReviewsToggle } from './PublicReviewsToggle';
import { listAdminReviews, getReviewsReport, getPublicReviewsEnabled } from '@/server/services/review';
import { formatDate } from '@/lib/date';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const STATUS_TONE: Record<ReviewStatus, BadgeTone> = {
  PENDING: 'muted',
  APPROVED: 'success',
  REJECTED: 'danger',
};

function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function GuestCommentsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);
  const sp = await searchParams;
  const ar = locale === 'ar';

  const page = Math.max(1, parseInt(str(sp.page) ?? '1', 10) || 1);
  const statusRaw = str(sp.status);
  const status = (['PENDING', 'APPROVED', 'REJECTED'] as const).includes(statusRaw as ReviewStatus)
    ? (statusRaw as ReviewStatus)
    : undefined;
  const ratingRaw = str(sp.rating);
  const rating = ratingRaw && /^[1-5]$/.test(ratingRaw) ? Number(ratingRaw) : undefined;
  const sortRaw = str(sp.sort);
  const sort = (['recent', 'lowest', 'highest'] as const).includes(sortRaw as 'recent')
    ? (sortRaw as 'recent' | 'lowest' | 'highest')
    : 'recent';
  const q = str(sp.q);

  const [report, list, publicEnabled, t] = await Promise.all([
    getReviewsReport({ from: new Date(0), toExclusive: new Date('9999-12-31T23:59:59.999Z') }),
    listAdminReviews({ q, status, rating, sort, page }),
    getPublicReviewsEnabled(),
    getTranslations('adminReviews'),
  ]);

  return (
    <div className="space-y-6">
      {/* Header + public master toggle */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-gold-700">{t('title')}</h1>
          <p className="text-xs text-muted-foreground">{t('subtitle', { count: report.total })}</p>
        </div>
        <PublicReviewsToggle enabled={publicEnabled} />
      </header>

      {/* Dashboard: KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t('avgRating')} value={report.average ? report.average.toFixed(1) : '—'} hint={t('outOfFive')} />
        <StatCard label={t('totalReviews')} value={String(report.total)} />
        <StatCard label={t('approved')} value={String(report.approved)} hint={t('approvalRate', { pct: report.approvalRate })} />
        <StatCard label={t('lowRatings')} value={String(report.recentLow.length)} hint={t('lowRatingsHint')} />
      </div>

      {/* Dashboard: charts */}
      {report.total > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <h2 className="font-display text-base text-gold-700">{t('distribution')}</h2>
            </CardHeader>
            <CardBody>
              <ReportBarChart
                data={report.distribution.map((d) => ({ name: `${d.star}★`, value: d.count }))}
                label={t('reviewsLabel')}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <h2 className="font-display text-base text-gold-700">{t('trend')}</h2>
            </CardHeader>
            <CardBody>
              <ReportAreaChart
                data={report.trend.map((d) => ({ date: d.date, amount: d.avg }))}
                label={t('avgRating')}
              />
            </CardBody>
          </Card>
        </div>
      ) : null}

      {/* Filters */}
      <form className="flex flex-wrap items-end gap-2" method="get">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ''}
          placeholder={t('searchPlaceholder')}
          className="h-10 min-w-[200px] flex-1 rounded-xl border border-border/60 bg-background/60 px-3 text-sm outline-none focus:border-gold-400"
        />
        <select name="status" defaultValue={status ?? ''} className="h-10 rounded-xl border border-border/60 bg-background/60 px-3 text-sm">
          <option value="">{t('allStatuses')}</option>
          <option value="PENDING">{t('statusPENDING')}</option>
          <option value="APPROVED">{t('statusAPPROVED')}</option>
          <option value="REJECTED">{t('statusREJECTED')}</option>
        </select>
        <select name="rating" defaultValue={rating ? String(rating) : ''} className="h-10 rounded-xl border border-border/60 bg-background/60 px-3 text-sm">
          <option value="">{t('allRatings')}</option>
          {[5, 4, 3, 2, 1].map((r) => (
            <option key={r} value={r}>{`${r}★`}</option>
          ))}
        </select>
        <select name="sort" defaultValue={sort} className="h-10 rounded-xl border border-border/60 bg-background/60 px-3 text-sm">
          <option value="recent">{t('sortRecent')}</option>
          <option value="lowest">{t('sortLowest')}</option>
          <option value="highest">{t('sortHighest')}</option>
        </select>
        <button type="submit" className="h-10 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">
          {t('apply')}
        </button>
      </form>

      {/* List */}
      <Card>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start font-medium">{t('colGuest')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('colCategory')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('colService')}</th>
                <th className="px-4 py-3 text-center font-medium">{t('colRating')}</th>
                <th className="px-4 py-3 text-start font-medium">{t('colComment')}</th>
                <th className="px-4 py-3 text-center font-medium">{t('colStatus')}</th>
                <th className="px-4 py-3 text-end font-medium">{t('colDate')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {list.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    {t('empty')}
                  </td>
                </tr>
              ) : (
                list.items.map((r) => (
                  <tr key={r.id} className="group hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link href={`/admin/guest-comments/${r.id}`} className="font-medium text-accent underline-offset-4 group-hover:underline">
                        {r.user.name || r.user.email || '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {ar ? r.service.category.nameAr : r.service.category.nameEn}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{ar ? r.service.nameAr : r.service.nameEn}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-center">
                        <RatingStars value={r.rating} readOnly size={14} />
                      </div>
                    </td>
                    <td className="max-w-[280px] truncate px-4 py-3 text-muted-foreground">{r.comment}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge tone={STATUS_TONE[r.status]}>{t(`status${r.status}`)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-end text-xs text-muted-foreground">{formatDate(r.createdAt, locale)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Pagination currentPage={list.page} totalPages={list.totalPages} baseUrl="/admin/guest-comments" searchParams={sp} />
    </div>
  );
}

import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Pagination } from '@/components/ui/Pagination';
import { BookingStatusBadge } from '@/components/booking/BookingStatusBadge';
import {
  getReportOverview,
  getBookingsReport,
  getPlacePerformanceReport,
  getRevenueReport,
  getCustomersReport,
  getOperationsReport,
  getPaymentsReport,
  getCancellationsReport,
  getSanctionsReport,
  getAuditReport,
} from '@/server/services/admin-reports';
import { getReviewsReport } from '@/server/services/review';
import { prisma } from '@/server/db/prisma';
import { getStaffDirectory } from '@/server/services/staff-performance';
import { formatMoney } from '@/lib/money';
import { formatDate, parseReportRange } from '@/lib/date';
import { isLocale } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { StatCard } from './StatCard';
import { ReportAreaChart, ReportBarChart, ReportStatusDonut } from './ReportsCharts';

const TABS = [
  'overview',
  'bookings',
  'revenue',
  'ratings',
  'payments',
  'cancellations',
  'cabanas',
  'customers',
  'sanctions',
  'audit',
  'operations',
  'staff',
] as const;
type Tab = (typeof TABS)[number];

/** Badge tone per staff role — matches the /admin/staff pages. */
const ROLE_TONES: Record<string, 'gold' | 'navy' | 'muted' | 'info' | 'success' | 'danger'> = {
  DEVELOPER: 'danger',
  SUPER_ADMIN: 'gold',
  ADMIN: 'success',
  DIRECTOR: 'gold',
  MANAGER: 'info',
  SUPERVISOR: 'info',
  STAFF: 'info',
  SECURITY: 'navy',
  HOUSEKEEPING: 'muted',
  MAINTENANCE: 'muted',
};

const BOOKING_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'FAILED'] as const;
const PAYMENT_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'] as const;
const CHANNELS = ['online', 'reception'] as const;
const CHECKED_IN = ['yes', 'no'] as const;

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    tab?: string;
    from?: string;
    to?: string;
    serviceId?: string;
    categoryId?: string;
    placeId?: string;
    status?: string;
    paymentStatus?: string;
    channel?: string;
    checkedIn?: string;
    page?: string;
  }>;
}

/** UTC yyyy-mm-dd for preset links. */
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Preset ranges — `labelKey` resolves against `reports.presets.*`. */
function presetRanges(now: Date) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = 86_400_000;
  const yesterday = new Date(today.getTime() - day);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const prevMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const prevMonthEnd = new Date(monthStart.getTime() - day);
  const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  return [
    { labelKey: 'today', from: iso(today), to: iso(today) },
    { labelKey: 'yesterday', from: iso(yesterday), to: iso(yesterday) },
    { labelKey: 'last7', from: iso(new Date(today.getTime() - 6 * day)), to: iso(today) },
    { labelKey: 'last30', from: iso(new Date(today.getTime() - 29 * day)), to: iso(today) },
    { labelKey: 'thisMonth', from: iso(monthStart), to: iso(today) },
    { labelKey: 'lastMonth', from: iso(prevMonthStart), to: iso(prevMonthEnd) },
    { labelKey: 'thisYear', from: iso(yearStart), to: iso(today) },
  ];
}

export default async function AdminReportsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);
  const t = await getTranslations('reports');
  const tStatus = await getTranslations('history.status');

  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : 'overview';
  const range = parseReportRange(sp.from, sp.to);
  const fromIso = iso(range.from);
  const toIso = iso(new Date(range.toExclusive.getTime() - 86_400_000));
  const status = BOOKING_STATUSES.includes(sp.status as (typeof BOOKING_STATUSES)[number])
    ? (sp.status as (typeof BOOKING_STATUSES)[number])
    : undefined;
  const paymentStatus = PAYMENT_STATUSES.includes(sp.paymentStatus as (typeof PAYMENT_STATUSES)[number])
    ? (sp.paymentStatus as (typeof PAYMENT_STATUSES)[number])
    : undefined;
  const channel = CHANNELS.includes(sp.channel as (typeof CHANNELS)[number])
    ? (sp.channel as (typeof CHANNELS)[number])
    : undefined;
  const checkedIn = CHECKED_IN.includes(sp.checkedIn as (typeof CHECKED_IN)[number])
    ? (sp.checkedIn as (typeof CHECKED_IN)[number])
    : undefined;
  const categoryId = sp.categoryId || undefined;
  const page = sp.page ? Math.max(1, parseInt(sp.page, 10) || 1) : 1;

  const ar = locale === 'ar';
  const money = (c: number) => formatMoney(c, { locale, currency: 'EGP' });
  const currencySuffix = ar ? 'ج.م' : 'EGP';

  // Filter-select options. Services carry their `categoryId` so the cabanas
  // filter can group / cascade Category → Service → Cell.
  const [services, categories] = await Promise.all([
    prisma.service.findMany({
      select: { id: true, nameEn: true, nameAr: true, categoryId: true },
      orderBy: [{ category: { nameEn: 'asc' } }, { nameEn: 'asc' }],
    }),
    prisma.category.findMany({ select: { id: true, nameEn: true, nameAr: true }, orderBy: { nameEn: 'asc' } }),
  ]);

  // Validate the drill-down chain so a stale child from a previous selection is
  // dropped: a serviceId must belong to the chosen category, and a placeId to
  // the chosen service. Keeps the cascade coherent across GET round-trips.
  const selectedService = sp.serviceId ? services.find((s) => s.id === sp.serviceId) : undefined;
  const serviceId =
    selectedService && (!categoryId || selectedService.categoryId === categoryId)
      ? selectedService.id
      : undefined;
  const selectedPlace = sp.placeId
    ? await prisma.servicePlace.findUnique({ where: { id: sp.placeId }, select: { id: true, serviceId: true } })
    : null;
  const placeId =
    selectedPlace && (!serviceId || selectedPlace.serviceId === serviceId) ? selectedPlace.id : undefined;

  // Cells of the selected service drive the Cell dropdown (only meaningful once
  // a service is picked — there are hundreds of cells across all services).
  const placeOptions = serviceId
    ? await prisma.servicePlace.findMany({
        where: { serviceId },
        select: { id: true, label: true, zone: true, type: true },
        orderBy: [{ zone: 'asc' }, { position: 'asc' }, { label: 'asc' }],
      })
    : [];

  // Services grouped by category → `<optgroup>`s; narrowed to one category when
  // the category filter is set (the Service dropdown then shows only its
  // services), otherwise every category group is shown.
  const servicesByCat = new Map<string, typeof services>();
  for (const s of services) {
    const arr = servicesByCat.get(s.categoryId) ?? [];
    arr.push(s);
    servicesByCat.set(s.categoryId, arr);
  }
  const serviceGroups = categories.filter(
    (c) => servicesByCat.has(c.id) && (!categoryId || c.id === categoryId),
  );

  // Querystring helpers — tab links keep filters; preset links keep tab + filters.
  const baseQs = (over: Record<string, string | undefined>) => {
    const entries: Record<string, string | undefined> = {
      tab,
      from: fromIso,
      to: toIso,
      serviceId,
      status,
      paymentStatus,
      channel,
      checkedIn,
      categoryId,
      placeId,
      ...over,
    };
    const qs = Object.entries(entries)
      .filter(([, v]) => !!v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join('&');
    return `/admin/reports?${qs}`;
  };
  const exportHref = (format: 'csv' | 'xlsx') => {
    const entries: Record<string, string | undefined> = {
      type: `report-${tab}`,
      from: fromIso,
      to: toIso,
      serviceId,
      status,
      paymentStatus,
      channel,
      checkedIn,
      categoryId,
      placeId,
      format,
    };
    return `/api/admin/export?${Object.entries(entries)
      .filter(([, v]) => !!v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join('&')}`;
  };

  const presets = presetRanges(new Date());

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-gold-700">{t('title')}</h1>
          <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
            {formatDate(range.from, locale, { dateStyle: 'medium' })} →{' '}
            {formatDate(new Date(range.toExclusive.getTime() - 86_400_000), locale, { dateStyle: 'medium' })}
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={exportHref('csv')}
            className="h-9 rounded-2xl border border-border/60 bg-input px-4 text-sm leading-9 text-foreground hover:border-accent"
          >
            {t('exportCsv')}
          </a>
          <a
            href={exportHref('xlsx')}
            className="h-9 rounded-2xl bg-primary px-4 text-sm font-medium leading-9 text-primary-foreground"
          >
            {t('exportExcel')}
          </a>
        </div>
      </header>

      {/* Tab pills */}
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((tk) => (
          <Link
            key={tk}
            href={baseQs({ tab: tk, page: undefined })}
            className={cn(
              'rounded-2xl px-4 py-2 text-sm transition-colors',
              tk === tab
                ? 'bg-accent/15 text-accent'
                : 'border border-border/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {t(`tabs.${tk}`)}
          </Link>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => {
              const active = p.from === fromIso && p.to === toIso;
              return (
                <Link
                  key={p.labelKey}
                  href={baseQs({ from: p.from, to: p.to, page: undefined })}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs transition-colors',
                    active
                      ? 'bg-accent/15 text-accent'
                      : 'border border-border/40 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(`presets.${p.labelKey}`)}
                </Link>
              );
            })}
          </div>
          <form className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="tab" value={tab} />
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t('filters.from')}
              <input
                type="date"
                name="from"
                defaultValue={fromIso}
                className="h-10 rounded-2xl border border-border/60 bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {t('filters.to')}
              <input
                type="date"
                name="to"
                defaultValue={toIso}
                className="h-10 rounded-2xl border border-border/60 bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </label>
            {/* Cabanas: Category → Service → Cell drill-down. */}
            {tab === 'cabanas' && (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t('filters.category')}
                <select
                  name="categoryId"
                  defaultValue={categoryId ?? ''}
                  className="h-10 rounded-2xl border border-border/60 bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="">{t('filters.allCategories')}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {ar ? c.nameAr : c.nameEn}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(tab === 'bookings' || tab === 'cabanas') && (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t('filters.service')}
                <select
                  name="serviceId"
                  defaultValue={serviceId ?? ''}
                  className="h-10 rounded-2xl border border-border/60 bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="">{t('filters.allServices')}</option>
                  {serviceGroups.map((c) => (
                    <optgroup key={c.id} label={ar ? c.nameAr : c.nameEn}>
                      {(servicesByCat.get(c.id) ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {ar ? s.nameAr : s.nameEn}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            )}
            {tab === 'cabanas' && (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t('filters.cell')}
                <select
                  name="placeId"
                  defaultValue={placeId ?? ''}
                  disabled={!serviceId}
                  className="h-10 rounded-2xl border border-border/60 bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50"
                >
                  <option value="">{serviceId ? t('filters.allCells') : t('filters.pickServiceFirst')}</option>
                  {placeOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                      {p.zone ? ` · ${p.zone}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {tab === 'bookings' && (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t('filters.status')}
                <select
                  name="status"
                  defaultValue={status ?? ''}
                  className="h-10 rounded-2xl border border-border/60 bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="">{t('filters.allStatuses')}</option>
                  {BOOKING_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {tStatus(s)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(tab === 'bookings' || tab === 'payments') && (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {ar ? 'حالة الدفع' : 'Payment status'}
                <select
                  name="paymentStatus"
                  defaultValue={paymentStatus ?? ''}
                  className="h-10 rounded-2xl border border-border/60 bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="">{ar ? 'الكل' : 'All'}</option>
                  {PAYMENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {tab === 'bookings' && (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {ar ? 'القناة' : 'Channel'}
                <select
                  name="channel"
                  defaultValue={channel ?? ''}
                  className="h-10 rounded-2xl border border-border/60 bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="">{ar ? 'الكل' : 'All'}</option>
                  <option value="online">{ar ? 'أونلاين' : 'Online'}</option>
                  <option value="reception">{ar ? 'الاستقبال' : 'Reception'}</option>
                </select>
              </label>
            )}
            {tab === 'bookings' && (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {ar ? 'الحضور' : 'Checked in'}
                <select
                  name="checkedIn"
                  defaultValue={checkedIn ?? ''}
                  className="h-10 rounded-2xl border border-border/60 bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="">{ar ? 'الكل' : 'All'}</option>
                  <option value="yes">{ar ? 'نعم' : 'Yes'}</option>
                  <option value="no">{ar ? 'لا' : 'No'}</option>
                </select>
              </label>
            )}
            {(tab === 'revenue' || tab === 'ratings') && (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t('filters.category')}
                <select
                  name="categoryId"
                  defaultValue={categoryId ?? ''}
                  className="h-10 rounded-2xl border border-border/60 bg-input px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="">{t('filters.allCategories')}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {ar ? c.nameAr : c.nameEn}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="submit"
              className="h-10 rounded-2xl bg-primary px-5 text-sm font-medium text-primary-foreground"
            >
              {t('apply')}
            </button>
          </form>
        </CardBody>
      </Card>

      {tab === 'overview' && <OverviewTab range={range} ar={ar} money={money} currencySuffix={currencySuffix} />}
      {tab === 'bookings' && (
        <BookingsTab
          range={range}
          status={status}
          serviceId={serviceId}
          channel={channel}
          checkedIn={checkedIn}
          paymentStatus={paymentStatus}
          page={page}
          ar={ar}
          locale={locale}
          money={money}
          sp={{ tab, from: fromIso, to: toIso, serviceId, status, paymentStatus, channel, checkedIn }}
        />
      )}
      {tab === 'cabanas' && <CabanasTab range={range} serviceId={serviceId} categoryId={categoryId} placeId={placeId} ar={ar} locale={locale} money={money} currencySuffix={currencySuffix} />}
      {tab === 'revenue' && <RevenueTab range={range} categoryId={categoryId} ar={ar} money={money} currencySuffix={currencySuffix} />}
      {tab === 'ratings' && <RatingsTab range={range} categoryId={categoryId} ar={ar} />}
      {tab === 'customers' && <CustomersTab range={range} money={money} />}
      {tab === 'operations' && <OperationsTab range={range} ar={ar} locale={locale} />}
      {tab === 'payments' && <PaymentsTab range={range} paymentStatus={paymentStatus} ar={ar} locale={locale} money={money} />}
      {tab === 'cancellations' && <CancellationsTab range={range} ar={ar} locale={locale} money={money} />}
      {tab === 'sanctions' && <SanctionsTab range={range} locale={locale} money={money} />}
      {tab === 'audit' && <AuditTab range={range} locale={locale} />}
      {tab === 'staff' && <StaffTab range={range} locale={locale} money={money} />}
    </div>
  );
}

type Range = ReturnType<typeof parseReportRange>;
type MoneyFn = (c: number) => string;

/* ── Overview ── */
async function OverviewTab({ range, ar, money, currencySuffix }: { range: Range; ar: boolean; money: MoneyFn; currencySuffix: string }) {
  const t = await getTranslations('reports');
  const tStatus = await getTranslations('history.status');
  const o = await getReportOverview(range);
  const statusData = Object.entries(o.statusCounts).map(([status, count]) => ({ status, count: count ?? 0, name: tStatus(status) }));
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t('kpi.netRevenue')} value={money(o.netRevenueCents)} hint={t('kpi.paidInvoices', { count: o.paidInvoices })} />
        <StatCard label={t('kpi.avgInvoice')} value={money(o.avgInvoiceCents)} />
        <StatCard label={t('kpi.refunds')} value={money(o.refundCents)} hint={t('kpi.refundsCount', { count: o.refundCount })} />
        <StatCard label={t('kpi.outstanding')} value={money(o.outstandingCents)} hint={t('kpi.outstandingHint')} />
        <StatCard label={t('kpi.bookingsCreated')} value={String(o.totalBookings)} hint={t('kpi.channelHint', { online: o.onlineBookings, reception: o.receptionBookings })} />
        <StatCard label={t('kpi.visits')} value={String(o.visitBookings)} hint={t('kpi.guestsHint', { count: o.visitGuests })} />
        <StatCard label={t('kpi.customers')} value={String(o.totalCustomers)} hint={t('kpi.newCustomersHint', { count: o.newCustomers })} />
        <StatCard label={t('kpi.placesOutNow')} value={String(o.placesOutNow)} hint={t('kpi.placesOfflineHint', { count: o.placesOffline })} />
        {/* Insurance deposits — a liability while held, never part of net revenue. */}
        <StatCard label={t('kpi.depositsCollected')} value={money(o.deposits.collectedCents)} hint={t('kpi.depositsCollectedHint', { count: o.deposits.collectedCount })} />
        <StatCard label={t('kpi.depositsHeld')} value={money(o.deposits.heldCents)} hint={t('kpi.depositsHeldHint')} />
        <StatCard label={t('kpi.depositsRefunded')} value={money(o.deposits.refundedCents)} hint={t('kpi.refundsCount', { count: o.deposits.refundedCount })} />
        <StatCard label={t('kpi.depositsRetained')} value={money(o.deposits.retainedCents)} hint={t('kpi.depositsRetainedHint')} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('overview.revenueOverTime')}</h2>
          </CardHeader>
          <CardBody>
            <ReportAreaChart data={o.revenueTrend} label={t('charts.revenue')} currencySuffix={currencySuffix} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('overview.bookingsByStatus')}</h2>
          </CardHeader>
          <CardBody>{statusData.length ? <ReportStatusDonut data={statusData} /> : <Empty text={t('empty')} />}</CardBody>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('overview.topCategories')}</h2>
          </CardHeader>
          <CardBody>
            {o.topCategories.length ? (
              <ReportBarChart
                data={o.topCategories.map((c) => ({ name: ar ? c.nameAr : c.nameEn, value: Math.round(c.cents / 100) }))}
                label={t('charts.revenue')}
                currencySuffix={currencySuffix}
              />
            ) : (
              <Empty text={t('empty')} />
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

/* ── Bookings ── */
async function BookingsTab({
  range,
  status,
  serviceId,
  channel,
  checkedIn,
  paymentStatus,
  page,
  ar,
  locale,
  money,
  sp,
}: {
  range: Range;
  status?: (typeof BOOKING_STATUSES)[number];
  serviceId?: string;
  channel?: (typeof CHANNELS)[number];
  checkedIn?: (typeof CHECKED_IN)[number];
  paymentStatus?: (typeof PAYMENT_STATUSES)[number];
  page: number;
  ar: boolean;
  locale: 'ar' | 'en';
  money: MoneyFn;
  sp: Record<string, string | undefined>;
}) {
  const t = await getTranslations('reports');
  const tStatus = await getTranslations('history.status');
  const r = await getBookingsReport({ ...range, status, serviceId, channel, checkedIn, paymentStatus, page });
  const statusData = r.statusCounts.map((s) => ({ ...s, name: tStatus(s.status) }));
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t('bookingsTab.inRange')} value={String(r.totalInRange)} hint={t('kpi.channelHint', { online: r.onlineCount, reception: r.receptionCount })} />
        <StatCard label={t('bookingsTab.cancellationRate')} value={`${r.cancellationRatePct}%`} />
        <StatCard label={t('bookingsTab.showRate')} value={`${r.showRatePct}%`} hint={t('bookingsTab.showRateHint', { checkedIn: r.checkedInCount, confirmed: r.confirmedCount })} />
        <StatCard label={t('bookingsTab.bookedDays')} value={String(r.totalBookedDays)} hint={t('bookingsTab.bookedDaysHint', { avg: r.avgDurationDays, multi: r.multiDayCount })} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('bookingsTab.createdPerDay')}</h2>
          </CardHeader>
          <CardBody>
            <ReportAreaChart data={r.createdPerDay.map((d) => ({ date: d.date, amount: d.count }))} label={t('charts.created')} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('bookingsTab.visitsPerDay')}</h2>
          </CardHeader>
          <CardBody>
            <ReportAreaChart data={r.visitsPerDay.map((d) => ({ date: d.date, amount: d.count }))} label={t('charts.visits')} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('bookingsTab.statusBreakdown')}</h2>
          </CardHeader>
          <CardBody>{statusData.length ? <ReportStatusDonut data={statusData} /> : <Empty text={t('empty')} />}</CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-700">{t('bookingsTab.tableTitle', { count: r.table.total })}</h2>
        </CardHeader>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">{t('bookingsTab.thReference')}</th>
                <th className="px-4 py-3 text-start">{t('bookingsTab.thDate')}</th>
                <th className="px-4 py-3 text-start">{t('bookingsTab.thCustomer')}</th>
                <th className="px-4 py-3 text-start">{t('bookingsTab.thService')}</th>
                <th className="px-4 py-3 text-end">{t('bookingsTab.thGuests')}</th>
                <th className="px-4 py-3 text-end">{t('bookingsTab.thTotal')}</th>
                <th className="px-4 py-3 text-end">{t('bookingsTab.thStatus')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {r.table.items.map((b) => (
                <tr key={b.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link href={`/admin/bookings/${b.id}`} dir="ltr" className="font-display text-accent underline-offset-4 hover:underline">
                      {b.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(b.bookingDate, locale)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{b.guestName ?? b.user.name ?? b.user.email ?? '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{ar ? b.service.nameAr : b.service.nameEn}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-muted-foreground">{b.people}</td>
                  <td className="px-4 py-3 text-end tabular-nums">{b.invoice ? money(b.invoice.totalCents) : '—'}</td>
                  <td className="px-4 py-3 text-end">
                    <BookingStatusBadge status={b.status} />
                  </td>
                </tr>
              ))}
              {r.table.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    {t('bookingsTab.emptyTable')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardBody>
      </Card>
      <Pagination currentPage={r.table.page} totalPages={r.table.totalPages} baseUrl="/admin/reports" searchParams={sp} />
    </>
  );
}

/* ── Cabanas / places ── */
async function CabanasTab({
  range,
  serviceId,
  categoryId,
  placeId,
  ar,
  locale,
  money,
  currencySuffix,
}: {
  range: Range;
  serviceId?: string;
  categoryId?: string;
  placeId?: string;
  ar: boolean;
  locale: 'ar' | 'en';
  money: MoneyFn;
  currencySuffix: string;
}) {
  const t = await getTranslations('reports');
  const r = await getPlacePerformanceReport({ ...range, serviceId, categoryId, placeId });
  const top = r.rows.filter((x) => x.revenueCents > 0).slice(0, 14);
  const outageTop = [...r.rows].sort((a, b) => b.outageCount - a.outageCount || b.downtimeHours - a.downtimeHours).filter((x) => x.outageCount > 0).slice(0, 14);
  // Chart bar names: a bare place label like "U1" repeats across services, so
  // unless a single service (or cell) is selected we disambiguate the bar with
  // its service — a category view can still span several services.
  const oneService = !!serviceId || !!placeId;
  const chartName = (p: { label: string; serviceNameEn: string; serviceNameAr: string }) =>
    oneService ? p.label : `${p.label} · ${ar ? p.serviceNameAr : p.serviceNameEn}`;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t('cabanas.attributedRevenue')} value={money(r.totals.revenueCents)} hint={r.unassignedRevenueCents > 0 ? t('cabanas.unassignedHint', { amount: money(r.unassignedRevenueCents) }) : undefined} />
        <StatCard label={t('cabanas.bookedPlaceDays')} value={String(r.totals.bookedDays)} hint={t('cabanas.bookedPlaceDaysHint', { bookings: r.totals.bookings, days: r.rangeDays })} />
        <StatCard label={t('cabanas.outageWindows')} value={String(r.totals.outages)} />
        <StatCard label={t('cabanas.totalDowntime')} value={`${r.totals.downtimeHours}h`} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('cabanas.revenueByPlace', { count: top.length })}</h2>
          </CardHeader>
          <CardBody>
            {top.length ? (
              <ReportBarChart data={top.map((p) => ({ name: chartName(p), value: Math.round(p.revenueCents / 100) }))} label={t('charts.revenue')} currencySuffix={currencySuffix} />
            ) : (
              <Empty text={t('empty')} />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('cabanas.outageFrequency')}</h2>
          </CardHeader>
          <CardBody>
            {outageTop.length ? (
              <ReportBarChart data={outageTop.map((p) => ({ name: chartName(p), value: p.outageCount }))} label={t('charts.outages')} />
            ) : (
              <Empty text={t('cabanas.noOutages')} />
            )}
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="font-display text-base text-gold-700">{t('cabanas.tableTitle', { count: r.rows.length })}</h2>
          <p className="text-xs text-muted-foreground">{t('cabanas.tableNote')}</p>
        </CardHeader>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">{t('cabanas.thPlace')}</th>
                <th className="px-4 py-3 text-start">{t('cabanas.thCategory')}</th>
                <th className="px-4 py-3 text-start">{t('cabanas.thService')}</th>
                <th className="px-4 py-3 text-end">{t('cabanas.thBookings')}</th>
                <th className="px-4 py-3 text-end">{t('cabanas.thBookedDays')}</th>
                <th className="px-4 py-3 text-end">{t('cabanas.thOccupancy')}</th>
                <th className="px-4 py-3 text-end">{t('cabanas.thRevenue')}</th>
                <th className="px-4 py-3 text-end">{t('cabanas.thAvgBooking')}</th>
                <th className="px-4 py-3 text-end">{t('cabanas.thOutages')}</th>
                <th className="px-4 py-3 text-end">{t('cabanas.thDowntime')}</th>
                <th className="px-4 py-3 text-start">{t('cabanas.thLastBooked')}</th>
                <th className="px-4 py-3 text-end">{t('cabanas.thStatus')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {r.rows.map((p) => (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <span className="font-display text-gold-700">{p.label}</span>
                    <span className="ms-2 text-xs text-muted-foreground">{t(`placeTypes.${p.type}`)}{p.zone ? ` · ${p.zone}` : ''}</span>
                  </td>
                  <td className="px-4 py-3 text-foreground/80">{ar ? p.categoryNameAr : p.categoryNameEn}</td>
                  <td className="px-4 py-3 text-muted-foreground">{ar ? p.serviceNameAr : p.serviceNameEn}</td>
                  <td className="px-4 py-3 text-end tabular-nums">{p.bookings}</td>
                  <td className="px-4 py-3 text-end tabular-nums">{p.bookedDays}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-muted-foreground">{p.occupancyPct}%</td>
                  <td className="px-4 py-3 text-end tabular-nums">{p.revenueCents > 0 ? money(p.revenueCents) : '—'}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-muted-foreground">{p.avgPerBookingCents > 0 ? money(p.avgPerBookingCents) : '—'}</td>
                  <td className="px-4 py-3 text-end tabular-nums">{p.outageCount}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-muted-foreground">{p.downtimeHours > 0 ? `${p.downtimeHours}h` : '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.lastBookedAt ? formatDate(p.lastBookedAt, locale, { dateStyle: 'medium' }) : '—'}</td>
                  <td className="px-4 py-3 text-end">
                    <Badge tone={p.status === 'online' ? 'success' : p.status === 'out' ? 'warning' : 'muted'}>
                      {t(`placeStatus.${p.status}`)}
                    </Badge>
                  </td>
                </tr>
              ))}
              {r.rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-10 text-center text-muted-foreground">
                    {t('cabanas.emptyTable')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardBody>
      </Card>
      <p className="text-xs text-muted-foreground">{t('cabanas.footnote')}</p>
    </>
  );
}

/* ── Revenue ── */
async function RevenueTab({ range, categoryId, ar, money, currencySuffix }: { range: Range; categoryId?: string; ar: boolean; money: MoneyFn; currencySuffix: string }) {
  const t = await getTranslations('reports');
  const r = await getRevenueReport({ ...range, categoryId });
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t('kpi.netRevenue')} value={money(r.netRevenueCents)} hint={t('revenue.netRevenueHint', { amount: money(r.grossRevenueCents) })} />
        <StatCard label={t('kpi.avgInvoice')} value={money(r.avgInvoiceCents)} hint={t('kpi.paidInvoices', { count: r.paidInvoices })} />
        <StatCard label={t('kpi.refunds')} value={money(r.refundCents)} hint={t('revenue.refundsHint', { count: r.refundCount })} />
        <StatCard label={t('kpi.outstanding')} value={money(r.outstandingCents)} hint={t('revenue.outstandingHint')} />
        <StatCard label={t('revenue.onlineRevenue')} value={money(r.onlineNetCents)} />
        <StatCard label={t('revenue.receptionRevenue')} value={money(r.receptionNetCents)} />
        <StatCard label={t('revenue.tax')} value={money(r.taxCents)} />
        <StatCard label={t('revenue.fees')} value={money(r.feeCents)} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('overview.revenueOverTime')}</h2>
          </CardHeader>
          <CardBody>
            <ReportAreaChart data={r.trend} label={t('charts.revenue')} currencySuffix={currencySuffix} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('revenue.revenueByCategory')}</h2>
          </CardHeader>
          <CardBody>
            {r.byCategory.length ? (
              <ReportBarChart data={r.byCategory.map((c) => ({ name: ar ? c.nameAr : c.nameEn, value: Math.round(c.cents / 100) }))} label={t('charts.revenue')} currencySuffix={currencySuffix} />
            ) : (
              <Empty text={t('empty')} />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('revenue.paymentMethods')}</h2>
          </CardHeader>
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-start">{t('revenue.thMethod')}</th>
                  <th className="px-4 py-3 text-end">{t('revenue.thPayments')}</th>
                  <th className="px-4 py-3 text-end">{t('revenue.thCollected')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {r.byMethod.map((m) => (
                  <tr key={m.provider}>
                    <td className="px-4 py-3">{t.has(`methods.${m.provider}`) ? t(`methods.${m.provider}`) : m.provider}</td>
                    <td className="px-4 py-3 text-end tabular-nums">{m.payments}</td>
                    <td className="px-4 py-3 text-end tabular-nums">{money(m.collectedCents)}</td>
                  </tr>
                ))}
                {r.byMethod.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
                      {t('revenue.emptyPayments')}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-700">{t('revenue.topServices')}</h2>
        </CardHeader>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">{t('cabanas.thService')}</th>
                <th className="px-4 py-3 text-end">{t('revenue.thInvoices')}</th>
                <th className="px-4 py-3 text-end">{t('revenue.thNetRevenue')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {r.byService.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3">{ar ? s.nameAr : s.nameEn}</td>
                  <td className="px-4 py-3 text-end tabular-nums">{s.invoices}</td>
                  <td className="px-4 py-3 text-end tabular-nums">{money(s.cents)}</td>
                </tr>
              ))}
              {r.byService.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
                    {t('revenue.emptyRevenue')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  );
}

/* ── Ratings ── */
async function RatingsTab({ range, categoryId, ar }: { range: Range; categoryId?: string; ar: boolean }) {
  const t = await getTranslations('reports');
  const r = await getReviewsReport({ ...range, categoryId });
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t('ratings.avgRating')} value={r.total ? r.average.toFixed(1) : '—'} hint={t('ratings.outOfFive')} />
        <StatCard label={t('ratings.totalReviews')} value={String(r.total)} />
        <StatCard label={t('ratings.approved')} value={String(r.approved)} hint={t('ratings.approvalRate', { pct: r.approvalRate })} />
        <StatCard label={t('ratings.lowRatings')} value={String(r.recentLow.length)} hint={t('ratings.lowRatingsHint')} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('ratings.distribution')}</h2>
          </CardHeader>
          <CardBody>
            {r.total ? (
              <ReportBarChart data={r.distribution.map((d) => ({ name: `${d.star}★`, value: d.count }))} label={t('ratings.reviewsLabel')} />
            ) : (
              <Empty text={t('empty')} />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('ratings.trend')}</h2>
          </CardHeader>
          <CardBody>
            {r.total ? (
              <ReportAreaChart data={r.trend.map((d) => ({ date: d.date, amount: d.avg }))} label={t('ratings.avgRating')} />
            ) : (
              <Empty text={t('empty')} />
            )}
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-700">{t('ratings.byCategory')}</h2>
        </CardHeader>
        <CardBody>
          {r.byCategory.length ? (
            <ReportBarChart data={r.byCategory.map((c) => ({ name: ar ? c.nameAr : c.nameEn, value: c.avg }))} label={t('ratings.avgRating')} />
          ) : (
            <Empty text={t('empty')} />
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-700">{t('ratings.byService')}</h2>
        </CardHeader>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">{t('ratings.thCategory')}</th>
                <th className="px-4 py-3 text-start">{t('ratings.thService')}</th>
                <th className="px-4 py-3 text-end">{t('ratings.thAvg')}</th>
                <th className="px-4 py-3 text-end">{t('ratings.thReviews')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {r.byService.map((s) => (
                <tr key={s.serviceId}>
                  <td className="px-4 py-3">{ar ? s.categoryNameAr : s.categoryNameEn}</td>
                  <td className="px-4 py-3">{ar ? s.nameAr : s.nameEn}</td>
                  <td className="px-4 py-3 text-end tabular-nums">{s.avg.toFixed(1)}</td>
                  <td className="px-4 py-3 text-end tabular-nums">{s.count}</td>
                </tr>
              ))}
              {r.byService.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                    {t('empty')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  );
}

/* ── Customers ── */
async function CustomersTab({ range, money }: { range: Range; money: MoneyFn }) {
  const t = await getTranslations('reports');
  const r = await getCustomersReport(range);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t('kpi.customers')} value={String(r.totalCustomers)} hint={t('customers.blockedHint', { count: r.blockedCustomers })} />
        <StatCard label={t('customers.newCustomers')} value={String(r.newCustomers)} hint={t('customers.newCustomersHint')} />
        <StatCard label={t('customers.activeBookers')} value={String(r.activeBookers)} hint={t('customers.activeBookersHint')} />
        <StatCard label={t('customers.newVsReturning')} value={`${r.newBookers} / ${r.returningBookers}`} />
      </div>
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="font-display text-base text-gold-700">{t('customers.topSpenders')}</h2>
          <p className="text-xs text-muted-foreground">{t('customers.topSpendersNote')}</p>
        </CardHeader>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">{t('customers.thCustomer')}</th>
                <th className="px-4 py-3 text-end">{t('customers.thBookings')}</th>
                <th className="px-4 py-3 text-end">{t('customers.thNetSpend')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {r.topCustomers.map((c) => (
                <tr key={c.userId} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link href={`/admin/customers/${c.userId}`} className="text-accent underline-offset-4 hover:underline">
                      {c.name ?? c.email ?? c.userId}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums">{c.bookings}</td>
                  <td className="px-4 py-3 text-end tabular-nums">{money(c.netCents)}</td>
                </tr>
              ))}
              {r.topCustomers.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
                    {t('customers.emptyTable')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  );
}

/* ── Operations ── */
async function OperationsTab({ range, ar, locale }: { range: Range; ar: boolean; locale: 'ar' | 'en' }) {
  const t = await getTranslations('reports');
  const r = await getOperationsReport(range);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {r.scansByResult.map((s) => (
          <StatCard key={s.result} label={`${t('operations.gatePrefix')} · ${t(`results.${s.result}`)}`} value={String(s.count)} />
        ))}
        <StatCard label={t('operations.channelSplit')} value={`${r.onlineBookings} / ${r.receptionBookings}`} hint={t('operations.channelSplitHint')} />
      </div>
      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-700">{t('operations.admissionsByHour')}</h2>
        </CardHeader>
        <CardBody>
          <ReportBarChart data={r.admittedByHour.map((h) => ({ name: h.hour, value: h.people }))} label={t('charts.guestsAdmitted')} />
        </CardBody>
      </Card>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('operations.outNowTitle', { count: r.placesOutNow.length })}</h2>
          </CardHeader>
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-start">{t('operations.thPlace')}</th>
                  <th className="px-4 py-3 text-start">{t('operations.thReason')}</th>
                  <th className="px-4 py-3 text-start">{t('operations.thBackInService')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {r.placesOutNow.map((p, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3">
                      <span className="font-display text-gold-700">{p.label}</span>
                      <span className="ms-2 text-xs text-muted-foreground">{ar ? p.categoryNameAr : p.categoryNameEn} · {ar ? p.serviceNameAr : p.serviceNameEn}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{p.reason ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(p.until, locale, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  </tr>
                ))}
                {r.placesOutNow.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
                      {t('operations.emptyOutNow')}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('operations.offlineTitle', { count: r.placesOffline.length })}</h2>
          </CardHeader>
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-start">{t('operations.thPlace')}</th>
                  <th className="px-4 py-3 text-start">{t('operations.thCategory')}</th>
                  <th className="px-4 py-3 text-start">{t('operations.thService')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {r.placesOffline.map((p, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3 font-display text-gold-700">{p.label}</td>
                    <td className="px-4 py-3 text-foreground/80">{ar ? p.categoryNameAr : p.categoryNameEn}</td>
                    <td className="px-4 py-3 text-muted-foreground">{ar ? p.serviceNameAr : p.serviceNameEn}</td>
                  </tr>
                ))}
                {r.placesOffline.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
                      {t('operations.emptyOffline')}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

/* ── Payments ── */
async function PaymentsTab({
  range,
  paymentStatus,
  ar,
  locale,
  money,
}: {
  range: Range;
  paymentStatus?: (typeof PAYMENT_STATUSES)[number];
  ar: boolean;
  locale: 'ar' | 'en';
  money: MoneyFn;
}) {
  const t = await getTranslations('reports');
  const r = await getPaymentsReport({ ...range, paymentStatus });
  const dt = (d: Date | null) => (d ? formatDate(d, locale, { dateStyle: 'short', timeStyle: 'short' }) : '—');
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={ar ? 'المحصّل' : 'Collected'} value={money(r.collectedCents)} hint={`${r.collectedCount} ${ar ? 'دفعة ناجحة' : 'succeeded'}`} />
        <StatCard label={ar ? 'المسترد' : 'Refunded'} value={money(r.refundedCents)} hint={`${r.refundedCount} ${ar ? 'استرداد' : 'refunds'}`} />
        <StatCard label={ar ? 'إجمالي المدفوعات' : 'Total payments'} value={String(r.totalPayments)} />
        <StatCard label={ar ? 'طرق الدفع' : 'Methods used'} value={String(r.byProvider.length)} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><h2 className="font-display text-base text-gold-700">{ar ? 'حسب طريقة الدفع' : 'By method'}</h2></CardHeader>
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr><th className="px-4 py-3 text-start">{ar ? 'الطريقة' : 'Method'}</th><th className="px-4 py-3 text-end">{ar ? 'العدد' : 'Count'}</th><th className="px-4 py-3 text-end">{ar ? 'المبلغ' : 'Amount'}</th></tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {r.byProvider.map((m) => (
                  <tr key={m.provider}><td className="px-4 py-3 font-medium text-foreground">{m.provider}</td><td className="px-4 py-3 text-end tabular-nums">{m.count}</td><td className="px-4 py-3 text-end tabular-nums text-gold-700">{money(m.cents)}</td></tr>
                ))}
                {r.byProvider.length === 0 ? <tr><td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">{t('empty')}</td></tr> : null}
              </tbody>
            </table>
          </CardBody>
        </Card>
        <Card>
          <CardHeader><h2 className="font-display text-base text-gold-700">{ar ? 'حسب الحالة' : 'By status'}</h2></CardHeader>
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr><th className="px-4 py-3 text-start">{ar ? 'الحالة' : 'Status'}</th><th className="px-4 py-3 text-end">{ar ? 'العدد' : 'Count'}</th><th className="px-4 py-3 text-end">{ar ? 'المبلغ' : 'Amount'}</th></tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {r.byStatus.map((s) => (
                  <tr key={s.status}><td className="px-4 py-3 font-medium text-foreground">{s.status}</td><td className="px-4 py-3 text-end tabular-nums">{s.count}</td><td className="px-4 py-3 text-end tabular-nums">{money(s.cents)}</td></tr>
                ))}
                {r.byStatus.length === 0 ? <tr><td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">{t('empty')}</td></tr> : null}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader><h2 className="font-display text-base text-gold-700">{ar ? 'أحدث المدفوعات' : 'Recent payments'}</h2></CardHeader>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">{ar ? 'التاريخ' : 'When'}</th>
                <th className="px-4 py-3 text-start">{ar ? 'المرجع' : 'Reference'}</th>
                <th className="px-4 py-3 text-start">{ar ? 'العميل' : 'Customer'}</th>
                <th className="px-4 py-3 text-start">{ar ? 'الطريقة' : 'Method'}</th>
                <th className="px-4 py-3 text-start">{ar ? 'الحالة' : 'Status'}</th>
                <th className="px-4 py-3 text-end">{ar ? 'المبلغ' : 'Amount'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {r.preview.map((p, i) => (
                <tr key={i}>
                  <td className="px-4 py-3 text-muted-foreground">{dt(p.createdAt)}</td>
                  <td className="px-4 py-3 font-display text-gold-700">{p.reference}</td>
                  <td className="px-4 py-3 text-foreground/80">{p.customer}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.provider}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.status}</td>
                  <td className="px-4 py-3 text-end tabular-nums">{money(p.amountCents)}</td>
                </tr>
              ))}
              {r.preview.length === 0 ? <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">{t('empty')}</td></tr> : null}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  );
}

/* ── Cancellations & Refunds ── */
async function CancellationsTab({ range, ar, locale, money }: { range: Range; ar: boolean; locale: 'ar' | 'en'; money: MoneyFn }) {
  const t = await getTranslations('reports');
  const r = await getCancellationsReport(range);
  const dt = (d: Date | null) => (d ? formatDate(d, locale, { dateStyle: 'short', timeStyle: 'short' }) : '—');
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={ar ? 'حجوزات ملغاة' : 'Cancelled bookings'} value={String(r.cancelledCount)} />
        <StatCard label={ar ? 'عدد الاستردادات' : 'Refunds'} value={String(r.refundCount)} />
        <StatCard label={ar ? 'إجمالي المسترد' : 'Total refunded'} value={money(r.refundedCents)} />
      </div>
      <Card>
        <CardHeader><h2 className="font-display text-base text-gold-700">{ar ? 'أحدث الإلغاءات' : 'Recent cancellations'}</h2></CardHeader>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">{ar ? 'المرجع' : 'Reference'}</th>
                <th className="px-4 py-3 text-start">{ar ? 'الحالة' : 'Status'}</th>
                <th className="px-4 py-3 text-start">{ar ? 'العميل' : 'Customer'}</th>
                <th className="px-4 py-3 text-start">{ar ? 'الخدمة' : 'Service'}</th>
                <th className="px-4 py-3 text-end">{ar ? 'الإجمالي' : 'Total'}</th>
                <th className="px-4 py-3 text-end">{ar ? 'المسترد' : 'Refunded'}</th>
                <th className="px-4 py-3 text-start">{ar ? 'أُلغي في' : 'Cancelled at'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {r.preview.map((b, i) => (
                <tr key={i}>
                  <td className="px-4 py-3 font-display text-gold-700">{b.reference}</td>
                  <td className="px-4 py-3"><BookingStatusBadge status={b.status} /></td>
                  <td className="px-4 py-3 text-foreground/80">{b.customer}</td>
                  <td className="px-4 py-3 text-muted-foreground">{ar ? b.serviceNameAr : b.serviceNameEn}</td>
                  <td className="px-4 py-3 text-end tabular-nums">{money(b.totalCents)}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-gold-700">{money(b.refundedCents)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{dt(b.cancelledAt)}</td>
                </tr>
              ))}
              {r.preview.length === 0 ? <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">{t('empty')}</td></tr> : null}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  );
}

/* ── Sanctions ── */
async function SanctionsTab({ range, locale, money }: { range: Range; locale: 'ar' | 'en'; money: MoneyFn }) {
  const t = await getTranslations('reports');
  const r = await getSanctionsReport(range);
  const ar = locale === 'ar';
  const dt = (d: Date | null) => (d ? formatDate(d, locale, { dateStyle: 'short', timeStyle: 'short' }) : '—');
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={ar ? 'عقوبات صادرة (بالمدى)' : 'Issued (in range)'} value={String(r.issuedCount)} hint={money(r.issuedCents)} />
        <StatCard label={ar ? 'عقوبات نشطة الآن' : 'Active now'} value={String(r.activeCount)} hint={money(r.activeCents)} />
      </div>
      <Card>
        <CardHeader><h2 className="font-display text-base text-gold-700">{ar ? 'العقوبات' : 'Sanctions'}</h2></CardHeader>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">{ar ? 'التاريخ' : 'Issued'}</th>
                <th className="px-4 py-3 text-start">{ar ? 'العميل' : 'Customer'}</th>
                <th className="px-4 py-3 text-start">{ar ? 'الهاتف' : 'Phone'}</th>
                <th className="px-4 py-3 text-end">{ar ? 'المبلغ' : 'Amount'}</th>
                <th className="px-4 py-3 text-start">{ar ? 'السبب' : 'Reason'}</th>
                <th className="px-4 py-3 text-start">{ar ? 'الحالة' : 'Status'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {r.preview.map((s, i) => (
                <tr key={i}>
                  <td className="px-4 py-3 text-muted-foreground">{dt(s.createdAt)}</td>
                  <td className="px-4 py-3 text-foreground/80">{s.customer}</td>
                  <td className="px-4 py-3 text-muted-foreground" dir="ltr">{s.phone}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-gold-700">{money(s.amountCents)}</td>
                  <td className="max-w-[260px] truncate px-4 py-3 text-muted-foreground" title={s.reason}>{s.reason}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.status}</td>
                </tr>
              ))}
              {r.preview.length === 0 ? <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">{t('empty')}</td></tr> : null}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  );
}

/* ── Admin activity (audit) ── */
async function AuditTab({ range, locale }: { range: Range; locale: 'ar' | 'en' }) {
  const t = await getTranslations('reports');
  const r = await getAuditReport(range, locale);
  const ar = locale === 'ar';
  const dt = (d: Date | null) => (d ? formatDate(d, locale, { dateStyle: 'short', timeStyle: 'short' }) : '—');
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={ar ? 'إجمالي الأحداث' : 'Total events'} value={String(r.total)} />
        {r.byAction.slice(0, 3).map((a) => (
          <StatCard key={a.action} label={a.action} value={String(a.count)} />
        ))}
      </div>
      <Card>
        <CardHeader><h2 className="font-display text-base text-gold-700">{ar ? 'أحدث نشاط الإدارة' : 'Recent admin activity'}</h2></CardHeader>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">{ar ? 'التاريخ' : 'When'}</th>
                <th className="px-4 py-3 text-start">{ar ? 'المستخدم' : 'Actor'}</th>
                <th className="px-4 py-3 text-start">{ar ? 'الإجراء' : 'Action'}</th>
                <th className="px-4 py-3 text-start">{ar ? 'الكيان' : 'Entity'}</th>
                <th className="px-4 py-3 text-start">{ar ? 'ما الذي تغيّر' : 'What changed'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {r.preview.map((a, i) => (
                <tr key={i} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{dt(a.createdAt)}</td>
                  <td className="px-4 py-3 text-foreground/80">{a.actor}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{a.action}</td>
                  <td className="px-4 py-3">
                    <div className="text-foreground/80">{a.entityType}</div>
                    {a.service || a.category ? (
                      <div className="text-[11px] font-medium text-gold-700">{a.service ?? a.item ?? ''}{a.category ? ` · ${a.category}` : ''}</div>
                    ) : a.item ? (
                      <div className="text-[11px] text-muted-foreground">{a.item}</div>
                    ) : null}
                  </td>
                  <td className="max-w-[420px] px-4 py-3 text-xs text-muted-foreground" dir="ltr">{a.changes}</td>
                </tr>
              ))}
              {r.preview.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">{t('empty')}</td></tr> : null}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  );
}

/* ── Staff performance (gate / reception operators) ── */
async function StaffTab({ range, locale, money }: { range: Range; locale: 'ar' | 'en'; money: MoneyFn }) {
  const t = await getTranslations('reports');
  const rows = await getStaffDirectory(range);
  const ar = locale === 'ar';
  const dt = (d: Date | null) => (d ? formatDate(d, locale, { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const hrs = (ms: number) => {
    if (ms <= 0) return '—';
    const m = Math.round(ms / 60000);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  };
  const totals = rows.reduce(
    (a, r) => {
      a.bookings += r.rollup.bookings;
      a.scans += r.rollup.gateScans;
      a.revenue += r.rollup.revenueCents;
      a.cash += r.rollup.cashCents;
      a.worked += r.rollup.workedMs;
      return a;
    },
    { bookings: 0, scans: 0, revenue: 0, cash: 0, worked: 0 },
  );
  const active = rows.filter((r) => r.rollup.bookings || r.rollup.gateScans).length;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={ar ? 'موظفون نشطون' : 'Active staff'} value={String(active)} hint={ar ? `${rows.length} إجمالي` : `${rows.length} total`} />
        <StatCard label={ar ? 'صافي الإيراد' : 'Net revenue'} value={money(totals.revenue)} hint={ar ? 'حجوزات الاستقبال' : 'reception bookings'} />
        <StatCard label={ar ? 'نقدي محصّل' : 'Cash collected'} value={money(totals.cash)} />
        <StatCard label={ar ? 'ساعات العمل' : 'Working hours'} value={hrs(totals.worked)} hint={`${totals.scans} ${ar ? 'مسح' : 'scans'}`} />
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-base text-gold-700">{ar ? 'أداء الموظفين' : 'Staff performance'}</h2>
            <Link href="/admin/staff" className="text-xs text-accent underline-offset-4 hover:underline">
              {ar ? 'لوحة الموظفين ←' : 'Staff dashboard →'}
            </Link>
          </div>
        </CardHeader>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">{ar ? 'الموظف' : 'Staff'}</th>
                <th className="px-4 py-3 text-start">{ar ? 'الدور' : 'Role'}</th>
                <th className="px-4 py-3 text-end">{ar ? 'حجوزات' : 'Bookings'}</th>
                <th className="px-4 py-3 text-end">{ar ? 'مسح البوابة' : 'Gate scans'}</th>
                <th className="px-4 py-3 text-end">{ar ? 'دخول' : 'Admitted'}</th>
                <th className="px-4 py-3 text-end">{ar ? 'صافي الإيراد' : 'Net revenue'}</th>
                <th className="px-4 py-3 text-end">{ar ? 'نقدي' : 'Cash'}</th>
                <th className="px-4 py-3 text-end">{ar ? 'ساعات' : 'Worked'}</th>
                <th className="px-4 py-3 text-start">{ar ? 'آخر نشاط' : 'Last active'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rows.map((r) => (
                <tr key={r.id} className="align-top hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/admin/staff/${r.id}`} className="text-accent underline-offset-4 hover:underline">{r.name}</Link>
                    {!r.active ? <span className="ms-2 text-xs text-red-700">{ar ? 'غير نشط' : 'inactive'}</span> : null}
                  </td>
                  <td className="px-4 py-3"><Badge tone={ROLE_TONES[r.role] ?? 'navy'}>{r.role}</Badge></td>
                  <td className="px-4 py-3 text-end tabular-nums">{r.rollup.bookings || '—'}</td>
                  <td className="px-4 py-3 text-end tabular-nums">{r.rollup.gateScans || '—'}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-green-700">{r.rollup.admittedPeople || '—'}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-gold-700">{r.rollup.revenueCents ? money(r.rollup.revenueCents) : '—'}</td>
                  <td className="px-4 py-3 text-end tabular-nums text-muted-foreground">{r.rollup.cashCents ? money(r.rollup.cashCents) : '—'}</td>
                  <td className="px-4 py-3 text-end tabular-nums">
                    {r.rollup.workedMs > 0 ? (
                      hrs(r.rollup.workedMs)
                    ) : r.rollup.scanWindowMs > 0 ? (
                      <span className="text-muted-foreground" title={ar ? 'نافذة النشاط' : 'activity window'}>{hrs(r.rollup.scanWindowMs)}*</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground" dir="ltr">{dt(r.lastActiveAt)}</td>
                </tr>
              ))}
              {rows.length === 0 ? <tr><td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">{t('empty')}</td></tr> : null}
            </tbody>
          </table>
        </CardBody>
      </Card>
      <p className="text-xs text-muted-foreground">
        {ar
          ? 'صافي الإيراد = قيمة الفواتير المدفوعة (بعد الاسترداد) لحجوزات الموظف؛ النقدي = ما تم تحصيله فعليًا في الاستقبال — لا يُجمعان معًا. * = نافذة النشاط (أول→آخر مسح) للأيام السابقة لبدء تتبّع ساعات العمل.'
          : 'Net revenue = paid-invoice value (after refunds) for the staffer’s bookings; cash = what was physically collected at reception — the two are never added together. * = activity window (first→last scan) for days before working-hours tracking began.'}
      </p>
    </>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-2 py-10 text-center text-sm text-muted-foreground">{text}</p>;
}

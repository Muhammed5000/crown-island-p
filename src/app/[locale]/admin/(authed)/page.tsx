import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { BookingStatusBadge } from '@/components/booking/BookingStatusBadge';
import { Link } from '@/i18n/navigation';
import { prisma } from '@/server/db/prisma';
import { formatMoney } from '@/lib/money';
import { splitPaidInvoice } from '@/server/services/report-math';
import { formatDate } from '@/lib/date';
import { isLocale } from '@/i18n/config';
import { RevenueChart, CategoryChart, StatusChart } from './DashboardCharts';

export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const t = await getTranslations('admin');

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    bookingsToday,
    pendingPayment,
    monthRevenue,
    recent,
    revenueByDay,
    bookingsByService,
    serviceCategories,
    bookingsByStatus,
  ] = await Promise.all([
    prisma.booking.count({
      where: { status: 'CONFIRMED', bookingDate: today },
    }),
    prisma.booking.count({ where: { status: 'PENDING_PAYMENT' } }),
    prisma.invoice.findMany({
      where: { status: 'PAID', paidAt: { gte: startOfMonth } },
      select: {
        totalCents: true,
        refunds: { select: { amountCents: true, kind: true } },
        booking: { select: { insurance: { select: { amountCents: true, collectionStatus: true } } } },
      },
    }),
    prisma.booking.findMany({
      include: { service: { include: { category: true } }, invoice: true },
      orderBy: { createdAt: 'desc' },
      take: 8,
    }),
    // Data for charts
    prisma.invoice.findMany({
      where: { status: 'PAID', paidAt: { gte: thirtyDaysAgo } },
      select: {
        totalCents: true,
        paidAt: true,
        refunds: { select: { amountCents: true, kind: true } },
        booking: { select: { insurance: { select: { amountCents: true, collectionStatus: true } } } },
      },
      orderBy: { paidAt: 'asc' },
    }),
    // Count bookings per service (bounded by the catalog size) and roll up to
    // category below, instead of loading the entire Booking table just to bucket
    // by category name.
    prisma.booking.groupBy({
      by: ['serviceId'],
      _count: { _all: true },
    }),
    prisma.service.findMany({
      select: { id: true, category: { select: { nameEn: true } } },
    }),
    prisma.booking.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
  ]);

  // Revenue figures are SERVICE-net: refunded bookings stop counting AND the
  // collected insurance deposit (a liability inside totalCents) never counts.
  const monthRevenueCents = monthRevenue.reduce(
    (sum, inv) => sum + splitPaidInvoice(inv.totalCents, inv.refunds, inv.booking?.insurance).serviceNetCents,
    0,
  );

  // Process revenue data
  const revenueMap = new Map<string, number>();
  revenueByDay.forEach((inv) => {
    if (!inv.paidAt) return;
    const day = inv.paidAt.toISOString().split('T')[0];
    if (day) revenueMap.set(day, (revenueMap.get(day) ?? 0) + splitPaidInvoice(inv.totalCents, inv.refunds, inv.booking?.insurance).serviceNetCents / 100);
  });

  const chartRevenue = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    const day = d.toISOString().split('T')[0];
    return {
      date: formatDate(d, locale, { day: 'numeric', month: 'short' }),
      amount: day ? Math.round(revenueMap.get(day) ?? 0) : 0,
    };
  });

  // Process category data — roll the per-service booking counts up to their
  // category (avoids loading the entire Booking table just to bucket by name).
  const serviceCategoryName = new Map(serviceCategories.map((s) => [s.id, s.category.nameEn]));
  const categoryMap = new Map<string, number>();
  bookingsByService.forEach((g) => {
    const name = g.serviceId ? serviceCategoryName.get(g.serviceId) : undefined;
    if (name) categoryMap.set(name, (categoryMap.get(name) ?? 0) + g._count._all);
  });
  const chartCategories = Array.from(categoryMap.entries()).map(([name, count]) => ({
    name,
    count,
  }));

  // Process status data
  const chartStatus = bookingsByStatus.map((s) => ({
    status: s.status,
    count: s._count._all,
  }));

  const metrics = [
    {
      label: t('cards.todayConfirmed'),
      value: String(bookingsToday),
    },
    {
      label: t('cards.awaitingPayment'),
      value: String(pendingPayment),
    },
    {
      label: t('cards.monthRevenue'),
      value: formatMoney(monthRevenueCents, { locale, currency: 'EGP' }),
    },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-gold-700">{t('dashboard')}</h1>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {metrics.map((m) => (
          <Card key={m.label}>
            <CardBody>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{m.label}</p>
              <p className="mt-2 font-display text-3xl font-semibold text-gold-700 tabular-nums">
                {m.value}
              </p>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('cards.revenueTrend')}</h2>
          </CardHeader>
          <CardBody>
            <RevenueChart data={chartRevenue} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('cards.byCategory')}</h2>
          </CardHeader>
          <CardBody>
            <CategoryChart data={chartCategories} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-display text-base text-gold-700">{t('cards.byStatus')}</h2>
          </CardHeader>
          <CardBody>
            <StatusChart data={chartStatus} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-display text-base text-gold-700">{t('cards.latest')}</h2>
        </CardHeader>
        <CardBody className="p-0">
          <div className="divide-y divide-border/40">
            {recent.map((b) => (
              <Link
                key={b.id}
                href={`/admin/bookings/${b.id}`}
                className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">
                    {locale === 'ar' ? b.service.nameAr : b.service.nameEn} ·{' '}
                    {locale === 'ar' ? b.service.category.nameAr : b.service.category.nameEn}
                  </p>
                  <p dir="ltr" className="text-xs text-muted-foreground">
                    {b.reference} · {formatDate(b.bookingDate, locale)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm tabular-nums text-foreground">
                    {b.invoice
                      ? formatMoney(b.invoice.totalCents, { locale, currency: 'EGP' })
                      : '—'}
                  </span>
                  <BookingStatusBadge status={b.status} />
                </div>
              </Link>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

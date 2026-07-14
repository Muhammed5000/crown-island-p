import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { prisma } from '@/server/db/prisma';
import { formatMoney } from '@/lib/money';
import { isLocale } from '@/i18n/config';
import { Pagination } from '@/components/ui/Pagination';
import { ServiceDeleteButton } from './ServiceDeleteButton';

export default async function AdminServicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const sp = await searchParams;
  const t = await getTranslations('admin');
  
  const page = sp.page ? parseInt(sp.page, 10) : 1;
  const pageSize = 20;

  const [total, services] = await Promise.all([
    prisma.service.count(),
    prisma.service.findMany({
      include: { category: true, _count: { select: { bookings: true } } },
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-foreground">{t('services')}</h1>
        <Link
          href="/admin/services/new"
          className="inline-flex h-10 items-center justify-center rounded-2xl bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          {t('newService')}
        </Link>
      </header>

      <Card>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">category</th>
                <th className="px-4 py-3 text-start">slug</th>
                <th className="px-4 py-3 text-start">name</th>
                <th className="px-4 py-3 text-start">kind</th>
                <th className="px-4 py-3 text-end">base price</th>
                <th className="px-4 py-3 text-end">bookings</th>
                <th className="px-4 py-3 text-end">{t('active')}</th>
                <th className="px-4 py-3 text-end" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {services.map((s) => (
                <tr key={s.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 text-muted-foreground" dir="ltr">
                    {s.category.slug}
                  </td>
                  <td className="px-4 py-3" dir="ltr">
                    {s.slug}
                  </td>
                  <td className="px-4 py-3">{locale === 'ar' ? s.nameAr : s.nameEn}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.kind}</td>
                  <td className="px-4 py-3 text-end tabular-nums">
                    {formatMoney(s.basePriceCents, { locale, currency: 'EGP' })}
                  </td>
                  <td className="px-4 py-3 text-end tabular-nums text-muted-foreground">
                    {s._count.bookings}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {s.isActive ? (
                      <Badge tone="success">{t('active')}</Badge>
                    ) : (
                      <Badge tone="muted">{t('inactive')}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-end">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/admin/services/${s.id}/edit`}
                        className="text-xs text-gold-600 underline-offset-4 hover:underline"
                      >
                        ✎
                      </Link>
                      <ServiceDeleteButton
                        id={s.id}
                        name={locale === 'ar' ? s.nameAr : s.nameEn}
                        bookingCount={s._count.bookings}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Pagination
        currentPage={page}
        totalPages={Math.ceil(total / pageSize)}
        baseUrl="/admin/services"
        searchParams={sp}
      />
    </div>
  );
}

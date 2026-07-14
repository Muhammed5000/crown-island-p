import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { prisma } from '@/server/db/prisma';
import { isLocale } from '@/i18n/config';
import { CategoryDeleteButton } from '../categories/CategoryDeleteButton';

/**
 * Admin → Activities categories.
 *
 * A parallel of the (beach) categories list, scoped to `type: ACTIVITY`. Each
 * row links to edit the category, add a service that's pre-filtered to it, and
 * delete (which re-homes services via the shared CategoryDeleteButton).
 */
export default async function AdminActivitiesCategoriesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const t = await getTranslations('admin');
  const categories = await prisma.category.findMany({
    where: { type: 'ACTIVITY' },
    include: { _count: { select: { services: true } } },
    orderBy: { sortOrder: 'asc' },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-foreground">
          {t('activitiesCategories')}
        </h1>
        <Link
          href="/admin/activities-categories/new"
          className="inline-flex h-10 items-center justify-center rounded-2xl bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          {t('newActivityCategory')}
        </Link>
      </header>

      <Card>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start">slug</th>
                <th className="px-4 py-3 text-start">name (EN)</th>
                <th className="px-4 py-3 text-start">name (AR)</th>
                <th className="px-4 py-3 text-end">services</th>
                <th className="px-4 py-3 text-end">{t('active')}</th>
                <th className="px-4 py-3 text-end" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {categories.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    No activities categories yet.
                  </td>
                </tr>
              ) : (
                categories.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3" dir="ltr">
                      {c.slug}
                    </td>
                    <td className="px-4 py-3" dir="ltr">
                      {c.nameEn}
                    </td>
                    <td className="px-4 py-3">{c.nameAr}</td>
                    <td className="px-4 py-3 text-end tabular-nums">{c._count.services}</td>
                    <td className="px-4 py-3 text-end">
                      {c.isActive ? (
                        <Badge tone="success">{t('active')}</Badge>
                      ) : (
                        <Badge tone="muted">{t('inactive')}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-end">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/admin/activities-categories/${c.id}/services/new`}
                          className="text-xs text-gold-600 underline-offset-4 hover:underline"
                        >
                          ＋ service
                        </Link>
                        <Link
                          href={`/admin/activities-categories/${c.id}/edit`}
                          className="text-xs text-gold-600 underline-offset-4 hover:underline"
                        >
                          ✎ edit
                        </Link>
                        <CategoryDeleteButton id={c.id} name={c.nameEn} serviceCount={c._count.services} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}

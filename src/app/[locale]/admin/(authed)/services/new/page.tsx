import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ServiceForm } from '../ServiceForm';
import { createServiceAction } from '@/features/admin/catalog-actions';
import { prisma } from '@/server/db/prisma';
import { isLocale } from '@/i18n/config';

export default async function NewServicePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const categories = await prisma.category.findMany({
    select: { id: true, slug: true, nameEn: true },
    orderBy: { sortOrder: 'asc' },
  });

  const t = await getTranslations('admin');
  const tCommon = await getTranslations('common');

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold text-foreground">{t('newService')}</h1>
      <ServiceForm
        action={createServiceAction}
        categories={categories}
        submitLabel={tCommon('save')}
      />
    </div>
  );
}

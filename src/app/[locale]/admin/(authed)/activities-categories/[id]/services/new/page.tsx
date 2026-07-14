import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ServiceForm } from '../../../../services/ServiceForm';
import { createServiceAction } from '@/features/admin/catalog-actions';
import { prisma } from '@/server/db/prisma';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

/**
 * Add a service to a specific activities category. The ServiceForm's category
 * dropdown is pre-filtered to this single category, so the service is always
 * created under it (reuses the shared createServiceAction).
 */
export default async function NewActivityServicePage({ params }: Props) {
  const { locale, id } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const category = await prisma.category.findUnique({
    where: { id },
    select: { id: true, slug: true, nameEn: true, type: true },
  });
  if (!category || category.type !== 'ACTIVITY') notFound();

  const t = await getTranslations('admin');
  const tCommon = await getTranslations('common');

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold text-foreground">
        {t('newService')} · {category.nameEn}
      </h1>
      <ServiceForm
        action={createServiceAction}
        categories={[{ id: category.id, slug: category.slug, nameEn: category.nameEn }]}
        defaultValues={{ categoryId: category.id }}
        submitLabel={tCommon('save')}
      />
    </div>
  );
}

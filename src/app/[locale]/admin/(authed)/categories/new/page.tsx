import { setRequestLocale, getTranslations } from 'next-intl/server';
import { CategoryForm } from '../CategoryForm';
import { createCategoryAction } from '@/features/admin/catalog-actions';
import { isLocale } from '@/i18n/config';

export default async function NewCategoryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const t = await getTranslations('admin');
  const tCommon = await getTranslations('common');

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold text-foreground">{t('newCategory')}</h1>
      <CategoryForm action={createCategoryAction} submitLabel={tCommon('save')} />
    </div>
  );
}

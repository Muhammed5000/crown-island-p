import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { CategoryForm } from '../../../categories/CategoryForm';
import { updateCategoryAction } from '@/features/admin/catalog-actions';
import { prisma } from '@/server/db/prisma';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditActivityCategoryPage({ params }: Props) {
  const { locale, id } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const category = await prisma.category.findUnique({ where: { id } });
  if (!category) notFound();

  const t = await getTranslations('admin');
  const tCommon = await getTranslations('common');

  const update = updateCategoryAction.bind(null, id);

  // about-page JSON arrays ↔ newline-separated textareas (same as beach edit).
  const linesFromJson = (raw: unknown): string =>
    Array.isArray(raw) ? raw.filter((v) => typeof v === 'string').join('\n') : '';

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold text-foreground">
        {t('activitiesCategories')} · {category.slug}
      </h1>
      <CategoryForm
        action={update}
        type={category.type}
        submitLabel={tCommon('save')}
        defaultValues={{
          slug: category.slug,
          nameEn: category.nameEn,
          nameAr: category.nameAr,
          descEn: category.descEn ?? '',
          descAr: category.descAr ?? '',
          longDescEn: category.longDescEn ?? '',
          longDescAr: category.longDescAr ?? '',
          coverUrl: category.coverUrl ?? '',
          galleryUrls: linesFromJson(category.galleryUrls),
          videoUrl: category.videoUrl ?? '',
          highlightsEn: linesFromJson(category.highlightsEn),
          highlightsAr: linesFromJson(category.highlightsAr),
          termsEn: linesFromJson(category.termsEn),
          termsAr: linesFromJson(category.termsAr),
          latitude: category.latitude,
          longitude: category.longitude,
          addressEn: category.addressEn ?? '',
          addressAr: category.addressAr ?? '',
          isActive: category.isActive,
          sortOrder: category.sortOrder,
        }}
      />
    </div>
  );
}

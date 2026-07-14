import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { CategoryForm } from '../../CategoryForm';
import { updateCategoryAction } from '@/features/admin/catalog-actions';
import { prisma } from '@/server/db/prisma';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditCategoryPage({ params }: Props) {
  const { locale, id } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const category = await prisma.category.findUnique({ where: { id } });
  if (!category) notFound();

  const t = await getTranslations('admin');
  const tCommon = await getTranslations('common');

  const update = updateCategoryAction.bind(null, id);

  // The about-page fields are stored as JSON arrays in SQLite but the form
  // exposes them as newline-separated textareas, so flip them back here.
  const linesFromJson = (raw: unknown): string =>
    Array.isArray(raw) ? raw.filter((v) => typeof v === 'string').join('\n') : '';

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold text-foreground">
        {t('categories')} · {category.slug}
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
          logoUrl: category.logoUrl ?? '',
          logoDarkUrl: category.logoDarkUrl ?? '',
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
          minAge: category.minAge,
          isActive: category.isActive,
          sortOrder: category.sortOrder,
        }}
      />
    </div>
  );
}

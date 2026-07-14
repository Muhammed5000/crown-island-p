import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ServiceForm } from '../../ServiceForm';
import { updateServiceAction } from '@/features/admin/catalog-actions';
import { prisma } from '@/server/db/prisma';
import { isLocale } from '@/i18n/config';
import { Link } from '@/i18n/navigation';

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

export default async function EditServicePage({ params }: Props) {
  const { locale, id } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  // Pull the auto-managed PER_CAR rule alongside the service so the form can
  // pre-fill the "price per car" input. We only look at the priority-10 base
  // rules (the ones the admin form owns); custom rules are left alone.
  const [service, categories] = await Promise.all([
    prisma.service.findUnique({
      where: { id },
      include: {
        priceRules: {
          where: { kind: 'PER_CAR', priority: 10, isActive: true },
          select: { amountCents: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    }),
    prisma.category.findMany({
      select: { id: true, slug: true, nameEn: true },
      orderBy: { sortOrder: 'asc' },
    }),
  ]);
  if (!service) notFound();
  const perCarPriceCents = service.priceRules[0]?.amountCents ?? 0;

  const t = await getTranslations('admin');
  const tCommon = await getTranslations('common');
  const update = updateServiceAction.bind(null, id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-semibold text-foreground">
          {t('services')} · {service.slug}
        </h1>
        <Link
          href={`/admin/services/${id}/places`}
          className="rounded-xl border border-gold-400/40 px-3 py-1.5 text-sm text-gold-600 hover:bg-gold-400/10"
        >
          manage places →
        </Link>
      </div>
      <ServiceForm
        action={update}
        categories={categories}
        submitLabel={tCommon('save')}
        defaultValues={{
          categoryId: service.categoryId,
          slug: service.slug,
          nameEn: service.nameEn,
          nameAr: service.nameAr,
          descEn: service.descEn ?? '',
          descAr: service.descAr ?? '',
          longDescEn: service.longDescEn,
          longDescAr: service.longDescAr,
          highlightsEn: asStringArray(service.highlightsEn),
          highlightsAr: asStringArray(service.highlightsAr),
          galleryUrls: asStringArray(service.galleryUrls),
          kind: service.kind,
          coverUrl: service.coverUrl ?? '',
          basePriceCents: service.basePriceCents,
          extraPersonPriceCents: service.extraPersonPriceCents,
          perCarPriceCents,
          includedPersonsPerUnit: service.includedPersonsPerUnit,
          maxPersonsPerUnit: service.maxPersonsPerUnit,
          allowExtraPeople: service.allowExtraPeople,
          extraPersonMode: service.extraPersonMode,
          maxExtraPersonsPerUnit: service.maxExtraPersonsPerUnit,
          allowChildren: service.allowChildren,
          maxChildAge: service.maxChildAge,
          freeChildrenPerUnit: service.freeChildrenPerUnit,
          maxChildrenPerBooking: service.maxChildrenPerBooking,
          extraChildPriceCents: service.extraChildPriceCents,
          childrenCountAsPersons: service.childrenCountAsPersons,
          insuranceEnabled: service.insuranceEnabled,
          insuranceType: service.insuranceType,
          insurancePercent: service.insurancePercent,
          insuranceFixedCents: service.insuranceFixedCents,
          allowMultiDay: service.allowMultiDay,
          maxBookingDays: service.maxBookingDays,
          placeAssignmentRequired: service.placeAssignmentRequired,
          placeType: service.placeType,
          requiresAccessControl: service.requiresAccessControl,
          dailyCapacityPeople: service.dailyCapacityPeople,
          dailyCapacityCars: service.dailyCapacityCars,
          maxPeoplePerBooking: service.maxPeoplePerBooking,
          maxCarsPerBooking: service.maxCarsPerBooking,
          openTime: service.openTime,
          closeTime: service.closeTime,
          isActive: service.isActive,
          sortOrder: service.sortOrder,
        }}
      />
    </div>
  );
}

function asStringArray(v: unknown): string[] | null {
  if (Array.isArray(v)) return v.filter((i) => typeof i === 'string');
  return null;
}


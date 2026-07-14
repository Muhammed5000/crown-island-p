import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireReceptionOrNull } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { isLocale } from '@/i18n/config';
import { ReceptionDesk, type ReceptionCategory } from '@/components/gate/ReceptionDesk';

interface Props {
  params: Promise<{ locale: string }>;
}

/**
 * Reception Booking desk (`/gate/reception`).
 *
 * Reception-authorised staff (STAFF + admin tiers) create bookings for walk-in
 * customers who have no website account. SECURITY is explicitly excluded here
 * AND in the gate layout's switch — `requireReceptionOrNull` returns null for
 * them, so they get a 403 instead of the desk.
 */
export default async function ReceptionPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const t = await getTranslations('reception.desk');
  const staff = await requireReceptionOrNull();
  if (!staff) {
    return (
      <main dir="ltr" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div
          style={{
            maxWidth: 380,
            textAlign: 'center',
            padding: '32px 28px',
            borderRadius: 20,
            background: '#ffffff',
            border: '1px solid rgba(28,43,64,0.12)',
            boxShadow: '0 10px 30px rgba(28,43,64,0.08)',
            color: '#1c2b40',
            fontFamily: 'var(--font-aurelia-sans), system-ui, sans-serif',
          }}
        >
          <p style={{ fontFamily: 'var(--font-aurelia-display), serif', fontSize: 28, fontWeight: 600, color: '#9c7d34', margin: 0 }}>
            403
          </p>
          <h1 style={{ fontSize: 16, fontWeight: 600, margin: '12px 0 8px' }}>{t('forbidden403.title')}</h1>
          <p style={{ fontSize: 13, lineHeight: 1.5, color: 'rgba(28,43,64,0.62)', margin: 0 }}>
            {t('forbidden403.body')}
          </p>
        </div>
      </main>
    );
  }

  const ar = locale === 'ar';
  const rows = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    include: {
      services: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }] },
    },
  });

  // Include EVERY active category — beaches and activities alike. Categories
  // with no services yet still appear (the desk disables booking + shows a
  // hint for them) so reception mirrors the customer-facing catalog.
  const categories: ReceptionCategory[] = rows.map((c) => ({
    id: c.id,
    name: ar ? c.nameAr : c.nameEn,
    isActivity: c.type === 'ACTIVITY',
    services: c.services.map((s) => ({
      id: s.id,
      name: ar ? s.nameAr : s.nameEn,
      priceCents: s.basePriceCents,
      kind: s.kind,
      maxPeople: s.maxPeoplePerBooking,
      maxCars: s.maxCarsPerBooking,
      includedPersonsPerUnit: s.includedPersonsPerUnit,
      requiresPlacement: s.placeAssignmentRequired,
      allowChildren: s.allowChildren,
      maxChildAge: s.maxChildAge,
      allowMultiDay: s.allowMultiDay,
      maxBookingDays: s.maxBookingDays,
      allowExtraPeople: s.allowExtraPeople,
      extraPersonPriceCents: s.extraPersonPriceCents,
      maxExtraPersonsPerUnit: s.maxExtraPersonsPerUnit,
    })),
  }));

  return (
    <ReceptionDesk
      locale={locale}
      staffName={staff.name ?? staff.email ?? t('shell.staffFallback')}
      categories={categories}
    />
  );
}

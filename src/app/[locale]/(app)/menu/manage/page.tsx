import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  CheckCircle2Icon,
  ClockIcon,
  EyeIcon,
  ShieldAlertIcon,
  StoreIcon,
  XCircleIcon,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { TopNav } from '@/components/layout/TopNav';
import { Card, CardBody } from '@/components/ui/Card';
import { PageTransition } from '@/components/layout/PageTransition';
import { requireRestaurantOwnerOrNull } from '@/server/auth/guards';
import { getMyRestaurant } from '@/server/services/restaurants';
import { isLocale } from '@/i18n/config';
import { RestaurantProfileForm } from './RestaurantProfileForm';

/**
 * Restaurant partner dashboard — create / edit the profile, upload the cover
 * and menu PDF, and see the moderation status. RESTAURANT-role only: other
 * signed-in users get a friendly "partners only" panel (server-enforced; the
 * save action re-checks the role independently).
 */
export default async function ManageRestaurantPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const owner = await requireRestaurantOwnerOrNull();
  const t = await getTranslations('menu');

  if (!owner) {
    return (
      <PageTransition>
        <TopNav title={t('manageTitle')} locale={locale} />
        <div className="mx-auto max-w-md px-5 pb-10 pt-2">
          <Card variant="glass">
            <CardBody className="flex flex-col items-center gap-4 px-5 py-10 text-center">
              <span className="grid size-14 place-items-center rounded-2xl bg-gold-400/15 text-gold-600">
                <ShieldAlertIcon className="size-7" />
              </span>
              <h2 className="font-display text-xl font-bold text-gold-700">
                {t('partnersOnlyTitle')}
              </h2>
              <p className="max-w-xs text-sm text-muted-foreground">{t('partnersOnlyBody')}</p>
              <Link
                href="/menu"
                className="text-sm font-semibold text-gold-700 underline-offset-4 hover:underline"
              >
                {t('backToRestaurants')}
              </Link>
            </CardBody>
          </Card>
        </div>
      </PageTransition>
    );
  }

  const restaurant = await getMyRestaurant(owner.id);

  const statusBanner = restaurant
    ? {
        PENDING: {
          Icon: ClockIcon,
          text: t('statusPending'),
          cls: 'border-warning/40 bg-warning/10 text-warning',
        },
        APPROVED: {
          Icon: CheckCircle2Icon,
          text: t('statusApproved'),
          cls: 'border-success/40 bg-success/10 text-success',
        },
        REJECTED: {
          Icon: XCircleIcon,
          text: t('statusRejected'),
          cls: 'border-danger/40 bg-danger/10 text-danger',
        },
        DISABLED: {
          Icon: XCircleIcon,
          text: t('statusDisabled'),
          cls: 'border-danger/40 bg-danger/10 text-danger',
        },
      }[restaurant.status]
    : null;

  return (
    <PageTransition>
      <TopNav title={t('manageTitle')} locale={locale} />
      <div className="mx-auto max-w-md px-5 pb-12 pt-2 md:max-w-2xl">
        <div className="mb-5 flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gold-400/15 text-gold-600">
            <StoreIcon className="size-5" />
          </span>
          <div>
            <h1 className="font-display text-xl font-bold text-foreground">{t('manageTitle')}</h1>
            <p className="text-sm text-muted-foreground">{t('manageSubtitle')}</p>
          </div>
        </div>

        {statusBanner ? (
          <div
            className={`mb-3 flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-[13px] font-medium ${statusBanner.cls}`}
          >
            <statusBanner.Icon className="mt-0.5 size-4 shrink-0" />
            <div>
              <p>{statusBanner.text}</p>
              {restaurant?.statusNote && restaurant.status !== 'APPROVED' ? (
                <p className="mt-1 opacity-90">
                  {t('adminNote')}: {restaurant.statusNote}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {restaurant ? (
          <Link
            href={`/menu/${restaurant.id}`}
            className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-gold-700 underline-offset-4 hover:underline"
          >
            <EyeIcon className="size-4" />
            {restaurant.status === 'APPROVED' ? t('viewPublicProfile') : t('previewBanner')}
          </Link>
        ) : null}

        <Card variant="glass">
          <CardBody className="px-5 py-6">
            <RestaurantProfileForm
              initial={
                restaurant
                  ? {
                      name: restaurant.name,
                      description: restaurant.description,
                      phone: restaurant.phone,
                      address: restaurant.address,
                      openingHours: restaurant.openingHours,
                      facebookUrl: restaurant.facebookUrl,
                      instagramUrl: restaurant.instagramUrl,
                      tiktokUrl: restaurant.tiktokUrl,
                      websiteUrl: restaurant.websiteUrl,
                      coverUrl: restaurant.coverUrl,
                      menuPdfUrl: restaurant.menuPdfUrl,
                      menuPdfName: restaurant.menuPdfName,
                      menuPdfSize: restaurant.menuPdfSize,
                    }
                  : null
              }
            />
          </CardBody>
        </Card>
      </div>
    </PageTransition>
  );
}

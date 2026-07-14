import { setRequestLocale, getTranslations } from 'next-intl/server';
import { TopNav } from '@/components/layout/TopNav';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { Card, CardBody } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { PageTransition } from '@/components/layout/PageTransition';
import { SettingsPanel } from './SettingsPanel';
import { SettingsDesktop } from './SettingsDesktop';
import { requireUser } from '@/server/auth/guards';
import { isLocale, type Locale } from '@/i18n/config';
import { prisma } from '@/server/db/prisma';
import { APP_VERSION } from '@/lib/appVersion';

/**
 * User settings: language, theme, sign out.
 *
 * Locale-aware: the language toggle re-navigates via `next-intl` so the same
 * path is served under the alternate locale.
 */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const user = await requireUser();
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      name: true,
      email: true,
      phone: true,
      image: true,
      profile: {
        select: {
          countryCode: true,
          age: true,
          isHandicapped: true,
          nationalId: true,
          passportId: true,
          region: true,
          marketingOpt: true,
          notifyBookingUpdates: true,
          notifyReminders: true,
        },
      },
    },
  });

  const t = await getTranslations('settings');

  const settingsUser = {
    name: dbUser?.name ?? '',
    phone: dbUser?.phone ?? '',
    email: dbUser?.email ?? '',
    countryCode: dbUser?.profile?.countryCode ?? 'EG',
    age: dbUser?.profile?.age ?? null,
    isHandicapped: dbUser?.profile?.isHandicapped ?? false,
    idType: (dbUser?.profile?.passportId ? 'passport' : 'national') as 'national' | 'passport',
    idNumber: dbUser?.profile?.passportId ?? dbUser?.profile?.nationalId ?? '',
    region: dbUser?.profile?.region ?? '',
  };

  const notifications = {
    bookingUpdates: dbUser?.profile?.notifyBookingUpdates ?? true,
    reminders: dbUser?.profile?.notifyReminders ?? true,
    promotions: dbUser?.profile?.marketingOpt ?? false,
  };

  return (
    <PageTransition>
      {/* Mobile + tablet (< xl) — unchanged centered column. */}
      <div className="xl:hidden">
        <TopNav title={t('title')} locale={locale} hideBack trailing={<NotificationBell />} />
        <div className="mx-auto max-w-md px-5 pb-10 pt-2 md:max-w-xl">
          <Card className="mb-4">
            <CardBody className="flex items-center gap-3">
              <Avatar src={dbUser?.image ?? null} name={dbUser?.name ?? null} size={48} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  {dbUser?.name ?? '—'}
                </p>
                <p className="truncate text-xs text-muted-foreground" dir="ltr">
                  {dbUser?.email ?? dbUser?.phone ?? ''}
                </p>
              </div>
            </CardBody>
          </Card>

          <SettingsPanel
            currentLocale={locale as Locale}
            user={settingsUser}
            notifications={notifications}
            appVersion={APP_VERSION}
          />
        </div>
      </div>

      {/* Desktop (≥ xl) — wide-canvas Crown Settings redesign. Hidden below xl
          so the mobile/tablet view above stays byte-identical. */}
      <div className="hidden xl:block">
        <SettingsDesktop
          currentLocale={locale as Locale}
          user={{ ...settingsUser, image: dbUser?.image ?? null }}
          notifications={notifications}
          appVersion={APP_VERSION}
        />
      </div>
    </PageTransition>
  );
}

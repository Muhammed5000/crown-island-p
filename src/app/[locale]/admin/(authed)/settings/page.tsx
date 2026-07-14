import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { SettingsForm } from './SettingsForm';
import { getSettings } from '@/server/settings/settings';
import { isLocale, type Locale } from '@/i18n/config';

/**
 * Admin settings.
 *
 * Top: editable form bound to the `Settings` singleton (brand, booking,
 * notifications, display).
 * Bottom: read-only "Environment health" panel — keeps the old env-var
 * checklist around so operators can verify the runtime keys without leaving
 * the page.
 */
export default async function AdminSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const t = await getTranslations('admin');
  const settings = await getSettings();

  // Env vars surface — purely informational.
  const env = [
    { key: 'NEXT_PUBLIC_APP_URL', value: process.env.NEXT_PUBLIC_APP_URL ?? null },
    { key: 'DATABASE_URL', present: !!process.env.DATABASE_URL },
    { key: 'AUTH_SECRET', present: !!process.env.AUTH_SECRET },
    { key: 'AUTH_GOOGLE_ID', present: !!process.env.AUTH_GOOGLE_ID },
    { key: 'AUTH_FACEBOOK_ID', present: !!process.env.AUTH_FACEBOOK_ID },
    { key: 'AUTH_APPLE_ID', present: !!process.env.AUTH_APPLE_ID },
    { key: 'MPGS_MERCHANT_ID', present: !!process.env.MPGS_MERCHANT_ID },
    { key: 'MPGS_PASSWORD', present: !!process.env.MPGS_PASSWORD },
    { key: 'MPGS_WEBHOOK_SECRET', present: !!process.env.MPGS_WEBHOOK_SECRET },
    { key: 'RESEND_API_KEY', present: !!process.env.RESEND_API_KEY },
    { key: 'ADMIN_BOOTSTRAP_EMAIL', value: process.env.ADMIN_BOOTSTRAP_EMAIL ?? null },
    { key: 'ZK_ACCESS_TOKEN', present: !!process.env.ZK_ACCESS_TOKEN },
  ] as const;

  const zkTokenPresent = !!process.env.ZK_ACCESS_TOKEN?.trim();

  return (
    <div className="space-y-6">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-gold-600">
          CROWN · ADMIN
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-gradient-gold md:text-4xl">
          {t('settings')}
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
          Configure brand identity, booking rules, notification routing, and
          display defaults. Changes apply immediately and are recorded in the
          audit log.
        </p>
        <div className="rule-gold mt-5 max-w-[260px]" />
      </header>

      {/*
        Key on `updatedAt` so the form fully remounts after every save.
        The inputs are uncontrolled (`defaultValue`) — without this key
        React would reconcile the same DOM nodes and keep whatever the
        user last typed, which made it look as if a save had "reverted".
        A new key forces a clean re-read from the DB values above.
      */}
      <SettingsForm
        key={settings.updatedAt.toISOString()}
        initialValues={{
          siteName: settings.siteName,
          supportEmail: settings.supportEmail ?? '',
          supportPhone: settings.supportPhone ?? '',
          adminNotifyEmail: settings.adminNotifyEmail ?? '',
          defaultCurrency: settings.defaultCurrency,
          defaultLocale: (settings.defaultLocale === 'en' ? 'en' : 'ar') as Locale,
          bookingLeadTimeHours: settings.bookingLeadTimeHours,
          cancellationCutoffHours: settings.cancellationCutoffHours,
          holdTtlMinutes: settings.holdTtlMinutes,
          bookingsEnabled: settings.bookingsEnabled,
          heroVideoUrl: settings.heroVideoUrl ?? '',
          heroPosterUrl: settings.heroPosterUrl ?? '',
          supportOpenDay: settings.supportOpenDay,
          supportCloseDay: settings.supportCloseDay,
          supportOpenTime: settings.supportOpenTime,
          supportCloseTime: settings.supportCloseTime,
          zkEnabled: settings.zkEnabled,
          zkServerUrl: settings.zkServerUrl ?? '',
          zkServerPort: settings.zkServerPort,
          zkGuestDeptCode: settings.zkGuestDeptCode ?? '',
        }}
        zkTokenPresent={zkTokenPresent}
      />

      {/* ─── Read-only system info ─── */}
      <Card>
        <CardHeader>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold-600">
            Environment health
          </p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
            Reads the process environment to confirm required keys are present.
            These cannot be edited from the dashboard — change them in your{' '}
            <span className="font-display">.env</span> file and restart the dev server.
          </p>
        </CardHeader>
        <CardBody className="divide-y divide-gold-400/[0.08] p-0">
          {env.map((e) => {
            const ok = 'value' in e ? !!e.value : !!e.present;
            const label = 'value' in e ? (e.value ?? '—') : ok ? 'set' : 'missing';
            return (
              <div
                key={e.key}
                className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
              >
                <span
                  dir="ltr"
                  className="font-display text-[12px] tracking-[0.16em] text-muted-foreground"
                >
                  {e.key}
                </span>
                {ok ? (
                  <Badge tone="success" className="font-display normal-case tracking-normal">
                    {label}
                  </Badge>
                ) : (
                  <Badge tone="muted">missing</Badge>
                )}
              </div>
            );
          })}
        </CardBody>
      </Card>
    </div>
  );
}

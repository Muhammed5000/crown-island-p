'use client';

import { useTransition, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { GlobeIcon, MoonIcon, SunIcon, LogOutIcon, LaptopIcon, UserIcon, ShieldCheckIcon, LockIcon, ChevronRightIcon, BellIcon, FileTextIcon, HelpCircleIcon, InfoIcon } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { useRouter, usePathname, Link } from '@/i18n/navigation';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { AgeSelect } from '@/components/ui/AgeSelect';
import { useTheme, type ThemeMode } from '@/components/providers/ThemeProvider';
import { localeLabels, locales, type Locale } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { updateProfileAction, updatePasswordAction } from '@/features/auth/actions';
import { InstallAppButton } from '@/components/pwa/InstallAppButton';
import { NotificationSettings } from './NotificationSettings';
import { AccountActions } from './AccountActions';
import { COUNTRY_OPTIONS } from '@/lib/countries';
import { EGYPT_REGIONS } from '@/lib/regions';

interface Props {
  currentLocale: Locale;
  user: {
    name: string;
    phone: string;
    email: string;
    countryCode: string;
    age: number | null;
    isHandicapped: boolean;
    idType: 'national' | 'passport';
    idNumber: string;
    region: string;
  };
  notifications: { bookingUpdates: boolean; reminders: boolean; promotions: boolean };
  appVersion: string;
}

/**
 * User-facing preferences:
 *  - Language (AR / EN) — re-navigates the current pathname under the new locale.
 *  - Theme (dark / light / system) — persists via ThemeProvider's localStorage.
 *  - Profile (Name, Phone) - server action to update DB.
 *  - Password (Current, New) - server action to update DB.
 *  - Sign out — Auth.js client-side signOut.
 */
export function SettingsPanel({ currentLocale, user, notifications, appVersion }: Props) {
  const t = useTranslations('settings');
  const tAuth = useTranslations('auth');
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  
  const [isPending, startTransition] = useTransition();
  const [profilePending, startProfileTransition] = useTransition();
  const [passwordPending, startPasswordTransition] = useTransition();

  const [profileStatus, setProfileStatus] = useState<'idle' | 'success' | string>('idle');
  const [passwordStatus, setPasswordStatus] = useState<'idle' | 'success' | string>('idle');
  const [idType, setIdType] = useState<'national' | 'passport'>(user.idType);
  const ar = currentLocale === 'ar';

  function switchLocale(next: Locale) {
    if (next === currentLocale) return;
    startTransition(() => {
      router.replace(pathname, { locale: next });
      router.refresh();
    });
  }

  function doSignOut() {
    startTransition(async () => {
      await signOut({ callbackUrl: '/' });
    });
  }

  async function handleUpdateProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProfileStatus('idle');
    const formData = new FormData(e.currentTarget);
    
    startProfileTransition(async () => {
      const res = await updateProfileAction(formData);
      if (res.ok) {
        setProfileStatus('success');
        router.refresh();
      } else {
        setProfileStatus(res.error || 'update_failed');
      }
    });
  }

  async function handleUpdatePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPasswordStatus('idle');
    const formData = new FormData(e.currentTarget);

    startPasswordTransition(async () => {
      const res = await updatePasswordAction(formData);
      if (res.ok) {
        setPasswordStatus('success');
        (e.target as HTMLFormElement).reset();
      } else {
        setPasswordStatus(res.error || 'update_failed');
      }
    });
  }

  return (
    <div className="space-y-6 pb-20">
      {/* 1. Language & Appearance */}
      <div className="space-y-4">
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-gold-700/80">
              <GlobeIcon className="size-3.5" />
              <span>{t('language')}</span>
            </div>
            <div className="flex gap-2">
              {locales.map((loc) => {
                const active = loc === currentLocale;
                return (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => switchLocale(loc)}
                    disabled={isPending}
                    className={cn(
                      'flex-1 rounded-xl border px-4 py-3 text-sm font-semibold transition-colors',
                      active
                        ? 'border-gold-400 bg-gold-400/15 text-gold-700'
                        : 'border-gold-400/[0.28] bg-transparent text-muted-foreground hover:border-gold-400/40 hover:text-foreground',
                    )}
                  >
                    {localeLabels[loc]}
                  </button>
                );
              })}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-gold-700/80">
              <MoonIcon className="size-3.5" />
              <span>{t('theme')}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <ThemeOption
                icon={<MoonIcon className="size-4" />}
                label={t('themeDark')}
                active={theme === 'dark'}
                onClick={() => setTheme('dark')}
              />
              <ThemeOption
                icon={<SunIcon className="size-4" />}
                label={t('themeLight')}
                active={theme === 'light'}
                onClick={() => setTheme('light')}
              />
              <ThemeOption
                icon={<LaptopIcon className="size-4" />}
                label={t('themeSystem')}
                active={theme === 'system'}
                onClick={() => setTheme('system')}
              />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Download app (PWA install) — hidden automatically when already installed. */}
      <InstallAppButton variant="mobile" />

      {/* 2. Personal Information */}
      <Card>
        <CardBody className="space-y-6">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-gold-700/80">
            <UserIcon className="size-3.5" />
            <span>{t('profileInfo')}</span>
          </div>

          <form onSubmit={handleUpdateProfile} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="fullName">{t('fullName')}</Label>
              <Input
                id="fullName"
                name="fullName"
                defaultValue={user.name}
                required
                autoComplete="name"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">{t('phone')}</Label>
              <div className="flex gap-2">
                <select
                  name="countryCode"
                  defaultValue={user.countryCode}
                  className="h-12 w-28 rounded-xl border border-border bg-card transition-colors px-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/55 focus:border-accent/50"
                >
                  {COUNTRY_OPTIONS.map((c) => (
                    <option key={c.code} value={c.code} className="bg-background text-foreground">
                      {c.flag} +{c.callingCode}
                    </option>
                  ))}
                </select>
                <Input
                  id="phone"
                  name="phone"
                  defaultValue={user.phone}
                  required
                  type="tel"
                  autoComplete="tel"
                  dir="ltr"
                  className="min-w-0 flex-1"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="age">{t('age')}</Label>
              <AgeSelect
                id="age"
                name="age"
                defaultValue={user.age ?? ''}
                placeholder={t('age')}
                className="h-12 w-full rounded-xl border border-border bg-card transition-colors px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/55 focus:border-accent/50"
                optionClassName="bg-background text-foreground"
              />
            </div>

            {/* Identity document — National ID or Passport */}
            <div className="space-y-1.5">
              <Label htmlFor="idType">{t('idDocument')}</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  id="idType"
                  name="idType"
                  value={idType}
                  onChange={(e) => setIdType(e.target.value as 'national' | 'passport')}
                  className="h-12 w-full rounded-xl border border-border bg-card transition-colors px-2 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/55 focus:border-accent/50 sm:w-40 sm:shrink-0"
                >
                  <option value="national" className="bg-background text-foreground">{t('idTypeNational')}</option>
                  <option value="passport" className="bg-background text-foreground">{t('idTypePassport')}</option>
                </select>
                <Input
                  id="idNumber"
                  name="idNumber"
                  defaultValue={user.idNumber}
                  dir="ltr"
                  required
                  inputMode={idType === 'national' ? 'numeric' : 'text'}
                  maxLength={idType === 'national' ? 14 : 15}
                  placeholder={idType === 'national' ? '2xxxxxxxxxxxxx' : 'A1234567'}
                  className="w-full min-w-0 sm:flex-1"
                />
              </div>
            </div>

            {/* Region — Egyptian governorate */}
            <div className="space-y-1.5">
              <Label htmlFor="region">{t('region')}</Label>
              <select
                id="region"
                name="region"
                required
                defaultValue={user.region}
                className="h-12 w-full rounded-xl border border-border bg-card transition-colors px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-accent/55 focus:border-accent/50"
              >
                <option value="" disabled className="bg-background text-muted-foreground">
                  {t('regionPlaceholder')}
                </option>
                {EGYPT_REGIONS.map((r) => (
                  <option key={r.value} value={r.value} className="bg-background text-foreground">
                    {ar ? r.ar : r.value}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <input
                id="isHandicapped"
                name="isHandicapped"
                type="checkbox"
                defaultChecked={user.isHandicapped}
                className="size-5 rounded border-gold-400/40 bg-background text-gold-400 focus:ring-gold-400/60"
              />
              <Label htmlFor="isHandicapped" className="!mb-0 cursor-pointer">
                {t('accessibilityAssistance')}
              </Label>
            </div>

            {profileStatus === 'success' && (
              <p className="text-xs font-medium text-green-600">{t('profileUpdated')}</p>
            )}
            {profileStatus !== 'idle' && profileStatus !== 'success' && (
              <p className="text-xs font-medium text-red-600">
                {profileStatus === 'phone_taken' ? t('errors.phone_taken') :
                 profileStatus === 'invalid_phone' ? 'Invalid phone number for the selected country.' :
                 profileStatus === 'invalid_id' ? t('idInvalid') :
                 profileStatus === 'invalid_region' ? t('regionInvalid') :
                 t('errors.update_failed')}
              </p>
            )}

            <Button
              type="submit"
              variant="primary"
              size="sm"
              fullWidth
              loading={profilePending}
            >
              {t('updateProfile')}
            </Button>
          </form>
        </CardBody>
      </Card>

      {/* 3. Password / Security */}
      <Card>
        <CardBody className="space-y-6">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-gold-700/80">
            <ShieldCheckIcon className="size-3.5" />
            <span>{t('changePassword')}</span>
          </div>

          <form onSubmit={handleUpdatePassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="currentPassword">{t('currentPassword')}</Label>
              <Input
                id="currentPassword"
                name="currentPassword"
                type="password"
                required
                autoComplete="current-password"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="newPassword">{t('newPassword')}</Label>
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                required
                autoComplete="new-password"
                placeholder={tAuth('passwordPlaceholder')}
              />
              <p className="text-[10px] text-muted-foreground/60">{tAuth('passwordRule')}</p>
            </div>

            {passwordStatus === 'success' && (
              <p className="text-xs font-medium text-green-600">{t('passwordUpdated')}</p>
            )}
            {passwordStatus !== 'idle' && passwordStatus !== 'success' && (
              <p className="text-xs font-medium text-red-600">
                {passwordStatus === 'incorrect_password' ? t('errors.incorrect_password') :
                 passwordStatus === 'weak_password' ? tAuth('weakPassword') :
                 t('errors.update_failed')}
              </p>
            )}

            <Button
              type="submit"
              variant="outline"
              size="sm"
              fullWidth
              loading={passwordPending}
            >
              {t('updatePassword')}
            </Button>
          </form>
        </CardBody>
      </Card>

      {/* 4. Notifications */}
      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-gold-700/80">
            <BellIcon className="size-3.5" />
            <span>{t('notifications')}</span>
          </div>
          <NotificationSettings initial={notifications} />
        </CardBody>
      </Card>

      {/* 5. Legal & Support */}
      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-gold-700/80">
            <FileTextIcon className="size-3.5" />
            <span>{t('legalSupport')}</span>
          </div>
          <div>
            <NavLinkRow href="/privacy-policy" icon={<LockIcon className="size-4" strokeWidth={1.9} />} label={t('privacyPolicy')} />
            <NavLinkRow href="/terms-gate" icon={<FileTextIcon className="size-4" strokeWidth={1.9} />} label={t('termsConditions')} />
            <NavLinkRow href="/support" icon={<HelpCircleIcon className="size-4" strokeWidth={1.9} />} label={t('helpSupport')} />
          </div>
        </CardBody>
      </Card>

      {/* 6. About */}
      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-gold-700/80">
            <InfoIcon className="size-3.5" />
            <span>{t('about')}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{t('appVersion')}</span>
            <span dir="ltr" className="font-mono text-xs font-semibold text-foreground">v{appVersion}</span>
          </div>
          <p className="text-xs text-muted-foreground">{t('aboutTagline')}</p>
        </CardBody>
      </Card>

      {/* 7. Account */}
      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-gold-700/80">
            <UserIcon className="size-3.5" />
            <span>{t('account')}</span>
          </div>
          <AccountActions />
          <Button
            variant="ghost"
            size="lg"
            fullWidth
            onClick={doSignOut}
            loading={isPending}
            className="text-red-600 hover:bg-red-500/10 hover:text-red-700"
          >
            <LogOutIcon className="size-4" />
            <span>{tAuth('signOut')}</span>
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

function NavLinkRow({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl px-1 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted/50"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gold-400/12 text-gold-700 ring-1 ring-gold-400/25">
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      <ChevronRightIcon className="size-4 text-muted-foreground/60 rtl:-scale-x-100" />
    </Link>
  );
}

function ThemeOption({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-semibold transition-colors',
        active
          ? 'border-gold-400 bg-gold-400/15 text-gold-700'
          : 'border-gold-400/[0.28] text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export type { ThemeMode };

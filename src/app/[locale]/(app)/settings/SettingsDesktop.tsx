'use client';

import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  BellIcon,
  ChevronRightIcon,
  CrownIcon,
  EyeIcon,
  EyeOffIcon,
  FileTextIcon,
  HelpCircleIcon,
  InfoIcon,
  LaptopIcon,
  LockIcon,
  LogOutIcon,
  MoonIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SunIcon,
  UserIcon,
} from 'lucide-react';
import { signOut } from 'next-auth/react';
import { useRouter, usePathname, Link } from '@/i18n/navigation';
import { Avatar } from '@/components/ui/Avatar';
import { AgeSelect } from '@/components/ui/AgeSelect';
import { useTheme } from '@/components/providers/ThemeProvider';
import { localeLabels, locales, type Locale } from '@/i18n/config';
import { cn } from '@/lib/cn';
import { updateProfileAction, updatePasswordAction } from '@/features/auth/actions';
import { InstallAppButton } from '@/components/pwa/InstallAppButton';
import { NotificationSettings } from './NotificationSettings';
import { AccountActions } from './AccountActions';
import { EGYPT_REGIONS } from '@/lib/regions';
import { COUNTRY_OPTIONS } from '@/lib/countries';

interface Props {
  currentLocale: Locale;
  user: {
    name: string;
    phone: string;
    email: string;
    image?: string | null;
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

type SectionId = 'preferences' | 'personal' | 'security' | 'notifications' | 'legal' | 'about' | 'account';

/**
 * Desktop (≥ xl) redesign of the settings page, built from the Claude Design
 * handoff "Crown Settings Desktop.html".
 *
 * Two-column layout filling the wide canvas:
 *  - LEFT (sticky): identity card (avatar, name, email, "Crown Member" badge)
 *    + a section nav that smooth-scrolls and scroll-spies, with Sign out as a
 *    separated danger action.
 *  - RIGHT: grouped panels — Preferences (Language + Theme segmented controls),
 *    Personal information (name + phone), Security (current/new password with
 *    show-hide toggles and a live strength meter).
 *
 * Every control is wired to the SAME state, handlers, server actions and
 * translations as the mobile `SettingsPanel`. The left icon rail / breadcrumb
 * are provided by the authenticated `AppShell`, so they're not re-implemented.
 */
export function SettingsDesktop({ currentLocale, user, notifications, appVersion }: Props) {
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

  // Controlled fields (the design uses live inputs + a strength meter).
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone);
  const [countryCode, setCountryCode] = useState(user.countryCode);
  const [age, setAge] = useState(user.age?.toString() ?? '');
  const [isHandicapped, setIsHandicapped] = useState(user.isHandicapped);
  const [idType, setIdType] = useState<'national' | 'passport'>(user.idType);
  const [idNumber, setIdNumber] = useState(user.idNumber);
  const [region, setRegion] = useState(user.region);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [activeNav, setActiveNav] = useState<SectionId>('preferences');

  // ── Scroll-spy: highlight the nav item for the section in view. ──────────
  useEffect(() => {
    const ids: SectionId[] = ['preferences', 'personal', 'security', 'notifications', 'legal', 'about', 'account'];
    const els = ids
      .map((id) => document.getElementById(`sec-${id}`))
      .filter((el): el is HTMLElement => el != null);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActiveNav(visible.target.id.replace('sec-', '') as SectionId);
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: [0.1, 0.5, 1] },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  function scrollToSection(id: SectionId) {
    setActiveNav(id);
    document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

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

  function handleUpdateProfile() {
    setProfileStatus('idle');
    const fd = new FormData();
    fd.append('fullName', name);
    fd.append('phone', phone);
    fd.append('countryCode', countryCode);
    fd.append('age', age);
    fd.append('idType', idType);
    fd.append('idNumber', idNumber);
    fd.append('region', region);
    if (isHandicapped) fd.append('isHandicapped', 'on');

    startProfileTransition(async () => {
      const res = await updateProfileAction(fd);
      if (res.ok) {
        setProfileStatus('success');
        router.refresh();
      } else {
        setProfileStatus(res.error || 'update_failed');
      }
    });
  }

  function handleUpdatePassword() {
    setPasswordStatus('idle');
    const fd = new FormData();
    fd.append('currentPassword', currentPassword);
    fd.append('newPassword', newPassword);
    startPasswordTransition(async () => {
      const res = await updatePasswordAction(fd);
      if (res.ok) {
        setPasswordStatus('success');
        setCurrentPassword('');
        setNewPassword('');
      } else {
        setPasswordStatus(res.error || 'update_failed');
      }
    });
  }

  const navItems: Array<{ id: SectionId; label: string; icon: ReactNode }> = [
    { id: 'preferences', label: t('preferences'), icon: <SlidersHorizontalIcon className="size-[18px]" /> },
    { id: 'personal', label: t('profileInfo'), icon: <UserIcon className="size-[18px]" /> },
    { id: 'security', label: t('changePassword'), icon: <ShieldCheckIcon className="size-[18px]" /> },
    { id: 'notifications', label: t('notifications'), icon: <BellIcon className="size-[18px]" /> },
    { id: 'legal', label: t('legalSupport'), icon: <FileTextIcon className="size-[18px]" /> },
    { id: 'about', label: t('about'), icon: <InfoIcon className="size-[18px]" /> },
    { id: 'account', label: t('account'), icon: <CrownIcon className="size-[18px]" /> },
  ];

  return (
    <div
      className="relative min-h-dvh w-full bg-background font-aurelia-sans text-foreground"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 55% 45% at 75% 0%, rgba(194,161,78,0.08), transparent 60%)',
      }}
    >
      {/* top bar */}
      <div className="flex h-16 items-center border-b border-border px-11">
        <h1 className="m-0 font-aurelia-display text-[26px] font-semibold tracking-[0.01em] text-foreground">
          {t('title')}
        </h1>
      </div>

      <div className="mx-auto grid max-w-[1140px] grid-cols-[320px_1fr] items-start gap-7 px-11 pb-12 pt-8">
        {/* ── LEFT sticky column ───────────────────────────────── */}
        <div className="sticky top-6 flex flex-col gap-4">
          {/* identity */}
          <div className="rounded-[20px] border border-border bg-card p-6 text-center">
            <div className="mx-auto mb-3.5 w-fit">
              <Avatar
                src={user.image ?? null}
                name={user.name}
                size={76}
                className="!text-2xl ring-2 ring-gold-500"
              />
            </div>
            <div className="font-aurelia-display text-2xl font-semibold leading-none text-foreground">
              {user.name || '—'}
            </div>
            {user.email && (
              <div className="mt-2 text-[13px] text-muted-foreground" dir="ltr">
                {user.email}
              </div>
            )}
            <div className="mt-3.5 inline-flex items-center gap-1.5 rounded-full border border-gold-400/30 bg-gold-400/15 px-3 py-1.5">
              <CrownIcon className="size-3.5 text-gold-600" />
              <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-gold-700">
                {t('crownMember')}
              </span>
            </div>
          </div>

          {/* nav */}
          <div className="rounded-[20px] border border-border bg-card p-2">
            {navItems.map((n) => {
              const on = n.id === activeNav;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => scrollToSection(n.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-start text-sm transition-colors',
                    on
                      ? 'bg-accent/10 font-semibold text-accent'
                      : 'font-medium text-muted-foreground hover:text-foreground',
                  )}
                >
                  {n.icon}
                  {n.label}
                </button>
              );
            })}
            <div className="mx-1.5 my-2 h-px bg-border" />
            <button
              type="button"
              onClick={doSignOut}
              disabled={isPending}
              className="flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-start text-sm font-semibold text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-60"
            >
              <LogOutIcon className="size-[18px]" />
              {tAuth('signOut')}
            </button>
          </div>
        </div>

        {/* ── RIGHT content ────────────────────────────────────── */}
        <div className="flex flex-col gap-6">
          {/* Preferences */}
          <div id="sec-preferences" className="scroll-mt-24">
            <SectionCard
              icon={<SlidersHorizontalIcon className="size-[19px] text-gold-600" />}
              title={t('preferences')}
              desc={t('prefDesc')}
            >
              <div className="grid grid-cols-2 gap-7">
                <div>
                  <div className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    {t('language')}
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    {locales.map((loc) => (
                      <SegmentedButton
                        key={loc}
                        active={loc === currentLocale}
                        disabled={isPending}
                        onClick={() => switchLocale(loc)}
                        label={localeLabels[loc]}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    {t('theme')}
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    <SegmentedButton
                      active={theme === 'dark'}
                      onClick={() => setTheme('dark')}
                      label={t('themeDark')}
                      icon={<MoonIcon className="size-5" />}
                    />
                    <SegmentedButton
                      active={theme === 'light'}
                      onClick={() => setTheme('light')}
                      label={t('themeLight')}
                      icon={<SunIcon className="size-5" />}
                    />
                    <SegmentedButton
                      active={theme === 'system'}
                      onClick={() => setTheme('system')}
                      label={t('themeSystem')}
                      icon={<LaptopIcon className="size-5" />}
                    />
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>

          {/* Download app (PWA install) — hidden automatically when already installed. */}
          <InstallAppButton variant="desktop" />

          {/* Personal information */}
          <div id="sec-personal" className="scroll-mt-24">
            <SectionCard
              icon={<UserIcon className="size-[19px] text-gold-600" />}
              title={t('profileInfo')}
              desc={t('profileDesc')}
            >
              <div className="grid grid-cols-2 gap-[18px]">
                <FieldShell label={t('fullName')}>
                  <TextInput value={name} onChange={setName} autoComplete="name" />
                </FieldShell>
                <FieldShell label={t('age')}>
                  <AgeSelect
                    value={age}
                    onChange={setAge}
                    placeholder={t('age')}
                    className="h-[52px] w-full rounded-[13px] border border-border bg-muted px-3 text-[15px] font-semibold text-foreground transition-colors focus:border-accent focus:outline-none"
                    optionClassName="bg-background text-foreground font-sans"
                  />
                </FieldShell>
                <FieldShell label={t('phone')} className="col-span-2">
                  <div className="flex gap-2">
                    <select
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      className="h-[52px] w-[105px] shrink-0 rounded-[13px] border border-border bg-muted px-2 text-[15px] font-semibold text-foreground transition-colors focus:border-accent focus:outline-none"
                    >
                      {COUNTRY_OPTIONS.map((c) => (
                        <option key={c.code} value={c.code} className="bg-background text-foreground font-sans">
                          {c.flag} +{c.callingCode}
                        </option>
                      ))}
                    </select>
                    <div className="min-w-0 flex-1">
                      <TextInput
                        value={phone}
                        onChange={setPhone}
                        type="tel"
                        autoComplete="tel"
                        dir="ltr"
                      />
                    </div>
                  </div>
                </FieldShell>
                <FieldShell label={t('idDocument')} className="col-span-2">
                  <div className="flex gap-2">
                    <select
                      value={idType}
                      onChange={(e) => setIdType(e.target.value as 'national' | 'passport')}
                      className="h-[52px] w-auto shrink-0 rounded-[13px] border border-border bg-muted px-3 text-[14px] font-semibold text-foreground transition-colors focus:border-accent focus:outline-none"
                    >
                      <option value="national" className="bg-background text-foreground font-sans">{t('idTypeNational')}</option>
                      <option value="passport" className="bg-background text-foreground font-sans">{t('idTypePassport')}</option>
                    </select>
                    <div className="min-w-0 flex-1">
                      <TextInput value={idNumber} onChange={setIdNumber} dir="ltr" placeholder={idType === 'national' ? '2xxxxxxxxxxxxx' : 'A1234567'} />
                    </div>
                  </div>
                </FieldShell>
                <FieldShell label={t('region')}>
                  <select
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    className="h-[52px] w-full rounded-[13px] border border-border bg-muted px-3 text-[15px] font-semibold text-foreground transition-colors focus:border-accent focus:outline-none"
                  >
                    <option value="" disabled className="bg-background text-muted-foreground font-sans">
                      {t('regionPlaceholder')}
                    </option>
                    {EGYPT_REGIONS.map((r) => (
                      <option key={r.value} value={r.value} className="bg-background text-foreground font-sans">
                        {currentLocale === 'ar' ? r.ar : r.value}
                      </option>
                    ))}
                  </select>
                </FieldShell>
                <div className="flex items-center gap-3 pt-[28px]">
                  <input
                    type="checkbox"
                    checked={isHandicapped}
                    onChange={(e) => setIsHandicapped(e.target.checked)}
                    className="size-5 rounded border-gold-400/40 bg-muted text-gold-400 focus:ring-gold-400/60"
                    id="deskHandicap"
                  />
                  <label htmlFor="deskHandicap" className="cursor-pointer text-[13px] font-medium text-muted-foreground hover:text-foreground">
                    {t('accessibilityAssistance')}
                  </label>
                </div>
              </div>

              {profileStatus === 'success' && (
                <p className="mt-3.5 text-xs font-medium text-[#2f9e63]">{t('profileUpdated')}</p>
              )}
              {profileStatus !== 'idle' && profileStatus !== 'success' && (
                <p className="mt-3.5 text-xs font-medium text-[#d2482e]">
                  {profileStatus === 'phone_taken' ? t('errors.phone_taken') :
                   profileStatus === 'invalid_phone' ? 'Invalid phone number for the selected country.' :
                   t('errors.update_failed')}
                </p>
              )}

              <div className="mt-5 max-w-[280px]">
                <PrimaryBtn onClick={handleUpdateProfile} loading={profilePending}>
                  {t('updateProfile')}
                </PrimaryBtn>
              </div>
            </SectionCard>
          </div>

          {/* Security */}
          <div id="sec-security" className="scroll-mt-24">
            <SectionCard
              icon={<ShieldCheckIcon className="size-[19px] text-gold-600" />}
              title={t('changePassword')}
              desc={t('securityDesc')}
            >
              <div className="grid grid-cols-2 items-start gap-[18px]">
                <FieldShell label={t('currentPassword')}>
                  <PasswordInput
                    value={currentPassword}
                    onChange={setCurrentPassword}
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                </FieldShell>
                <div>
                  <FieldShell label={t('newPassword')}>
                    <PasswordInput
                      value={newPassword}
                      onChange={setNewPassword}
                      placeholder={tAuth('passwordPlaceholder')}
                      autoComplete="new-password"
                    />
                  </FieldShell>
                  <StrengthMeter
                    pw={newPassword}
                    helper={tAuth('passwordRule')}
                    labels={[
                      t('strengthWeak'),
                      t('strengthFair'),
                      t('strengthGood'),
                      t('strengthStrong'),
                    ]}
                  />
                </div>
              </div>

              {passwordStatus === 'success' && (
                <p className="mt-3.5 text-xs font-medium text-[#2f9e63]">{t('passwordUpdated')}</p>
              )}
              {passwordStatus !== 'idle' && passwordStatus !== 'success' && (
                <p className="mt-3.5 text-xs font-medium text-[#d2482e]">
                  {passwordStatus === 'incorrect_password'
                    ? t('errors.incorrect_password')
                    : passwordStatus === 'password_not_set'
                      ? t('errors.password_not_set')
                      : passwordStatus === 'weak_password'
                        ? tAuth('weakPassword')
                        : t('errors.update_failed')}
                </p>
              )}

              <div className="mt-[18px] max-w-[280px]">
                <OutlineBtn onClick={handleUpdatePassword} loading={passwordPending}>
                  {t('updatePassword')}
                </OutlineBtn>
              </div>
            </SectionCard>
          </div>

          {/* Notifications */}
          <div id="sec-notifications" className="scroll-mt-24">
            <SectionCard
              icon={<BellIcon className="size-[19px] text-gold-600" />}
              title={t('notifications')}
              desc={t('notificationsDesc')}
            >
              <NotificationSettings initial={notifications} />
            </SectionCard>
          </div>

          {/* Legal & Support */}
          <div id="sec-legal" className="scroll-mt-24">
            <SectionCard
              icon={<FileTextIcon className="size-[19px] text-gold-600" />}
              title={t('legalSupport')}
              desc={t('legalSupportDesc')}
            >
              <div className="grid gap-2.5 sm:grid-cols-2">
                <DeskLinkRow href="/privacy-policy" icon={<LockIcon className="size-[18px]" />} label={t('privacyPolicy')} />
                <DeskLinkRow href="/terms-gate" icon={<FileTextIcon className="size-[18px]" />} label={t('termsConditions')} />
                <DeskLinkRow href="/support" icon={<HelpCircleIcon className="size-[18px]" />} label={t('helpSupport')} />
              </div>
            </SectionCard>
          </div>

          {/* About */}
          <div id="sec-about" className="scroll-mt-24">
            <SectionCard
              icon={<InfoIcon className="size-[19px] text-gold-600" />}
              title={t('about')}
              desc={t('aboutDescApp')}
            >
              <div className="flex items-center justify-between rounded-[13px] border border-border bg-muted/40 px-4 py-3">
                <span className="text-sm font-medium text-muted-foreground">{t('appVersion')}</span>
                <span dir="ltr" className="font-mono text-sm font-semibold text-foreground">v{appVersion}</span>
              </div>
              <p className="mt-3 text-[13px] text-muted-foreground">{t('aboutTagline')}</p>
            </SectionCard>
          </div>

          {/* Account */}
          <div id="sec-account" className="scroll-mt-24">
            <SectionCard
              icon={<CrownIcon className="size-[19px] text-gold-600" />}
              title={t('account')}
              desc={t('accountDesc')}
            >
              <AccountActions />
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Primitives ─────────────────────────────────────────────

function SectionCard({
  icon,
  title,
  desc,
  children,
}: {
  icon: ReactNode;
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[20px] border border-border bg-card">
      <div className="flex items-center gap-3.5 border-b border-border px-6 py-5">
        <div className="flex size-[38px] shrink-0 items-center justify-center rounded-[11px] border border-gold-400/30 bg-gold-400/15">
          {icon}
        </div>
        <div>
          <h2 className="m-0 font-aurelia-display text-[22px] font-semibold leading-none text-foreground">
            {title}
          </h2>
          {desc && <p className="mt-1.5 text-[12.5px] text-muted-foreground">{desc}</p>}
        </div>
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}

function SegmentedButton({
  active,
  onClick,
  label,
  icon,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'flex flex-col items-center gap-2 rounded-[14px] border px-3 text-sm transition-all disabled:opacity-60',
        icon ? 'py-4' : 'py-3.5',
        active
          ? 'border-gold-400 bg-gold-400/15 font-bold text-gold-700'
          : 'border-border bg-muted font-medium text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function FieldShell({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-2.5 block text-xs font-semibold tracking-[0.02em] text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  prefix,
  placeholder,
  type = 'text',
  dir,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  prefix?: ReactNode;
  placeholder?: string;
  type?: string;
  dir?: 'ltr' | 'rtl';
  autoComplete?: string;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <div
      className={cn(
        'flex h-[52px] items-center overflow-hidden rounded-[13px] border bg-muted transition-colors',
        focus ? 'border-accent' : 'border-border',
      )}
    >
      {prefix && (
        <div className="flex h-full items-center gap-1.5 whitespace-nowrap border-e border-border px-3.5 text-sm font-semibold text-foreground">
          {prefix}
        </div>
      )}
      <input
        type={type}
        value={value}
        dir={dir}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        placeholder={placeholder}
        className="h-full min-w-0 flex-1 border-none bg-transparent px-4 text-[15px] tracking-[0.01em] text-foreground outline-none placeholder:text-muted-foreground/60"
      />
    </div>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  const [focus, setFocus] = useState(false);
  return (
    <div
      className={cn(
        'flex h-[52px] items-center overflow-hidden rounded-[13px] border bg-muted transition-colors',
        focus ? 'border-accent' : 'border-border',
      )}
    >
      <input
        type={show ? 'text' : 'password'}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        placeholder={placeholder}
        className="h-full min-w-0 flex-1 border-none bg-transparent px-4 text-[15px] text-foreground outline-none placeholder:text-muted-foreground/60"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        tabIndex={-1}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="flex h-full items-center px-3.5 text-muted-foreground/70 transition-colors hover:text-foreground"
      >
        {show ? <EyeOffIcon className="size-[18px]" /> : <EyeIcon className="size-[18px]" />}
      </button>
    </div>
  );
}

function PrimaryBtn({
  children,
  onClick,
  loading,
}: {
  children: ReactNode;
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="h-[52px] w-full rounded-[14px] bg-gradient-to-b from-gold-400 to-[#cba45f] text-[14.5px] font-bold tracking-[0.02em] text-navy-950 shadow-[0_10px_28px_rgba(194,161,78,0.25)] transition-opacity disabled:opacity-70"
    >
      {loading ? '…' : children}
    </button>
  );
}

function OutlineBtn({
  children,
  onClick,
  loading,
}: {
  children: ReactNode;
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="h-[52px] w-full rounded-[14px] border border-gold-500 bg-transparent text-[14.5px] font-bold tracking-[0.02em] text-gold-700 transition-colors hover:bg-gold-400/[0.12] disabled:opacity-70"
    >
      {loading ? '…' : children}
    </button>
  );
}

// ── Password strength ──────────────────────────────────────

function strength(pw: string): number {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^a-zA-Z0-9]/.test(pw)) s++;
  return s;
}

function StrengthMeter({
  pw,
  helper,
  labels,
}: {
  pw: string;
  helper: string;
  labels: [string, string, string, string];
}) {
  const s = strength(pw);
  const colors = ['', '#d2482e', '#c79320', '#b5933f', '#2f9e63'];
  const text = s > 0 ? labels[s - 1] : '';
  return (
    <div className="mt-3">
      <div className="flex gap-1.5">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-1 flex-1 rounded-full transition-colors"
            style={{ background: i <= s ? colors[s] : 'rgba(28,43,64,0.12)' }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between gap-2">
        <span className="text-[11.5px] text-muted-foreground">{helper}</span>
        {s > 0 && (
          <span className="text-[11.5px] font-semibold" style={{ color: colors[s] }}>
            {text}
          </span>
        )}
      </div>
    </div>
  );
}

function DeskLinkRow({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-[13px] border border-border bg-muted/40 px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:border-gold-400/40 hover:bg-muted"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gold-400/15 text-gold-700">
        {icon}
      </span>
      <span className="min-w-0 flex-1">{label}</span>
      <ChevronRightIcon className="size-4 text-muted-foreground/60 rtl:-scale-x-100" />
    </Link>
  );
}

'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Label';
import { AgeSelect } from '@/components/ui/AgeSelect';
import { completeProfile } from '@/features/auth/actions';
import { COUNTRY_OPTIONS } from '@/lib/countries';
import { EGYPT_REGIONS } from '@/lib/regions';
import { FieldIcon } from './FieldIcon';

interface Props {
  initialName?: string;
  initialPhone?: string;
  initialEmail?: string;
  initialCountryCode?: string;
  initialAge?: number;
  initialIdType?: 'national' | 'passport';
  initialIdNumber?: string;
  initialRegion?: string;
  next?: string;
}

/** Shared input styling — theme-tokened so it tracks light ↔ dark. */
const FIELD =
  'block h-[52px] w-full rounded-xl border border-border bg-card ' +
  'ps-11 pe-4 text-[15px] text-foreground placeholder:text-muted-foreground/40 transition-colors ' +
  'focus:border-gold-400/55 focus:outline-none focus:ring-2 focus:ring-gold-400/25';

/** Plain (no leading icon) variant for native selects. */
const SELECT =
  'h-[52px] rounded-xl border border-border bg-card px-2 text-foreground transition-colors ' +
  'focus:border-gold-400/55 focus:outline-none focus:ring-2 focus:ring-gold-400/25';

const LABEL = 'text-muted-foreground';
const ICON =
  'pointer-events-none absolute start-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground/55 transition-colors group-focus-within:text-gold-600';
const OPTION = 'bg-background text-foreground';

export function ProfileForm({
  initialName,
  initialPhone,
  initialEmail,
  initialCountryCode,
  initialAge,
  initialIdType,
  initialIdNumber,
  initialRegion,
  next,
}: Props) {
  const t = useTranslations('auth.profile');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const ar = locale === 'ar';
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [idType, setIdType] = useState<'national' | 'passport'>(initialIdType ?? 'national');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await completeProfile(formData);
      if (!res.ok) {
        if (res.error === 'invalid_phone') {
          setError('Please enter a valid phone number for the selected country.');
        } else if (res.error === 'invalid_id') {
          setError(t('idInvalid'));
        } else if (res.error === 'invalid_region') {
          setError(t('regionInvalid'));
        } else if (res.error === 'invalid_email') {
          setError(t('emailRequired'));
        } else if (res.error === 'email_taken') {
          setError('This email is already in use by another account.');
        } else if (res.error === 'phone_taken') {
          setError('This phone number is already in use by another account.');
        } else {
          setError(tCommon('error'));
        }
        return;
      }
      router.push(next || '/booking');
    });
  }

  return (
    <form className="grid grid-cols-1 gap-4 lg:grid-cols-2" onSubmit={onSubmit}>
      {/* Full name */}
      <div className="space-y-1.5">
        <Label htmlFor="fullName" className={LABEL}>
          {t('fullName')}
        </Label>
        <div className="group relative">
          <FieldIcon name="user" className={ICON} />
          <input
            id="fullName"
            name="fullName"
            required
            minLength={2}
            defaultValue={initialName}
            autoComplete="name"
            className={FIELD}
          />
        </div>
      </div>

      {/* Phone — country selector + number */}
      <div className="space-y-1.5">
        <Label htmlFor="phone" className={LABEL}>
          {t('phone')}
        </Label>
        <div className="flex gap-2">
          <select
            name="countryCode"
            defaultValue={initialCountryCode ?? 'EG'}
            aria-label="Country code"
            className={`${SELECT} w-28`}
          >
            {COUNTRY_OPTIONS.map((c) => (
              <option key={c.code} value={c.code} className={OPTION}>
                {c.flag} +{c.callingCode}
              </option>
            ))}
          </select>
          <div className="group relative flex-1">
            <FieldIcon name="phone" className={ICON} />
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              required
              dir="ltr"
              defaultValue={initialPhone}
              autoComplete="tel"
              placeholder="1xx xxx xxxx"
              className={`${FIELD} text-start`}
            />
          </div>
        </div>
      </div>

      {/* Email — REQUIRED */}
      <div className="space-y-1.5 lg:col-span-2">
        <Label htmlFor="email" className={LABEL}>
          {t('email')} <span className="font-semibold text-danger" aria-hidden="true">*</span>
        </Label>
        <div className="group relative">
          <FieldIcon name="mail" className={ICON} />
          <input
            id="email"
            name="email"
            type="email"
            dir="ltr"
            required
            aria-required="true"
            defaultValue={initialEmail}
            autoComplete="email"
            placeholder="name@email.com"
            className={`${FIELD} text-start`}
          />
        </div>
      </div>

      {/* Identity document — Egyptian National ID or Passport (REQUIRED) */}
      <div className="space-y-1.5 lg:col-span-2">
        <Label htmlFor="idType" className={LABEL}>
          {t('idDocument')} <span className="font-semibold text-danger" aria-hidden="true">*</span>
        </Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            id="idType"
            name="idType"
            value={idType}
            onChange={(e) => setIdType(e.target.value as 'national' | 'passport')}
            aria-label={t('idType')}
            className={`${SELECT} w-full sm:w-44 sm:shrink-0`}
          >
            <option value="national" className={OPTION}>{t('idTypeNational')}</option>
            <option value="passport" className={OPTION}>{t('idTypePassport')}</option>
          </select>
          <div className="group relative w-full sm:min-w-0 sm:flex-1">
            <FieldIcon name="id" className={ICON} />
            <input
              id="idNumber"
              name="idNumber"
              dir="ltr"
              required
              aria-required="true"
              defaultValue={initialIdNumber}
              inputMode={idType === 'national' ? 'numeric' : 'text'}
              maxLength={idType === 'national' ? 14 : 15}
              placeholder={idType === 'national' ? '2xxxxxxxxxxxxx' : 'A1234567'}
              className={`${FIELD} text-start`}
            />
          </div>
        </div>
        <p className="text-[12px] text-muted-foreground">
          {idType === 'national' ? t('idHintNational') : t('idHintPassport')}
        </p>
      </div>

      {/* Region — Egyptian governorate (REQUIRED) */}
      <div className="space-y-1.5">
        <Label htmlFor="region" className={LABEL}>
          {t('region')} <span className="font-semibold text-danger" aria-hidden="true">*</span>
        </Label>
        <div className="group relative">
          <FieldIcon name="pin" className={ICON} />
          <select
            id="region"
            name="region"
            required
            aria-required="true"
            defaultValue={initialRegion ?? ''}
            className={`${FIELD} appearance-none`}
          >
            <option value="" disabled className="bg-background text-muted-foreground">
              {t('regionPlaceholder')}
            </option>
            {EGYPT_REGIONS.map((r) => (
              <option key={r.value} value={r.value} className={OPTION}>
                {ar ? r.ar : r.value}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Age */}
      <div className="space-y-1.5">
        <Label htmlFor="age" className={LABEL}>
          {t('age')}
        </Label>
        <div className="group relative">
          <FieldIcon name="age" className={ICON} />
          <AgeSelect
            id="age"
            name="age"
            required
            defaultValue={initialAge}
            placeholder={t('age')}
            className={`${FIELD} appearance-none`}
            optionClassName={OPTION}
          />
        </div>
      </div>

      {/* Accessibility toggle */}
      <label
        htmlFor="isHandicapped"
        className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 lg:col-span-2"
      >
        <FieldIcon name="shield" className="size-[18px] shrink-0 text-muted-foreground" />
        <span className="flex-1 text-[13.5px] text-foreground/80">
          {t('accessibilityAssistance')}
        </span>
        <input
          id="isHandicapped"
          name="isHandicapped"
          type="checkbox"
          className="size-5 shrink-0 rounded border-border bg-background text-gold-500 focus:ring-2 focus:ring-gold-400/40"
        />
      </label>

      <div className="pt-1 lg:col-span-2">
        <Button type="submit" variant="gold" size="lg" fullWidth loading={isPending} className="h-[54px]">
          {tCommon('save')}
        </Button>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-2.5 text-center text-[13px] text-danger lg:col-span-2"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}

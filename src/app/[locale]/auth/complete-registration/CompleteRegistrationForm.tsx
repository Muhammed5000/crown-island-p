'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { LockIcon, PhoneIcon, UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { completeRegistration } from '@/features/auth/actions';

export function CompleteRegistrationForm({ email, token }: { email: string; token: string }) {
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await completeRegistration({ email, fullName: name, phone, password, token });
        if (!res.ok) {
          if (res.code === 'weak_password') setError(t('weakPassword'));
          else if (res.code === 'email_taken') setError(t('emailTaken'));
          else if (res.code === 'phone_taken') setError(t('phoneTaken'));
          else setError(tCommon('error'));
        }
      } catch (err) {
        // signIn throws NEXT_REDIRECT on success — that's the success path.
        if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;
        setError(tCommon('error'));
      }
    });
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div>
        <Label htmlFor="name">{t('profile.fullName')}</Label>
        <div className="relative">
          <Input
            id="name"
            name="name"
            required
            minLength={2}
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="ps-11"
          />
          <UserIcon className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-gold-600/70" />
        </div>
      </div>

      <div>
        <Label htmlFor="phone">{t('profile.phone')}</Label>
        <div className="relative">
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            required
            dir="ltr"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+20 1xx xxx xxxx"
            className="ps-11"
          />
          <PhoneIcon className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-gold-600/70" />
        </div>
      </div>

      <div>
        <Label htmlFor="password">{t('password')}</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('passwordPlaceholder')}
            className="ps-11"
          />
          <LockIcon className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-gold-600/70" />
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">{t('passwordRule')}</p>
      </div>

      <Button type="submit" variant="primary" size="lg" fullWidth loading={isPending}>
        {tCommon('continue')}
      </Button>

      {error ? (
        <p
          className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-sm text-red-700"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}

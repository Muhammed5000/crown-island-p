'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2Icon, LockIcon } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { resetPassword } from '@/features/auth/actions';

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await resetPassword({ token, password });
      if (!res.ok) {
        if (res.code === 'weak_password') setError(t('weakPassword'));
        else if (res.code === 'invalid_or_expired') setError(t('invalidOrExpired'));
        else setError(tCommon('error'));
        return;
      }
      setDone(true);
    });
  }

  if (done) {
    return (
      <div className="space-y-5 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-gold-400/15 text-gold-600 ring-1 ring-gold-400/30">
          <CheckCircle2Icon className="size-7" strokeWidth={1.75} />
        </div>
        <div className="space-y-1">
          <p className="font-display text-lg font-semibold text-foreground">{t('resetSuccess')}</p>
          <p className="text-sm text-muted-foreground">{t('resetSuccessBody')}</p>
        </div>
        <Link
          href="/login"
          className="gleam inline-flex h-12 items-center justify-center gap-1.5 rounded-xl bg-gold-button px-6 text-[12px] font-bold uppercase tracking-[0.18em] text-ink shadow-gold-lg transition-all hover:-translate-y-px"
        >
          {t('signIn')}
        </Link>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
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
            placeholder={t('newPasswordPlaceholder')}
            className="ps-11"
          />
          <LockIcon className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-gold-600/70" />
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">{t('passwordRule')}</p>
      </div>

      <Button type="submit" variant="primary" size="lg" fullWidth loading={isPending}>
        {tCommon('save')}
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

'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { LockIcon, MailIcon } from 'lucide-react';
import { signIn } from 'next-auth/react';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { ErrorIllustration } from '@/components/ui/ErrorIllustration';

interface Props {
  next?: string;
  initialError?: string | null;
}

/**
 * Email + password sign-in form for the admin panel.
 *
 * Uses NextAuth's client-side `signIn(...)` (which POSTs to /api/auth/callback)
 * rather than a server-action wrapper. This avoids the Next 16 server-action
 * fetch handshake getting confused by the auth-cookie redirect cycle — the
 * issue that produced the "Failed to fetch" runtime error.
 */
export function AdminLoginForm({ next, initialError }: Props) {
  const tAuth = useTranslations('auth');
  const router = useRouter();
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [isPending, startTransition] = useTransition();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = e.currentTarget;
    const email = String(new FormData(form).get('email') ?? '').trim();
    const password = String(new FormData(form).get('password') ?? '');

    if (!email || !password) {
      setError(tAuth('invalidCredentials'));
      return;
    }

    startTransition(async () => {
      const res = await signIn('admin-password', {
        email,
        password,
        redirect: false,
      });

      if (!res || res.error) {
        setError(tAuth('invalidCredentials'));
        return;
      }

      // Soft-navigate so the layout re-runs with the fresh JWT cookie.
      router.push(next || '/admin');
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 text-start">
      <Field
        hint={tAuth('email')}
        name="email"
        type="email"
        autoComplete="username"
        dir="ltr"
        required
        trailing={<MailIcon className="size-4 text-muted-foreground" />}
        placeholder="admin@crown-island.local"
      />
      <Field
        hint={tAuth('password')}
        name="password"
        type="password"
        autoComplete="current-password"
        dir="ltr"
        required
        trailing={<LockIcon className="size-4 text-muted-foreground" />}
      />

      <Button type="submit" variant="primary" size="lg" fullWidth loading={isPending}>
        {tAuth('signIn')}
      </Button>

      {error ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-danger/20 bg-danger/5 p-4 text-center animate-fade-in">
          <ErrorIllustration type="forbidden" className="size-16" />
          <p className="text-xs font-medium text-danger" role="alert">
            {error}
          </p>
        </div>
      ) : null}
    </form>
  );
}

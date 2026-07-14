'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { signOut } from 'next-auth/react';
import { ArrowLeftIcon } from 'lucide-react';

/**
 * Escape hatch for the Complete-Profile gate. A signed-in user with an
 * incomplete profile is bounced back here from every in-app route, so the only
 * way to "return to the main page / cancel sign-in" is to end the session.
 * This signs the user out and sends them home (where they browse as a guest).
 */
export function ExitButton() {
  const t = useTranslations('auth.profile');
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => { await signOut({ callbackUrl: '/' }); })}
      className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
    >
      <ArrowLeftIcon className="size-4 rtl:-scale-x-100" strokeWidth={2} aria-hidden />
      {pending ? '…' : t('backHome')}
    </button>
  );
}

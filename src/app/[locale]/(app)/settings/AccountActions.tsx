'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { signOut } from 'next-auth/react';
import { MonitorSmartphoneIcon, UserXIcon } from 'lucide-react';
import { signOutEverywhereAction, closeAccountAction } from '@/features/auth/actions';

/**
 * Account actions — "sign out of all devices" (bumps the session epoch so every
 * JWT is evicted) and "close account" (soft-deletes + signs out, with a
 * confirmation dialog). Both follow up with a client signOut() so the current
 * tab clears immediately. Shared by the mobile + desktop Settings layouts.
 */
/** Loosely compare typed input to the required phrase (trim + collapse spaces + case-insensitive). */
const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export function AccountActions() {
  const t = useTranslations('settings');
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState(false);

  const phrase = t('closeAccountConfirmPhrase');
  const phraseMatches = normalize(typed) === normalize(phrase);

  function openConfirm() {
    setTyped('');
    setError(false);
    setConfirmOpen(true);
  }

  function closeConfirm() {
    if (pending) return;
    setConfirmOpen(false);
    setTyped('');
  }

  function signOutEverywhere() {
    setError(false);
    startTransition(async () => {
      const res = await signOutEverywhereAction();
      if (res.ok) await signOut({ callbackUrl: '/' });
      else setError(true);
    });
  }

  function closeAccount() {
    if (!phraseMatches) return;
    setError(false);
    startTransition(async () => {
      const res = await closeAccountAction();
      if (res.ok) await signOut({ callbackUrl: '/' });
      else {
        setError(true);
        setConfirmOpen(false);
      }
    });
  }

  return (
    <div className="space-y-2.5">
      <button
        type="button"
        onClick={signOutEverywhere}
        disabled={pending}
        className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-start transition-colors hover:bg-muted/50 disabled:opacity-60"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <MonitorSmartphoneIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{t('signOutAllDevices')}</span>
          <span className="block text-xs text-muted-foreground">{t('signOutAllDevicesDesc')}</span>
        </span>
      </button>

      <button
        type="button"
        onClick={openConfirm}
        disabled={pending}
        className="flex w-full items-center gap-3 rounded-2xl border border-danger/30 bg-danger/[0.04] px-4 py-3 text-start transition-colors hover:bg-danger/10 disabled:opacity-60"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-danger/10 text-danger">
          <UserXIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-danger">{t('closeAccount')}</span>
          <span className="block text-xs text-danger/70">{t('closeAccountDesc')}</span>
        </span>
      </button>

      {error ? <p className="text-xs font-medium text-red-600">{t('actionFailed')}</p> : null}

      {confirmOpen ? (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={closeConfirm}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-foreground">{t('closeAccountConfirmTitle')}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('closeAccountConfirmBody')}</p>

            {/* Type-to-confirm gate — the user must type the exact (localized) phrase. */}
            <p className="mt-4 text-sm font-medium text-foreground">{t('closeAccountConfirmPrompt')}</p>
            <p className="mt-1.5 select-all rounded-lg border border-danger/25 bg-danger/[0.06] px-3 py-2 text-center text-sm font-bold text-danger">
              {phrase}
            </p>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={pending}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label={t('closeAccountConfirmPrompt')}
              placeholder={t('closeAccountTypePlaceholder')}
              className="mt-2.5 h-11 w-full rounded-xl border border-border bg-background px-3.5 text-sm text-foreground outline-none transition-colors focus:border-accent/60 focus:ring-2 focus:ring-accent/30 disabled:opacity-60"
            />

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={closeConfirm}
                disabled={pending}
                className="flex-1 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-60"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={closeAccount}
                disabled={pending || !phraseMatches}
                className="flex-1 rounded-xl bg-danger px-4 py-2.5 text-sm font-bold text-white transition-opacity hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? '…' : t('confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

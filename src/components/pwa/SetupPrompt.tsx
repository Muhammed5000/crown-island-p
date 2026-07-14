'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BellIcon, CheckIcon, DownloadIcon, SparklesIcon, XIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { useInstallPrompt } from './useInstallPrompt';
import {
  getDevicePushState,
  subscribeThisDevice,
  type PushDeviceState,
} from '@/features/push/client';

/**
 * One-card setup prompt for signed-in users: enable web-push notifications AND
 * install the PWA, both in a single dismissible card. Shown on entry (per
 * browser session) while EITHER is still pending; once a customer has both
 * notifications on and the app installed, it never appears again. Reuses the
 * existing `useInstallPrompt` hook and the push client helpers.
 */
const DISMISS_KEY = 'ci.setupPrompt.dismissed.v1';

export function SetupPrompt() {
  const t = useTranslations('setupPrompt');
  const tSettings = useTranslations('settings');
  const locale = useLocale();

  const { state: installState, promptInstall, isIos } = useInstallPrompt();
  const [pushState, setPushState] = useState<PushDeviceState | 'loading'>('loading');
  const [pushBusy, setPushBusy] = useState(false);
  const [dismissed, setDismissed] = useState(true); // hidden until we've checked
  const [showInstallHint, setShowInstallHint] = useState(false);

  useEffect(() => {
    let dismissedThisSession = false;
    try {
      dismissedThisSession = !!sessionStorage.getItem(DISMISS_KEY);
    } catch {
      /* private mode — treat as not dismissed */
    }
    if (dismissedThisSession) return;
    // Mount-time client-only sync (sessionStorage isn't readable in a useState
    // initializer without risking a hydration mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(false);
    let alive = true;
    void getDevicePushState().then((s) => {
      if (alive) setPushState(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  }, []);

  async function enablePush() {
    setPushBusy(true);
    try {
      const next = await subscribeThisDevice(locale === 'en' ? 'en' : 'ar');
      setPushState(next);
    } catch {
      setPushState(await getDevicePushState());
    } finally {
      setPushBusy(false);
    }
  }

  async function install() {
    if (installState === 'available') {
      const outcome = await promptInstall();
      if (outcome === 'unavailable') setShowInstallHint(true);
      return;
    }
    setShowInstallHint((v) => !v); // iOS / Firefox → reveal manual instructions
  }

  const pushDone = pushState === 'subscribed';
  const needsPush = pushState === 'default'; // the only state where "Enable" works
  const installDone = installState === 'installed';
  // 'available' = real one-tap prompt; 'manual' only counts on iOS (Add to Home
  // Screen). On Chromium, 'manual' means no install prompt fired — which usually
  // means it's ALREADY installed — so we don't show an install button there.
  const needsInstall = installState === 'available' || (installState === 'manual' && isIos);

  const resolved = pushState !== 'loading' && installState !== 'pending';
  const visible = !dismissed && resolved && (needsPush || needsInstall);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="setup-prompt"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          role="dialog"
          aria-label={t('title')}
          className={cn(
            'fixed inset-x-0 bottom-0 z-[70] px-3 pb-[calc(env(safe-area-inset-bottom)+76px)]',
            'xl:inset-x-auto xl:bottom-6 xl:end-6 xl:px-0 xl:pb-0',
          )}
        >
          <div className="mx-auto w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card shadow-[0_2px_6px_rgba(20,32,46,0.07),0_28px_60px_-22px_rgba(20,32,46,0.30)]">
            <div className="flex items-start gap-3 border-b border-border/70 px-4 py-3.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gold-400/15 text-gold-600">
                <SparklesIcon className="size-[18px]" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{t('title')}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {t('subtitle')}
                </p>
              </div>
              <button
                type="button"
                onClick={dismiss}
                aria-label={t('dismiss')}
                className="-m-1 grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <XIcon className="size-4" />
              </button>
            </div>

            <div className="divide-y divide-border/60">
              {needsPush || pushDone ? (
                <Row
                  icon={<BellIcon className="size-4" aria-hidden />}
                  title={t('notifTitle')}
                  desc={t('notifDesc')}
                  done={pushDone}
                  doneLabel={t('enabled')}
                  action={
                    needsPush ? (
                      <ActionButton onClick={enablePush} busy={pushBusy}>
                        {t('enable')}
                      </ActionButton>
                    ) : null
                  }
                />
              ) : null}

              {needsInstall || installDone ? (
                <Row
                  icon={<DownloadIcon className="size-4" aria-hidden />}
                  title={t('installTitle')}
                  desc={t('installDesc')}
                  done={installDone}
                  doneLabel={t('installed')}
                  note={
                    showInstallHint
                      ? isIos
                        ? tSettings('installHintIos')
                        : tSettings('installHintGeneric')
                      : null
                  }
                  action={
                    needsInstall ? (
                      <ActionButton onClick={install}>{t('install')}</ActionButton>
                    ) : null
                  }
                />
              ) : null}
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function Row({
  icon,
  title,
  desc,
  done,
  doneLabel,
  action,
  note,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  done: boolean;
  doneLabel: string;
  action: ReactNode;
  note?: string | null;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-full',
          done ? 'bg-green-500/15 text-green-600' : 'bg-muted text-foreground',
        )}
      >
        {done ? <CheckIcon className="size-4" aria-hidden /> : icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{desc}</p>
        {note ? (
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground" role="note">
            {note}
          </p>
        ) : null}
      </div>
      <div className="shrink-0">
        {done ? (
          <span className="text-xs font-semibold text-green-600">{doneLabel}</span>
        ) : (
          action
        )}
      </div>
    </div>
  );
}

function ActionButton({
  onClick,
  busy,
  children,
}: {
  onClick: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex h-8 items-center rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
    >
      {busy ? '…' : children}
    </button>
  );
}

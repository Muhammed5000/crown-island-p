'use client';

import { useEffect, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Toggle } from '@/components/ui/Toggle';
import { updateNotificationPrefsAction } from '@/features/auth/actions';
import {
  getDevicePushState,
  subscribeThisDevice,
  unsubscribeThisDevice,
  type PushDeviceState,
} from '@/features/push/client';

/**
 * Notification preferences. Three email toggles persisted to the customer
 * profile (booking updates + reminders on the profile; promotions via
 * `marketingOpt`), plus a per-device "browser notifications" toggle that
 * subscribes THIS browser to Web Push. The push toggle reflects the device's
 * own subscription state, independent of the stored email preferences. Shared by
 * the mobile + desktop Settings layouts; the parent supplies the card chrome.
 */
interface Prefs {
  bookingUpdates: boolean;
  reminders: boolean;
  promotions: boolean;
}

export function NotificationSettings({ initial }: { initial: Prefs }) {
  const t = useTranslations('settings');
  const locale = useLocale();
  const [prefs, setPrefs] = useState<Prefs>(initial);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [pending, startTransition] = useTransition();

  // Per-device Web Push state.
  const [pushState, setPushState] = useState<PushDeviceState | 'loading'>('loading');
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState(false);

  useEffect(() => {
    let alive = true;
    void getDevicePushState().then((s) => {
      if (alive) setPushState(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  function update(next: Prefs) {
    setPrefs(next);
    setStatus('idle');
    const fd = new FormData();
    if (next.bookingUpdates) fd.set('bookingUpdates', 'on');
    if (next.reminders) fd.set('reminders', 'on');
    if (next.promotions) fd.set('promotions', 'on');
    startTransition(async () => {
      const res = await updateNotificationPrefsAction(fd);
      setStatus(res.ok ? 'saved' : 'error');
    });
  }

  async function togglePush(on: boolean) {
    setPushBusy(true);
    setPushError(false);
    try {
      const next = on
        ? await subscribeThisDevice(locale === 'en' ? 'en' : 'ar')
        : await unsubscribeThisDevice();
      setPushState(next);
    } catch {
      setPushError(true);
      setPushState(await getDevicePushState());
    } finally {
      setPushBusy(false);
    }
  }

  const rows = [
    { key: 'bookingUpdates', title: t('notifyBookingUpdates'), desc: t('notifyBookingUpdatesDesc') },
    { key: 'reminders', title: t('notifyReminders'), desc: t('notifyRemindersDesc') },
    { key: 'promotions', title: t('notifyPromotions'), desc: t('notifyPromotionsDesc') },
  ] as const;

  const pushUnsupported = pushState === 'unsupported';
  const pushInsecure = pushState === 'insecure';
  const pushBlocked = pushState === 'denied';
  // iOS only supports Web Push from a Home-Screen-installed PWA (iOS 16.4+).
  const isIos =
    typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true);

  return (
    <div>
      <div className="divide-y divide-border">
        {rows.map((r) => (
          <div key={r.key} className="flex items-start justify-between gap-4 py-3 first:pt-0">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{r.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{r.desc}</p>
            </div>
            <Toggle
              checked={prefs[r.key]}
              disabled={pending}
              aria-label={r.title}
              onChange={(v) => update({ ...prefs, [r.key]: v })}
            />
          </div>
        ))}

        {/* Per-device browser push — separate from the stored email prefs above. */}
        <div className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{t('notifyBrowserPush')}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {t('notifyBrowserPushDesc')}
            </p>
            {pushInsecure ? (
              <p className="mt-1 text-xs text-amber-600">{t('pushInsecureOrigin')}</p>
            ) : null}
            {pushUnsupported ? (
              <p className="mt-1 text-xs text-muted-foreground">{t('pushUnsupported')}</p>
            ) : null}
            {pushBlocked ? (
              <p className="mt-1 text-xs text-amber-600">{t('pushBlocked')}</p>
            ) : null}
            {isIos && !isStandalone ? (
              <p className="mt-1 text-xs text-muted-foreground">{t('pushIosAddToHome')}</p>
            ) : null}
            {pushError ? (
              <p className="mt-1 text-xs text-red-600">{t('pushFailed')}</p>
            ) : null}
          </div>
          <Toggle
            checked={pushState === 'subscribed'}
            disabled={
              pushBusy || pushUnsupported || pushInsecure || pushBlocked || pushState === 'loading'
            }
            aria-label={t('notifyBrowserPush')}
            onChange={(v) => void togglePush(v)}
          />
        </div>
      </div>
      {status === 'saved' ? (
        <p className="mt-3 text-xs font-medium text-green-600">{t('notificationsSaved')}</p>
      ) : null}
      {status === 'error' ? (
        <p className="mt-3 text-xs font-medium text-red-600">{t('notificationsSaveFailed')}</p>
      ) : null}
    </div>
  );
}

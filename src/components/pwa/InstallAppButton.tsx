'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DownloadCloudIcon, DownloadIcon } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useInstallPrompt } from './useInstallPrompt';

/**
 * "Download app" (PWA install) control for the settings page.
 *
 * Renders a self-contained card with an install button. It returns `null` —
 * showing NOTHING — when the app is already installed (standalone display-mode
 * / iOS home-screen) or before the install state is known, so it never appears
 * for users who already downloaded the app.
 *
 * Where the browser supports a programmatic install (Chromium), the button
 * fires the real install dialog. Where it doesn't (iOS Safari, Firefox), the
 * button reveals the platform-appropriate "Add to Home Screen" instructions.
 *
 * `variant` styles the card to match its host: the mobile `SettingsPanel`
 * (`Card` + gold uppercase header) or the desktop `SettingsDesktop`
 * (`SectionCard` look + gold-gradient primary button).
 */
export function InstallAppButton({ variant = 'mobile' }: { variant?: 'mobile' | 'desktop' }) {
  const t = useTranslations('settings');
  const { state, promptInstall, isIos } = useInstallPrompt();
  const [showHint, setShowHint] = useState(false);

  // The core requirement: do NOT render anything once the app is installed
  // (and stay silent until we know the state, to avoid a wrong-state flash).
  if (state === 'installed' || state === 'pending') return null;

  async function handleInstall() {
    if (state === 'available') {
      const outcome = await promptInstall();
      // If the captured prompt went stale, fall back to manual instructions.
      if (outcome === 'unavailable') setShowHint(true);
      return;
    }
    // Browsers with no programmatic prompt: reveal manual instructions.
    setShowHint((v) => !v);
  }

  const hint = isIos ? t('installHintIos') : t('installHintGeneric');

  if (variant === 'desktop') {
    return (
      <section className="overflow-hidden rounded-[20px] border border-border bg-card">
        <div className="flex items-center gap-3.5 border-b border-border px-6 py-5">
          <div className="flex size-[38px] shrink-0 items-center justify-center rounded-[11px] border border-gold-400/30 bg-gold-400/15">
            <DownloadCloudIcon className="size-[19px] text-gold-600" aria-hidden />
          </div>
          <div>
            <h2 className="m-0 font-aurelia-display text-[22px] font-semibold leading-none text-foreground">
              {t('downloadApp')}
            </h2>
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">{t('downloadAppDesc')}</p>
          </div>
        </div>
        <div className="p-6">
          <button
            type="button"
            onClick={handleInstall}
            className="inline-flex h-[52px] items-center justify-center gap-2 rounded-[14px] bg-gradient-to-b from-gold-400 to-[#cba45f] px-7 text-[14.5px] font-bold tracking-[0.02em] text-navy-950 shadow-[0_10px_28px_rgba(194,161,78,0.25)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60"
          >
            <DownloadIcon className="size-[18px]" aria-hidden />
            {t('downloadApp')}
          </button>
          {showHint ? (
            <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground" role="note">
              {hint}
            </p>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-gold-700/80">
          <DownloadCloudIcon className="size-3.5" aria-hidden />
          <span>{t('downloadApp')}</span>
        </div>
        <p className="text-sm text-muted-foreground">{t('downloadAppDesc')}</p>
        <Button type="button" variant="primary" size="sm" fullWidth onClick={handleInstall}>
          <DownloadIcon className="size-4" aria-hidden />
          <span>{t('downloadApp')}</span>
        </Button>
        {showHint ? (
          <p className="text-xs leading-relaxed text-muted-foreground/80" role="note">
            {hint}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

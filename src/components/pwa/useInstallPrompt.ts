'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The non-standard event Chromium fires when the app is installable. Typed
 * locally because it isn't in the DOM lib.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** The early-capture script in the root layout stashes the prompt here. */
type WindowWithInstall = Window & { __ciInstallPrompt?: BeforeInstallPromptEvent | null };

interface RelatedApp {
  platform?: string;
  id?: string;
  url?: string;
}
type NavigatorWithInstall = Navigator & {
  getInstalledRelatedApps?: () => Promise<RelatedApp[]>;
  standalone?: boolean;
};

/**
 * Persisted "this browser has the PWA installed" flag. `display-mode: standalone`
 * is ONLY true while running FROM the installed icon — a normal browser tab
 * can't tell it's installed otherwise — so we remember it across sessions the
 * moment we ever observe it installed (standalone launch, `appinstalled`, an
 * accepted install, or getInstalledRelatedApps).
 */
const INSTALLED_FLAG = 'ci.pwa.installed.v1';

function stashedPrompt(): BeforeInstallPromptEvent | null {
  if (typeof window === 'undefined') return null;
  return (window as WindowWithInstall).__ciInstallPrompt ?? null;
}
function rememberInstalled() {
  try {
    localStorage.setItem(INSTALLED_FLAG, '1');
  } catch {
    /* private mode — ignore */
  }
}
function forgetInstalled() {
  try {
    localStorage.removeItem(INSTALLED_FLAG);
  } catch {
    /* ignore */
  }
}
function rememberedInstalled(): boolean {
  try {
    return localStorage.getItem(INSTALLED_FLAG) === '1';
  } catch {
    return false;
  }
}

export type InstallState =
  | 'pending' // not yet determined (SSR / pre-mount) — render nothing
  | 'installed' // already installed — hide the install UI
  | 'available' // `beforeinstallprompt` captured — one-tap native install
  | 'manual'; // installable only via the browser's own menu (iOS Safari, Firefox, …)

/**
 * PWA install state + a one-tap install trigger.
 *
 * Installed-detection (the hard part — a browser tab can't see standalone):
 *  - `display-mode: standalone` / iOS `navigator.standalone` → running AS the app.
 *  - a persisted flag set whenever we've ever seen it installed (survives tabs).
 *  - `navigator.getInstalledRelatedApps()` (Chromium) → detects the installed
 *    web app even from a normal tab (manifest declares itself in
 *    `related_applications`).
 *  - `appinstalled` while open. A later `beforeinstallprompt` proves it is NOT
 *    installed and clears any stale flag (handles an uninstall).
 *
 * All detection runs in an effect (post-mount), so first render is `'pending'`.
 */
export function useInstallPrompt() {
  const [state, setState] = useState<InstallState>('pending');
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    let cancelled = false;
    const nav = navigator as NavigatorWithInstall;
    const standaloneMq = window.matchMedia('(display-mode: standalone)');
    const isStandalone = standaloneMq.matches || nav.standalone === true;

    const settleNotInstalled = () => {
      if (cancelled) return;
      const early = stashedPrompt();
      if (early) {
        setDeferred(early);
        setState('available');
      } else {
        setState('manual');
      }
    };

    // Synchronous install-state sync into React (external system). The rule's
    // cascading-render concern doesn't apply — this runs once on mount.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (isStandalone) {
      rememberInstalled();
      setState('installed');
    } else if (rememberedInstalled()) {
      // Provisional — `onBeforeInstall` clears it below if the app was uninstalled.
      setState('installed');
    } else if (typeof nav.getInstalledRelatedApps === 'function') {
      nav
        .getInstalledRelatedApps()
        .then((apps) => {
          if (cancelled) return;
          if (apps?.some((a) => a.platform === 'webapp')) {
            rememberInstalled();
            setState('installed');
          } else {
            settleNotInstalled();
          }
        })
        .catch(() => settleNotInstalled());
    } else {
      settleNotInstalled();
    }
    /* eslint-enable react-hooks/set-state-in-effect */

    const onBeforeInstall = (e: Event) => {
      // Fires ONLY when installable (NOT installed) → also clears a stale flag.
      e.preventDefault();
      forgetInstalled();
      if (cancelled) return;
      setDeferred(e as BeforeInstallPromptEvent);
      setState('available');
    };
    const onStashed = () => {
      const ev = stashedPrompt();
      if (ev && !cancelled) {
        forgetInstalled();
        setDeferred(ev);
        setState('available');
      }
    };
    const onInstalled = () => {
      rememberInstalled();
      if (cancelled) return;
      setDeferred(null);
      setState('installed');
    };
    const onDisplayChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        rememberInstalled();
        if (cancelled) return;
        setDeferred(null);
        setState('installed');
      }
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('ci-installable', onStashed);
    window.addEventListener('appinstalled', onInstalled);
    standaloneMq.addEventListener?.('change', onDisplayChange);
    return () => {
      cancelled = true;
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('ci-installable', onStashed);
      window.removeEventListener('appinstalled', onInstalled);
      standaloneMq.removeEventListener?.('change', onDisplayChange);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<
    'accepted' | 'dismissed' | 'unavailable'
  > => {
    const evt = deferred ?? stashedPrompt();
    if (!evt) return 'unavailable';
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    // The captured prompt is single-use — drop it so we don't re-fire a stale one.
    setDeferred(null);
    if (typeof window !== 'undefined') (window as WindowWithInstall).__ciInstallPrompt = null;
    if (outcome === 'accepted') {
      rememberInstalled();
      setState('installed');
    }
    return outcome;
  }, [deferred]);

  // Is this an iOS / iPadOS device? NO iOS browser supports a programmatic
  // install: the only path is Safari → Share → Add to Home Screen. iPadOS 13+
  // reports a desktop "Macintosh" UA, so `maxTouchPoints` disambiguates.
  const isIos = (() => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    const iPadOS = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
    return /iphone|ipad|ipod/i.test(ua) || iPadOS;
  })();

  return { state, promptInstall, isIos };
}

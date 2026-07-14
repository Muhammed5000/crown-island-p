'use client';

import { useEffect } from 'react';

/**
 * Registers `/sw.js` once on the client.
 *
 * Production-only: in dev, HMR and the service worker fight over the response
 * cache; we'd see stale chunks long after editing files. We also bail out
 * silently if the browser doesn't support service workers.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    // In dev, a service worker left over from an earlier production/Docker run
    // on the same origin (e.g. localhost:3000) keeps controlling navigations and
    // can serve stale/404 responses long after we switched back to `next dev`.
    // Actively tear it down so dev never gets poisoned by a stale SW.
    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => {
          // Keep the dedicated push worker — it has no fetch handler, so it
          // can't poison the HMR cache, and unregistering it would destroy the
          // user's push subscription on every dev refresh.
          const scriptURL =
            reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || '';
          if (scriptURL.endsWith('/sw-push.js')) return;
          reg.unregister().catch(() => {});
        });
      });
      if ('caches' in window) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k).catch(() => {})));
      }
      return;
    }

    // Register right after `load` (so it doesn't compete with first paint / the
    // LCP image) but NOT later. Chrome only fires `beforeinstallprompt` once a
    // service worker controls the page, so a too-late registration (the previous
    // `requestIdleCallback`, which can fire seconds late on image-heavy pages)
    // means the "Install app" button isn't ready when the user taps it. The
    // heavy precache work runs inside the SW's own install event, off the main
    // thread, so registering here is cheap.
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Swallow — never break the page because the SW failed to register.
      });
    };

    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}

import type { ReactNode } from 'react';
import { getLocale } from 'next-intl/server';
import { fontVariables } from '@/lib/fonts';
import { localeDirection, type Locale } from '@/i18n/config';
import Script from 'next/script';
import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Crown Island — El Montazah',
    template: '%s · Crown Island',
  },
  description: 'Premium booking experience for Crown Island — El Montazah.',
  applicationName: 'Crown Island',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Crown Island',
  },
  icons: {
    icon: '/icons/icon.svg',
    shortcut: '/icons/icon.svg',
    // iOS "Add to Home Screen" needs a raster apple-touch icon.
    apple: '/icons/icon-apple-180.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#0a132a',
  width: 'device-width',
  initialScale: 1,
  // No `maximumScale` / `userScalable: false`: capping zoom breaks WCAG 1.4.4
  // (Resize text) and blocks low-vision users from pinch-zooming the booking,
  // payment, gate and admin flows. Users must be able to zoom.
  viewportFit: 'cover',
};

/**
 * TRUE Root layout for the entire application.
 * Defines the required <html> and <body> tags.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const dir = localeDirection[locale as Locale] || 'rtl';

  return (
    <html
      lang={locale}
      dir={dir}
      data-theme="light"
      className={fontVariables}
      suppressHydrationWarning
    >
      <head>
        <Script
          id="ci-theme-init"
          dangerouslySetInnerHTML={{
            // Pre-paint theme resolution. Default is "light" ("Seaside Daylight"
            // — the off-white/navy/teal/gold look from the Crown Island
            // reference). Explicit user choices (light/dark) win; "system"
            // follows the OS; anything else (incl. first visit) falls back to
            // light so the first paint matches the reference design.
            __html: `(function(){try{var t=localStorage.getItem('ci-theme');var r;if(t==='light'||t==='dark'){r=t}else if(t==='system'){r=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}else{r='light'}document.documentElement.setAttribute('data-theme',r)}catch(e){document.documentElement.setAttribute('data-theme','light')}})();`,
          }}
        />
        {/*
          Capture the PWA install prompt as EARLY as possible. Chromium fires
          `beforeinstallprompt` once, often before React hydrates — if no listener
          exists yet the event (and the one-tap install) is lost. A RAW inline
          <script> in <head> runs synchronously during HTML parse (before
          hydration), so it never misses the event: it stashes it on `window` and
          re-dispatches a custom event the install button's hook reads. Cleared
          again on `appinstalled`.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{window.__ciInstallPrompt=window.__ciInstallPrompt||null;window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__ciInstallPrompt=e;window.dispatchEvent(new Event('ci-installable'))});window.addEventListener('appinstalled',function(){window.__ciInstallPrompt=null})}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-dvh bg-background font-arabic text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}

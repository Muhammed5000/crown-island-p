import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

/**
 * Loads the message catalogue for the active locale on every server request.
 *
 * Next-intl invokes this on each request; the catalogue is dynamically imported,
 * which lets Next code-split per-locale and keeps the JS payload tight on mobile.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const candidate = await requestLocale;
  const locale = hasLocale(routing.locales, candidate) ? candidate : routing.defaultLocale;

  return {
    locale,
    // Pin a global time zone so server- and client-rendered dates/times agree
    // (otherwise next-intl warns and date/time markup can mismatch on hydration).
    // Crown Island is a single-location El Montazah venue → Cairo local time.
    timeZone: 'Africa/Cairo',
    messages: (await import(`@/messages/${locale}.json`)).default,
    // Missing-message handling.
    //
    // The `Breadcrumbs` component looks up translations by URL segment
    // (e.g. `breadcrumbs.crown-club`, `breadcrumbs.testing`). Any catalog
    // segment we haven't pre-translated triggers a MISSING_MESSAGE — by
    // default next-intl logs that as an error, which in dev surfaces as
    // a red error overlay and prevents the user from interacting with
    // the page. The Breadcrumbs component already handles missing keys
    // with a graceful humanised fallback, so we silence those particular
    // errors here.
    //
    // Everything else still goes through `console.error` so a real
    // typo in a hand-coded message reference is still visible.
    onError(error) {
      const msg = String(error?.message ?? '');
      if (msg.includes('breadcrumbs.')) return;
      console.error(error);
    },
    getMessageFallback({ namespace, key }) {
      // For known-graceful namespaces, return the bare key so the caller
      // can decide what to render. The Breadcrumbs lookup checks for the
      // `namespace.key` shape and falls back to humanising.
      if (namespace === 'breadcrumbs') return `breadcrumbs.${key}`;
      return `${namespace ? `${namespace}.` : ''}${key}`;
    },
  };
});

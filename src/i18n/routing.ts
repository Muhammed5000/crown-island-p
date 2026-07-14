import { defineRouting } from 'next-intl/routing';
import { defaultLocale, locales } from './config';

export const routing = defineRouting({
  locales: [...locales],
  defaultLocale,
  /**
   * Locale detection is enabled so user preferences (NEXT_LOCALE cookie) are
   * remembered across sessions. New visitors are forced to Arabic via proxy.ts.
   */
  localeDetection: true,
  /**
   * Use prefixed paths only when not the default locale.
   * Examples:
   *   /booking         → Arabic (default)
   *   /en/booking      → English
   */
  localePrefix: 'as-needed',
});

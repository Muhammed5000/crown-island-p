/**
 * Crown Island — locale configuration.
 * Adding a locale = adding the slug here + a matching JSON file under `src/messages/`.
 */
export const locales = ['ar', 'en'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'ar';

export const localeDirection: Record<Locale, 'rtl' | 'ltr'> = {
  ar: 'rtl',
  en: 'ltr',
};

export const localeLabels: Record<Locale, string> = {
  ar: 'العربية',
  en: 'English',
};

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}

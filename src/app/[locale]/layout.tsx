import { notFound } from 'next/navigation';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { I18nProvider } from '@/components/providers/I18nProvider';
import { hasLocale } from 'next-intl';
import { Providers } from '@/components/providers/Providers';
import { locales } from '@/i18n/config';

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

interface Props {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

/**
 * Locale-aware layout nested under the true root.
 * Handles i18n providers and context.
 */
export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  if (!hasLocale(locales, locale)) {
    notFound();
  }

  // Enable static rendering for the locale segment.
  setRequestLocale(locale);

  const messages = await getMessages();

  return (
    <I18nProvider locale={locale} messages={messages}>
      <Providers>{children}</Providers>
    </I18nProvider>
  );
}

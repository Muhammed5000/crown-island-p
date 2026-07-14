'use client';

import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

interface Props {
  children: React.ReactNode;
  locale: string;
  messages: AbstractIntlMessages;
}

export function I18nProvider({ children, locale, messages }: Props) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      // Pin Cairo time so client-rendered dates/times match the server and
      // don't trigger next-intl's ENVIRONMENT_FALLBACK hydration warning.
      timeZone="Africa/Cairo"
      onError={(error) => {
        const msg = String(error?.message ?? '');
        if (msg.includes('breadcrumbs.')) return;
        console.error(error);
      }}
      getMessageFallback={({ namespace, key }) => {
        if (namespace === 'breadcrumbs') return `breadcrumbs.${key}`;
        return `${namespace ? `${namespace}.` : ''}${key}`;
      }}
    >
      {children}
    </NextIntlClientProvider>
  );
}

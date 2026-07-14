import { setRequestLocale } from 'next-intl/server';
import { getSettings } from '@/server/settings/settings';
import { TermsGate } from './TermsGate';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function TermsGatePage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const settings = await getSettings();
  const terms = locale === 'ar' ? settings.termsAr : settings.termsEn;

  return <TermsGate terms={terms ?? ''} />;
}

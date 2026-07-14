import { setRequestLocale } from 'next-intl/server';
import { getSettings } from '@/server/settings/settings';
import { TermsForm } from './TermsForm';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function AdminTermsPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const settings = await getSettings();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-foreground">
          Global Terms & Conditions
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Updating these terms will force ALL users to re-accept them upon their next sign-in or page refresh.
        </p>
      </header>

      <TermsForm
        initialTermsEn={settings.termsEn ?? ''}
        initialTermsAr={settings.termsAr ?? ''}
      />
    </div>
  );
}

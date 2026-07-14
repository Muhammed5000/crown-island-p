import { setRequestLocale } from 'next-intl/server';
import { getSettings, getRefundTiers } from '@/server/settings/settings';
import { RefundPolicyForm } from './RefundPolicyForm';
import { RefundTiersForm } from './RefundTiersForm';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function AdminRefundPolicyPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const [settings, refundTiers] = await Promise.all([getSettings(), getRefundTiers()]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-foreground">
          Global Refund Policy
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Updating this policy will force ALL users to re-accept it upon their next sign-in or page refresh.
        </p>
      </header>

      <RefundTiersForm initialTiers={refundTiers} />

      <RefundPolicyForm
        initialRefundPolicyEn={settings.refundPolicyEn ?? ''}
        initialRefundPolicyAr={settings.refundPolicyAr ?? ''}
      />
    </div>
  );
}

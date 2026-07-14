import { setRequestLocale } from 'next-intl/server';
import { getSettings } from '@/server/settings/settings';
import { PolicyGate } from '@/components/policy/PolicyGate';
import { acceptRefundPolicyAction } from '@/features/auth/refund-policy-actions';
import { isLocale } from '@/i18n/config';

interface Props {
  params: Promise<{ locale: string }>;
}

export default async function RefundGatePage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const settings = await getSettings();
  const document = locale === 'ar' ? settings.refundPolicyAr : settings.refundPolicyEn;

  return (
    <PolicyGate
      document={document ?? ''}
      namespace="refundPolicy"
      acceptAction={acceptRefundPolicyAction}
    />
  );
}

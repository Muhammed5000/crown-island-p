import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { getSessionUser } from '@/server/auth/guards';
import { canViewGateMoney } from '@/server/auth/roles';
import { isLocale } from '@/i18n/config';
import { getGateSummary } from '@/server/services/gate-scan';
import { GateScanner } from '@/components/gate/GateScanner';

export const metadata: Metadata = {
  title: 'Gate Scanner',
};

interface Props {
  params: Promise<{ locale: string }>;
}

/**
 * Gate security check-in scanner. The layout already enforces staff access;
 * here we just resolve the operator's display name and hand the locale to the
 * client scanner shell (which picks mobile vs. desktop by viewport).
 */
export default async function GateScanPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  const staff = await getSessionUser();
  // SECURITY operators see no money anywhere on the gate page; everyone else
  // gate-authorised (STAFF + admin tiers) does. The summary is fetched with the
  // same flag so revenue is never even computed into the security payload.
  const canViewMoney = canViewGateMoney(staff?.role);
  const summary = await getGateSummary(locale, canViewMoney);

  return (
    <GateScanner
      locale={locale}
      operatorName={staff?.name ?? staff?.email ?? 'Operator'}
      staffRole={staff?.role ?? null}
      initialSummary={summary}
      canViewMoney={canViewMoney}
    />
  );
}

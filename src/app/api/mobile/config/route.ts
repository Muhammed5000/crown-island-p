import { NextResponse } from 'next/server';
import { getSettings } from '@/server/settings/settings';
import { MOBILE_API_DISABLED, mobileApiDisabled } from '@/server/mobile/disabled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/config — public app configuration.
 *
 * Exposes only the customer-relevant subset of the `Settings` singleton:
 * the maintenance switch, support contacts, currency/locale defaults, the
 * cancellation cutoff (so the app can explain why cancel is refused) and the
 * global Terms & Conditions text + version stamp (drives the terms gate).
 */
export async function GET() {
  // TEMPORARILY DISABLED: Mobile application API delivery is currently disabled.
  // Keep this code for future re-enable. Do not delete.
  // Disabled by request: "disable all the api that deliver to mobile application comment it for now until we enable it later"
  if (MOBILE_API_DISABLED) return mobileApiDisabled();
  const s = await getSettings();
  return NextResponse.json({
    ok: true,
    config: {
      siteName: s.siteName,
      bookingsEnabled: s.bookingsEnabled,
      supportEmail: s.supportEmail,
      supportPhone: s.supportPhone,
      defaultCurrency: s.defaultCurrency,
      defaultLocale: s.defaultLocale,
      cancellationCutoffHours: s.cancellationCutoffHours,
      bookingLeadTimeHours: s.bookingLeadTimeHours,
      termsEn: s.termsEn,
      termsAr: s.termsAr,
      termsUpdatedAt: s.termsUpdatedAt ? s.termsUpdatedAt.toISOString() : null,
      refundPolicyEn: s.refundPolicyEn,
      refundPolicyAr: s.refundPolicyAr,
      refundPolicyUpdatedAt: s.refundPolicyUpdatedAt
        ? s.refundPolicyUpdatedAt.toISOString()
        : null,
    },
  });
}

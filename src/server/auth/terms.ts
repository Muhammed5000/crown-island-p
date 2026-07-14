import 'server-only';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getSessionUser } from './guards';
import { getSettings } from '../settings/settings';

/**
 * Validates that the current signed-in user has accepted the latest global
 * Terms & Conditions. If not, redirects them to the terms gate.
 *
 * Call this from layouts that require terms acceptance (App, Admin, etc).
 */
/**
 * Pure boolean: does the CURRENT signed-in user satisfy the terms gate? (No
 * redirect.) Guests and "no terms defined" both count as satisfied. Shared by the
 * layout assert AND server actions that must re-enforce the gate on a direct call.
 */
export async function hasAcceptedCurrentTerms(): Promise<boolean> {
  const user = await getSessionUser();
  if (!user) return true; // Guests aren't gated by terms until they sign in.

  const settings = await getSettings();
  if (!settings.termsEn) return true; // No terms defined → nothing to accept.

  const acceptedAt = user.termsAcceptedAt;
  // If never updated (legacy), we use a base date from when this feature was added.
  const termsUpdatedAt = settings.termsUpdatedAt ?? new Date('2026-06-01');
  return !(!acceptedAt || acceptedAt < termsUpdatedAt);
}

export async function assertTermsAccepted(locale: string) {
  const user = await getSessionUser();
  if (!user) return; // Guests aren't gated by terms until they sign in.

  const h = await headers();
  const pathname = h.get('x-next-pathname') || '';
  // Never redirect if we're already on the terms gate to avoid loops.
  if (pathname.includes('/terms-gate')) {
    return;
  }

  if (!(await hasAcceptedCurrentTerms())) {
    redirect(`/${locale}/terms-gate`);
  }
}

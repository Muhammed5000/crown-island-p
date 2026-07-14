import 'server-only';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getSessionUser } from './guards';
import { prisma } from '@/server/db/prisma';
import { getSettings } from '../settings/settings';

/**
 * Validates that the current signed-in user has accepted the latest global
 * Refund Policy. If not, redirects them to the refund-policy gate.
 *
 * Mirrors `assertTermsAccepted` exactly — the two policies are independent, so a
 * change to either forces its own re-accept. Call this from layouts that require
 * policy acceptance (App, Admin, …), after `assertTermsAccepted`.
 */
/**
 * Pure boolean: does the CURRENT signed-in user satisfy the refund-policy gate?
 * (No redirect.) Shared by the layout assert AND server actions that must
 * re-enforce the gate on a direct call. Mirrors `hasAcceptedCurrentTerms`.
 */
export async function hasAcceptedCurrentRefundPolicy(): Promise<boolean> {
  const user = await getSessionUser();
  if (!user) return true; // Guests aren't gated by the refund policy until they sign in.

  const settings = await getSettings();
  if (!settings.refundPolicyEn) return true; // No policy defined → nothing to accept.

  // `refundPolicyAcceptedAt` isn't carried in the JWT session, so read it fresh
  // from the DB (cheap indexed lookup; `getSessionUser` is request-memoised).
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { refundPolicyAcceptedAt: true },
  });
  const acceptedAt = dbUser?.refundPolicyAcceptedAt ?? null;
  // If never updated (legacy), we use a base date from when this feature was added.
  const updatedAt = settings.refundPolicyUpdatedAt ?? new Date('2026-07-01');
  return !(!acceptedAt || acceptedAt < updatedAt);
}

export async function assertRefundPolicyAccepted(locale: string) {
  const user = await getSessionUser();
  if (!user) return; // Guests aren't gated by the refund policy until they sign in.

  const h = await headers();
  const pathname = h.get('x-next-pathname') || '';
  // Never redirect if we're already on either policy gate to avoid loops.
  if (pathname.includes('/refund-gate') || pathname.includes('/terms-gate')) {
    return;
  }

  if (!(await hasAcceptedCurrentRefundPolicy())) {
    redirect(`/${locale}/refund-gate`);
  }
}

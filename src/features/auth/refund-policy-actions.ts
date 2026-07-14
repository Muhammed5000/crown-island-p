'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db/prisma';
import { getSessionUser } from '@/server/auth/guards';

/**
 * Marks the current user as having accepted the latest Refund Policy and reports
 * where the user should go next.
 *
 * Mirrors `acceptTermsAction`: a customer who has not yet completed their profile
 * is sent to `/profile/complete`; one who already has a profile goes to the
 * booking home; non-customers return to the root, where the proxy + landing page
 * route them to the surface they belong on.
 */
export async function acceptRefundPolicyAction() {
  const user = await getSessionUser();
  if (!user) return { ok: false as const, code: 'unauthenticated' as const };

  await prisma.user.update({
    where: { id: user.id },
    data: { refundPolicyAcceptedAt: new Date() },
  });

  // Revalidate everything to clear any stale 'accept policy' gates.
  revalidatePath('/', 'layout');

  let redirectTo = '/';
  if (user.role === 'CUSTOMER') {
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { profile: { select: { id: true } } },
    });
    redirectTo = dbUser?.profile ? '/booking' : '/profile/complete';
  }

  return { ok: true as const, redirectTo };
}

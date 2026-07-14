import type { ReactNode } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { getSessionUser } from '@/server/auth/guards';
import { assertTermsAccepted } from '@/server/auth/terms';
import { assertRefundPolicyAccepted } from '@/server/auth/refund-policy';
import { prisma } from '@/server/db/prisma';
import { isLocale } from '@/i18n/config';

interface Props {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

/**
 * Shell for the booking app (booking, history, menu, settings, support).
 *
 * Auth is OPTIONAL here so guests can browse the catalog. The proxy already
 * gates the routes that require a session (booking commit/payment, bookings,
 * profile, settings, etc.), and restricted server actions re-check on their
 * own — so this layout only resolves the (possibly absent) user for the shell
 * chrome and, for signed-in users, enforces profile completion.
 */
export default async function AppLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;
  setRequestLocale(locale);

  await assertTermsAccepted(locale);
  await assertRefundPolicyAccepted(locale);

  const user = await getSessionUser();

  let userName: string | null = null;
  let userImage: string | null = null;

  if (user) {
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        name: true,
        image: true,
        profile: {
          select: { id: true, nationalId: true, passportId: true, region: true },
        },
      },
    });
    // Signed-in users still must complete their profile before using app
    // features. Guests are never sent here — they can browse freely. Completion
    // now also requires an identity document (national ID or passport) and a
    // region, so older profiles missing these are sent back to finish.
    const profile = dbUser?.profile;
    const profileComplete =
      !!profile && !!profile.region && (!!profile.nationalId || !!profile.passportId);
    if (!profileComplete) {
      redirect(`/${locale}/profile/complete`);
    }
    userName = dbUser?.name ?? null;
    userImage = dbUser?.image ?? null;
  }

  return (
    <AppShell userName={userName} userImage={userImage} isAuthenticated={!!user}>
      {children}
    </AppShell>
  );
}

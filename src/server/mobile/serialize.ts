import 'server-only';
import { prisma } from '@/server/db/prisma';

/**
 * Canonical "current user" payload returned by `/api/mobile/auth/login`,
 * `/api/mobile/auth/register/complete` and `/api/mobile/me`.
 *
 * `profileComplete` mirrors the web app-layout gate
 * (`src/app/[locale]/(app)/layout.tsx`): a profile is complete once `region`
 * is set AND a national id OR passport id is present. The app uses it to
 * route new sign-ins to the complete-profile screen.
 */
export interface MobileMePayload {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  phone: string | null;
  role: string;
  termsAcceptedAt: string | null;
  profileComplete: boolean;
  profile: {
    fullName: string;
    phone: string;
    countryCode: string;
    age: number | null;
    isHandicapped: boolean;
    email: string | null;
    nationalId: string | null;
    passportId: string | null;
    region: string | null;
  } | null;
}

export async function mobileMePayload(userId: string): Promise<MobileMePayload | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      phone: true,
      role: true,
      termsAcceptedAt: true,
      deletedAt: true,
      blockedAt: true,
      profile: true,
    },
  });
  if (!user || user.deletedAt || user.blockedAt) return null;

  const p = user.profile;
  const profileComplete = !!(p?.region && (p.nationalId || p.passportId));

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    phone: user.phone,
    role: user.role,
    termsAcceptedAt: user.termsAcceptedAt ? user.termsAcceptedAt.toISOString() : null,
    profileComplete,
    profile: p
      ? {
          fullName: p.fullName,
          phone: p.phone,
          countryCode: p.countryCode,
          age: p.age,
          isHandicapped: p.isHandicapped,
          email: p.email,
          nationalId: p.nationalId,
          passportId: p.passportId,
          region: p.region,
        }
      : null,
  };
}

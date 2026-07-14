import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/prisma';
import { getMobileUser, UNAUTHORIZED } from '@/server/mobile/guard';
import { MOBILE_API_DISABLED, mobileApiDisabled } from '@/server/mobile/disabled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/me/accept-terms — record Terms & Conditions acceptance.
 *
 * Stamps `User.termsAcceptedAt = now`, the same write the website's terms
 * gate performs. The app shows the gate when `termsAcceptedAt` predates the
 * `termsUpdatedAt` stamp from `/api/mobile/config` (and terms text exists).
 */
export async function POST(request: Request) {
  // TEMPORARILY DISABLED: Mobile application API delivery is currently disabled.
  // Keep this code for future re-enable. Do not delete.
  // Disabled by request: "disable all the api that deliver to mobile application comment it for now until we enable it later"
  if (MOBILE_API_DISABLED) return mobileApiDisabled();
  const user = await getMobileUser(request);
  if (!user) return NextResponse.json(UNAUTHORIZED, { status: 401 });

  await prisma.user.update({
    where: { id: user.id },
    data: { termsAcceptedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}

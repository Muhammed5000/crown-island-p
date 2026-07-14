import { NextResponse } from 'next/server';
import { getPayableSanctionsForUser } from '@/server/services/sanctions';
import { getMobileUser, UNAUTHORIZED } from '@/server/mobile/guard';
import { MOBILE_API_DISABLED, mobileApiDisabled } from '@/server/mobile/disabled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/sanctions — the caller's payable penalties.
 *
 * The website review screen shows ACTIVE sanctions as extra invoice lines
 * before confirmation; the app needs the same numbers so the total it
 * displays matches what `createBooking` will charge.
 */
export async function GET(request: Request) {
  // TEMPORARILY DISABLED: Mobile application API delivery is currently disabled.
  // Keep this code for future re-enable. Do not delete.
  // Disabled by request: "disable all the api that deliver to mobile application comment it for now until we enable it later"
  if (MOBILE_API_DISABLED) return mobileApiDisabled();
  const user = await getMobileUser(request);
  if (!user) return NextResponse.json(UNAUTHORIZED, { status: 401 });

  const { sanctions, totalCents } = await getPayableSanctionsForUser(user.id);
  return NextResponse.json({
    ok: true,
    totalCents,
    sanctions: sanctions.map((s) => ({
      id: s.id,
      amountCents: s.amountCents,
      reason: s.reason,
      createdAt: s.createdAt,
    })),
  });
}

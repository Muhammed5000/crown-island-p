import { NextResponse } from 'next/server';
import { listPublicRestaurants } from '@/server/services/restaurants';
import { getMobileUser, UNAUTHORIZED } from '@/server/mobile/guard';
import { MOBILE_API_DISABLED, mobileApiDisabled } from '@/server/mobile/disabled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/restaurants[?query=…] — APPROVED restaurant directory.
 *
 * Sign-in required, mirroring the website's `/menu` page (guests are
 * redirected to login there). Returns the same public card projection.
 */
export async function GET(request: Request) {
  // TEMPORARILY DISABLED: Mobile application API delivery is currently disabled.
  // Keep this code for future re-enable. Do not delete.
  // Disabled by request: "disable all the api that deliver to mobile application comment it for now until we enable it later"
  if (MOBILE_API_DISABLED) return mobileApiDisabled();
  const user = await getMobileUser(request);
  if (!user) return NextResponse.json(UNAUTHORIZED, { status: 401 });

  const url = new URL(request.url);
  const query = url.searchParams.get('query') ?? undefined;

  const restaurants = await listPublicRestaurants(query);
  return NextResponse.json({ ok: true, restaurants });
}

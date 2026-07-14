import { NextResponse } from 'next/server';
import { getRestaurantForViewer } from '@/server/services/restaurants';
import { getMobileUser, UNAUTHORIZED } from '@/server/mobile/guard';
import { MOBILE_API_DISABLED, mobileApiDisabled } from '@/server/mobile/disabled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/restaurants/:id — restaurant profile.
 *
 * APPROVED profiles only for regular customers (the mobile guard already
 * refuses admin roles, and the owner-preview path still works for a
 * RESTAURANT-role account viewing its own profile). Unapproved profiles are
 * indistinguishable from "not found", same as the website.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  // TEMPORARILY DISABLED: Mobile application API delivery is currently disabled.
  // Keep this code for future re-enable. Do not delete.
  // Disabled by request: "disable all the api that deliver to mobile application comment it for now until we enable it later"
  if (MOBILE_API_DISABLED) return mobileApiDisabled();
  const user = await getMobileUser(request);
  if (!user) return NextResponse.json(UNAUTHORIZED, { status: 401 });

  const { id } = await context.params;
  const restaurant = await getRestaurantForViewer(id, { id: user.id, isAdmin: false });
  if (!restaurant) {
    return NextResponse.json({ ok: false, code: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, restaurant });
}

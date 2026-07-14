import { NextResponse } from 'next/server';
import { getBookingDetail } from '@/server/services/bookings-read';
import { getMobileUser, UNAUTHORIZED } from '@/server/mobile/guard';
import { MOBILE_API_DISABLED, mobileApiDisabled } from '@/server/mobile/disabled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/bookings/:id — booking detail (owner only).
 *
 * Same read path as the website detail page (`getBookingDetail`): service +
 * category, invoice with lines + refunds, payments, assigned places, with the
 * lazy CONFIRMED→EXPIRED transition applied.
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
  const booking = await getBookingDetail(id, user.id);
  if (!booking) {
    return NextResponse.json({ ok: false, code: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, booking });
}

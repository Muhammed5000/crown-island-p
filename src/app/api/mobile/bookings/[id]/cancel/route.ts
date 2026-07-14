import { NextResponse } from 'next/server';
import { cancelBooking } from '@/server/services/bookings-read';
import { DomainError } from '@/server/services/errors';
import { getMobileUser, UNAUTHORIZED } from '@/server/mobile/guard';
import { MOBILE_API_DISABLED, mobileApiDisabled } from '@/server/mobile/disabled';
import { log, errFields } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/bookings/:id/cancel — customer self-cancel.
 *
 * Same service transaction the website uses (`cancelBooking`): only
 * PENDING_PAYMENT / future CONFIRMED bookings, subject to the admin-configured
 * cancellation cutoff. Domain errors surface as machine codes the app
 * localises (`cancellation_cutoff`, `booking_already_used`, …).
 */
export async function POST(
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
  try {
    await cancelBooking(id, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ ok: false, code: err.code }, { status: err.httpStatus });
    }
    log.error('mobile cancel booking failed', errFields(err));
    return NextResponse.json({ ok: false, code: 'unknown' }, { status: 500 });
  }
}

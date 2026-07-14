import { NextResponse } from 'next/server';
import { getSessionUser } from '@/server/auth/guards';
import { canAccessReception } from '@/server/auth/roles';
import { getBookingPlacement } from '@/server/services/place-assignment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/gate/places?bookingId=...
 *
 * Returns the live placement view for a booking: its units, the places already
 * assigned, the places currently available (free on every day of the booking),
 * and an adjacency-based recommendation for the still-unplaced units.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  // Placement view is a reception-desk function (mirrors gate/places-available) —
  // not SECURITY / HOUSEKEEPING / MAINTENANCE.
  if (!canAccessReception(user.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const bookingId = new URL(request.url).searchParams.get('bookingId');
  // Presence + a sane upper bound (booking ids are cuids ~25 chars) so an
  // attacker can't push an unbounded string into the lookup.
  if (!bookingId || bookingId.length > 64) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const view = await getBookingPlacement(bookingId);
  if (!view) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ placement: view });
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser } from '@/server/auth/guards';
import { canAccessReception } from '@/server/auth/roles';
import { assignPlaces, getBookingPlacement } from '@/server/services/place-assignment';
import { DomainError } from '@/server/services/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  bookingId: z.string().min(1),
  assignments: z
    .array(z.object({ unitIndex: z.number().int().min(0), placeId: z.string().min(1) }))
    .min(1)
    .max(50),
});

/**
 * POST /api/gate/assign-places
 *
 * Body: { bookingId, assignments: [{ unitIndex, placeId }] }
 *
 * Assigns each chosen place to its unit on every day of the booking inside a
 * transaction. The `BookingUnit @@unique([placeId, date])` constraint defeats
 * concurrent double-assignment (→ `place_taken`). Returns the refreshed
 * placement view so the UI updates live.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  // Place assignment is a reception-desk function — not for SECURITY (scan-only) or
  // HOUSEKEEPING/MAINTENANCE (ticket work). Mirrors gate/places-available.
  if (!canAccessReception(user.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  try {
    await assignPlaces({
      bookingId: parsed.data.bookingId,
      staffId: user.id,
      assignments: parsed.data.assignments,
    });
    const placement = await getBookingPlacement(parsed.data.bookingId);
    return NextResponse.json({ placement });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.httpStatus });
    }
    throw err;
  }
}

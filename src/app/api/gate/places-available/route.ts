import { NextResponse } from 'next/server';
import { getSessionUser } from '@/server/auth/guards';
import { canAccessReception } from '@/server/auth/roles';
import { getAvailablePlaces } from '@/server/services/place-assignment';
import { parseIsoDateUTC } from '@/lib/date';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/gate/places-available?serviceId=...&dates=2026-06-08,2026-06-09
 *
 * Booking-less availability for the reception desk's deferred-commit wizard: a
 * booking doesn't exist yet at the placement step, so this returns every place
 * free on ALL the requested days, for the operator to pre-select on the 2D map.
 * Reception-authorised staff only (never SECURITY).
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!canAccessReception(user.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const serviceId = params.get('serviceId');
  const datesRaw = (params.get('dates') ?? '').split(',').map((d) => d.trim()).filter(Boolean);
  if (!serviceId || datesRaw.length === 0 || !datesRaw.every((d) => DATE_RE.test(d))) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  // DATE-001: DATE_RE only checks the yyyy-mm-dd SHAPE; parseIsoDateUTC now also
  // rejects impossible calendar dates (2026-02-31 → null), so parse and 400 on any
  // null instead of injecting null into getAvailablePlaces.
  const parsedDates = datesRaw.map((d) => parseIsoDateUTC(d));
  if (parsedDates.some((d) => d === null)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const dates = parsedDates as Date[];

  const available = await getAvailablePlaces(serviceId, dates, null);
  return NextResponse.json({ available });
}

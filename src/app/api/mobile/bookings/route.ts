import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createBooking } from '@/server/services/booking';
import { listUserBookings, type HistoryFilter } from '@/server/services/bookings-read';
import { DomainError } from '@/server/services/errors';
import { getMobileUser, UNAUTHORIZED } from '@/server/mobile/guard';
import { MOBILE_API_DISABLED, mobileApiDisabled } from '@/server/mobile/disabled';
import { log, errFields } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /api/mobile/bookings
 *
 *  - POST — create a booking (mobile equivalent of the website's
 *    `commitBooking` server action). Same schema, same idempotency via
 *    `clientRequestId`, same price guard via `expectedTotalCents`, same
 *    service-layer transaction (`createBooking`) — sanctions, invoice,
 *    payment row, capacity hold and visit code all happen there.
 *  - GET ?filter=all|upcoming|past — booking history, same lazy-expiry read
 *    path the website history page uses (`listUserBookings`).
 */

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z.object({
  serviceId: z.string().min(1),
  date: z.string().regex(dateRe),
  endDate: z.string().regex(dateRe).optional(),
  adults: z.number().int().min(1).max(200).optional(),
  people: z.number().int().min(1).max(200).optional(),
  children: z.number().int().min(0).max(200).optional().default(0),
  cars: z.number().int().min(0).max(100),
  clientRequestId: z.string().min(8).max(64),
  expectedTotalCents: z.number().int().nonnegative().optional(),
  locale: z.enum(['ar', 'en']).default('ar'),
});

export async function POST(request: Request) {
  // TEMPORARILY DISABLED: Mobile application API delivery is currently disabled.
  // Keep this code for future re-enable. Do not delete.
  // Disabled by request: "disable all the api that deliver to mobile application comment it for now until we enable it later"
  if (MOBILE_API_DISABLED) return mobileApiDisabled();
  const user = await getMobileUser(request);
  if (!user) return NextResponse.json(UNAUTHORIZED, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: 'invalid_input' }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: 'invalid_input' }, { status: 400 });
  }

  const adults = parsed.data.adults ?? parsed.data.people ?? 1;

  try {
    const result = await createBooking({
      userId: user.id,
      serviceId: parsed.data.serviceId,
      date: parsed.data.date,
      endDate: parsed.data.endDate,
      adults,
      children: parsed.data.children,
      cars: parsed.data.cars,
      clientRequestId: parsed.data.clientRequestId,
      locale: parsed.data.locale,
      expectedTotalCents: parsed.data.expectedTotalCents,
    });
    return NextResponse.json({ ok: true, bookingId: result.bookingId, reference: result.reference });
  } catch (err) {
    if (err instanceof DomainError) {
      const extra: { expectedCents?: number; actualCents?: number } = {};
      if ('expectedCents' in err && 'actualCents' in err) {
        extra.expectedCents = (err as unknown as { expectedCents: number }).expectedCents;
        extra.actualCents = (err as unknown as { actualCents: number }).actualCents;
      }
      return NextResponse.json({ ok: false, code: err.code, ...extra }, { status: err.httpStatus });
    }
    log.error('mobile create booking failed', errFields(err));
    return NextResponse.json({ ok: false, code: 'unknown' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  // TEMPORARILY DISABLED: Mobile application API delivery is currently disabled.
  // Keep this code for future re-enable. Do not delete.
  // Disabled by request: "disable all the api that deliver to mobile application comment it for now until we enable it later"
  if (MOBILE_API_DISABLED) return mobileApiDisabled();
  const user = await getMobileUser(request);
  if (!user) return NextResponse.json(UNAUTHORIZED, { status: 401 });

  const url = new URL(request.url);
  const filterParam = url.searchParams.get('filter');
  const filter: HistoryFilter =
    filterParam === 'upcoming' || filterParam === 'past' ? filterParam : 'all';

  const bookings = await listUserBookings(user.id, filter);
  return NextResponse.json({ ok: true, bookings });
}

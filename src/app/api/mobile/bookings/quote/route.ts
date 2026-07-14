import { NextResponse } from 'next/server';
import { calcQuote } from '@/features/booking/actions';
import { MOBILE_API_DISABLED, mobileApiDisabled } from '@/server/mobile/disabled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/bookings/quote — live price preview.
 *
 * Direct wrapper over the website's `calcQuote` server action (the single
 * pricing engine, with availability checking). Public like the website's
 * selection form — guests can see prices before signing in; the commit step
 * is what requires auth.
 */
export async function POST(request: Request) {
  // TEMPORARILY DISABLED: Mobile application API delivery is currently disabled.
  // Keep this code for future re-enable. Do not delete.
  // Disabled by request: "disable all the api that deliver to mobile application comment it for now until we enable it later"
  if (MOBILE_API_DISABLED) return mobileApiDisabled();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: 'invalid_input' }, { status: 400 });
  }

  const result = await calcQuote(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

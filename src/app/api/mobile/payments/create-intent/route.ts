import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ensurePaymentIntention, isPaymentNotConfigured } from '@/server/payments/provider';
import { DomainError } from '@/server/services/errors';
import { getRequestOrigin } from '@/lib/origin';
import { getMobileUser, UNAUTHORIZED } from '@/server/mobile/guard';
import { MOBILE_API_DISABLED, mobileApiDisabled } from '@/server/mobile/disabled';
import { log, errFields } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/payments/create-intent — start a Paymob checkout.
 *
 * Bearer-token twin of `/api/paymob/create-intent`. The app opens the
 * returned `checkoutUrl` in the system browser; Paymob redirects the browser
 * to the website success page afterwards while the server-to-server webhook
 * (`/api/paymob/webhook`, unchanged) confirms the booking. The app simply
 * polls `GET /api/mobile/bookings/:id` until the status settles.
 */

const schema = z.object({
  bookingId: z.string().min(1),
  locale: z.enum(['ar', 'en']).optional(),
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

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: 'invalid_input' }, { status: 400 });
  }

  const origin = await getRequestOrigin();
  const localePrefix = parsed.data.locale === 'en' ? 'en/' : '';
  // IMPORTANT: the browser redirect must land on the PUBLIC, sessionless
  // /payment-return page — NOT the authenticated /booking/success page. The
  // phone's browser has no app session (the app uses bearer tokens), and any
  // unrelated website cookie it carries (e.g. a staff account) would otherwise
  // hijack the redirect — gate-only roles get bounced to /gate/scan by the
  // proxy. The app learns the real outcome by polling the bookings API.
  const redirectionUrl = `${origin}/${localePrefix}payment-return?bid=${parsed.data.bookingId}`;

  try {
    const result = await ensurePaymentIntention({
      userId: user.id,
      bookingId: parsed.data.bookingId,
      origin,
      locale: parsed.data.locale ?? 'ar',
      redirectionUrl,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (isPaymentNotConfigured(err)) {
      return NextResponse.json({ ok: false, code: 'payment_not_configured' }, { status: 503 });
    }
    if (err instanceof DomainError) {
      return NextResponse.json({ ok: false, code: err.code }, { status: err.httpStatus });
    }
    log.error('mobile create intent failed', errFields(err));
    return NextResponse.json({ ok: false, code: 'internal_error' }, { status: 500 });
  }
}

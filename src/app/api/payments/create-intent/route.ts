import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser } from '@/server/auth/guards';
import { DomainError } from '@/server/services/errors';
import { getRequestOrigin } from '@/lib/origin';
import { ensurePaymentIntention, isPaymentNotConfigured } from '@/server/payments/provider';
import { checkUploadRate } from '@/lib/upload-rate-limit';

export const runtime = 'nodejs';

/**
 * Provider-agnostic checkout entry point. Creates a payment intention with the
 * active provider and returns MPGS Lightbox parameters for the client to use.
 */

const schema = z.object({
  bookingId: z.string().min(1),
  locale: z.enum(['ar', 'en']).optional(),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Containment: creating a checkout session hits the payment gateway. Cap it per
  // user so a runaway client / compromised session can't spam the provider.
  const rate = checkUploadRate(`payment-intent:${user.id}`, 10);
  if (!rate.ok) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const origin = await getRequestOrigin();

  try {
    const result = await ensurePaymentIntention({
      userId: user.id,
      bookingId: parsed.data.bookingId,
      origin,
      locale: parsed.data.locale ?? 'ar',
    });
    return NextResponse.json(result);
  } catch (err) {
    if (isPaymentNotConfigured(err)) {
      return NextResponse.json({ error: 'payment_not_configured' }, { status: 503 });
    }
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.code }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}

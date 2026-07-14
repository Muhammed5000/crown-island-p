import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionUser } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { MpgsNotConfiguredError } from '@/server/credit-agricole/client';
import { verifyAndConfirmOrder } from '@/server/credit-agricole/verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Poll target for the payment page while the MPGS iframe is open.
 *
 * The embedded checkout does not reliably navigate `data-complete` from inside
 * our isolated iframe, so the parent page polls this instead: it runs the
 * authoritative RETRIEVE_ORDER verification and confirms the booking the moment
 * MPGS reports SUCCESS. Idempotent and owner-scoped.
 */
const schema = z.object({ bookingId: z.string().min(1) });

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ status: 'unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: 'invalid' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ status: 'invalid' }, { status: 400 });

  // Only the booking owner may poll its payment status.
  const booking = await prisma.booking.findFirst({
    where: { id: parsed.data.bookingId, userId: user.id },
    select: { id: true, status: true },
  });
  if (!booking) return NextResponse.json({ status: 'not_found' }, { status: 404 });
  if (booking.status === 'CONFIRMED') return NextResponse.json({ status: 'success' });

  try {
    const status = await verifyAndConfirmOrder(booking.id, { attempts: 1 });
    return NextResponse.json({ status });
  } catch (err) {
    if (err instanceof MpgsNotConfiguredError) {
      return NextResponse.json({ status: 'not_configured' }, { status: 503 });
    }
    console.error('[MPGS] check failed for booking', booking.id, err);
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}

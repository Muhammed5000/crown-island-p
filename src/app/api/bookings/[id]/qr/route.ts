import { NextResponse } from 'next/server';
import { getSessionUser } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { renderQrSvg, renderQrPng } from '@/lib/qr';
import { visitTokenForBooking } from '@/server/services/visit-code';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/bookings/:id/qr[?format=png]
 *
 * Returns the signed QR for a CONFIRMED booking owned by the caller. The QR
 * encodes the booking's DAILY VISIT token (the per-user-per-day root code) —
 * one scan at the gate opens every booking the customer has for that day. The
 * raw visit code is never exposed; only the signed token lives in the image.
 * Generated on demand (not precomputed) so revoked / cancelled bookings
 * immediately stop producing valid tickets.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await context.params;
  const booking = await prisma.booking.findFirst({
    where: { id, userId: user.id },
    select: { id: true, reference: true, status: true, bookingDate: true },
  });

  if (!booking) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // CANCELLED/EXPIRED can never become CONFIRMED (the confirm engine's terminal
  // guard blocks them) — tell the poller to STOP instead of spinning on 202.
  // FAILED stays 202: a transient gateway FAILED can still recover to CAPTURED
  // (reconciler) and flip the booking to CONFIRMED.
  if (booking.status === 'CANCELLED' || booking.status === 'EXPIRED') {
    return NextResponse.json({ error: 'terminal' }, { status: 410 });
  }
  if (booking.status !== 'CONFIRMED') {
    return NextResponse.json({ error: 'not_confirmed' }, { status: 202 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get('format') === 'png' ? 'png' : 'svg';

  const { token } = await visitTokenForBooking(prisma, booking.id);

  if (format === 'png') {
    const buf = await renderQrPng(token);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, no-store',
      },
    });
  }

  const svg = await renderQrSvg(token);
  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'private, no-store',
    },
  });
}

import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/prisma';
import { renderQrSvg, renderQrPng } from '@/lib/qr';
import { visitTokenForBooking } from '@/server/services/visit-code';
import { getMobileUser, UNAUTHORIZED } from '@/server/mobile/guard';
import { MOBILE_API_DISABLED, mobileApiDisabled } from '@/server/mobile/disabled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/bookings/:id/qr[?format=png] — the gate ticket QR.
 *
 * Bearer-token twin of `/api/bookings/:id/qr`: same ownership check, same
 * CONFIRMED-only rule, same signed DAILY VISIT token (one scan opens every
 * booking the customer has that day). Defaults to PNG, the friendlier format
 * for React Native's <Image>.
 */
export async function GET(
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
  const booking = await prisma.booking.findFirst({
    where: { id, userId: user.id },
    select: { id: true, status: true },
  });

  if (!booking) return NextResponse.json({ ok: false, code: 'not_found' }, { status: 404 });
  if (booking.status !== 'CONFIRMED') {
    return NextResponse.json({ ok: false, code: 'not_confirmed' }, { status: 202 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get('format') === 'svg' ? 'svg' : 'png';

  const { token } = await visitTokenForBooking(prisma, booking.id);

  if (format === 'svg') {
    const svg = await renderQrSvg(token);
    return new NextResponse(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'private, no-store',
      },
    });
  }

  const buf = await renderQrPng(token);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, no-store',
    },
  });
}

import { NextResponse } from 'next/server';
import { getSessionUser } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';
import { checkUploadRate } from '@/lib/upload-rate-limit';
import { getBookingZkPass } from '@/server/zk/pass';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/bookings/:id/zk-pass
 *
 * Returns the ZKBio cabin pass (card number + dynamic door QR) for a booking
 * OWNED by the caller. Backend-mediated: the ZK server URL and token never reach
 * the browser. Rate-limited because the QR is dynamic and fetched on demand.
 * Non-ZK bookings (or ZK off) return `{ status: 'none' }` so the UI hides the pass.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await context.params;

  // Owner scope (IDOR guard) — mirrors the gate-QR route.
  const booking = await prisma.booking.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!booking) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Cap ZK QR fetches per user (dynamic QR; don't hammer the on-prem server).
  const rate = checkUploadRate(`zkpass:${user.id}`, 30, 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  const pass = await getBookingZkPass(id);
  return NextResponse.json(pass, { headers: { 'Cache-Control': 'private, no-store' } });
}

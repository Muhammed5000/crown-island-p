import { NextResponse } from 'next/server';
import { getSessionUser } from '@/server/auth/guards';
import { GATE_ROLES, canViewGateMoney } from '@/server/auth/roles';
import { checkOutBooking } from '@/server/services/gate-scan';
import { DomainError } from '@/server/services/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/gate/check-out
 *
 * Body: { token?, reference?, bookingId?, locale?, exitCount? }
 *
 * Scans a guest party OUT at the exit gate — stamps `checkedOutAt` once,
 * supports partial exits via `exitCount`, and returns the updated pass.
 * Refuses if no one is checked in, or everyone has already left.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!GATE_ROLES.has(user.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: { token?: string; reference?: string; bookingId?: string; locale?: string; exitCount?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  try {
    const pass = await checkOutBooking({
      token: body.token,
      reference: body.reference,
      bookingId: body.bookingId,
      staffUserId: user.id,
      locale: body.locale === 'ar' ? 'ar' : 'en',
      includeMoney: canViewGateMoney(user.role),
      exitCount: typeof body.exitCount === 'number' ? body.exitCount : undefined,
    });
    return NextResponse.json({ pass });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.httpStatus },
      );
    }
    throw err;
  }
}

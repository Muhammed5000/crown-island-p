import { NextResponse } from 'next/server';
import { getSessionUser } from '@/server/auth/guards';
import { GATE_ROLES, canViewGateMoney } from '@/server/auth/roles';
import { checkInBooking } from '@/server/services/gate-scan';
import { DomainError } from '@/server/services/errors';
import { apiError, apiOk, parseJsonBody } from '@/server/http/respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/gate/check-in
 *
 * Body: { token?: string, reference?: string, bookingId?: string, locale? }
 *
 * Admits the guest — stamps `checkedInAt` once and returns the updated pass
 * (now `used`). Refuses non-admissible passes with the reason as the message.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return apiError('unauthorized', 401);
  if (!GATE_ROLES.has(user.role)) return apiError('forbidden', 403);

  const body = await parseJsonBody<{
    token?: string;
    reference?: string;
    bookingId?: string;
    locale?: string;
    admitCount?: number;
    admitGuestSeqs?: number[];
  }>(request);
  if (!body) return apiError('bad_request', 400);

  try {
    const pass = await checkInBooking({
      token: body.token,
      reference: body.reference,
      bookingId: body.bookingId,
      staffUserId: user.id,
      locale: body.locale === 'ar' ? 'ar' : 'en',
      // SECURITY operators never receive money fields (see canViewGateMoney).
      includeMoney: canViewGateMoney(user.role),
      admitCount: typeof body.admitCount === 'number' ? body.admitCount : undefined,
      admitGuestSeqs: Array.isArray(body.admitGuestSeqs)
        ? body.admitGuestSeqs.filter((n): n is number => typeof n === 'number')
        : undefined,
    });
    return apiOk({ pass });
  } catch (err) {
    if (err instanceof DomainError) {
      // Keeps the reason `message` the gate UI renders — apiError would drop it.
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.httpStatus });
    }
    throw err;
  }
}

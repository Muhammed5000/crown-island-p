import { NextResponse } from 'next/server';
import { getSessionUser } from '@/server/auth/guards';
import { GATE_ROLES } from '@/server/auth/roles';
import { recordGateDeny } from '@/server/services/gate-scan';
import { log, errFields } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/gate/deny
 *
 * Body: { token?, reference?, bookingId?, reason? }
 *
 * Records a DENIED gate scan against the signed-in operator for the admin
 * activity report. Fire-and-forget from the scanner — it does not mutate the
 * booking and always returns 200 so a logging hiccup never blocks the gate.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!GATE_ROLES.has(user.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: { token?: string; reference?: string; bookingId?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  try {
    await recordGateDeny({
      operatorUserId: user.id,
      token: body.token,
      reference: body.reference,
      bookingId: body.bookingId,
      // Cap the free-text reason so a hostile/oversized value can't bloat the DB/logs.
      reason: typeof body.reason === 'string' ? body.reason.slice(0, 500) : undefined,
    });
  } catch (err) {
    // Never surface logging failures to the gate UI.
    log.error('gate deny record failed', errFields(err));
  }

  return NextResponse.json({ ok: true });
}

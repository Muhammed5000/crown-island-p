import { NextResponse } from 'next/server';
import { getSessionUser } from '@/server/auth/guards';
import { prisma } from '@/server/db/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/push/unsubscribe
 *
 * Body: { endpoint }. Removes this device's subscription. Scoped to the
 * signed-in user (deleteMany with userId) so one account can't delete another's.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { endpoint?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const endpoint = body.endpoint?.trim();
  if (!endpoint) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
  return NextResponse.json({ ok: true });
}

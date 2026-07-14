import { NextResponse } from 'next/server';
import { z } from 'zod';
import { compare } from 'bcryptjs';
import { prisma } from '@/server/db/prisma';
import { isPrivilegedRole } from '@/server/auth/roles';
import { signMobileToken } from '@/server/mobile/token';
import { mobileMePayload } from '@/server/mobile/serialize';
import { MOBILE_API_DISABLED, mobileApiDisabled } from '@/server/mobile/disabled';
import { consumeLoginAttempt } from '@/server/auth/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/auth/login — email + password sign-in for the mobile app.
 *
 * Mirrors the `customer-password` credentials provider
 * (`src/server/auth/providers.ts`): verified email + password hash required,
 * soft-deleted / blocked accounts rejected. Instead of a session cookie the
 * caller receives a signed bearer token for `Authorization: Bearer …`.
 *
 * Staff/gate/admin roles are refused — the mobile app is the customer app;
 * staff tooling lives on the website.
 */

const schema = z.object({
  email: z.string().trim().min(3).max(254).email().transform((s) => s.toLowerCase()),
  password: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  // TEMPORARILY DISABLED: Mobile application API delivery is currently disabled.
  // Keep this code for future re-enable. Do not delete.
  // Disabled by request: "disable all the api that deliver to mobile application comment it for now until we enable it later"
  if (MOBILE_API_DISABLED) return mobileApiDisabled();
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

  // Brute-force throttle (grace-then-backoff), keyed per email and shared with
  // the web sign-in namespace; cleared on a correct password below.
  const loginKey = `login:${parsed.data.email}`;
  if (!(await consumeLoginAttempt(loginKey)).ok) {
    return NextResponse.json({ ok: false, code: 'rate_limited' }, { status: 429 });
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: {
      id: true,
      role: true,
      passwordHash: true,
      emailVerified: true,
      deletedAt: true,
      blockedAt: true,
      tokenVersion: true,
    },
  });

  // Uniform `invalid_credentials` for every failure mode so accounts can't be
  // enumerated — same stance as the web credentials provider.
  if (!user || !user.passwordHash || !user.emailVerified || user.deletedAt || user.blockedAt) {
    return NextResponse.json({ ok: false, code: 'invalid_credentials' }, { status: 401 });
  }

  const valid = await compare(parsed.data.password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ ok: false, code: 'invalid_credentials' }, { status: 401 });
  }

  // Correct password — clear the throttle so the next sign-in is instant.
  await prisma.authRateLimit.delete({ where: { key: loginKey } }).catch(() => {});

  if (isPrivilegedRole(user.role)) {
    return NextResponse.json({ ok: false, code: 'staff_use_web' }, { status: 403 });
  }

  const token = signMobileToken(user.id, user.tokenVersion);
  const me = await mobileMePayload(user.id);
  return NextResponse.json({ ok: true, token, user: me });
}

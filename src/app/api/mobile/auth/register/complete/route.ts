import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db/prisma';
import { registerCustomer } from '@/server/auth/register';
import { signMobileToken } from '@/server/mobile/token';
import { mobileMePayload } from '@/server/mobile/serialize';
import { MOBILE_API_DISABLED, mobileApiDisabled } from '@/server/mobile/disabled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/auth/register/complete — step 2 of registration.
 *
 * Same validation rules and the same shared core as the website action
 * (`registerCustomer`): the client must present the raw email-verification
 * `token` (claimed atomically as the inbox-possession proof — AUTH-001), then
 * the account is created (or completed). Returns a bearer token so the app is
 * signed in immediately — the mobile equivalent of the website's post-register
 * `signIn(...)`.
 */

const schema = z.object({
  email: z.string().trim().min(3).max(254).email().transform((s) => s.toLowerCase()),
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(20),
  password: z
    .string()
    .min(8, { message: 'too_short' })
    .max(200, { message: 'too_long' })
    .refine((s) => /[A-Za-z]/.test(s) && /\d/.test(s), { message: 'too_weak' }),
  // Raw verification token from the mobile magic-link step (AUTH-001).
  token: z.string().min(16).max(200),
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
    const flat = parsed.error.flatten();
    const code = flat.fieldErrors.password?.some(
      (m) => m === 'too_short' || m === 'too_weak' || m === 'too_long',
    )
      ? 'weak_password'
      : 'invalid_input';
    return NextResponse.json({ ok: false, code }, { status: 400 });
  }

  const result = await registerCustomer(parsed.data);
  if (!result.ok) {
    const status = result.code === 'invalid_input' ? 400 : 409;
    return NextResponse.json({ ok: false, code: result.code }, { status });
  }

  // Sign with the account's current session epoch (AUTH-005) so the token tracks
  // future password-change / sign-out-everywhere revocations.
  const fresh = await prisma.user.findUnique({
    where: { id: result.userId },
    select: { tokenVersion: true },
  });
  const token = signMobileToken(result.userId, fresh?.tokenVersion ?? 0);
  const me = await mobileMePayload(result.userId);
  return NextResponse.json({ ok: true, token, user: me });
}

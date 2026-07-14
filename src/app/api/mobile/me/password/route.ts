import { NextResponse } from 'next/server';
import { z } from 'zod';
import { compare, hash } from 'bcryptjs';
import { prisma } from '@/server/db/prisma';
import { getMobileUser, UNAUTHORIZED } from '@/server/mobile/guard';
import { MOBILE_API_DISABLED, mobileApiDisabled } from '@/server/mobile/disabled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/me/password — change password.
 *
 * JSON twin of the website's `updatePasswordAction`: verifies the current
 * password, enforces the same policy (8+ chars, letter + digit), bcrypt cost
 * 12. Existing bearer tokens stay valid — they're identity-only and the
 * account itself is unchanged, matching the web behaviour where sessions
 * survive a password change.
 */

const schema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z
    .string()
    .min(8, { message: 'too_short' })
    .max(200, { message: 'too_long' })
    .refine((s) => /[A-Za-z]/.test(s) && /\d/.test(s), { message: 'too_weak' }),
});

export async function POST(request: Request) {
  // TEMPORARILY DISABLED: Mobile application API delivery is currently disabled.
  // Keep this code for future re-enable. Do not delete.
  // Disabled by request: "disable all the api that deliver to mobile application comment it for now until we enable it later"
  if (MOBILE_API_DISABLED) return mobileApiDisabled();
  const user = await getMobileUser(request);
  if (!user) return NextResponse.json(UNAUTHORIZED, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: 'invalid_input' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const code = flat.fieldErrors.newPassword?.length ? 'weak_password' : 'invalid_input';
    return NextResponse.json({ ok: false, code }, { status: 400 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (!dbUser?.passwordHash) {
    return NextResponse.json({ ok: false, code: 'password_not_set' }, { status: 409 });
  }

  const valid = await compare(parsed.data.currentPassword, dbUser.passwordHash);
  if (!valid) {
    return NextResponse.json({ ok: false, code: 'incorrect_password' }, { status: 403 });
  }

  const newHash = await hash(parsed.data.newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash },
  });

  return NextResponse.json({ ok: true });
}

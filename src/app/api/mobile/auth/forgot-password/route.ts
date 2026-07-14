import { NextResponse } from 'next/server';
import { requestPasswordReset } from '@/features/auth/actions';
import { MOBILE_API_DISABLED, mobileApiDisabled } from '@/server/mobile/disabled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/auth/forgot-password — send a password-reset link.
 *
 * Wraps the same server action the website uses (`requestPasswordReset`):
 * always answers `ok: true` for a well-formed email whether or not an account
 * exists (anti-enumeration), rate-limited per email + IP. The link in the
 * email opens the website's reset page; once the password is changed there
 * the user signs back in from the app.
 */
export async function POST(request: Request) {
  // TEMPORARILY DISABLED: Mobile application API delivery is currently disabled.
  // Keep this code for future re-enable. Do not delete.
  // Disabled by request: "disable all the api that deliver to mobile application comment it for now until we enable it later"
  if (MOBILE_API_DISABLED) return mobileApiDisabled();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: 'invalid_email' }, { status: 400 });
  }

  const result = await requestPasswordReset(body);
  if (!result.ok) {
    const status = result.code === 'rate_limited' ? 429 : result.code === 'invalid_email' ? 400 : 502;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}

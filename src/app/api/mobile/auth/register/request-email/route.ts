import { NextResponse } from 'next/server';
import { requestEmailVerification } from '@/features/auth/actions';
import { MOBILE_API_DISABLED, mobileApiDisabled } from '@/server/mobile/disabled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/auth/register/request-email — step 1 of registration.
 *
 * Thin wrapper over the same server action the website uses
 * (`requestEmailVerification`): rate-limited per email + IP, blocklist-aware,
 * sends the magic verification link by email. The user clicks the link (it
 * opens the website's verify page, which consumes the token), then returns to
 * the app and completes registration — `register/complete` re-checks that the
 * email was verified within the last hour, so the app never has to see the
 * token itself.
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

  const result = await requestEmailVerification(body);
  if (!result.ok) {
    const status = result.code === 'rate_limited' ? 429 : result.code === 'invalid_email' ? 400 : 502;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result);
}

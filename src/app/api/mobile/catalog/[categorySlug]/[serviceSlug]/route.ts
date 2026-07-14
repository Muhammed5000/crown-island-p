import { NextResponse } from 'next/server';
import { getServiceBySlug } from '@/server/repositories/catalog';
import { MOBILE_API_DISABLED, mobileApiDisabled } from '@/server/mobile/disabled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/catalog/:categorySlug/:serviceSlug — service detail.
 *
 * Full service row + category, exactly what the website's selection page
 * receives. Price rules are deliberately NOT included — quoting goes through
 * `/api/mobile/bookings/quote`, the same engine the website uses.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ categorySlug: string; serviceSlug: string }> },
) {
  // TEMPORARILY DISABLED: Mobile application API delivery is currently disabled.
  // Keep this code for future re-enable. Do not delete.
  // Disabled by request: "disable all the api that deliver to mobile application comment it for now until we enable it later"
  if (MOBILE_API_DISABLED) return mobileApiDisabled();
  const { categorySlug, serviceSlug } = await context.params;

  const service = await getServiceBySlug(categorySlug, serviceSlug);
  if (!service) {
    return NextResponse.json({ ok: false, code: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, service });
}

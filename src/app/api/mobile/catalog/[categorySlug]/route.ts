import { NextResponse } from 'next/server';
import { getCategoryAboutBySlug, getCategoryBySlug } from '@/server/repositories/catalog';
import { MOBILE_API_DISABLED, mobileApiDisabled } from '@/server/mobile/disabled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/catalog/:categorySlug — category detail.
 *
 * Combines the website's category page + about page data: the category copy
 * with parsed gallery / highlights / terms arrays, plus its active services
 * (full rows — the selection screen needs every pricing/capacity flag).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ categorySlug: string }> },
) {
  // TEMPORARILY DISABLED: Mobile application API delivery is currently disabled.
  // Keep this code for future re-enable. Do not delete.
  // Disabled by request: "disable all the api that deliver to mobile application comment it for now until we enable it later"
  if (MOBILE_API_DISABLED) return mobileApiDisabled();
  const { categorySlug } = await context.params;

  const [about, withServices] = await Promise.all([
    getCategoryAboutBySlug(categorySlug),
    getCategoryBySlug(categorySlug),
  ]);
  if (!about || !withServices) {
    return NextResponse.json({ ok: false, code: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    category: about,
    services: withServices.services,
  });
}

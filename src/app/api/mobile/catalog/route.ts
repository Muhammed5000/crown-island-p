import { NextResponse } from 'next/server';
import type { CategoryType } from '@prisma/client';
import { listActiveCategoriesWithServices } from '@/server/repositories/catalog';
import { MOBILE_API_DISABLED, mobileApiDisabled } from '@/server/mobile/disabled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/catalog[?type=NORMAL|ACTIVITY] — the booking landing data.
 *
 * Same source as the website home / Beaches / Activities tabs
 * (`listActiveCategoriesWithServices`): active categories with a slim service
 * projection plus TODAY's booked counters per service. Public, like the
 * website's catalog browsing (guests can look before signing in).
 */
export async function GET(request: Request) {
  // TEMPORARILY DISABLED: Mobile application API delivery is currently disabled.
  // Keep this code for future re-enable. Do not delete.
  // Disabled by request: "disable all the api that deliver to mobile application comment it for now until we enable it later"
  if (MOBILE_API_DISABLED) return mobileApiDisabled();
  const url = new URL(request.url);
  const typeParam = url.searchParams.get('type');
  const type: CategoryType | undefined =
    typeParam === 'NORMAL' || typeParam === 'ACTIVITY' ? typeParam : undefined;

  const categories = await listActiveCategoriesWithServices(type);
  return NextResponse.json({ ok: true, categories });
}

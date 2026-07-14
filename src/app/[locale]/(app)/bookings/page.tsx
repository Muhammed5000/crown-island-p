import { redirect } from '@/i18n/navigation';

/**
 * Canonical landing for `/bookings`.
 *
 * The bookings UI has two real pages — `/bookings/history` (the list) and
 * `/bookings/[id]` (a single booking detail) — but no leaf at the bare
 * `/bookings` segment. This redirect exists so:
 *
 *   1. A user who types `/en/bookings` directly lands somewhere useful instead
 *      of hitting Next's not-found rendering.
 *   2. The auto-derived breadcrumb intermediate (`Home › Bookings › Detail`)
 *      remains clickable — "Bookings" navigates to the list rather than 404.
 *
 * The redirect target is the same one used by the bottom nav, so all three
 * paths converge on a single canonical route.
 */
export default async function BookingsIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: '/bookings/history', locale });
}

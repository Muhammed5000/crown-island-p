import { redirect } from '@/i18n/navigation';
import { isLocale } from '@/i18n/config';

/**
 * Root route (`/`).
 *
 * The booking experience is the site's main entry point, so the root forwards
 * every visitor straight to `/booking` — there is no longer an intro/landing
 * screen here.
 *
 *  - The booking catalog is PUBLIC: guests reach it without signing in and can
 *    browse categories, services and dates (the proxy marks `/booking` as a
 *    public route).
 *  - Authentication is still enforced where it matters: any protected step
 *    (booking review/payment, bookings, profile, settings, …) bounces to the
 *    existing `/login` page via the proxy's auth checks, preserving the
 *    `callbackUrl`/`next` redirect-back behaviour.
 *  - Gate-only staff (STAFF/SECURITY) never reach this redirect — the proxy
 *    confines them to `/gate/**` before this page renders.
 *
 * The previous AURELIA landing components live on in `@/components/landing/*`
 * and are intentionally left in place; they are simply no longer the first
 * screen shown at `/`.
 */
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;

  redirect({ href: '/booking', locale });
}

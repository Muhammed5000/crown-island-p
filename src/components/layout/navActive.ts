/**
 * Shared active-state logic for the app nav (BottomNav + DesktopRail).
 *
 * The booking section has three nav destinations that share the `/booking`
 * prefix: Home (`/booking`, the "all" view), Beaches (`/booking/beaches`) and
 * Activities (`/booking/activities`). A naive `startsWith('/booking')` would
 * light Home on the beaches/activities pages too, so Home is matched specially:
 * it stays active for `/booking` and its deep sub-pages (category detail,
 * review, payment) but NOT for the two dedicated tab routes.
 */
export function isNavItemActive(key: string, href: string, pathname: string): boolean {
  if (key === 'home') {
    if (pathname === '/booking') return true;
    if (!pathname.startsWith('/booking/')) return false;
    return (
      !pathname.startsWith('/booking/beaches') && !pathname.startsWith('/booking/activities')
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

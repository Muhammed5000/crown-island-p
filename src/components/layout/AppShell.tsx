import type { ReactNode } from 'react';
import { AppHeader } from './AppHeader';
import { GuestTopBar } from './GuestTopBar';
import { BottomNav } from './BottomNav';
import { DesktopRail } from './DesktopRail';
import { HeaderlessTopPad } from './HeaderlessTopPad';
import { PageNav } from './PageNav';
import { SetupPrompt } from '@/components/pwa/SetupPrompt';

interface Props {
  children: ReactNode;
  userName?: string | null;
  userImage?: string | null;
  /** When false, avatar affordances become "sign in" links for guests. */
  isAuthenticated?: boolean;
  showHeader?: boolean;
  showBottomNav?: boolean;
}

/**
 * Booking-app shell — header on top, scrollable content, bottom nav on mobile.
 * Renders for both guests and signed-in users; auth-aware affordances are
 * driven by `isAuthenticated`.
 */
export function AppShell({
  children,
  userName,
  userImage,
  isAuthenticated = true,
  showHeader = true,
  showBottomNav = true,
}: Props) {
  return (
    <div className="bg-grain relative flex min-h-dvh flex-col overflow-hidden bg-background">
      {/* Keyboard skip-link — visually hidden until focused, then jumps past the
          nav/header straight to the page content. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[200] focus:rounded-xl focus:bg-gold-400 focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-[#1a1206]"
      >
        Skip to content
      </a>
      {/* Quiet atmosphere — a soft champagne breath at the top and an obsidian
          vignette at the foot. Static, restrained (no animated blobs). */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        <div className="absolute inset-x-0 top-0 h-[55vh] bg-[radial-gradient(75%_60%_at_50%_-8%,rgba(42,157,168,0.05),transparent_62%)]" />
        <div className="absolute inset-x-0 bottom-0 h-[45vh] bg-[radial-gradient(90%_70%_at_50%_120%,rgba(20,32,46,0.04),transparent_58%)]" />
      </div>

      {/* Desktop-only fixed left rail (≥ xl). Inset the content by its width so
          nothing slides under it; mobile/tablet get no rail and no inset. */}
      <DesktopRail userName={userName} userImage={userImage} isAuthenticated={isAuthenticated} />

      <div className="relative z-10 flex flex-1 flex-col xl:ps-[78px]">
        {/* Signed-in users get the regular app header (where the page opts in);
            guests get the global GuestTopBar below instead, so the brand + login
            never double up. */}
        {showHeader && isAuthenticated ? (
          <AppHeader userName={userName} userImage={userImage} isAuthenticated={isAuthenticated} />
        ) : null}
        {/* Guest-only brand + login bar, pinned at the very top of every page on
            all breakpoints when signed out. Renders nothing for signed-in users. */}
        <GuestTopBar isAuthenticated={isAuthenticated} />
        <main id="main-content" className="flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] xl:pb-6">
          {/* Replaces the AppHeader's safe-area inset on pages that opt out
              of the global top bar (booking, bookings, menu, settings). */}
          <HeaderlessTopPad />
          {/* Breadcrumb + back-button strip. Hidden on the four primary tab
              roots (which are the bottom-nav anchors and reachable in one
              tap) so we don't add visual noise there. Every sub-page under
              them still gets it. */}
          <PageNav
            topLevelPaths={['/booking', '/bookings', '/menu', '/settings', '/support']}
            backFallbackHref="/booking"
            // `/map` has no `page.tsx` of its own — it's only reachable as
            // `/map/[bookingId]`. Suppress the link in the breadcrumb so
            // users don't bounce into a not-found route. `/bookings` HAS a
            // page (a small redirect) so it stays clickable.
            nonClickableSegments={['map']}
          />
          {children}
        </main>
        {showBottomNav ? <BottomNav /> : null}
      </div>

      {/* Signed-in only: one-card prompt to enable notifications + install the
          app. Self-hides once both are done (or dismissed for the session). */}
      {isAuthenticated ? <SetupPrompt /> : null}
    </div>
  );
}

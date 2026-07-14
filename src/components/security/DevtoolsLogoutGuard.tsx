'use client';

import { useEffect, useRef } from 'react';
import { signOut } from 'next-auth/react';

/**
 * ── Best-effort "DevTools opened → sign out" guard ───────────────────────────
 *
 * ⚠️  IMPORTANT: client-side DevTools detection is a DETERRENT, never real
 * security. Any moderately advanced user can bypass it (disable JavaScript,
 * use a debugger that skips `debugger`, edit the bundle, read the SSR HTML, or
 * call the API directly). The REAL authorization boundary lives server-side
 * (the proxy + per-route `requireX` guards). This component only adds a
 * session-protection deterrent per the product requirement: if a LOGGED-IN user
 * opens Inspect / DevTools on any page, end their session immediately.
 *
 * Design:
 *  - Mounted ONCE globally (inside <Providers>) → covers every page, survives
 *    client-side navigation, and re-runs after refresh.
 *  - Runs only on the client (all logic inside an effect) → no SSR/hydration risk.
 *  - Arms ONLY after confirming an active session (the httpOnly session cookie
 *    isn't readable, so we ask NextAuth's /api/auth/session). Anonymous/public
 *    visitors are never affected. Fail-safe: on any error we do NOT arm.
 *  - A single `lockedRef` prevents duplicate logout calls; every listener and the
 *    poll interval are cleaned up on logout and on unmount (no leaks).
 */

/** Docked DevTools shrinks the viewport vs. the window by well over this. */
const SIZE_THRESHOLD_PX = 160;
const POLL_INTERVAL_MS = 800;
/** A `debugger` that pauses longer than this ⇒ DevTools is open. */
const DEBUGGER_PAUSE_MS = 120;

/**
 * A `debugger` trap built at runtime via Function(). A literal `debugger;` in
 * source is removed by the production minifier (SWC `drop_debugger`), which
 * would silently disable this check in the build — compiling it at runtime keeps
 * it intact. (Relies on the default script CSP, which this app uses; if a strict
 * `unsafe-eval`-free CSP is ever added globally this one check degrades while the
 * others keep working.)
 */
const runDebuggerTrap: () => void =
  typeof window !== 'undefined' ? (new Function('debugger') as () => void) : () => {};

/** Login path honouring `localePrefix: 'as-needed'` (Arabic = unprefixed default). */
function loginPathFor(pathname: string): string {
  const seg = pathname.split('/')[1];
  return seg === 'en' ? '/en/login' : '/login';
}

export function DevtoolsLogoutGuard() {
  const lockedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;
    let armed = false;
    let intervalId: number | undefined;
    const cleanups: Array<() => void> = [];

    // Best-effort clear of client-readable auth state. The real web session is an
    // httpOnly cookie cleared server-side by signOut(); this just scrubs any
    // non-httpOnly leftovers without nuking unrelated prefs (e.g. the theme).
    const clearClientAuthState = () => {
      try {
        window.sessionStorage.clear();
      } catch {
        /* ignore */
      }
      try {
        const KEEP = new Set(['ci-theme']);
        for (let i = window.localStorage.length - 1; i >= 0; i--) {
          const k = window.localStorage.key(i);
          if (!k || KEEP.has(k)) continue;
          if (/auth|token|session|user|next-?auth|authjs/i.test(k)) {
            window.localStorage.removeItem(k);
          }
        }
      } catch {
        /* ignore */
      }
      try {
        document.cookie.split(';').forEach((c) => {
          const name = c.split('=')[0]?.trim();
          if (name && /auth|token|session|csrf|callback/i.test(name)) {
            document.cookie = `${name}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
          }
        });
      } catch {
        /* ignore */
      }
    };

    // The payment flow embeds the MPGS Hosted Checkout + 3-D-Secure, which runs
    // heavy third-party JS and trips these DevTools heuristics; a developer testing
    // with DevTools open — or a customer right-clicking to paste a card — would be
    // signed out MID-PAYMENT, killing the session before the gateway records the
    // transaction (no order is ever created → "transaction unsuccessful"). This
    // deterrent is explicitly "never real security" (the server-side guards are the
    // real boundary), so it must NOT run on the payment page.
    const onPaymentPage = () => window.location.pathname.includes('/booking/payment');

    const triggerLogout = () => {
      if (lockedRef.current) return;
      if (onPaymentPage()) return;
      lockedRef.current = true;

      // 1. Stop all detection so it can't fire again mid-logout.
      if (intervalId) window.clearInterval(intervalId);
      cleanups.forEach((fn) => {
        try {
          fn();
        } catch {
          /* ignore */
        }
      });

      // 2. Scrub client state, then 3. proper NextAuth sign-out (clears the
      //    httpOnly session cookie) and redirect to login.
      clearClientAuthState();
      const target = loginPathFor(window.location.pathname);
      try {
        void signOut({ callbackUrl: target }).catch(() => {
          window.location.href = target;
        });
      } catch {
        window.location.href = target;
      }
      // 4. Hard fallback if signOut hangs or its redirect is swallowed.
      window.setTimeout(() => {
        if (!window.location.pathname.includes('/login')) window.location.replace(target);
      }, 1500);
    };

    // ── Detection (attached only once a session is confirmed) ────────────────
    const arm = () => {
      if (cancelled || armed) return;
      armed = true;

      // Keyboard: F12, Ctrl/Cmd+Shift+I/J/C, Cmd+Option+I/J/C. `e.code` is
      // layout-independent and dodges the Mac Option dead-key problem.
      const onKeyDown = (e: KeyboardEvent) => {
        const code = e.code;
        const letter = code === 'KeyI' || code === 'KeyJ' || code === 'KeyC';
        const isF12 = code === 'F12' || e.key === 'F12';
        const winCombo = (e.ctrlKey || e.metaKey) && e.shiftKey && letter;
        const macCombo = e.metaKey && e.altKey && letter;
        if (isF12 || winCombo || macCombo) {
          e.preventDefault();
          triggerLogout();
        }
      };
      // Right-click → block the menu and end the session (per the strict
      // "right-click Inspect" requirement; intentionally aggressive).
      const onContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        triggerLogout();
      };

      window.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('contextmenu', onContextMenu, true);
      cleanups.push(() => window.removeEventListener('keydown', onKeyDown, true));
      cleanups.push(() => window.removeEventListener('contextmenu', onContextMenu, true));

      // Viewport-vs-window gap ⇒ docked DevTools (bottom or side).
      const sizeOpen = () =>
        window.outerWidth - window.innerWidth > SIZE_THRESHOLD_PX ||
        window.outerHeight - window.innerHeight > SIZE_THRESHOLD_PX;
      // Timing of a runtime `debugger` ⇒ catches DevTools opened from the menu /
      // undocked (no shortcut, no size change).
      const debuggerOpen = () => {
        const t = performance.now();
        try {
          runDebuggerTrap();
        } catch {
          /* ignore */
        }
        return performance.now() - t > DEBUGGER_PAUSE_MS;
      };

      const tick = () => {
        // Skip the ENTIRE check on the payment page — critically the `debugger`
        // trap inside debuggerOpen(): with DevTools open, that statement pauses the
        // page every 800ms, which freezes the embedded MPGS checkout so its Pay
        // button never becomes submit-ready (stays dimmed) and the card auth never
        // reaches the gateway. (triggerLogout is also guarded, but the trap must not
        // even run here.)
        if (lockedRef.current || onPaymentPage()) return;
        if (sizeOpen() || debuggerOpen()) triggerLogout();
      };
      intervalId = window.setInterval(tick, POLL_INTERVAL_MS);

      // Re-check promptly when the user returns to the tab/window.
      const onFocus = () => {
        if (sizeOpen()) triggerLogout();
      };
      const onVisibility = () => {
        if (!document.hidden && sizeOpen()) triggerLogout();
      };
      window.addEventListener('focus', onFocus);
      document.addEventListener('visibilitychange', onVisibility);
      cleanups.push(() => window.removeEventListener('focus', onFocus));
      cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));

      // Immediate first check — covers "refreshed with DevTools already open".
      tick();
    };

    // Only protect authenticated sessions. We can't read the httpOnly session
    // cookie, so ask NextAuth. Fail-safe: on error / no session we never arm, so
    // public + anonymous pages are untouched and can't be forced to "log out".
    fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && data.user) arm();
      })
      .catch(() => {
        /* ignore — stay disarmed */
      });

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
      cleanups.forEach((fn) => {
        try {
          fn();
        } catch {
          /* ignore */
        }
      });
    };
  }, []);

  return null;
}

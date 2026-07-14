'use client';

import { useEffect } from 'react';

/**
 * Mount-once safety net for pages that may be reached as the redirect
 * target of an embedded payment iframe.
 *
 * Why this exists
 * ──────────────
 * The Paymob unified-checkout can be loaded either as a top-level
 * navigation or inside an `<iframe>`. Today the booking app does a
 * full-page redirect, but should anything ever embed the checkout (a
 * dashboard widget, a future mobile shell, etc.) Paymob's
 * `redirection_url` redirect would land *inside the iframe* — the outer
 * page would still show whatever was rendering the iframe and the user
 * would have no indication the payment finished.
 *
 * This component detects that scenario at mount time and re-issues the
 * navigation against `window.top.location`, so the success / failed page
 * always becomes the customer's top-level view regardless of how they got
 * here. It's a no-op when the page is already at the top level.
 */
export function IframeBreakout() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.top && window.top !== window.self) {
      try {
        window.top.location.href = window.location.href;
      } catch {
        // Cross-origin frames refuse the top-level write — the
        // redirecting iframe will at least display the page contents.
      }
    }
  }, []);
  return null;
}

'use client';

import { useEffect, useMemo, useState } from 'react';

/**
 * Polls the QR endpoint for a booking until it is CONFIRMED, then exposes the
 * SVG markup and a blob object-URL ready for an `<img>` tag.
 *
 * Extracted from `SuccessTicket` so both the mobile ticket and the desktop
 * confirmation page share one polling implementation.
 *
 * Polling contract (`/api/bookings/{id}/qr`):
 *  - 202 / 409 → still PENDING, retry after a short delay (max 30 attempts).
 *  - 410       → terminal (booking cancelled — e.g. capture auto-refunded after
 *                a capacity race). Stop polling and move to the failed page,
 *                which explains the automatic refund.
 *  - 2xx       → SVG body; booking is confirmed.
 */
export function useBookingQr(bookingId: string, initialConfirmed: boolean, poll = true) {
  const [confirmed, setConfirmed] = useState(initialConfirmed);
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null);

  useEffect(() => {
    // Only poll while a live QR can exist — a booking being confirmed, or a valid
    // confirmed one. Terminal bookings (EXPIRED / CANCELLED / FAILED) have no QR:
    // the endpoint returns 410, which would otherwise redirect a viewer to the
    // payment-failed page. When `poll` is false, do nothing (no fetch, no redirect).
    if (!poll) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let pollCount = 0;

    async function fetchOnce() {
      if (pollCount >= 30) return;
      pollCount++;

      const url = `/api/bookings/${bookingId}/qr?t=${Date.now()}`;

      try {
        const headers: HeadersInit = { Accept: 'image/svg+xml' };
        if (window.location.hostname.includes('ngrok')) {
          headers['ngrok-skip-browser-warning'] = 'true';
        }

        const res = await fetch(url, {
          cache: 'no-store',
          headers,
        });
        if (cancelled) return;

        if (res.status === 202 || res.status === 409) {
          // Still PENDING — poll again.
          timeout = setTimeout(fetchOnce, 2000);
          return;
        }

        if (res.status === 410) {
          // Terminal: the booking was cancelled while this page was open (e.g.
          // its capture was auto-refunded). The failed page explains the refund.
          const prefix = window.location.pathname.startsWith('/en') ? '/en' : '';
          window.location.href = `${prefix}/booking/failed?bid=${bookingId}`;
          return;
        }

        if (!res.ok) {
          console.error('[useBookingQr] Fetch failed:', res.status);
          return;
        }

        const svg = await res.text();
        if (cancelled) return;
        setSvgMarkup(svg);
        setConfirmed(true);
      } catch (err) {
        console.error('[useBookingQr] Network error:', err);
        timeout = setTimeout(fetchOnce, 3000);
      }
    }

    fetchOnce();

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [bookingId, poll]);

  // Inline the SVG markup as a data URL for `<img src>`. Derived purely (no
  // object-URL lifecycle to manage) and captured reliably by html-to-image.
  const qrDataUrl = useMemo(
    () => (svgMarkup ? `data:image/svg+xml;utf8,${encodeURIComponent(svgMarkup)}` : null),
    [svgMarkup],
  );

  return { confirmed, svgMarkup, qrDataUrl };
}

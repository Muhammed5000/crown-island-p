import { NextResponse } from 'next/server';
import { getRequestOrigin } from '@/lib/origin';
import { MpgsNotConfiguredError } from '@/server/credit-agricole/client';
import { verifyAndConfirmOrder, type MpgsVerifyStatus } from '@/server/credit-agricole/verify';
import { checkUploadRate } from '@/lib/upload-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * MPGS Hosted Checkout completion landing.
 *
 * The embedded checkout's `data-complete` points here after payment. We verify
 * the order SERVER-SIDE (RETRIEVE_ORDER) — the authoritative result — and only
 * then treat it as paid. The order is never marked paid from the form closing
 * alone.
 *
 * When the payment runs inside our isolated payment IFRAME (`?frame=1`), we
 * return a tiny HTML document that posts the outcome to the parent window (so the
 * parent navigates the top-level page); if MPGS happened to navigate at the top
 * level instead, the same document falls back to a normal redirect.
 */
/** Opaque per-frame nonce echoed back to the parent (FESEC-001/SEC-002). */
function cleanNonce(raw: string | null): string {
  return raw && /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? raw : '';
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const bid = url.searchParams.get('bid');
  const locale = url.searchParams.get('locale') === 'en' ? 'en' : 'ar';
  const frame = url.searchParams.get('frame') === '1';
  const cancelled = url.searchParams.get('cancel') === '1';
  const nonce = cleanNonce(url.searchParams.get('n'));
  const prefix = locale === 'en' ? '/en' : '';
  const origin = await getRequestOrigin();

  if (!bid) {
    return frame
      ? frameResult('cancel', prefix, '', origin, nonce)
      : NextResponse.redirect(new URL(`${prefix}/booking`, origin));
  }

  // DoS containment: the verify path polls the gateway up to 6×, so cap how often
  // an (unauthenticated) caller can trigger it per IP. The authenticated /check
  // poll + the reconciler still confirm a real capture out of band, so a throttled
  // caller simply sees "still processing".
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!cancelled && !checkUploadRate(`ca-complete:${ip}`, 20, 60_000).ok) {
    return frame
      ? frameResult('pending', prefix, bid, origin, nonce)
      : NextResponse.redirect(new URL(`${prefix}/booking/payment?bid=${bid}`, origin));
  }

  let status: MpgsVerifyStatus | 'cancel';
  if (cancelled) {
    status = 'cancel';
  } else {
    try {
      // The capture can take a few seconds to settle after MPGS sends the browser
      // here, so poll briefly before deciding (most resolve on the first attempt).
      status = await verifyAndConfirmOrder(bid, { attempts: 6, delayMs: 1500 });
    } catch (err) {
      if (!(err instanceof MpgsNotConfiguredError)) {
        console.error('[MPGS] complete handler error for booking', bid, err);
      }
      status = 'failed';
    }
  }

  if (frame) {
    return frameResult(status, prefix, bid, origin, nonce);
  }

  return NextResponse.redirect(new URL(destFor(status, prefix, bid), origin));
}

function destFor(status: MpgsVerifyStatus | 'cancel', prefix: string, bid: string): string {
  if (status === 'success') return `${prefix}/booking/success?bid=${encodeURIComponent(bid)}`;
  // Declined (no funds taken) or cancelled → back to the payment page to retry;
  // hard failure / unresolved → failed page (the reconciler confirms a genuine
  // capture out of band, so we never falsely auto-retry into a double charge).
  // 'refunded' (captured but unconfirmable — charge automatically returned) also
  // lands on the failed page, which shows the refund notice.
  if (status === 'declined' || status === 'cancel')
    return `${prefix}/booking/payment?bid=${encodeURIComponent(bid)}`;
  return `${prefix}/booking/failed?bid=${encodeURIComponent(bid)}`;
}

/**
 * HTML that, inside the payment iframe, posts the outcome to the parent; if it is
 * somehow at the top level, it redirects normally.
 *
 * FESEC-001/SEC-002: echoes the per-frame `nonce` and posts to the KNOWN parent
 * origin (not `window.location.origin`, which is "null" once the frame is
 * sandboxed to an opaque origin) so the parent binds the message to this frame.
 */
function frameResult(
  status: MpgsVerifyStatus | 'cancel',
  prefix: string,
  bid: string,
  parentOrigin: string,
  nonce: string,
): Response {
  const fallback = bid ? destFor(status, prefix, bid) : `${prefix}/booking`;
  const body = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
(function(){
  var status = ${JSON.stringify(status)};
  if (window.parent && window.parent !== window) {
    try { window.parent.postMessage({ mpgsStatus: status, ciNonce: ${JSON.stringify(nonce)} }, ${JSON.stringify(parentOrigin)}); return; } catch (e) {}
  }
  window.location.replace(${JSON.stringify(fallback)});
})();
</script></body></html>`;
  return new NextResponse(body, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

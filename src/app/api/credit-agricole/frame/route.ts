import { NextResponse } from 'next/server';
import { getSessionUser } from '@/server/auth/guards';
import { getRequestOrigin } from '@/lib/origin';
import { createMpgsSession } from '@/server/credit-agricole/payments';
import { MpgsNotConfiguredError } from '@/server/credit-agricole/client';
import { DomainError } from '@/server/services/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * MPGS payment IFRAME.
 *
 * Returns a minimal, chrome-free HTML document that hosts the Mastercard Hosted
 * Checkout embedded card form. The booking payment page loads THIS route in an
 * <iframe>, so the entire payment experience — card entry, 3-D Secure, inline
 * declines/retries — lives inside the iframe. Only the final outcome is posted to
 * the parent window (bound to the parent by source identity + a per-frame nonce)
 * so the site can navigate. Card data never touches our server.
 *
 * Isolation (FESEC-001): by default this document is served from the app origin
 * (the provider script therefore shares that origin). The parent can opt into a
 * true opaque-origin sandbox via `NEXT_PUBLIC_MPGS_FRAME_SANDBOX=1` — this route's
 * messaging already supports it (posts to the known parent origin + nonce, which
 * survive an opaque origin). Enabling the sandbox must be validated against a live
 * 3DS transaction first (a hosted-checkout script needing same-origin storage
 * could break under it), which is why it is off by default.
 */

function esc(value: string): string {
  return value.replace(/[<>&"']/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === '"' ? '&quot;' : '&#39;',
  );
}

function htmlResponse(body: string): NextResponse {
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // Allow our own payment page to frame this document (the global header is
      // DENY); it is only ever embedded same-origin.
      'X-Frame-Options': 'SAMEORIGIN',
    },
  });
}

/**
 * Sanitize the parent-supplied message nonce: only an opaque token, so it can be
 * safely inlined into the bootstrap JS. Empty when absent/malformed (the parent
 * then rejects unmatched messages — see MpgsLightbox).
 */
function cleanNonce(raw: string | null): string {
  return raw && /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? raw : '';
}

/**
 * Tiny document that reports an error to the parent window.
 *
 * FESEC-001/SEC-002: posts to the KNOWN parent origin (not `window.location.origin`,
 * which is "null" once the frame is sandboxed to an opaque origin) and echoes the
 * per-frame `nonce` so the parent can bind the message to this exact frame.
 */
function errorDoc(reason: string, parentOrigin: string, nonce: string): NextResponse {
  const body = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
try { window.parent.postMessage({ mpgsStatus: 'error', detail: ${JSON.stringify(reason)}, ciNonce: ${JSON.stringify(nonce)} }, ${JSON.stringify(parentOrigin)}); } catch (e) {}
</script></body></html>`;
  return htmlResponse(body);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const bid = url.searchParams.get('bid');
  const locale = url.searchParams.get('locale') === 'en' ? 'en' : 'ar';
  const nonce = cleanNonce(url.searchParams.get('n'));
  const origin = await getRequestOrigin();

  if (!bid) return errorDoc('missing_booking', origin, nonce);

  const user = await getSessionUser();
  if (!user) return errorDoc('unauthorized', origin, nonce);

  let session;
  try {
    session = await createMpgsSession({ userId: user.id, bookingId: bid, origin, locale });
  } catch (err) {
    const reason =
      err instanceof MpgsNotConfiguredError
        ? 'not_configured'
        : err instanceof DomainError
          ? err.code
          : 'session_failed';
    if (!(err instanceof MpgsNotConfiguredError) && !(err instanceof DomainError)) {
      console.error('[MPGS] frame session create failed for booking', bid, err);
    }
    return errorDoc(reason, origin, nonce);
  }

  const completeUrl = `${origin}/api/credit-agricole/complete?bid=${encodeURIComponent(bid)}&locale=${locale}&frame=1&n=${encodeURIComponent(nonce)}`;
  const cancelUrl = `${completeUrl}&cancel=1`;
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  const body = `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0;background:transparent;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}#ci-embed{min-height:100vh}</style>
</head>
<body>
<div id="ci-embed"></div>
<script>
var CI_NONCE=${JSON.stringify(nonce)};var CI_PARENT_ORIGIN=${JSON.stringify(origin)};
function ciParent(status, detail){try{window.parent.postMessage({mpgsStatus:status,detail:detail||null,ciNonce:CI_NONCE},CI_PARENT_ORIGIN);}catch(e){}}
function ciError(e){ciParent('error',(e&&e.message)||'checkout_error');}
</script>
<script id="ci-js" src="${esc(session.scriptUrl)}" data-error="ciError" data-cancel="${esc(cancelUrl)}" data-complete="${esc(completeUrl)}"></script>
<script>
(function(){
  function start(){
    try { window.Checkout.configure({ session: { id: ${JSON.stringify(session.sessionId)} } }); window.Checkout.showEmbeddedPage('#ci-embed'); }
    catch (e) { ciError(e); }
  }
  var s = document.getElementById('ci-js');
  if (window.Checkout && typeof window.Checkout.configure === 'function') start();
  else { s.addEventListener('load', start); s.addEventListener('error', function(){ ciParent('error','script_load'); }); }
})();
</script>
</body>
</html>`;

  return htmlResponse(body);
}

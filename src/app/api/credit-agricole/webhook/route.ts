import { NextResponse, after } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { prisma } from '@/server/db/prisma';
import { MpgsNotConfiguredError } from '@/server/credit-agricole/client';
import { verifyAndConfirmOrder } from '@/server/credit-agricole/verify';
import { checkUploadRate } from '@/lib/upload-rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * MPGS Webhook Notifications — server-to-server payment confirmation.
 *
 * Configure in the gateway's Merchant Administration (Admin → Webhook
 * Notifications): point the URL at `https://<domain>/api/credit-agricole/webhook`
 * and copy the generated Notification Secret into `MPGS_WEBHOOK_SECRET`. The
 * gateway then POSTs a JSON notification (with the secret echoed in the
 * `X-Notification-Secret` header) whenever a transaction reaches a final state —
 * so a booking confirms even when the browser never returns to `/complete`
 * (tab closed mid-redirect, network drop) and without waiting for the cron
 * reconciler.
 *
 * SECURITY MODEL — trigger-only, never trusted: the notification body is used
 * solely to find WHICH order to re-check. Confirmation always re-runs the
 * authoritative server-side RETRIEVE_ORDER (`verifyAndConfirmOrder`, idempotent,
 * all booking safeguards apply), so even a forged call with a valid secret can
 * only cause a harmless re-verify — never a false confirmation. To keep that
 * true observationally as well, every authenticated call gets the SAME response
 * body and (near-)constant latency: the lookup + verify run AFTER the response
 * (`after()`), so a caller cannot probe which order ids exist via the response
 * shape or timing. Errors during the deferred verify are logged, not returned —
 * the reconciler sweep re-covers anything a dropped notification would have
 * confirmed.
 */

const MAX_BODY_BYTES = 100_000;

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function POST(request: Request) {
  const secret = process.env.MPGS_WEBHOOK_SECRET?.trim();
  if (!secret) {
    // Refuse to run while unconfigured (mirrors the cron endpoints) — a non-2xx
    // also tells the gateway to keep retrying until the secret is deployed.
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const provided = request.headers.get('x-notification-secret') ?? '';
  if (!provided || !safeEqual(provided, secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Flood containment for authenticated callers: each accepted call schedules a
  // gateway round-trip, so cap the rate. The per-IP key alone is spoofable via
  // X-Forwarded-For rotation, so a GLOBAL bucket bounds total amplification no
  // matter how the caller rotates headers. A throttled genuine notification is
  // re-covered by the interactive polls / reconciler sweep.
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (
    !checkUploadRate(`ca-webhook:${ip}`, 120, 60_000).ok ||
    !checkUploadRate('ca-webhook:global', 600, 60_000).ok
  ) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  // Notification payloads are small — reject oversized bodies before parsing.
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }
  let orderId = '';
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
    }
    const body = JSON.parse(text) as { order?: { id?: unknown } } | null;
    const rawOrderId = body?.order?.id;
    orderId =
      typeof rawOrderId === 'string' || typeof rawOrderId === 'number' ? String(rawOrderId) : '';
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  // From here on the answer is CONSTANT — same body, no data-dependent work
  // before responding — regardless of whether the order exists. The actual
  // lookup + verify happen after the response is sent.
  if (orderId) {
    after(async () => {
      try {
        const payment = await prisma.payment.findFirst({
          where: { paymobOrderId: orderId, provider: 'CREDIT_AGRICOLE' },
          select: { bookingId: true },
        });
        if (!payment) return;
        // A few attempts: the notification can land a beat before RETRIEVE_ORDER
        // reflects CAPTURED (the same transient the browser /complete path polls
        // for). 3 × 1.5s covers the settle without holding the request — this
        // runs in after(), so the response already went out. Anything still not
        // final is caught by the reconciler.
        await verifyAndConfirmOrder(payment.bookingId, { attempts: 3, delayMs: 1500 });
      } catch (err) {
        if (!(err instanceof MpgsNotConfiguredError)) {
          console.error('[MPGS webhook] deferred verify failed for order', orderId, err);
        }
      }
    });
  }

  return NextResponse.json({ ok: true });
}

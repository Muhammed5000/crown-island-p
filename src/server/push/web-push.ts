import 'server-only';
import webpush from 'web-push';
import { prisma } from '@/server/db/prisma';
import { log, errFields } from '@/lib/log';

/**
 * Web Push sender.
 *
 * Mirrors the email provider's "configured?" pattern (`src/server/email/provider.ts`):
 * when the VAPID keys are absent the sender is a no-op, so a dev box without keys
 * never crashes and the in-app notification inbox keeps working on its own.
 *
 * Everything here is **best-effort** (like `sendBookingConfirmationEmail`): a push
 * failure must never abort a broadcast or bubble a 500 — the worst case is "no push
 * delivered", logged. When the push service reports a subscription is dead
 * (HTTP 404/410) we surface `gone: true` so the caller can prune that row.
 */

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body?: string;
  /** Image shown on the notification; defaults to the site icon in the SW. */
  icon?: string;
  /** Deep-link path opened on click. */
  url?: string;
  lang?: string;
  dir?: 'rtl' | 'ltr' | 'auto';
  /** Collapse key — a new push with the same tag replaces the previous one. */
  tag?: string;
}

export type PushResult =
  | { ok: true }
  /** `gone` = subscription expired/unsubscribed (404/410) → caller should delete it. */
  | { ok: false; gone: boolean };

let configured: boolean | null = null;

function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@crownisland.example';
  if (publicKey && privateKey) {
    try {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      configured = true;
    } catch (err) {
      log.error('push invalid VAPID config', { ...errFields(err) });
      configured = false;
    }
  } else {
    configured = false;
  }
  return configured;
}

/** True when VAPID keys are present and valid — push can actually be sent. */
export function isPushConfigured(): boolean {
  return ensureConfigured();
}

/** Public VAPID key for the browser `applicationServerKey`, or null when unconfigured. */
export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

/**
 * Send one push notification. Never throws. Returns `gone: true` when the push
 * service says the subscription is dead so the caller can delete the row.
 */
export async function sendPush(target: PushTarget, payload: PushPayload): Promise<PushResult> {
  if (!ensureConfigured()) {
    if (process.env.PUSH_DEBUG) log.info('push skipped — VAPID not configured');
    return { ok: false, gone: false };
  }
  // Log the endpoint HOST only (never the full endpoint — it is a secret).
  const host = (() => {
    try {
      return new URL(target.endpoint).host;
    } catch {
      return 'unknown';
    }
  })();
  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      {
        TTL: 60 * 60 * 24, // hold up to a day if the device is offline
        // High urgency reduces the chance OEM battery managers / Doze defer the
        // wake-up when the browser is backgrounded/closed on mobile.
        headers: { Urgency: 'high' },
      },
    );
    if (process.env.PUSH_DEBUG) log.debug('push sent', { host });
    return { ok: true };
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    const gone = status === 404 || status === 410;
    if (gone) {
      if (process.env.PUSH_DEBUG) log.info('push pruning dead sub', { host, status });
    } else {
      log.error('push send failed', { host, status: status ?? '', ...errFields(err) });
    }
    return { ok: false, gone };
  }
}

function truncateBody(s: string, max = 160): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Fan a push out to ALL of one user's subscriptions (their devices), rendering
 * each in that subscription's own locale. Best-effort — never throws — and prunes
 * subscriptions the push service reports dead (404/410). For transactional
 * (non-broadcast) pushes such as the post-visit review nudge; mirrors the
 * campaign dispatch in `admin-notifications.ts`.
 */
export async function pushToUser(
  userId: string,
  content: {
    titleEn: string;
    titleAr: string;
    bodyEn?: string | null;
    bodyAr?: string | null;
    url?: string;
    iconUrl?: string | null;
    tag?: string;
  },
): Promise<{ sent: number; failed: number }> {
  if (!ensureConfigured()) return { sent: 0, failed: 0 };
  const subs = await prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true, locale: true },
  });
  let sent = 0;
  let failed = 0;
  const deadIds: string[] = [];
  for (const s of subs) {
    const locale = s.locale === 'en' ? 'en' : 'ar';
    const res = await sendPush(
      { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
      {
        title: locale === 'en' ? content.titleEn : content.titleAr,
        body: truncateBody((locale === 'en' ? content.bodyEn : content.bodyAr) || ''),
        icon: content.iconUrl || undefined,
        url: content.url || '/notifications',
        lang: locale,
        dir: locale === 'ar' ? 'rtl' : 'ltr',
        tag: content.tag,
      },
    );
    if (res.ok) sent += 1;
    else {
      failed += 1;
      if (res.gone) deadIds.push(s.id);
    }
  }
  if (deadIds.length > 0) await prisma.pushSubscription.deleteMany({ where: { id: { in: deadIds } } });
  return { sent, failed };
}

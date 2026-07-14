'use client';

/**
 * Browser-side Web Push helpers used by the Settings "Browser notifications"
 * toggle. Push opt-in is **per device** — the source of truth is whether THIS
 * browser holds an active PushSubscription, mirrored to the DB.
 *
 * We use a DEDICATED push-only worker (`/sw-push.js`) registered at its own
 * scope (`/push/`) so that:
 *   - it survives `next dev` (the offline `sw.js` is unregistered in dev, which
 *     would otherwise destroy the subscription on every refresh), and
 *   - it never collides with the offline worker registered at `/`.
 * Reads and writes BOTH pin this exact scope so the toggle state and the
 * subscription always refer to the same registration.
 */

export type PushDeviceState = 'unsupported' | 'insecure' | 'denied' | 'default' | 'subscribed';

const PUSH_SW_URL = '/sw-push.js';
const PUSH_SCOPE = '/push/';

/**
 * Service Workers + the Push API are exposed by browsers ONLY in a secure
 * context (https, or http://localhost). Opening the app on a phone over a plain
 * http LAN IP (http://192.168.x.x:3000) is NOT secure, so `navigator.serviceWorker`
 * is undefined and push silently can't work — this distinguishes that case from
 * a browser that genuinely lacks push support.
 */
function secureContextOk(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === true;
}

function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Decode a URL-safe base64 VAPID key into the Uint8Array the Push API wants. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** Resolve once the registration has an ACTIVE worker — subscribing on an
 *  installing/waiting registration can throw or yield a non-persisted sub. */
function waitActive(reg: ServiceWorkerRegistration): Promise<ServiceWorkerRegistration> {
  if (reg.active) return Promise.resolve(reg);
  const worker = reg.installing ?? reg.waiting;
  if (!worker) return Promise.resolve(reg);
  return new Promise((resolve) => {
    const onState = () => {
      if (worker.state === 'activated') {
        worker.removeEventListener('statechange', onState);
        resolve(reg);
      }
    };
    worker.addEventListener('statechange', onState);
    if (worker.state === 'activated') resolve(reg);
  });
}

/** Get (or create) the push-scoped registration, ready to subscribe on. */
async function getPushRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(PUSH_SCOPE);
  const reg =
    existing ?? (await navigator.serviceWorker.register(PUSH_SW_URL, { scope: PUSH_SCOPE }));
  return waitActive(reg);
}

/** Current opt-in state for this device (used to render the toggle on mount). */
export async function getDevicePushState(): Promise<PushDeviceState> {
  if (!secureContextOk()) return 'insecure';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    // Pin the push scope exactly — a bare getRegistration() (page scope) would
    // resolve the offline worker, not ours, and miss the subscription.
    const reg = await navigator.serviceWorker.getRegistration(PUSH_SCOPE);
    if (reg) {
      const sub = await reg.pushManager.getSubscription();
      if (sub) return 'subscribed';
    }
  } catch {
    /* fall through to default */
  }
  return 'default';
}

/**
 * Request permission, subscribe this browser, and persist the subscription.
 * Throws only on an unexpected failure (network / server) so the caller can
 * surface an error.
 */
export async function subscribeThisDevice(locale: 'ar' | 'en'): Promise<PushDeviceState> {
  if (!secureContextOk()) return 'insecure';
  if (!pushSupported()) return 'unsupported';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'default';

  const keyRes = await fetch('/api/push/vapid-public-key');
  if (!keyRes.ok) throw new Error('push_not_configured');
  const { key } = (await keyRes.json()) as { key: string };

  const reg = await getPushRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // Cast: the DOM lib types applicationServerKey as a strictly
      // ArrayBuffer-backed BufferSource; our Uint8Array is ArrayBufferLike.
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    });
  }

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, locale }),
  });
  if (!res.ok) throw new Error('subscribe_failed');
  return 'subscribed';
}

/** Unsubscribe this browser and drop the server row. Best-effort. */
export async function unsubscribeThisDevice(): Promise<PushDeviceState> {
  if (!pushSupported()) return 'unsupported';
  try {
    const reg = await navigator.serviceWorker.getRegistration(PUSH_SCOPE);
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      const { endpoint } = sub;
      await sub.unsubscribe();
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      });
    }
  } catch {
    /* ignore — toggle reflects the desired state regardless */
  }
  return Notification.permission === 'denied' ? 'denied' : 'default';
}

/* Crown Island — dedicated Web Push service worker.
 *
 * This worker exists ONLY to receive push messages and route notification
 * clicks. It deliberately has NO `fetch` handler and NO caching, which means:
 *   - it can never poison the dev HMR / chunk cache, so it is safe to keep
 *     registered in development (unlike the offline shell worker `sw.js`, which
 *     the app unregisters in dev), and
 *   - it is registered at its own scope (`/push/`) so it never collides with or
 *     evicts the offline worker registered at `/`.
 *
 * Push delivery does not depend on this worker controlling any page — the
 * browser wakes it for `push` events regardless of scope/navigation.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data && event.data.text ? event.data.text() : 'Crown Island' };
  }

  const title = data.title || 'Crown Island';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: data.icon || '/icons/icon-192.png', // ← site icon, "like the apps"
      // Status-bar badge (top of the notification bar) — monochrome white crown
      // silhouette on transparent bg (Android masks the badge via its alpha, so a
      // solid/colored image would render as a white square).
      badge: '/icons/badge-96.png',
      lang: data.lang || 'ar',
      dir: data.dir || 'auto',
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // SEC-001: only ever navigate to a SAME-ORIGIN path. Resolve the stored URL
  // against our origin and drop it to '/' if it escapes (a protocol-relative
  // "//evil" or an absolute cross-origin URL resolves to a foreign origin).
  let target = '/';
  try {
    const resolved = new URL(
      (event.notification.data && event.notification.data.url) || '/',
      self.location.origin,
    );
    target =
      resolved.origin === self.location.origin
        ? resolved.pathname + resolved.search + resolved.hash
        : '/';
  } catch {
    target = '/';
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const exact = wins.find((w) => w.url.includes(target));
      if (exact) return exact.focus();
      if (wins.length > 0) {
        return wins[0].focus().then((w) => (w && 'navigate' in w ? w.navigate(target) : w));
      }
      return self.clients.openWindow(target);
    }),
  );
});

/* Re-mirror a rotated subscription to the server so the stored endpoint never
 * goes stale (otherwise the toggle silently reads OFF and pushes stop). */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch('/api/push/vapid-public-key');
        if (!res.ok) return;
        const { key } = await res.json();
        const sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        });
        const json = sub.toJSON();
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
        });
      } catch {
        /* best-effort — re-mirrored on next opt-in if this fails */
      }
    })(),
  );
});

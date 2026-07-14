/* Crown Island — service worker.
 *
 * Strategy:
 *  - "stale-while-revalidate" for the app shell (CSS, JS, fonts, images)
 *  - Network-first for HTML navigations, with a fallback to /offline.html
 *  - Never cache /api/* or Next data routes — those must always hit the network
 *  - Never cache Stripe / NextAuth callbacks under any circumstance
 *
 * Bump CACHE_VERSION whenever the shape of the cached resources changes; the
 * activate handler purges any caches that don't match the current version.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `crown-island-shell-${CACHE_VERSION}`;
const OFFLINE_FALLBACK = '/offline.html';

const PRECACHE_URLS = [OFFLINE_FALLBACK, '/manifest.webmanifest', '/brand/crown-logo.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => n !== SHELL_CACHE).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

function isApiOrAuth(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/_next/data/') ||
    url.pathname.startsWith('/api/auth/') ||
    url.pathname.startsWith('/api/stripe/')
  );
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/brand/') ||
    url.pathname.startsWith('/icons/') ||
    /\.(?:png|jpe?g|svg|webp|gif|ico|css|js|woff2?)$/i.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApiOrAuth(url)) return; // pass straight through to the network

  // Navigation requests: network-first, offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(() => caches.match(OFFLINE_FALLBACK).then((cached) => cached || Response.error())),
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(SHELL_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          const networkPromise = fetch(request)
            .then((response) => {
              if (response && response.status === 200) {
                cache.put(request, response.clone()).catch(() => {});
              }
              return response;
            })
            .catch(() => cached);
          return cached || networkPromise;
        }),
      ),
    );
  }
});

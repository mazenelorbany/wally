/* =============================================================================
 * Wally service worker — minimal offline app shell for the field capture PWA.
 *
 * Strategy:
 *   • Precache the shell (index.html) on install.
 *   • Navigations: network-first, falling back to the cached shell when offline
 *     so the SPA always boots (it then hydrates the capture queue from IndexedDB
 *     and retries uploads on reconnect — that logic lives in the app, not here).
 *   • Static assets (the hashed JS/CSS Vite emits): stale-while-revalidate.
 *   • API + photo requests are NEVER cached (auth-scoped, and photos may contain
 *     people — they're served via signed, time-limited URLs only).
 * ========================================================================== */

const VERSION = 'wally-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const SHELL_URL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll([SHELL_URL, '/'])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isApiRequest(url) {
  // Anything that isn't same-origin static content: API calls, signed photo
  // URLs (often a different origin / storage host), etc.
  return (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/auth') ||
    url.pathname.includes('/photos') ||
    url.pathname.includes('/reports')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never touch cross-origin or auth/photo/api traffic.
  if (url.origin !== self.location.origin || isApiRequest(url)) return;

  // App navigations → network-first with shell fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(SHELL_URL, copy));
          return res;
        })
        .catch(() => caches.match(SHELL_URL).then((r) => r || caches.match('/'))),
    );
    return;
  }

  // Hashed static assets → stale-while-revalidate.
  if (/\.(?:js|css|woff2?|png|svg|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});

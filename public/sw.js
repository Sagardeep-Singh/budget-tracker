/*
 * Ledger service worker. Plain JS at the origin root because a worker's scope is
 * capped by the path it's served from, and this one needs scope '/'.
 *
 * SECURITY: this worker caches exactly two static, unauthenticated assets — the
 * /offline fallback page and one icon. It never caches API responses or
 * authenticated HTML. Ledger is a multi-user app and browser profiles get shared;
 * a cached dashboard would hand one user's balances to whoever signs in next.
 */

const CACHE_VERSION = 'ledger-v1';
const OFFLINE_URL = '/offline';
const PRECACHE_URLS = [OFFLINE_URL, '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      await cache.addAll(PRECACHE_URLS);
      // Take over as soon as the new worker is installed rather than waiting for
      // every tab to close — pairs with clients.claim() below.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Navigations only. Everything else — /api/*, RSC payloads, static chunks —
  // goes straight to the network untouched. See the SECURITY note above.
  if (request.method !== 'GET' || request.mode !== 'navigate') {
    return;
  }

  event.respondWith(
    (async () => {
      try {
        // Network-first, never cache-first: a successful response is returned as
        // is and is deliberately not written to the cache.
        return await fetch(request);
      } catch {
        const cache = await caches.open(CACHE_VERSION);
        const offline = await cache.match(OFFLINE_URL);
        return (
          offline ??
          new Response('You are offline.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          })
        );
      }
    })(),
  );
});

self.addEventListener('push', (event) => {
  // Some push services deliver empty wake-up pushes, and a notification is
  // mandatory once a push is received, so fall back to sensible copy rather than
  // letting the browser show its own "this site was updated in the background".
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || 'Ledger';
  const body = payload.body || 'No spending logged lately — want to catch up?';
  const url = payload.url || '/dashboard?overlay=add';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // A stable tag collapses a backlog of missed reminders into one — nobody
      // wants four identical nudges after a week with the phone off.
      tag: 'ledger-reminder',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/dashboard?overlay=add';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // Focus an already-open Ledger tab and steer it, rather than piling up a
      // second window every time a reminder is tapped.
      for (const client of allClients) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client) {
            await client.navigate(url);
          }
          return;
        }
      }

      await self.clients.openWindow(url);
    })(),
  );
});

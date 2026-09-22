/**
 * LAN CLIPBOARD — Service Worker
 * Caches static assets for offline use.
 * NOTE: The service worker does NOT monitor or intercept clipboard content.
 *       Clipboard data travels only between trusted peers via WebRTC.
 */

'use strict';

const CACHE_NAME    = 'lan-clipboard-v2';
const CACHE_ASSETS  = [
  './',
  './index.html',
  './manifest.json',
  './assets/icons/icon.svg',
  './styles/compiled.css',
  './js/app.js',
  './js/utils.js',
  './js/security.js',
  './js/storage.js',
  './js/protocol.js',
  './js/webrtc.js',
  './js/pairing.js',
  './js/qr.js',
  './js/clipboard.js',
  './js/history.js',
  './js/devices.js',
  './js/settings.js',
  './js/ui.js',
];

// Install: pre-cache core assets
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        CACHE_ASSETS.map(url => cache.add(url).catch(() => { /* ignore individual failures */ }))
      );
    })
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first with safe cache fallback
self.addEventListener('fetch', event => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Never intercept WebRTC or non-http protocols
  if (!url.protocol.startsWith('http')) return;

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;

        // If it's a page navigation, fallback to cached index.html
        if (event.request.mode === 'navigate') {
          const fallback = await caches.match('./index.html') || await caches.match('./');
          if (fallback) return fallback;
        }

        // Always return a valid Response to prevent "Failed to convert value to 'Response'"
        return new Response('Network error occurred and resource is not cached.', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain' }
        });
      })
  );
});

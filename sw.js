/**
 * LAN CLIPBOARD — Service Worker
 * Caches static assets for offline use.
 * NOTE: The service worker does NOT monitor or intercept clipboard content.
 *       Clipboard data travels only between trusted peers via WebRTC.
 */

'use strict';

const CACHE_NAME    = 'lan-clipboard-v1';
const CACHE_ASSETS  = [
  './index.html',
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

// Fetch: cache-first for static assets, network-first otherwise
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never intercept WebRTC/STUN/TURN traffic or external APIs
  if (!url.protocol.startsWith('http')) return;
  if (url.hostname !== self.location.hostname) return;

  // Network-first strategy
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

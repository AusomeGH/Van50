/**
 * Van50 Progressive Web App — Production Service Worker
 * Fast, offline-first caching for Vancouver Events & Outings (<= $50 CAD)
 */

const CACHE_NAME = 'van50-cache-v1.4.0';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css?v=5.5.0',
  './css/components.css?v=5.5.0',
  './js/app.js?v=5.5.0',
  './js/map.js?v=5.5.0',
  './js/data.js?v=5.5.0',
  './js/roulette.js',
  './js/pwa-install.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

// Install Event: Pre-cache core application shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(PRECACHE_ASSETS).catch((err) => {
          console.warn('[PWA ServiceWorker] Pre-cache non-fatal warning:', err);
        });
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event: Purge outdated caches and take control
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[PWA ServiceWorker] Removing legacy cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Dual-tier caching strategy
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Only handle same-origin GET requests; bypass third-party map tiles and CDNs
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Never intercept or cache API endpoints or curator management console
  if (url.pathname.startsWith('/api/') || url.pathname.includes('curator')) {
    return;
  }

  // 1. DATA API STRATEGY: Network-First with Cache Fallback
  // Ensures fresh 4:00 AM daily sync updates are delivered when online,
  // while maintaining full offline browsing when signal drops.
  if (url.pathname.includes('/data/events.json') || url.pathname.endsWith('data.js')) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Fallback to cache when offline
          return caches.match(request);
        })
    );
    return;
  }

  // 2. SHELL & STATIC ASSETS: Cache-First with Network Background Revalidation
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch in background to update cache for subsequent visits
        fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }

      // Not in cache, fetch from network
      return fetch(request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        return networkResponse;
      });
    })
  );
});

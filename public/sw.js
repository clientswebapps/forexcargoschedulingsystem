/**
 * sw.js — Service Worker for Forex Cargo PWA
 * Caching strategy: Network-First with Cache Fallback for app shell,
 * direct pass-through for Firebase Auth & Firestore live connections.
 */
'use strict';

const CACHE_NAME = 'forex-cargo-v1.3.6';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.png',
  '/images/logo.png',
  '/images/icon-192.png',
  '/images/icon-512.png',
  '/images/apple-touch-icon.png',
  '/css/style.css',
  '/css/print.css',
  '/js/firebase-config.js',
  '/js/app.js',
  '/js/db.js',
  '/js/utils.js',
  '/js/presence.js',
  '/js/pwa.js',
  '/js/pages/login.js',
  '/js/pages/dashboard.js',
  '/js/pages/bookings.js',
  '/js/pages/booking-form.js',
  '/js/pages/booking-detail.js',
  '/js/pages/my-schedule.js',
  '/js/pages/customers.js',
  '/js/pages/users.js',
  '/js/pages/notifications.js',
  '/js/pages/activity-log.js',
  '/js/pages/staff-activity.js',
  '/js/pages/print.js'
];

// ── Install Event ───────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Pre-cache core assets gracefully
      for (const url of STATIC_ASSETS) {
        try {
          await cache.add(url);
        } catch (e) {
          console.warn('[SW] Pre-cache skipped:', url, e);
        }
      }
    })
  );
  // Do not force skipWaiting automatically to prevent mid-operation reloads
});

// ── Activate Event ──────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ── Message Event (for manual update triggers) ──────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Fetch Event ─────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1. Direct pass-through for Firebase backend APIs & Auth
  if (
    url.origin.includes('googleapis.com') ||
    url.origin.includes('firebaseio.com') ||
    url.origin.includes('identitytoolkit') ||
    url.pathname.startsWith('/__/') ||
    url.protocol === 'chrome-extension:'
  ) {
    return;
  }

  // 2. Navigation requests (HTML SPA) -> Network First with Index Fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((c) => c.put('/index.html', copy));
          }
          return networkRes;
        })
        .catch(() => {
          return caches.match('/index.html') || caches.match('/');
        })
    );
    return;
  }

  // 3. Static assets & scripts -> Network First with Cache Fallback
  event.respondWith(
    fetch(req)
      .then((networkRes) => {
        if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
          const copy = networkRes.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return networkRes;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        // If image failed and offline, return cached logo
        if (req.destination === 'image') {
          return caches.match('/images/logo.png');
        }
        return new Response('Network offline', { status: 503, statusText: 'Offline' });
      })
  );
});

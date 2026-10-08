import { NextResponse } from 'next/server';

// Service worker served from a route handler so the deploy version can be
// stamped into the file: a byte change is what makes browsers fetch and flag
// a new worker (update prompt). Public: see the middleware matcher.
export const dynamic = 'force-static';

const VERSION = process.env.SW_VERSION || 'dev';

const SW = `/* Monitor IF/BO service worker — version ${VERSION.replace(/[^\w.-]/g, '')} */
'use strict';
const VERSION = ${JSON.stringify(VERSION.replace(/[^\w.-]/g, ''))};
const SHELL_CACHE = 'ifbo-shell-' + VERSION;
const STATIC_CACHE = 'ifbo-static-v1';
const OFFLINE_URL = '/offline.html';
const SHELL_ASSETS = [OFFLINE_URL, '/icons/icon-192.png'];
const STATIC_MAX_ENTRIES = 150;

// Strategy (deliberate): the app is authenticated and every page/API response is
// per-user and live, so pages, RSC payloads, /api/* and any non-GET request are
// NOT intercepted at all (network-only, browser default). Only content-hashed,
// immutable build assets are cache-first. A failed navigation falls back to a
// static offline page that contains no user data.

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_ASSETS)));
  // No skipWaiting here: the page asks for it after the user accepts the update toast.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, STATIC_CACHE]);
      for (const key of await caches.keys()) {
        if (key.startsWith('ifbo-') && !keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.status === 200 && res.type === 'basic') {
    await cache.put(request, res.clone());
    trim(cache, STATIC_MAX_ENTRIES);
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error())
    );
    return;
  }

  // Hashed build output and static icons only. Range requests (audio/video) are
  // never cached here: the app serves no media.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    if (req.headers.has('range')) return;
    event.respondWith(cacheFirst(req));
  }
});
`;

export function GET() {
  return new NextResponse(SW, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Service-Worker-Allowed': '/',
    },
  });
}

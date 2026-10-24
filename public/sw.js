/* ==========================================================================
 * Ergalics Studio — FR-20 PWA offline Service Worker (hand-written; the
 * project forbids new npm deps, so vite-plugin-pwa is not available).
 *
 * Cache tiers:
 *   core    — app shell + build chunks (precache on install, cache-first
 *             with background revalidation on fetch).
 *   runtime — heavy same-origin engines: pyodide/, blockly/, webr/, *.wasm,
 *             docs/. Stale-while-revalidate: the FIRST online use caches
 *             them, every later offline session replays from cache. They are
 *             too large to precache blindly.
 *   shell   — index.html for offline navigation fallback.
 *
 * NETWORK-REQUIRED resources (bypassed here; the UI marks them via
 * src/core/pwa.ts needsNetwork()):
 *   - cdn.jsdelivr.net Pyodide fallback (PYODIDE_INDEX_URL) — cross-origin,
 *     only used when the vendored /pyodide/ copy is missing.
 *   - Any other cross-origin request (model downloads from user URLs,
 *     github.com links, external tiles) — never cached, needs network.
 *
 * Build injection (scripts/gen-sw-precache.mjs, run from vite closeBundle):
 *   the VERSION constant string  → build hash (cache busting)
 *   the PRECACHE_MANIFEST array  → ['./index.html', './assets/…', …]
 * Both placeholders are valid JS when unreplaced (dev server / tests).
 * ========================================================================== */

'use strict';

const VERSION = '__SW_VERSION__';
const CORE_CACHE = `ergalics-core-${VERSION}`;
const RUNTIME_CACHE = `ergalics-runtime-${VERSION}`;
const SHELL_CACHE = `ergalics-shell-${VERSION}`;

const PRECACHE_MANIFEST = /*__PRECACHE_MANIFEST__*/ [];

/** Same-origin heavy engines: cached on first use (SWR), not precached. */
const RUNTIME_URL_PATTERNS = [
  /(^|\/)pyodide\//,
  /(^|\/)blockly\//,
  /(^|\/)webr\//,
  /(^|\/)docs\//,
  /\.wasm(\?|$)/,
];

function isRuntimeAsset(url) {
  return RUNTIME_URL_PATTERNS.some((re) => re.test(url.pathname + url.search));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const core = await caches.open(CORE_CACHE);
      // All-or-nothing per entry: a missing hashed chunk (mid-deploy) must
      // not abort the whole install.
      await Promise.all(
        PRECACHE_MANIFEST.map((href) =>
          core.add(new Request(href, { cache: 'reload' })).catch(() => undefined),
        ),
      );
      const shell = await caches.open(SHELL_CACHE);
      await shell.add(new Request('./index.html', { cache: 'reload' })).catch(() => undefined);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([CORE_CACHE, RUNTIME_CACHE, SHELL_CACHE]);
      for (const name of await caches.keys()) {
        if (!keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Cross-origin (model CDN, Pyodide jsdelivr fallback, external links):
  // BYPASS — these explicitly REQUIRE network (see header comment).
  if (url.origin !== self.location.origin) return;

  // SPA navigation: network-first, fall back to the cached shell so the
  // installed app opens offline on any route.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const shell = await caches.open(SHELL_CACHE);
          shell.put('./index.html', fresh.clone());
          return fresh;
        } catch {
          const hit =
            (await caches.match(req, { ignoreSearch: true })) ||
            (await caches.match('./index.html')) ||
            (await caches.match('index.html'));
          return hit || Response.error();
        }
      })(),
    );
    return;
  }

  // Heavy same-origin engines: stale-while-revalidate into the runtime tier.
  if (isRuntimeAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const stale = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => undefined);
        return stale || (await network) || Response.error();
      })(),
    );
    return;
  }

  // Everything else same-origin (hashed chunks, css, icons, manifest):
  // cache-first with background revalidation.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CORE_CACHE);
      const stale = await cache.match(req);
      if (stale) {
        fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
          })
          .catch(() => undefined);
        return stale;
      }
      try {
        const res = await fetch(req);
        if (res && res.ok && (url.pathname.includes('/assets/') || /\.(css|js|svg|ico|webmanifest|json|woff2?)$/.test(url.pathname))) {
          cache.put(req, res.clone());
        }
        return res;
      } catch {
        return Response.error();
      }
    })(),
  );
});

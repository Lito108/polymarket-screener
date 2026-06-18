// Service worker for the Polymarket Insider Screener PWA.
// Strategy: network-first for the app shell (so updates show immediately when
// online, falling back to cache when offline). Live data — the cross-origin
// data-api calls, the /api/poly relay, and any /.netlify/ function — is NEVER
// cached or intercepted, so the screener always shows fresh trades.

const CACHE = "screener-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // allSettled so one missing file can't abort the whole install
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Only handle same-origin GETs (the app shell). Everything else → network.
  if (e.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;                 // data-api etc.
  if (url.pathname.startsWith("/api/")) return;                    // the relay
  if (url.pathname.startsWith("/.netlify/")) return;               // functions

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html")))
  );
});

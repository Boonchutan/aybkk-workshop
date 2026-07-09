// checkin-sw.js — offline shell for the AYBKK check-in station.
// Load the station once on good wifi, "Add to Home Screen", and it then runs
// fully offline. This is what makes it survive a blocked/flaky network in China.
const CACHE = "aybkk-checkin-v2";
const SHELL = [
  "/checkin-station.html",
  "/vendor/jsQR.js",
  "/checkin-manifest.webmanifest"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                 // never cache POST (check-in sync)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // only same-origin

  // Roster: network-first so an updated list is picked up, cache as fallback.
  if (url.pathname === "/rosters/hefei.json") {
    e.respondWith(
      fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return r; })
                .catch(() => caches.match(req))
    );
    return;
  }

  // Shell assets: cache-first with background refresh.
  if (SHELL.includes(url.pathname)) {
    e.respondWith(
      caches.match(req).then(cached => {
        const net = fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return r; }).catch(() => cached);
        return cached || net;
      })
    );
    return;
  }
});

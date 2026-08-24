// AOne Bazaar — service worker
//
// Its main job is simply to EXIST with a fetch handler, since that's
// one of the criteria browsers check before offering "Add to Home
// Screen" / "Install app". Along the way it also caches the shell
// (HTML/CSS/JS/logo) so the site opens instantly on a repeat visit
// and shows something even with a flaky connection — actual product
// data always comes fresh from Supabase, never from this cache.

const CACHE_NAME = "aone-bazaar-shell-v1";

const SHELL_FILES = [
  "/",
  "/index.html",
  "/about.html",
  "/contact.html",
  "/css/design-system.css",
  "/css/style.css",
  "/js/supabase-client.js",
  "/js/app.js",
  "/images/logo.png",
  "/images/logo192.png",
  "/images/logo512.png",
  "/favicon.ico"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // Cache what we can; don't let one missing file block install.
      Promise.all(
        SHELL_FILES.map(url => cache.add(url).catch(() => {}))
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(
        names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const req = event.request;

  // Only handle simple GET page/asset loads — never touch Supabase
  // API calls, WhatsApp links, or POST/PUT requests. Product data,
  // prices and stock must always be live, never served from cache.
  if (req.method !== "GET") return;
  if (req.url.includes("supabase.co")) return;

  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req)
        .then(res => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);

      // Cache-first for the shell (instant loads), falling back to
      // the network for anything not cached yet.
      return cached || network;
    })
  );
});
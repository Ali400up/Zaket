const CACHE_NAME = "zakat-12-5-0-ui4-cache";
const STATIC_ASSETS = [
  "/", "/index.html", "/css/styles.css", "/css/login.css", "/js/config.js", "/js/app.js",
  "/js/data-service.js", "/js/backup-edge-client.js", "/js/backup-v3.js", "/js/backup-v4.js", "/js/attachment-manager.js", "/js/import-service.js", "/js/connectivity.js", "/js/demo-data.js",
  "/js/offline.js", "/js/screen-config.js", "/js/supabase-client.js", "/js/device-identity.js", "/js/ai-assistant.js", "/js/assistant-intents.js", "/js/currency-service.js", "/js/session-audit.js", "/js/searchable-select.js", "/js/state-machines.js",
  "/js/ui.js", "/js/screen-values.js", "/js/user-guide.js", "/js/print-service.js", "/js/in-kind-valuation.js", "/js/error-presenter.js", "/js/release-notes.js", "/js/notification-center.js", "/js/system-health.js", "/js/storage-scope.js",
  "/assets/logo.svg", "/assets/fonts/Tajawal-Regular.ttf", "/assets/fonts/Tajawal-Bold.ttf",
  "/assets/fonts/Tajawal-Medium.ttf", "/assets/fonts/Tajawal-ExtraBold.ttf",
  "/assets/vendor/xlsx.full.min.js", "/assets/vendor/jszip.min.js", "/assets/vendor/chart.umd.min.js", "/assets/vendor/supabase.min.js",
  "/assets/vendor/fontawesome/css/all.min.css", "/assets/vendor/fontawesome/webfonts/fa-solid-900.woff2",
  "/assets/vendor/fontawesome/webfonts/fa-regular-400.woff2", "/assets/vendor/fontawesome/webfonts/fa-brands-400.woff2",
  "/assets/vendor/fontawesome/webfonts/fa-v4compatibility.woff2", "/manifest.webmanifest"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);

  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    const networkPromise = fetch(event.request).then(async response => {
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
      }
      return response;
    });

    if (cached) {
      event.waitUntil(networkPromise.catch(() => null));
      return cached;
    }

    try {
      return await networkPromise;
    } catch {
      if (event.request.mode === "navigate") return caches.match("/index.html");
      return new Response("", { status: 503, statusText: "Offline" });
    }
  })());
});

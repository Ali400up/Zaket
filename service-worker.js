const CACHE_NAME = "zakat-v12-0-0-verified-cache";
const STATIC_ASSETS = [
  "/", "/index.html", "/css/styles.css", "/js/config.js", "/js/app.js",
  "/js/data-service.js", "/js/import-service.js", "/js/connectivity.js", "/js/demo-data.js",
  "/js/offline.js", "/js/screen-config.js", "/js/supabase-client.js", "/js/device-identity.js", "/js/ai-assistant.js", "/js/state-machines.js",
  "/js/ui.js", "/js/user-guide.js", "/assets/logo.svg", "/assets/vendor/xlsx.full.min.js", "/assets/vendor/jszip.min.js", "/manifest.webmanifest"
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

  // مهم: لا نعترض أي طلب خارجي، بما في ذلك فحص الإنترنت وSupabase.
  // وإلا قد تعيد الذاكرة المؤقتة استجابة قديمة وتعرض "متصل" أثناء انقطاع الشبكة.
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

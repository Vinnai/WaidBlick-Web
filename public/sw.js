// Service Worker für WaidBlick — cacht alle App-Assets für Offline-Nutzung im Wald.
//
// Bei Änderungen an den App-Dateien CACHE_NAME hochzählen — sonst behalten Nutzer die alte Version.

const CACHE_NAME = "waidblick-v5";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./style.css",
  "./manifest.webmanifest",
  "./lib/ort/ort.min.js",
  "./lib/ort/ort-wasm-simd-threaded.mjs",
  "./lib/ort/ort-wasm-simd-threaded.wasm",
  "./models/best.onnx",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Einzeln cachen, damit fehlende Datei (z. B. Modell noch nicht deployed)
    // nicht den ganzen Install blockiert.
    for (const asset of ASSETS) {
      try {
        await cache.add(asset);
      } catch (err) {
        console.warn(`SW: konnte ${asset} nicht cachen:`, err);
      }
    }
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
    );
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;

    try {
      const response = await fetch(event.request);
      // Erfolgreiche Antworten nachträglich cachen (außer 0-Range etc.)
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, response.clone()).catch(() => { /* egal */ });
      }
      return response;
    } catch (err) {
      // Offline + nichts im Cache: leeres Response, App entscheidet selbst
      return new Response("", { status: 503, statusText: "Offline" });
    }
  })());
});

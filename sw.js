const CACHE_NAME = "tv-brasil-engine-shell-v5";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=2.5.2",
  "./app.js?v=2.5.2",
  "./manifest.json",
  "./data/playback-strategies.json",
  "./icons/icon-192.svg",
  "./icons/icon-512.svg",
  "./offline.html"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map(async path => { try { await cache.add(path); } catch (error) { console.warn("Recurso não entrou no cache inicial:", path, error); } }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("tv-brasil-engine-") && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.destination === "video" || request.destination === "audio" ||
      /\\.(m3u8|m3u|ts|mp4|m4s|aac|mp3)(\\?|$)/i.test(url.href)) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put("./index.html", response.clone());
        }
        return response;
      } catch (error) {
        return (await caches.match("./index.html")) || (await caches.match("./offline.html"));
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      return new Response("Você está offline. Conecte-se à internet para carregar este recurso.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  })());
});

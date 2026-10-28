const CACHE = "maktabati-shell-v3";
const SHELL = [
  "/",
  "/manifest.webmanifest",
  "/maktabati-icon.svg",
  "/maktabati-icon-192.png",
  "/maktabati-icon-512.png",
];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
    const existing = clientList.find(client => "focus" in client);
    if (existing) return existing.focus();
    return self.clients.openWindow(event.notification.data?.url || "/");
  }));
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/manus-storage/")) return;
  if (request.mode === "navigate") {
    const network = fetch(request);
    event.respondWith(network.then(response => response).catch(() => caches.match("/").then(response => response || new Response("التطبيق غير متاح دون اتصال بعد فتحه مرة واحدة.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }))));
    event.waitUntil(network.then(response => response.ok ? caches.open(CACHE).then(cache => cache.put("/", response.clone())) : undefined).catch(() => undefined));
    return;
  }
  if (["script", "style", "image", "font"].includes(request.destination)) {
    const cached = caches.match(request);
    const network = fetch(request).then(response => {
      if (response.ok) return caches.open(CACHE).then(cache => cache.put(request, response.clone())).then(() => response);
      return response;
    });
    event.respondWith(cached.then(response => response || network));
    event.waitUntil(network.catch(() => undefined));
  }
});

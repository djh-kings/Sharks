// sw.js - the service worker.
// A service worker sits between the page and the network. On first visit it
// saves ("precaches") every file the app needs. After that, the app loads from
// that cache, so it opens even with no signal at sea.
//
// IMPORTANT: when you change any file listed below, increase cacheVersion.
// Otherwise phones that already have the app will keep the old copy.

const cacheVersion = "v3";
const cacheName = `sharkSightings-${cacheVersion}`;

const appFiles = [
  "./",
  "index.html",
  "report.html",
  "sightings.html",
  "species.html",
  "manifest.webmanifest",
  "css/styles.css",
  "icons/icon-512-maskable.png",
  "js/app.js",
  "js/exportDwc.js",
  "js/format.js",
  "js/icons.js",
  "js/mapLayers.js",
  "js/geo.js",
  "js/photos.js",
  "js/report.js",
  "js/sightings.js",
  "js/species.js",
  "js/speciesPicker.js",
  "js/store.js",
  "data/species.json",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/silhouettes/openWater.svg",
  "icons/silhouettes/slender.svg",
  "icons/silhouettes/catshark.svg",
  "icons/silhouettes/flattened.svg",
  "icons/silhouettes/deepRare.svg",
  "vendor/leaflet/leaflet.js",
  "vendor/leaflet/leaflet.css",
  "vendor/leaflet/images/marker-icon.png",
  "vendor/leaflet/images/marker-icon-2x.png",
  "vendor/leaflet/images/marker-shadow.png",
  "vendor/leaflet/images/layers.png",
  "vendor/leaflet/images/layers-2x.png",
  "vendor/exifr/lite.umd.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(appFiles)));
  self.skipWaiting();
});

// Delete caches from older versions.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== cacheName).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Only handle our own files. Map tiles (OpenStreetMap) and satellite photos
  // (Esri) are not cached: their terms do not allow bulk caching.
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  // "Stale while revalidate": answer from the cache straight away, and fetch a
  // fresh copy in the background for next time.
  event.respondWith(
    caches.open(cacheName).then(async (cache) => {
      // ignoreSearch so that report.html?mode=absence uses the cached report.html.
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

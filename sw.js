var CACHE_NAME = "baby-log-pwa-v38";
var CORE_ASSETS = [
  "./",
  "./index.html",
  "./records.html",
  "./quick.html",
  "./photos.html",
  "./analysis.html",
  "./styles.css?v=38",
  "./diary.css?v=38",
  "./photos.css?v=38",
  "./diary.js?v=38",
  "./quick.js?v=38",
  "./app.js?v=38",
  "./photos.js?v=38",
  "./manifest.webmanifest?v=38",
  "./icons/icon.svg"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(CORE_ASSETS);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (name) {
        return name.indexOf("baby-log-pwa-") === 0 && name !== CACHE_NAME;
      }).map(function (name) { return caches.delete(name); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") { return; }
  var requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) { return; }

  event.respondWith(
    fetch(event.request).then(function (response) {
      if (response && response.ok) {
        var copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
          return cache.put(event.request, copy);
        }).catch(function () {}));
      }
      return response;
    }).catch(function () {
      return caches.match(event.request, { ignoreSearch: true }).then(function (cached) {
        if (cached) { return cached; }
        if (event.request.mode === "navigate") { return caches.match("./index.html"); }
        return Response.error();
      });
    })
  );
});

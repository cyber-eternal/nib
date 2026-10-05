// Nib's offline cache for the web build (never registered inside the desktop app). The build prepends
// CACHE, a name that changes whenever any shipped file does, and PRECACHE, the files the app needs offline.
// A new version installs alongside the old one and takes over once every Nib tab has been closed, so a
// running page never loses the scripts or fonts it started with.

const SHELL = "index.html"

const scopePath = () => new URL(self.registration.scope).pathname

const isShell = (url) => url.pathname === scopePath() || url.pathname === `${scopePath()}${SHELL}`

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // bypass the HTTP cache, which could hand back the previous release's page
      .then((cache) => cache.addAll(PRECACHE.map((path) => new Request(path, { cache: "reload" })))),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith("nib-") && key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.mode === "navigate" && isShell(url)) {
    const shell = new URL(SHELL, self.registration.scope).href
    event.respondWith(caches.match(shell, { cacheName: CACHE }).then((hit) => hit || fetch(request)))
    return
  }
  event.respondWith(
    caches.match(request, { cacheName: CACHE }).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          // font subsets for other scripts are left out of PRECACHE and kept once first used
          if (response.ok && response.type === "basic") {
            const copy = response.clone()
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)))
          }
          return response
        }),
    ),
  )
})

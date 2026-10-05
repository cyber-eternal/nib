import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import { precacheList, serviceWorkerSource, webManifest } from "../../../apps/desktop/pwa/plugin"

const desktop = fileURLToPath(new URL("../../../apps/desktop/", import.meta.url))
const template = readFileSync(`${desktop}pwa/sw.js`, "utf8")
const SCOPE = "https://nib.test/app/"

class FakeRequest {
  url: string
  method: string
  mode: string
  cache?: string
  constructor(url: string, init: { method?: string; mode?: string; cache?: string } = {}) {
    this.url = new URL(url, SCOPE).href
    this.method = init.method ?? "GET"
    this.mode = init.mode ?? "cors"
    this.cache = init.cache
  }
}

const response = (body: string, ok = true) => ({ body, ok, type: "basic", clone: () => response(body, ok) })
type FakeResponse = ReturnType<typeof response>

class FakeCache {
  entries = new Map<string, FakeResponse>()
  added: FakeRequest[] = []
  async addAll(requests: FakeRequest[]) {
    this.added.push(...requests)
    for (const r of requests) this.entries.set(r.url, response(`cached ${r.url}`))
  }
  async put(request: FakeRequest, res: FakeResponse) {
    this.entries.set(request.url, res)
  }
}

/** Runs the generated worker against fake service-worker globals. */
const boot = (files: string[]) => {
  const listeners: Record<string, (e: unknown) => void> = {}
  const stores = new Map<string, FakeCache>()
  const caches = {
    stores,
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new FakeCache())
      return stores.get(name)!
    },
    async keys() {
      return [...stores.keys()]
    },
    async delete(name: string) {
      return stores.delete(name)
    },
    async match(req: FakeRequest | string, opts: { cacheName: string }) {
      const url = typeof req === "string" ? req : req.url
      return stores.get(opts.cacheName)?.entries.get(url)
    },
  }
  const fetch = vi.fn(async (req: FakeRequest) => response(`network ${req.url}`))
  const self = {
    addEventListener: (type: string, cb: (e: unknown) => void) => {
      listeners[type] = cb
    },
    registration: { scope: SCOPE },
    location: { origin: new URL(SCOPE).origin },
    clients: { claim: vi.fn(async () => {}) },
  }
  const source = serviceWorkerSource(
    template,
    files.map((name) => ({ name, content: name })),
  )
  new Function("self", "caches", "fetch", "Request", source)(self, caches, fetch, FakeRequest)
  const cacheName = /const CACHE = "([^"]+)"/.exec(source)![1]!
  const lifecycle = async (type: "install" | "activate") => {
    let done: Promise<unknown> = Promise.resolve()
    listeners[type]!({ waitUntil: (p: Promise<unknown>) => (done = p) })
    await done
  }
  const request = async (url: string, init?: { method?: string; mode?: string }) => {
    let res: Promise<FakeResponse> | undefined
    const later: Promise<unknown>[] = []
    listeners.fetch!({
      request: new FakeRequest(url, init),
      respondWith: (p: Promise<FakeResponse>) => (res = p),
      waitUntil: (p: Promise<unknown>) => later.push(p),
    })
    const out = res ? await res : undefined
    await Promise.all(later)
    return out
  }
  return { caches, fetch, self, cacheName, lifecycle, request }
}

const FILES = [
  "index.html",
  "assets/index-abc.js",
  "assets/index-def.css",
  "assets/shantell-sans-latin-400-normal-1.woff2",
  "assets/shantell-sans-cyrillic-400-normal-2.woff2",
  "assets/shantell-sans-latin-400-normal-3.woff",
  "manifest.webmanifest",
]

describe("web build offline cache", () => {
  afterEach(() => vi.restoreAllMocks())

  it("precaches the app shell and Latin fonts, not legacy or other-script font files", () => {
    expect(precacheList([...FILES, "sw.js", "assets/index-abc.js.map"])).toEqual([
      "assets/index-abc.js",
      "assets/index-def.css",
      "assets/shantell-sans-latin-400-normal-1.woff2",
      "index.html",
      "manifest.webmanifest",
    ])
  })

  it("names the cache after the content, so any change ships a new worker", () => {
    const a = serviceWorkerSource(template, [{ name: "index.html", content: "<p>1</p>" }])
    const b = serviceWorkerSource(template, [{ name: "index.html", content: "<p>2</p>" }])
    const cache = (s: string) => /const CACHE = "([^"]+)"/.exec(s)![1]
    expect(cache(a)).toMatch(/^nib-[0-9a-f]{16}$/)
    expect(cache(a)).not.toBe(cache(b))
  })

  it("installs the shell bypassing the HTTP cache and drops older Nib caches on activate", async () => {
    const sw = boot(FILES)
    await sw.caches.open("nib-old")
    await sw.caches.open("someone-else")
    await sw.lifecycle("install")
    const added = sw.caches.stores.get(sw.cacheName)!.added
    expect(added.map((r) => r.url)).toContain(`${SCOPE}index.html`)
    expect(added.every((r) => r.cache === "reload")).toBe(true)
    await sw.lifecycle("activate")
    expect([...sw.caches.stores.keys()].sort()).toEqual([sw.cacheName, "someone-else"].sort())
    expect(sw.self.clients.claim).toHaveBeenCalled()
  })

  it("opens offline: the page and its assets come from the cache", async () => {
    const sw = boot(FILES)
    await sw.lifecycle("install")
    expect((await sw.request(SCOPE, { mode: "navigate" }))?.body).toBe(`cached ${SCOPE}index.html`)
    expect((await sw.request(`${SCOPE}?utm=x`, { mode: "navigate" }))?.body).toBe(`cached ${SCOPE}index.html`)
    expect((await sw.request(`${SCOPE}assets/index-abc.js`))?.body).toBe(`cached ${SCOPE}assets/index-abc.js`)
    expect(sw.fetch).not.toHaveBeenCalled()
  })

  it("keeps other same-origin files once fetched, and leaves other origins and writes alone", async () => {
    const sw = boot(FILES)
    await sw.lifecycle("install")
    const font = `${SCOPE}assets/shantell-sans-cyrillic-400-normal-2.woff2`
    expect((await sw.request(font))?.body).toBe(`network ${font}`)
    expect((await sw.request(font))?.body).toBe(`network ${font}`)
    expect(sw.fetch).toHaveBeenCalledTimes(1)
    expect(await sw.request("https://elsewhere.test/x.png")).toBeUndefined()
    expect(await sw.request(`${SCOPE}api`, { method: "POST" })).toBeUndefined()
  })
})

describe("web app manifest", () => {
  it("is installable and opens drawings from the OS", () => {
    const manifest = webManifest()
    expect(manifest.display).toBe("standalone")
    expect(manifest.start_url).toBe("./")
    expect(manifest.icons.some((i) => i.sizes === "512x512")).toBe(true)
    expect(manifest.name).toBe("Nib")
    expect(manifest.short_name).toBe("Nib")
    expect(manifest.file_handlers[0]!.accept["application/json"]).toEqual([".nibd", ".excalidraw"])
  })

  it("names the page Nib", () => {
    const html = readFileSync(`${desktop}index.html`, "utf8")
    expect(html).toContain("<title>Nib</title>")
    expect(html).toContain('<meta name="application-name" content="Nib" />')
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Nib" />')
  })
})

describe("build config", () => {
  const load = async (tauri: boolean) => {
    vi.stubEnv("TAURI_ENV_PLATFORM", tauri ? "darwin" : "")
    vi.resetModules()
    const { default: config } = await import("../../../apps/desktop/vite.config")
    const resolved = (config as (env: { command: string; mode: string }) => Record<string, unknown>)({
      command: "build",
      mode: "production",
    })
    const plugins = (resolved.plugins as { name?: string }[][]).flat().map((p) => p.name)
    return { resolved, plugins }
  }

  afterEach(() => vi.unstubAllEnvs())

  it("adds the CSP, manifest and service worker to the web build only", async () => {
    const web = await load(false)
    expect(web.plugins).toEqual(expect.arrayContaining(["nib-web-csp", "nib-web-pwa"]))
    expect(web.resolved.define).toEqual({ __NIB_PWA__: "true" })
    const tauri = await load(true)
    expect(tauri.plugins).not.toContain("nib-web-pwa")
    expect(tauri.plugins).not.toContain("nib-web-csp")
    expect(tauri.resolved.define).toEqual({ __NIB_PWA__: "false" })
  })

  it("frames embeds from exactly the sites core rewrites embed links to", async () => {
    const { EMBED_FRAME_ORIGINS: core } = await import("@nib/core")
    const { EMBED_FRAME_ORIGINS: web } = await import("../../../apps/desktop/vite.config")
    expect(web).toEqual([...core])
  })
})

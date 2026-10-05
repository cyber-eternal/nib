import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { Plugin } from "vite"

const here = fileURLToPath(new URL(".", import.meta.url))
const iconDir = fileURLToPath(new URL("../src-tauri/icons/", import.meta.url))

/** The Whiteboard theme's board, so the install splash matches the canvas. */
export const THEME_COLOR = "#FBFBFA"

const ICONS = [
  { from: "32x32.png", to: "icons/icon-32.png", sizes: "32x32" },
  { from: "128x128.png", to: "icons/icon-128.png", sizes: "128x128" },
  { from: "128x128@2x.png", to: "icons/icon-256.png", sizes: "256x256" },
  { from: "icon.png", to: "icons/icon-512.png", sizes: "512x512" },
]

export const webManifest = () => ({
  id: "./",
  name: "Nib",
  short_name: "Nib",
  description: "An infinite hand-drawn whiteboard",
  start_url: "./",
  scope: "./",
  display: "standalone",
  background_color: THEME_COLOR,
  theme_color: THEME_COLOR,
  icons: ICONS.map(({ to, sizes }) => ({ src: to, sizes, type: "image/png", purpose: "any" })),
  // an installed app opens drawings from the OS; the platform reads them through window.launchQueue
  file_handlers: [{ action: "./", accept: { "application/json": [".nibd", ".excalidraw"] } }],
})

export interface BuiltFile {
  name: string
  content: string | Uint8Array
}

/**
 * What the app needs offline. Legacy .woff files are never fetched by a browser that has service workers,
 * and font subsets for non-Latin scripts are cached the first time a drawing uses them instead.
 */
export const precacheList = (names: string[]): string[] =>
  names
    .filter((name) => {
      if (name === "sw.js" || name.endsWith(".map") || name.endsWith(".woff")) return false
      return !name.endsWith(".woff2") || /-latin(-ext)?-/.test(name)
    })
    .sort()

export const serviceWorkerSource = (template: string, files: BuiltFile[]): string => {
  const precache = precacheList(files.map((f) => f.name))
  const hash = createHash("sha256")
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    hash.update(file.name).update("\0").update(file.content).update("\0")
  }
  const cache = `nib-${hash.digest("hex").slice(0, 16)}`
  return `const CACHE = ${JSON.stringify(cache)}\nconst PRECACHE = ${JSON.stringify(precache)}\n\n${template}`
}

/** Manifest, icons and an offline service worker for the web build; the desktop build never gets them. */
export const webPwa = (): Plugin => {
  let base = "/"
  return {
    name: "nib-web-pwa",
    enforce: "post",
    configResolved(config) {
      base = config.base
    },
    transformIndexHtml: () => [
      { tag: "link", attrs: { rel: "manifest", href: `${base}manifest.webmanifest` }, injectTo: "head" },
      {
        tag: "link",
        attrs: { rel: "icon", type: "image/png", sizes: "32x32", href: `${base}icons/icon-32.png` },
        injectTo: "head",
      },
      {
        tag: "link",
        attrs: { rel: "apple-touch-icon", href: `${base}icons/icon-256.png` },
        injectTo: "head",
      },
    ],
    generateBundle(_options, bundle) {
      const emitted: BuiltFile[] = [
        ...ICONS.map(({ from, to }) => ({ name: to, content: new Uint8Array(readFileSync(iconDir + from)) })),
        { name: "manifest.webmanifest", content: `${JSON.stringify(webManifest(), null, 2)}\n` },
      ]
      for (const file of emitted) this.emitFile({ type: "asset", fileName: file.name, source: file.content })
      const built = new Map<string, BuiltFile>()
      for (const out of Object.values(bundle)) {
        built.set(out.fileName, { name: out.fileName, content: out.type === "chunk" ? out.code : out.source })
      }
      for (const file of emitted) built.set(file.name, file)
      const template = readFileSync(`${here}sw.js`, "utf8")
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: serviceWorkerSource(template, [...built.values()]),
      })
    },
  }
}

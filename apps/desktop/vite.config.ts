import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { type Plugin, defineConfig } from "vite"
import { webPwa } from "./pwa/plugin"
import { THEME_BOOT_SCRIPT } from "./src/themeBoot"

const here = fileURLToPath(new URL(".", import.meta.url))

// Vite loads this config with plain Node, which can't import core's TypeScript, so the list is
// repeated here; platform's webBuild test keeps it equal to core's EMBED_FRAME_ORIGINS
export const EMBED_FRAME_ORIGINS = [
  "https://www.youtube-nocookie.com",
  "https://player.vimeo.com",
  "https://figma.com",
  "https://*.figma.com",
  "https://www.loom.com",
  "https://gist.github.com",
  "https://codepen.io",
  "https://codesandbox.io",
  "https://stackblitz.com",
  "https://*.stackblitz.com",
  "https://excalidraw.com",
  "https://*.excalidraw.com",
  "https://open.spotify.com",
]

/** The CSP source that lets exactly the inline theme script run. */
export const THEME_BOOT_HASH = `'sha256-${createHash("sha256").update(THEME_BOOT_SCRIPT).digest("base64")}'`

const WEB_CSP = [
  "default-src 'self'",
  `script-src 'self' ${THEME_BOOT_HASH}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  `frame-src ${EMBED_FRAME_ORIGINS.join(" ")}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ")

/**
 * Paints the saved theme's board before the bundle runs (every build, and dev). Tauri hashes inline
 * scripts into its own CSP; the web build's CSP below carries THEME_BOOT_HASH.
 */
const themeBoot = (): Plugin => ({
  name: "nib-theme-boot",
  transformIndexHtml: () => [{ tag: "script", children: THEME_BOOT_SCRIPT, injectTo: "head" }],
})

/**
 * The web build gets the same lock-down as the desktop one (no remote images, so a file can't phone
 * home). Tauri builds keep only tauri.conf's CSP, which also allows the IPC origin, and dev skips it
 * because Vite's React preamble is an inline script.
 */
const webCsp = (): Plugin => ({
  name: "nib-web-csp",
  transformIndexHtml: () => [
    {
      tag: "meta",
      attrs: { "http-equiv": "Content-Security-Policy", content: WEB_CSP },
      injectTo: "head-prepend",
    },
  ],
})

export default defineConfig(({ command }) => {
  // the Tauri CLI sets TAURI_ENV_PLATFORM for its beforeBuildCommand
  const web = command === "build" && !process.env.TAURI_ENV_PLATFORM
  return {
    // pinned so the app builds the same whether vite runs from here or the repo root
    root: here,
    // relative, so the web build also works from a sub-path (GitHub Pages and the like)
    base: web ? "./" : "/",
    plugins: [react(), themeBoot(), ...(web ? [webCsp(), webPwa()] : [])],
    define: { __NIB_PWA__: JSON.stringify(web) },
    clearScreen: false,
    server: { port: 1420, strictPort: true, host: "127.0.0.1" },
    envPrefix: ["VITE_", "TAURI_"],
    build: {
      outDir: "dist",
      emptyOutDir: true,
      target: "safari15",
      sourcemap: false,
      chunkSizeWarningLimit: 2000,
    },
  }
})

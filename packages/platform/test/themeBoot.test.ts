import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { THEME_BOARDS, THEME_BOOT_SCRIPT } from "../../../apps/desktop/src/themeBoot"
import { MATCH_SYSTEM, themes } from "../../editor/src/theme/themes"
import { readThemeChoice, resolveTheme } from "../../editor/src/ui/shell/themePrefs"

interface Boot {
  local?: Record<string, string>
  boot?: { rev: number; values: Record<string, string | null> }
  dark?: boolean
}

/** Runs the inline script against a bare page, as the browser does before any stylesheet or bundle. */
const paint = ({ local = {}, boot, dark = false }: Boot) => {
  const vars = new Map<string, string>()
  const attrs = new Map<string, string>()
  const meta = { content: "#FBFBFA", setAttribute: (_k: string, v: string) => (meta.content = v) }
  const style = {
    backgroundColor: "",
    colorScheme: "",
    setProperty: (k: string, v: string) => vars.set(k, v),
  }
  const document = {
    documentElement: { style, setAttribute: (k: string, v: string) => attrs.set(k, v) },
    querySelector: () => meta,
  }
  const window = {
    localStorage: { getItem: (k: string) => local[k] ?? null },
    __NIB_BOOT__: boot && { prefs: boot },
    matchMedia: () => ({ matches: dark }),
  }
  new Function("window", "document", THEME_BOOT_SCRIPT)(window, document)
  return {
    theme: attrs.get("data-nib-theme"),
    mode: attrs.get("data-nib-mode"),
    board: vars.get("--board"),
    scheme: style.colorScheme,
    background: style.backgroundColor,
    themeColor: meta.content,
  }
}

describe("theme before first paint", () => {
  it("knows every theme's board and mode exactly as the editor defines them", () => {
    expect(THEME_BOARDS).toEqual(Object.fromEntries(themes.map((t) => [t.id, [t.board, t.mode]])))
  })

  it("paints the saved theme's board, mode and browser chrome colour", () => {
    expect(paint({ local: { "nib.theme": "midnight", "nib.matchSystem": "0" } })).toEqual({
      theme: "midnight",
      mode: "dark",
      board: "#0E1424",
      scheme: "dark",
      background: "var(--board)",
      themeColor: "#0E1424",
    })
  })

  it("resolves the theme the way the editor does, for every kind of saved choice", () => {
    const raws = [null, MATCH_SYSTEM, "kraft", "graphite", "not-a-theme"]
    const flags = [null, "1", "0", "true", "false"]
    for (const raw of raws)
      for (const flag of flags)
        for (const dark of [false, true]) {
          const local: Record<string, string> = {}
          if (raw !== null) local["nib.theme"] = raw
          if (flag !== null) local["nib.matchSystem"] = flag
          const expected = resolveTheme(readThemeChoice({ get: (k) => local[k] ?? null }), dark)
          expect(paint({ local, dark }).theme, JSON.stringify({ raw, flag, dark })).toBe(expected.id)
        }
  })

  it("on desktop, prefers the shell's copy of the prefs when it is newer than localStorage", () => {
    const local = { "nib.theme": "kraft", "nib.matchSystem": "0", "nib:prefs:rev": "4" }
    const newer = { rev: 5, values: { "nib.theme": "blueprint" } }
    expect(paint({ local, boot: newer }).theme).toBe("blueprint")
    expect(paint({ local, boot: { ...newer, rev: 3 } }).theme).toBe("kraft")
  })

  it("never throws, so a broken store still leaves the page to the editor", () => {
    const document = { documentElement: null, querySelector: () => null }
    const run = () => new Function("window", "document", THEME_BOOT_SCRIPT)({}, document)
    expect(run).not.toThrow()
  })
})

describe("theme script in the builds", () => {
  const load = async (tauri: boolean) => {
    vi.stubEnv("TAURI_ENV_PLATFORM", tauri ? "darwin" : "")
    vi.resetModules()
    const mod = await import("../../../apps/desktop/vite.config")
    const resolved = (mod.default as (env: { command: string; mode: string }) => Record<string, unknown>)({
      command: "build",
      mode: "production",
    })
    vi.unstubAllEnvs()
    const plugins = (resolved.plugins as { name?: string; transformIndexHtml?: unknown }[][]).flat()
    const html = (name: string) => {
      const hook = plugins.find((p) => p.name === name)?.transformIndexHtml as () => {
        tag: string
        attrs?: Record<string, string>
        children?: string
      }[]
      return hook()
    }
    return { plugins: plugins.map((p) => p.name), html, hash: mod.THEME_BOOT_HASH }
  }

  it("goes into the page of every build, and the web CSP allows exactly that script", async () => {
    const web = await load(false)
    expect(web.html("nib-theme-boot")).toEqual([
      { tag: "script", children: THEME_BOOT_SCRIPT, injectTo: "head" },
    ])
    const digest = createHash("sha256").update(THEME_BOOT_SCRIPT).digest("base64")
    expect(web.hash).toBe(`'sha256-${digest}'`)
    const csp = web.html("nib-web-csp")[0]!.attrs!.content!
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src"))!
    expect(scriptSrc.trim().split(/\s+/)).toEqual(["script-src", "'self'", `'sha256-${digest}'`])
    const desktop = await load(true)
    expect(desktop.plugins).toContain("nib-theme-boot")
  })
})

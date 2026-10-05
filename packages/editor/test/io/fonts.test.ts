import { DEFAULT_APP_STATE, type NibElement, newElement } from "@nib/core"
import { describe, expect, test, vi } from "vitest"
import {
  type FontFaceFile,
  buildEmbeddedFontCss,
  textByFamily,
  usedFontFaces,
  waitForFonts,
} from "../../src/export/embedFonts"
import { exportToSvgFile, exportToSvgString } from "../../src/export/exportImage"

const LATIN = "U+0000-00FF,U+0131,U+0152-0153"
const CYRILLIC = "U+0301,U+0400-045F"
const catalog: FontFaceFile[] = [
  { family: "hand", name: "Shantell Sans", subset: "latin", unicodeRange: LATIN, url: "/hand-latin.woff2" },
  {
    family: "hand",
    name: "Shantell Sans",
    subset: "cyrillic",
    unicodeRange: CYRILLIC,
    url: "/hand-cyr.woff2",
  },
  { family: "normal", name: "Nunito", subset: "latin", unicodeRange: LATIN, url: "/nunito-latin.woff2" },
  { family: "code", name: "Cascadia Code", subset: "latin", unicodeRange: LATIN, url: "/code-latin.woff2" },
]

const text = (value: string, fontFamily: string, extra: Record<string, unknown> = {}) =>
  newElement("text", {
    x: 0,
    y: 0,
    width: 50,
    height: 20,
    text: value,
    originalText: value,
    fontFamily,
    ...extra,
  })

const loader = () => {
  const loaded: string[] = []
  const load = async (url: string) => {
    loaded.push(url)
    return new TextEncoder().encode(url)
  }
  return { load, loaded }
}

describe("font embedding", () => {
  test("only the families and Unicode subsets the text uses are embedded", () => {
    const els: NibElement[] = [
      text("Hello", "hand"),
      text("Привет", "hand"),
      text("x = 1", "code"),
      text("gone", "normal", { isDeleted: true }),
      newElement("rectangle", { width: 10, height: 10 }),
    ]
    expect(usedFontFaces(els, catalog).map((f) => f.url)).toEqual([
      "/hand-latin.woff2",
      "/hand-cyr.woff2",
      "/code-latin.woff2",
    ])
    expect([...textByFamily(els).keys()]).toEqual(["hand", "code"])
  })

  test("the CSS has one @font-face per file with its data URL, weight and unicode-range", async () => {
    const { load, loaded } = loader()
    const css = await buildEmbeddedFontCss([text("Hi", "normal")], { load, catalog })
    expect(loaded).toEqual(["/nunito-latin.woff2"])
    const b64 = btoa("/nunito-latin.woff2")
    expect(css).toBe(
      `@font-face{font-family:"Nunito";font-style:normal;font-weight:400;src:url(data:font/woff2;base64,${b64}) format("woff2");unicode-range:${LATIN}}`,
    )
  })

  test("a drawing without text needs no fonts and loads nothing", async () => {
    const { load, loaded } = loader()
    expect(
      await buildEmbeddedFontCss([newElement("ellipse", { width: 5, height: 5 })], { load, catalog }),
    ).toBe("")
    expect(loaded).toEqual([])
  })

  test("an SVG file with embed fonts on carries the faces in its <defs>; previews and plain files do not", async () => {
    const { load } = loader()
    const opts = {
      elements: [text("Hand", "hand")],
      appState: DEFAULT_APP_STATE,
      files: {},
      scale: 1,
      exportBackground: false,
      theme: "light" as const,
    }
    const embedded = await exportToSvgFile({ ...opts, embedFonts: true }, { load, catalog })
    expect(/<defs>[\s\S]*@font-face\{font-family:&quot;Shantell Sans&quot;/.test(embedded)).toBe(true)
    expect(embedded).toContain("data:font/woff2;base64,")
    expect(await exportToSvgFile(opts, { load, catalog })).not.toContain("@font-face")
    expect(exportToSvgString({ ...opts, embedFonts: true })).not.toContain("@font-face")
  })

  test("the bundled catalog has every face for the three bundled families", async () => {
    const { BUNDLED_FONT_FILES } = await import("../../src/export/fontFiles")
    const families = new Set(BUNDLED_FONT_FILES.map((f) => `${f.family}:${f.name}`))
    expect([...families].sort()).toEqual(["code:Cascadia Code", "hand:Shantell Sans", "normal:Nunito"])
    for (const face of BUNDLED_FONT_FILES) {
      expect(face.url).toMatch(/\.woff2/)
      expect(face.unicodeRange).toMatch(/^U\+/)
    }
    expect(BUNDLED_FONT_FILES.filter((f) => f.subset === "latin")).toHaveLength(3)
  })

  test("PNG export waits for the faces the text uses, and gives up on a font that never loads", async () => {
    vi.useFakeTimers()
    const load = vi.fn(() => new Promise<FontFace[]>(() => {}))
    vi.stubGlobal("document", { fonts: { load } })
    try {
      let done = false
      const waiting = waitForFonts([text("Hey", "hand"), text("Yo", "code")]).then(() => {
        done = true
      })
      expect(load).toHaveBeenCalledTimes(2)
      expect(load.mock.calls[0]).toEqual(['16px "Shantell Sans", "Comic Sans MS", cursive', "Hey"])
      await vi.advanceTimersByTimeAsync(1000)
      expect(done).toBe(false)
      await vi.advanceTimersByTimeAsync(2500)
      await waiting
      expect(done).toBe(true)
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})

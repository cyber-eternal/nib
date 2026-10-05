import { FONT_STACKS, type FontFamily, type NibElement, bytesToBase64 } from "@nib/core"

/** One bundled font file: a family's regular face for one Unicode subset. */
export interface FontFaceFile {
  family: FontFamily
  /** The CSS family name FONT_STACKS puts first, e.g. "Shantell Sans". */
  name: string
  subset: string
  /** CSS unicode-range, e.g. "U+0000-00FF,U+0131". */
  unicodeRange: string
  url: string
}

/** Fetches a font file's bytes; tests and hosts without fetch inject their own. */
export type FontLoader = (url: string) => Promise<Uint8Array>

export interface EmbedFontOptions {
  load?: FontLoader
  /** Defaults to the bundled @fontsource files, imported only when needed. */
  catalog?: readonly FontFaceFile[]
}

const fetchFont: FontLoader = async (url) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Couldn't load the font file ${url} (${response.status}).`)
  return new Uint8Array(await response.arrayBuffer())
}

const loadCatalog = async (): Promise<readonly FontFaceFile[]> =>
  (await import("./fontFiles")).BUNDLED_FONT_FILES

const parseRanges = (range: string): [number, number][] =>
  range
    .split(",")
    .map((part) => /^\s*U\+([0-9a-f?]+)(?:-([0-9a-f]+))?\s*$/i.exec(part))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m): [number, number] => {
      // U+4?? is a wildcard range
      const lo = Number.parseInt(m[1]!.replace(/\?/g, "0"), 16)
      const hi = m[2] ? Number.parseInt(m[2], 16) : Number.parseInt(m[1]!.replace(/\?/g, "f"), 16)
      return [lo, hi]
    })

/** The characters each bundled family has to draw, from the visible text elements. */
export const textByFamily = (elements: readonly NibElement[]): Map<FontFamily, Set<number>> => {
  const out = new Map<FontFamily, Set<number>>()
  for (const el of elements) {
    if (el.isDeleted || el.type !== "text" || !el.text) continue
    let chars = out.get(el.fontFamily)
    if (!chars) {
      chars = new Set()
      out.set(el.fontFamily, chars)
    }
    for (const ch of el.text) chars.add(ch.codePointAt(0)!)
  }
  return out
}

/** The font files `elements` need: only families in use, and only subsets covering characters they show. */
export const usedFontFaces = (
  elements: readonly NibElement[],
  catalog: readonly FontFaceFile[],
): FontFaceFile[] => {
  const used = textByFamily(elements)
  return catalog.filter((face) => {
    const chars = used.get(face.family)
    if (!chars) return false
    const ranges = parseRanges(face.unicodeRange)
    for (const c of chars) if (ranges.some(([lo, hi]) => c >= lo && c <= hi)) return true
    return false
  })
}

// no characters that would need escaping inside the SVG <style>, so the CSS survives any serializer
const cssString = (s: string): string => `"${s.replace(/["\\<>&]/g, "")}"`
const safeRange = (range: string): string => range.replace(/[^0-9a-f?+,\-u]/gi, "")

/**
 * @font-face rules with the used bundled faces inlined as data: URLs, for exportSvg's embedFontCss,
 * so an exported SVG keeps its hand-drawn text on machines without the fonts installed.
 */
export const buildEmbeddedFontCss = async (
  elements: readonly NibElement[],
  opts: EmbedFontOptions = {},
): Promise<string> => {
  if (textByFamily(elements).size === 0) return ""
  const faces = usedFontFaces(elements, opts.catalog ?? (await loadCatalog()))
  const load = opts.load ?? fetchFont
  const rules = await Promise.all(
    faces.map(async (face) => {
      const data = bytesToBase64(await load(face.url))
      return `@font-face{font-family:${cssString(face.name)};font-style:normal;font-weight:400;src:url(data:font/woff2;base64,${data}) format("woff2");unicode-range:${safeRange(face.unicodeRange)}}`
    }),
  )
  return rules.join("\n")
}

const FONT_WAIT_MS = 3000

/**
 * Resolves once the browser has loaded the faces the text in `elements` uses (or after a few
 * seconds, so a missing font never blocks an export). Canvas text drawn before that falls back to
 * another font, so PNG export waits for this.
 */
export const waitForFonts = async (elements: readonly NibElement[]): Promise<void> => {
  const fonts = typeof document === "undefined" ? undefined : document.fonts
  if (!fonts || typeof fonts.load !== "function") return
  const loads = [...textByFamily(elements)].map(([family, chars]) => {
    const sample = String.fromCodePoint(...[...chars].slice(0, 256))
    return fonts.load(`16px ${FONT_STACKS[family] ?? FONT_STACKS.hand}`, sample).catch(() => [])
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    Promise.all(loads),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, FONT_WAIT_MS)
    }),
  ])
  clearTimeout(timer)
}

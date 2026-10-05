import { FONT_STACKS, setTextMeasurer } from "@nib/core"

let ctx: CanvasRenderingContext2D | null = null
const cache = new Map<string, number>()
const fontListeners = new Set<() => void>()
const requested = new Set<string>()
let fontsVersion = 0
let ready: Promise<void> | null = null

/** The bundled canvas faces (theme/fonts.css), in the weights the renderer uses. */
export const CANVAS_FONT_FACES: readonly string[] = [
  `400 16px ${FONT_STACKS.hand}`,
  `700 16px ${FONT_STACKS.hand}`,
  `400 16px ${FONT_STACKS.normal}`,
  `700 16px ${FONT_STACKS.normal}`,
  `400 16px ${FONT_STACKS.code}`,
]

/** Longest the first document waits for the bundled faces. */
export const FONT_WAIT_MS = 2500

type FontSet = {
  load(font: string, text?: string): Promise<unknown>
  check?(font: string, text?: string): boolean
  addEventListener?(type: string, cb: () => void): void
}

const fontSet = (): FontSet | null => {
  if (typeof document === "undefined") return null
  return ((document as Document & { fonts?: FontSet }).fonts ?? null) as FontSet | null
}

const fontsChanged = (): void => {
  cache.clear()
  fontsVersion++
  for (const cb of fontListeners) cb()
}

const hasNonAscii = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0x7f) return true
  return false
}

/** Groups text by 256-codepoint block, so one load covers a script's unicode-range subset. */
const blocksOf = (text: string): string => {
  const blocks = new Set<number>()
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp > 0x7f) blocks.add(cp >> 8)
  }
  return [...blocks].sort((a, b) => a - b).join(",")
}

/**
 * A measure of text in a subset that is not loaded yet uses the fallback face; ask for that subset and
 * re-measure once it arrives, so Cyrillic or Armenian labels wrap with the real glyphs.
 */
const ensureSubset = (font: string, text: string): void => {
  const fonts = fontSet()
  if (!fonts?.check) return
  const key = `${font}|${blocksOf(text)}`
  if (requested.has(key)) return
  requested.add(key)
  let loaded = true
  try {
    loaded = fonts.check(font, text)
  } catch {
    return
  }
  if (loaded) return
  fonts.load(font, text).then(
    (faces) => {
      if (Array.isArray(faces) && faces.length > 0) fontsChanged()
    },
    () => {},
  )
}

/**
 * Loads the bundled faces before text is measured with them (the first measure would otherwise use a
 * fallback and cache its widths). Resolves when they are in, or when the platform has no font loading API.
 */
export const loadCanvasFonts = (): Promise<void> => {
  if (ready) return ready
  const fonts = fontSet()
  if (!fonts) {
    ready = Promise.resolve()
    return ready
  }
  fonts.addEventListener?.("loadingdone", fontsChanged)
  const loaded = Promise.all(CANVAS_FONT_FACES.map((f) => fonts.load(f).catch(() => null)))
  // a face that never arrives must not hold the first document back; loadingdone re-measures if it does
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, FONT_WAIT_MS))
  ready = Promise.race([loaded, timeout]).then(() => fontsChanged())
  return ready
}

/** Resolves once the bundled canvas faces are loaded; the shell awaits it before opening the first document. */
export const canvasFontsReady = (): Promise<void> => loadCanvasFonts()

/** Fires after fonts finish loading and cached widths were dropped; laid-out text should be measured again. */
export const onCanvasFontsChange = (cb: () => void): (() => void) => {
  fontListeners.add(cb)
  return () => fontListeners.delete(cb)
}

export const canvasFontsVersion = (): number => fontsVersion

/** One shared offscreen context measures every string; results are memoised. */
export const installTextMeasurer = (): void => {
  if (ctx) return
  if (typeof document === "undefined") return
  const canvas = document.createElement("canvas")
  ctx = canvas.getContext("2d")
  if (!ctx) return
  void loadCanvasFonts()
  setTextMeasurer((text, font) => {
    const key = `${font}|${text}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    ctx!.font = font
    const width = ctx!.measureText(text).width
    if (cache.size > 5000) cache.clear()
    cache.set(key, width)
    if (hasNonAscii(text)) ensureSubset(font, text)
    return width
  })
}

export const clearMeasureCache = (): void => cache.clear()

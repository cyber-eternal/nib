import type { Theme } from "../model/types"
import { type ParsedColor, formatColor, hslToRgb, parseColor, rgbToHsl, withAlpha } from "./color"

/** Colours the renderers use for chrome rather than for element content. */
export interface CanvasPalette {
  board: string
  selection: string
  selectionFill: string
  binding: string
  snapGuide: string
  frameBorder: string
  frameLabel: string
  gridMinor: string
  gridMajor: string
  correctionFlash: string
  searchHighlight: string
  laser: string
}

/** A theme's own colours, from which every canvas chrome colour is derived. */
export interface CanvasPaletteSeed {
  mode: Theme
  board: string
  ink: string
  course: string
}

export const deriveCanvasPalette = ({ mode, board, ink, course }: CanvasPaletteSeed): CanvasPalette => ({
  board,
  selection: course,
  selectionFill: withAlpha(course, 0.08),
  binding: withAlpha(course, 0.55),
  snapGuide: "#ff6b6b",
  frameBorder: withAlpha(ink, 0.3),
  frameLabel: withAlpha(ink, 0.65),
  gridMinor: withAlpha(ink, 0.05),
  gridMajor: withAlpha(ink, 0.11),
  correctionFlash: course,
  searchHighlight: mode === "dark" ? "rgba(255, 212, 59, 0.8)" : "rgba(250, 176, 5, 0.8)",
  laser: "#ff2d55",
})

// dark matches the redesign's Graphite board, which dark exports also use
const DEFAULT_SEEDS: Record<Theme, CanvasPaletteSeed> = {
  light: { mode: "light", board: "#ffffff", ink: "#1e1e1e", course: "#6965db" },
  dark: { mode: "dark", board: "#16171a", ink: "#e6e7ea", course: "#7aa2ff" },
}

const defaultPalettes: Partial<Record<Theme, CanvasPalette>> = {}

export const defaultCanvasPalette = (mode: Theme): CanvasPalette => {
  let p = defaultPalettes[mode]
  if (!p) {
    p = Object.freeze(deriveCanvasPalette(DEFAULT_SEEDS[mode]))
    defaultPalettes[mode] = p
  }
  return p
}

/** How an element colour is used: strokes and text are kept legible against the board, fills never are. */
export type ColorRole = "stroke" | "text" | "fill"

/** WCAG contrast a stroke (non-text, 3:1) and text (4.5:1) keep against what is behind them. */
export const STROKE_CONTRAST = 3
export const TEXT_CONTRAST = 4.5

type Rgb = [number, number, number]

const linear = (c: number): number => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of 0..255 channels. */
const luminanceOf = ([r, g, b]: Rgb): number => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)

const ratio = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

/** WCAG contrast ratio of two colours, 1 to 21. Alpha is ignored; an unparseable colour gives 1. */
export const contrastRatio = (a: string, b: string): number => {
  const x = parseColor(a)
  const y = parseColor(b)
  return x && y ? ratio(luminanceOf([x.r, x.g, x.b]), luminanceOf([y.r, y.g, y.b])) : 1
}

/** The HSL lightness at which `h` and `s` have relative luminance `y`. */
const lightnessFor = (h: number, s: number, y: number): number => {
  // at a fixed hue and saturation luminance only rises with lightness, so halving finds the one answer
  let lo = 0
  let hi = 1
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2
    if (luminanceOf(hslToRgb(h, s, mid)) < y) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

const WHITE_LOG_CONTRAST = Math.log(21)
/** Contrast against white that a dark board reproduces exactly; darker colours share what is left. */
const KEPT_CONTRAST = 7

const kneeFor = (boardLog: number): number => Math.max(0, Math.min(Math.log(KEPT_CONTRAST), boardLog - 0.4))

/**
 * Display luminance on a dark board of luminance `board` for a light-authored luminance `l`.
 * A colour keeps the contrast it had on white (up to 7:1), so mid-tones read as well on the dark
 * board as on paper; darker ones are squeezed into the contrast the board has left, white lands
 * on the board itself and black on white.
 */
export const remapLuminance = (l: number, board: number): number => {
  const b = Math.max(0, Math.min(1, board))
  const u = Math.log(1.05 / (Math.max(0, Math.min(1, l)) + 0.05))
  const top = Math.log(1.05 / (b + 0.05))
  const knee = kneeFor(top)
  const v = u <= knee ? u : knee + ((u - knee) * (top - knee)) / (WHITE_LOG_CONTRAST - knee)
  return Math.max(b, Math.min(1, Math.exp(v) * (b + 0.05) - 0.05))
}

/** The light-authored luminance that remapLuminance turns into `l`; at or below the board it is white. */
export const unmapLuminance = (l: number, board: number): number => {
  const b = Math.max(0, Math.min(1, board))
  if (l <= b) return 1
  const v = Math.log((Math.min(1, l) + 0.05) / (b + 0.05))
  const top = Math.log(1.05 / (b + 0.05))
  const knee = kneeFor(top)
  if (top <= knee) return 0
  const u = v <= knee ? v : knee + ((v - knee) * (WHITE_LOG_CONTRAST - knee)) / (top - knee)
  return Math.max(0, Math.min(1, 1.05 / Math.exp(u) - 0.05))
}

const KEYWORDS = new Set(["", "transparent", "none", "currentcolor", "inherit", "initial", "unset"])

const remapDark = (c: ParsedColor, board: ParsedColor | null): Rgb => {
  const boardRgb: Rgb = board ? [board.r, board.g, board.b] : [22, 23, 26]
  const boardY = luminanceOf(boardRgb)
  const y = remapLuminance(luminanceOf([c.r, c.g, c.b]), boardY)
  const [h, s] = rgbToHsl(c.r, c.g, c.b)
  if (s > 0) return hslToRgb(h, s, lightnessFor(h, s, y))
  // greys pick up the board's tint as they approach it, so a white fill reads as board, not grey
  const fade = boardY < 1 ? Math.max(0, 1 - (y - boardY) / (1 - boardY)) : 0
  if (fade >= 1 - 1e-9) return boardRgb
  const [bh, bs] = rgbToHsl(...boardRgb)
  return hslToRgb(bh, bs * fade, lightnessFor(bh, bs * fade, y))
}

/**
 * `rgb` with its lightness moved away from `behind` until the pair reach `target`; hue and
 * saturation stay. A colour that cannot get there on its own side crosses to the other, except
 * that `keepLighter` leaves an ink lighter than what is behind it as it is.
 */
const withContrast = (rgb: Rgb, behind: number, target: number, keepLighter: boolean): Rgb => {
  const y = luminanceOf(rgb)
  if (ratio(y, behind) >= target) return rgb
  // a little headroom keeps the 8-bit rounding of the result on the right side of the line
  const t = target * 1.01
  const darker = (behind + 0.05) / t - 0.05
  const lighter = t * (behind + 0.05) - 0.05
  if (y > behind && lighter > 1 && keepLighter) return rgb
  const goDarker = y <= behind ? darker >= 0 || lighter > 1 : lighter > 1 && darker >= 0
  const want = goDarker ? Math.max(0, darker) : Math.min(1, lighter)
  const [h, s] = rgbToHsl(...rgb)
  return hslToRgb(h, s, lightnessFor(h, s, want))
}

/** Below this contrast with white a light surface counts as white, and inks on it are drawn as authored. */
const NEAR_WHITE_CONTRAST = 1.08

const shownCache = new Map<string, string>()

const shown = (
  color: string,
  theme: Theme,
  board: string,
  role: ColorRole,
  behind: string | null,
): string => {
  const c = parseColor(color)
  if (!c) return color
  let rgb: Rgb = theme === "dark" ? remapDark(c, parseColor(board)) : [c.r, c.g, c.b]
  const under = behind === null ? null : parseColor(behind)
  const underY = under ? luminanceOf([under.r, under.g, under.b]) : 0
  // Excalidraw parity: on a white board the palette is drawn exactly as picked
  const asAuthored = theme === "light" && ratio(underY, 1) < NEAR_WHITE_CONTRAST
  if (under && role !== "fill" && !asAuthored) {
    const target = role === "text" ? TEXT_CONTRAST : STROKE_CONTRAST
    // on a light board, ink lighter than the board was picked for a dark fill it sits on
    rgb = withContrast(rgb, underY, target, theme === "light")
  }
  // a light-mode colour the floor left alone comes back exactly as it was written
  if (theme === "light" && rgb[0] === c.r && rgb[1] === c.g && rgb[2] === c.b) return color
  return formatColor({ r: rgb[0], g: rgb[1], b: rgb[2], a: c.a }, c.notation)
}

/**
 * How an element colour shows on the board. Colours are stored as authored for a light board;
 * dark boards remap them so hue and saturation survive and each keeps the contrast it had on
 * white. Strokes and text then get a display floor of 3:1 and 4.5:1 against `surface` (the board
 * unless given; null when nothing is known to be behind, as in a transparent export). Fills are
 * never floored. On light themes the floor skips a near-white surface, so Whiteboard and High
 * Contrast draw colours as authored, and never darkens an ink lighter than the surface, which is
 * meant for a dark fill. Light-theme colours the floor leaves alone are returned untouched.
 */
export const themeColor = (
  color: string,
  theme: Theme,
  board?: string,
  role: ColorRole = "stroke",
  surface?: string | null,
): string => {
  if (typeof color !== "string") return color
  if (KEYWORDS.has(color.trim().toLowerCase())) return color
  if (theme === "light" && role === "fill") return color
  const boardColor = board ?? DEFAULT_SEEDS[theme === "dark" ? "dark" : "light"].board
  const behind = role === "fill" ? null : surface === undefined ? boardColor : surface
  const key = `${theme}|${boardColor}|${role}|${behind ?? ""}|${color}`
  let out = shownCache.get(key)
  if (out === undefined) {
    out = shown(color, theme, boardColor, role, behind)
    if (shownCache.size > 4096) shownCache.clear()
    shownCache.set(key, out)
  }
  return out
}

const channelError = (a: Rgb, b: Rgb): number =>
  Math.max(
    Math.abs(Math.round(a[0]) - b[0]),
    Math.abs(Math.round(a[1]) - b[1]),
    Math.abs(Math.round(a[2]) - b[2]),
  )

const clampChannel = (v: number): number => Math.max(0, Math.min(255, Math.round(v)))

const storedCache = new Map<string, string>()

/** The 8-bit colour whose dark remap lands nearest `want`. */
const invertDark = (want: Rgb, board: ParsedColor | null): Rgb => {
  const boardRgb: Rgb = board ? [board.r, board.g, board.b] : [22, 23, 26]
  const boardY = luminanceOf(boardRgb)
  const y = unmapLuminance(luminanceOf(want), boardY)
  const [h, s] = rgbToHsl(...want)
  const shownBy = (c: Rgb): number =>
    channelError(remapDark({ r: c[0], g: c[1], b: c[2], a: 1, notation: "hex" }, board), want)
  // a stored grey shows with the board's tint, so a tinted display colour may come from a grey
  let best: Rgb = [0, 0, 0]
  let bestError = Number.POSITIVE_INFINITY
  for (const c of [hslToRgb(h, s, lightnessFor(h, s, y)), hslToRgb(0, 0, lightnessFor(0, 0, y))]) {
    const rounded = c.map(clampChannel) as Rgb
    const e = shownBy(rounded)
    if (e < bestError) {
      best = rounded
      bestError = e
    }
  }
  // dark stored colours have few 8-bit steps of hue, so the nearest one is found by a short local search
  for (let step = 4, reach = 1; bestError > 0 && step > 0; ) {
    let moved = false
    const from = best
    for (let dr = -reach; dr <= reach; dr++)
      for (let dg = -reach; dg <= reach; dg++)
        for (let db = -reach; db <= reach; db++) {
          if (!dr && !dg && !db) continue
          const c: Rgb = [
            clampChannel(from[0] + dr * step),
            clampChannel(from[1] + dg * step),
            clampChannel(from[2] + db * step),
          ]
          const e = shownBy(c)
          if (e < bestError) {
            best = c
            bestError = e
            moved = true
          }
        }
    if (moved) continue
    if (step > 1) step /= 2
    else if (reach < 2) reach = 2
    else step = 0
  }
  return best
}

/**
 * The colour to store so that it shows as `display` under `theme`: the inverse of the dark remap,
 * to the nearest 8-bit colour, so a swatch or typed hex that already reads on the board
 * round-trips. Dark themes give their swatches as on-screen colours, which are stored as their
 * light-mode originals, and a colour picked on a dark board is stored as one with the same
 * contrast on white.
 */
export const storedColorFor = (display: string, theme: Theme, board?: string): string => {
  if (theme === "light" || typeof display !== "string") return display
  if (KEYWORDS.has(display.trim().toLowerCase())) return display
  const c = parseColor(display)
  if (!c) return display
  const boardColor = board ?? DEFAULT_SEEDS.dark.board
  const key = `${boardColor}|${display}`
  let out = storedCache.get(key)
  if (out === undefined) {
    const [r, g, b] = invertDark([c.r, c.g, c.b], parseColor(boardColor))
    out = formatColor({ r, g, b, a: c.a }, c.notation)
    if (storedCache.size > 1024) storedCache.clear()
    storedCache.set(key, out)
  }
  return out
}

const isDefaultBackground = (color: string): boolean => {
  const c = typeof color === "string" ? color.trim().toLowerCase() : ""
  return c === "" || c === "#ffffff" || c === "#fff" || c === "white" || c === "transparent"
}

/** The document background as painted: the theme's board for the default white, otherwise the remapped colour. */
export const canvasBackground = (color: string, theme: Theme, palette?: CanvasPalette): string => {
  const p = palette ?? defaultCanvasPalette(theme)
  if (isDefaultBackground(color)) return p.board
  return theme === "dark" ? themeColor(color, "dark", p.board, "fill") : color
}

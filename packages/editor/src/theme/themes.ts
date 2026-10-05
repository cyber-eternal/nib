import type { CanvasPalette } from "@nib/core"

export type { CanvasPalette }

export type ThemeMode = "light" | "dark"

export type ThemeId =
  | "whiteboard"
  | "blackboard"
  | "graphite"
  | "blueprint"
  | "kraft"
  | "legalpad"
  | "mint"
  | "midnight"
  | "sakura"
  | "contrast"
  | "clay"

export interface ThemeDef {
  id: ThemeId
  name: string
  /** Decides how element colours are remapped on the canvas (AppState.theme). */
  mode: ThemeMode
  board: string
  tray: string
  ink: string
  /** The reserved accent: selection, active tool, binding targets, focus ring, primary button. */
  course: string
  /**
   * Marker caps as they should appear on the board (display colours, not stored element colours).
   * None repeats the course ink: a stroke in it would read as selected and hide the binding highlight.
   */
  caps: readonly [string, string, string, string, string]
  /** Spoken names of the caps, unique within the theme. */
  capNames: readonly [string, string, string, string, string]
  /** 2px seams and a 3px focus ring. */
  highContrast?: boolean
  /** Text and icons on the accent are white; filled accent surfaces deepen until white reads at 4.5:1. */
  whiteOnCourse?: boolean
}

export interface ThemeTokens {
  board: string
  tray: string
  ink: string
  /** Secondary text; at least 4.5:1 on board, tray, surface and surface-2. */
  inkDim: string
  /** Non-text UI (input borders, idle glyphs); at least 3:1 on board, tray and surface. Not for text. */
  inkFaint: string
  seam: string
  seamHi: string
  seamLo: string
  surface: string
  surface2: string
  course: string
  courseInk: string
  /** The accent as a fill under course-ink (primary button, active tool); strokes keep `course`. */
  courseFill: string
  courseSoft: string
  danger: string
  dangerSoft: string
  /** Contrasting partner of course for snap guides and search hits, so they never read as selection. */
  signal: string
  /** Translucent ink washes for hover and press, so they read on board, tray and surface alike. */
  hover: string
  press: string
  /** Dialog backdrop. */
  scrim: string
  shadow1: string
  focus: string
  /** null keeps the stylesheet's one-device-pixel hairline. */
  seamWidth: string | null
  focusWidth: string
}

export const themes: readonly ThemeDef[] = [
  {
    id: "whiteboard",
    name: "Whiteboard",
    mode: "light",
    board: "#FBFBFA",
    tray: "#ECEDEF",
    ink: "#202124",
    // #2F6BFF gave white text on the primary button 4.499:1
    course: "#2D68FA",
    caps: ["#1E1E1E", "#1971C2", "#E03131", "#2F9E44", "#F08C00"],
    capNames: ["Black", "Blue", "Red", "Green", "Orange"],
  },
  {
    id: "blackboard",
    name: "Blackboard",
    mode: "dark",
    board: "#1F2D27",
    tray: "#2A3A33",
    ink: "#EDEFE6",
    course: "#F4D35E",
    caps: ["#F1F3EE", "#F5A742", "#F7A8B8", "#9AD1F5", "#B5E48C"],
    capNames: ["White", "Amber", "Pink", "Blue", "Green"],
  },
  {
    id: "graphite",
    name: "Graphite",
    mode: "dark",
    board: "#16171A",
    tray: "#222428",
    ink: "#E6E7EA",
    course: "#7AA2FF",
    caps: ["#E6E7EA", "#74C0FC", "#FF8787", "#69DB7C", "#FFD43B"],
    capNames: ["White", "Blue", "Red", "Green", "Yellow"],
  },
  {
    id: "blueprint",
    name: "Blueprint",
    mode: "dark",
    board: "#0F3460",
    tray: "#163F72",
    ink: "#E8F1FF",
    course: "#FFD166",
    caps: ["#FFFFFF", "#8BE9FD", "#FFA94D", "#FF9AC1", "#B9F18C"],
    capNames: ["White", "Cyan", "Orange", "Pink", "Green"],
  },
  {
    id: "kraft",
    name: "Kraft",
    mode: "light",
    board: "#D8C29D",
    tray: "#CBB289",
    ink: "#2B2118",
    course: "#9E2F14",
    // the brief's white cap vanished on the other boards and under the dark remap; ochre holds 3.9:1 here
    caps: ["#1E1E1E", "#A8123E", "#1F3A5F", "#2E5E3A", "#7C5300"],
    capNames: ["Black", "Crimson", "Navy", "Green", "Ochre"],
  },
  {
    id: "legalpad",
    name: "Legal Pad",
    mode: "light",
    board: "#FFF4B8",
    tray: "#F2E49A",
    ink: "#2A2A2A",
    course: "#C81E3A",
    caps: ["#1F2A44", "#1E1E1E", "#7F1D1D", "#2F7D32", "#6A1B9A"],
    capNames: ["Navy", "Black", "Dark red", "Green", "Purple"],
  },
  {
    id: "mint",
    name: "Mint",
    mode: "light",
    board: "#EEF6F1",
    tray: "#DCEBE2",
    ink: "#1C2B24",
    course: "#0F7A55",
    caps: ["#1C2B24", "#2F9E44", "#1971C2", "#E03131", "#F08C00"],
    capNames: ["Black", "Green", "Blue", "Red", "Orange"],
  },
  {
    id: "midnight",
    name: "Midnight",
    mode: "dark",
    board: "#0E1424",
    tray: "#18213A",
    ink: "#E7EBF5",
    course: "#FF7A59",
    caps: ["#E7EBF5", "#FF6B8B", "#7AA2FF", "#69DB7C", "#FFD43B"],
    capNames: ["White", "Rose", "Blue", "Green", "Yellow"],
    whiteOnCourse: true,
  },
  {
    id: "sakura",
    name: "Sakura",
    mode: "light",
    board: "#FFF5F7",
    tray: "#F6E1E7",
    ink: "#2E1F24",
    course: "#B0124F",
    caps: ["#2E1F24", "#E64980", "#1971C2", "#2F9E44", "#F08C00"],
    capNames: ["Black", "Pink", "Blue", "Green", "Orange"],
  },
  {
    id: "contrast",
    name: "High Contrast",
    mode: "light",
    board: "#FFFFFF",
    tray: "#FFFFFF",
    ink: "#000000",
    course: "#0040E0",
    caps: ["#000000", "#003A70", "#C00000", "#006B00", "#8A4B00"],
    capNames: ["Black", "Navy", "Red", "Green", "Brown"],
    highContrast: true,
  },
  {
    id: "clay",
    name: "Clay Dark",
    mode: "dark",
    board: "#262624",
    tray: "#30302E",
    ink: "#FAF9F5",
    course: "#D97757",
    caps: ["#FAF9F5", "#6A9BCC", "#D4A27F", "#9AAE76", "#C46686"],
    capNames: ["Ivory", "Sky", "Kraft", "Olive", "Fig"],
    whiteOnCourse: true,
  },
]

export const DEFAULT_THEME_ID: ThemeId = "clay"

/** Prefs key holding a ThemeId or MATCH_SYSTEM. */
export const THEME_PREF_KEY = "nib.theme"
export const MATCH_SYSTEM = "system"
export const SYSTEM_THEMES: Readonly<Record<ThemeMode, ThemeId>> = { light: "whiteboard", dark: "clay" }

const byId = new Map<string, ThemeDef>(themes.map((t) => [t.id, t]))

export const isThemeId = (id: unknown): id is ThemeId => typeof id === "string" && byId.has(id)

/** Unknown ids fall back to the default theme so a stale pref can never leave the UI unthemed. */
export const getTheme = (id: string | null | undefined): ThemeDef =>
  (id ? byId.get(id) : undefined) ?? byId.get(DEFAULT_THEME_ID)!

export const matchSystemTheme = (prefersDark: boolean): ThemeDef =>
  getTheme(SYSTEM_THEMES[prefersDark ? "dark" : "light"])

/** Only an explicit "system" pref follows the OS; a missing pref opens on the default theme. */
export const resolveThemeId = (pref: string | null | undefined, prefersDark: boolean): ThemeId => {
  if (isThemeId(pref)) return pref
  if (pref === MATCH_SYSTEM) return SYSTEM_THEMES[prefersDark ? "dark" : "light"]
  return DEFAULT_THEME_ID
}

export const systemPrefersDark = (): boolean => {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
  } catch {
    return false
  }
}

export const watchSystemDark = (onChange: (dark: boolean) => void): (() => void) => {
  if (typeof matchMedia !== "function") return () => {}
  const mq = matchMedia("(prefers-color-scheme: dark)")
  const listener = (e: MediaQueryListEvent) => onChange(e.matches)
  mq.addEventListener("change", listener)
  return () => mq.removeEventListener("change", listener)
}

type Rgb = [number, number, number]

export const parseHex = (hex: string): Rgb => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) throw new Error(`Not a hex colour: ${hex}`)
  let h = m[1]!
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ]
}

const toHex = (rgb: Rgb): string =>
  `#${rgb
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`

/** Mixes `a` toward `b` by `t` (0 = a, 1 = b) in sRGB. */
export const mix = (a: string, b: string, t: number): string => {
  const x = parseHex(a)
  const y = parseHex(b)
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}

export const withAlpha = (hex: string, alpha: number): string => {
  const [r, g, b] = parseHex(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const channel = (v: number): number => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export const relativeLuminance = (hex: string): number => {
  const [r, g, b] = parseHex(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 2.x contrast ratio, 1..21. */
export const contrastRatio = (a: string, b: string): number => {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const minContrast = (fg: string, bgs: readonly string[]): number =>
  Math.min(...bgs.map((bg) => contrastRatio(fg, bg)))

/** Pushes `fg` toward black or white (away from the backgrounds) until it reaches `min` against all of them. */
export const ensureContrast = (fg: string, bgs: readonly string[], min: number): string => {
  if (minContrast(fg, bgs) >= min) return fg
  const bgLum = bgs.reduce((s, bg) => s + relativeLuminance(bg), 0) / bgs.length
  const target = bgLum > 0.18 ? "#000000" : "#FFFFFF"
  for (let t = 0.02; t <= 1; t += 0.02) {
    const c = mix(fg, target, t)
    if (minContrast(c, bgs) >= min) return c
  }
  return target
}

/** The most muted mix of `fg` toward `toward` that still holds `min` against every background. */
const mutedWithin = (
  fg: string,
  toward: string,
  bgs: readonly string[],
  min: number,
  maxT: number,
): string => {
  for (let t = maxT; t > 0; t -= 0.01) {
    const c = mix(fg, toward, t)
    if (minContrast(c, bgs) >= min) return c
  }
  return fg
}

/** The least mix of `from` toward `to` that stands `ratio` apart from `from`, else `to` itself. */
/** Darkens a fill toward black just until `fg` on it reaches `ratio`; already-passing fills are kept. */
const deepenUnder = (fill: string, fg: string, ratio: number): string => {
  for (let t = 0; t <= 1; t += 0.01) {
    const c = mix(fill, "#000000", t)
    if (contrastRatio(fg, c) >= ratio) return c
  }
  return "#000000"
}

const toward = (from: string, to: string, ratio: number): string => {
  for (let t = 0.01; t <= 1; t += 0.01) {
    const c = mix(from, to, t)
    if (contrastRatio(c, from) >= ratio) return c
  }
  return to
}

const rotateHue = (hex: string, degrees: number): string => {
  const [r, g, b] = parseHex(hex).map((v) => v / 255) as Rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return hex
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (((h * 60 + degrees) % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r1, g1, b1] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return toHex([(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255])
}

const tokenCache = new WeakMap<ThemeDef, ThemeTokens>()

export const deriveTokens = (def: ThemeDef): ThemeTokens => {
  const cached = tokenCache.get(def)
  if (cached) return cached
  const light = def.mode === "light"
  const hc = def.highContrast === true
  const { board, tray, ink, course } = def

  // light themes lift popovers toward paper white; dark themes raise them toward the ink
  const surface = hc ? "#FFFFFF" : light ? mix(board, "#FFFFFF", 0.6) : mix(tray, ink, 0.05)
  const surface2 = mix(surface, ink, light ? 0.05 : 0.07)
  const grounds = [board, tray, surface, surface2]

  // the accessibility theme holds secondary text to AAA and idle glyphs to AA text contrast
  const inkDim = mutedWithin(ink, surface, grounds, hc ? 7.05 : 4.6, 0.6)
  const inkFaint = mutedWithin(ink, surface, [board, tray, surface], hc ? 4.6 : 3.05, 0.8)

  const seam = hc ? ink : mix(ink, tray, light ? 0.86 : 0.84)
  // fainter than this and the tray reads as a floating pill instead of the ledge
  const seamHi = hc ? ink : light ? "#FFFFFF" : toward(tray, "#FFFFFF", 1.45)
  const seamLo = hc ? ink : toward(tray, "#000000", light ? 1.8 : 1.25)

  const whiteOn = contrastRatio("#FFFFFF", course)
  const darkInk = light ? ink : board
  const courseInk = def.whiteOnCourse || whiteOn >= contrastRatio(darkInk, course) ? "#FFFFFF" : darkInk
  const courseFill = courseInk === "#FFFFFF" ? deepenUnder(course, "#FFFFFF", 4.5) : course
  const courseSoft = hc ? mix(course, surface, 0.88) : mix(course, surface, light ? 0.86 : 0.78)

  const dangerBase = light ? "#C92A2A" : "#FF8787"
  const dangerSoft = mix(dangerBase, surface, light ? 0.9 : 0.84)
  const danger = ensureContrast(dangerBase, [...grounds, dangerSoft], 4.6)

  const signal = ensureContrast(rotateHue(course, 150), [board, surface], 3.2)

  const hover = withAlpha(ink, light ? 0.06 : 0.08)
  const press = withAlpha(ink, light ? 0.12 : 0.14)
  const scrim = light ? withAlpha(ink, 0.24) : "rgba(0, 0, 0, 0.55)"
  const shadow1 = light ? `0 4px 16px -2px ${withAlpha(ink, 0.16)}` : "0 6px 20px -2px rgba(0, 0, 0, 0.5)"

  const tokens: ThemeTokens = {
    board,
    tray,
    ink,
    inkDim,
    inkFaint,
    seam,
    seamHi,
    seamLo,
    surface,
    surface2,
    course,
    courseInk,
    courseFill,
    courseSoft,
    danger,
    dangerSoft,
    signal,
    hover,
    press,
    scrim,
    shadow1,
    focus: course,
    seamWidth: hc ? "2px" : null,
    focusWidth: hc ? "3px" : "2px",
  }
  tokenCache.set(def, tokens)
  return tokens
}

/** Custom properties applyTheme writes; tokens.css declares the same names with Whiteboard defaults. */
export const themeCssVars = (def: ThemeDef): Record<string, string> => {
  const t = deriveTokens(def)
  const vars: Record<string, string> = {
    "--board": t.board,
    "--tray": t.tray,
    "--tray-seam-hi": t.seamHi,
    "--tray-seam-lo": t.seamLo,
    "--surface": t.surface,
    "--surface-2": t.surface2,
    "--seam": t.seam,
    "--seam-hi": t.seamHi,
    "--ink": t.ink,
    "--ink-dim": t.inkDim,
    "--ink-faint": t.inkFaint,
    "--course": t.course,
    "--course-ink": t.courseInk,
    "--course-fill": t.courseFill,
    "--course-soft": t.courseSoft,
    "--danger": t.danger,
    "--danger-soft": t.dangerSoft,
    "--signal": t.signal,
    "--hover": t.hover,
    "--press": t.press,
    "--scrim": t.scrim,
    "--shadow-1": t.shadow1,
    "--focus": t.focus,
    "--focus-w": t.focusWidth,
  }
  def.caps.forEach((cap, i) => {
    vars[`--cap-${i + 1}`] = cap
  })
  if (t.seamWidth) vars["--seam-w"] = t.seamWidth
  return vars
}

const OPTIONAL_VARS = ["--seam-w"]

export const applyTheme = (root: HTMLElement, def: ThemeDef): void => {
  const vars = themeCssVars(def)
  for (const name of OPTIONAL_VARS) if (!(name in vars)) root.style.removeProperty(name)
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
  root.style.colorScheme = def.mode
  // a separate attribute from the old shell's data-theme="light|dark", which it still drives
  root.dataset.nibTheme = def.id
  root.dataset.nibMode = def.mode
}

export const canvasPaletteFor = (def: ThemeDef): CanvasPalette => {
  const t = deriveTokens(def)
  const light = def.mode === "light"
  return {
    board: def.board,
    selection: def.course,
    selectionFill: withAlpha(def.course, light ? 0.08 : 0.14),
    binding: withAlpha(def.course, 0.55),
    snapGuide: t.signal,
    frameBorder: mix(def.ink, def.board, def.highContrast ? 0.4 : 0.72),
    frameLabel: t.inkDim,
    gridMinor: withAlpha(def.ink, light ? 0.06 : 0.07),
    gridMajor: withAlpha(def.ink, light ? 0.12 : 0.14),
    correctionFlash: def.course,
    searchHighlight: withAlpha(t.signal, 0.35),
    laser: ensureContrast("#FF2D55", [def.board], 3),
  }
}

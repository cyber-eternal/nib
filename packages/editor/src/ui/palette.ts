/**
 * Element colours as stored in files: authored for a light board. Dark themes remap them on screen
 * (themeColor), so every list here is canonical; ui/style/colors.ts turns them into display swatches.
 */

export interface ColorFamily {
  id: string
  name: string
  /** Five shades, lightest first. */
  shades: readonly [string, string, string, string, string]
  /** Which shade the stroke grid offers. */
  strokeShade: number
  /** Which shade the background grid offers. */
  backgroundShade: number
}

export const COLOR_FAMILIES: readonly ColorFamily[] = [
  {
    id: "gray",
    name: "Grey",
    shades: ["#f8f9fa", "#e9ecef", "#ced4da", "#868e96", "#343a40"],
    strokeShade: 3,
    backgroundShade: 1,
  },
  {
    id: "red",
    name: "Red",
    shades: ["#fff5f5", "#ffc9c9", "#ff8787", "#fa5252", "#e03131"],
    strokeShade: 4,
    backgroundShade: 1,
  },
  {
    id: "pink",
    name: "Pink",
    shades: ["#fff0f6", "#fcc2d7", "#f783ac", "#e64980", "#c2255c"],
    strokeShade: 4,
    backgroundShade: 1,
  },
  {
    id: "grape",
    name: "Grape",
    shades: ["#f8f0fc", "#eebefa", "#da77f2", "#be4bdb", "#9c36b5"],
    strokeShade: 4,
    backgroundShade: 1,
  },
  {
    id: "violet",
    name: "Violet",
    shades: ["#f3f0ff", "#d0bfff", "#9775fa", "#7950f2", "#6741d9"],
    strokeShade: 4,
    backgroundShade: 1,
  },
  {
    id: "blue",
    name: "Blue",
    shades: ["#e7f5ff", "#a5d8ff", "#4dabf7", "#228be6", "#1971c2"],
    strokeShade: 4,
    backgroundShade: 1,
  },
  {
    id: "cyan",
    name: "Cyan",
    shades: ["#e3fafc", "#99e9f2", "#3bc9db", "#15aabf", "#0c8599"],
    strokeShade: 4,
    backgroundShade: 1,
  },
  {
    id: "teal",
    name: "Teal",
    shades: ["#e6fcf5", "#96f2d7", "#38d9a9", "#12b886", "#099268"],
    strokeShade: 4,
    backgroundShade: 1,
  },
  {
    id: "green",
    name: "Green",
    shades: ["#ebfbee", "#b2f2bb", "#69db7c", "#40c057", "#2f9e44"],
    strokeShade: 4,
    backgroundShade: 1,
  },
  {
    id: "yellow",
    name: "Yellow",
    shades: ["#fff9db", "#ffec99", "#ffd43b", "#fab005", "#f08c00"],
    strokeShade: 4,
    backgroundShade: 1,
  },
  {
    id: "orange",
    name: "Orange",
    shades: ["#fff4e6", "#ffd8a8", "#ffa94d", "#fd7e14", "#e8590c"],
    strokeShade: 4,
    backgroundShade: 1,
  },
  {
    id: "bronze",
    name: "Bronze",
    shades: ["#f8f1ee", "#eaddd7", "#d2bab0", "#a18072", "#846358"],
    strokeShade: 4,
    backgroundShade: 1,
  },
]

export const BLACK = "#1e1e1e"
export const WHITE = "#ffffff"
export const TRANSPARENT = "transparent"

/** The 13 stroke hues: black, then one shade per family. */
export const STROKE_PALETTE: readonly string[] = [
  BLACK,
  ...COLOR_FAMILIES.map((f) => f.shades[f.strokeShade]!),
]

/** Transparent, white, then one pale shade per family. */
export const BACKGROUND_PALETTE: readonly string[] = [
  TRANSPARENT,
  WHITE,
  ...COLOR_FAMILIES.map((f) => f.shades[f.backgroundShade]!),
]

/** Canvas colours; the first is the default, which every theme paints as its own board. */
export const CANVAS_PALETTE: readonly string[] = [
  WHITE,
  "#f8f9fa",
  "#f5faff",
  "#fffce8",
  "#fdf8f6",
  "#f1f8f4",
  "#fdf2f6",
]

const familyOf = new Map<string, { family: ColorFamily; shade: number }>()
for (const family of COLOR_FAMILIES) family.shades.forEach((c, shade) => familyOf.set(c, { family, shade }))

const toRgb = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]!
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ]
}

const distance = (a: [number, number, number], b: [number, number, number]): number =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2

/** The family a colour belongs to, or the nearest one, so the shades row always has something to offer. */
export const nearestFamily = (color: string): ColorFamily => {
  const exact = familyOf.get(color.toLowerCase())
  if (exact) return exact.family
  const rgb = toRgb(color)
  if (!rgb) return COLOR_FAMILIES[0]!
  let best = COLOR_FAMILIES[0]!
  let bestD = Number.POSITIVE_INFINITY
  for (const family of COLOR_FAMILIES)
    for (const shade of family.shades) {
      const d = distance(rgb, toRgb(shade)!)
      if (d < bestD) {
        bestD = d
        best = family
      }
    }
  return best
}

const SHADE_WORDS = ["lightest", "light", "medium", "dark", "darkest"]

/** Below this channel spread a colour reads as neutral, whatever its hue. */
const TINT_SPREAD = 6

const hueOf = ([r, g, b]: [number, number, number]): number => {
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d === 0) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}

/** The family whose palest shade has the nearest hue: pale tints are too close to white to go by distance. */
const tintFamily = (rgb: [number, number, number]): ColorFamily => {
  const hue = hueOf(rgb)
  let best = COLOR_FAMILIES[1]!
  let bestD = Number.POSITIVE_INFINITY
  for (const family of COLOR_FAMILIES) {
    if (family.id === "gray") continue
    const d = Math.abs(hueOf(toRgb(family.shades[0])!) - hue)
    const around = Math.min(d, 360 - d)
    if (around < bestD) {
      bestD = around
      best = family
    }
  }
  return best
}

/** A human name for the accessible label: "Red", "Blue, light", "Blue tint", "Black". Never a hex code. */
export const colorName = (color: string): string => {
  const c = color.trim().toLowerCase()
  if (c === TRANSPARENT || c === "") return "Transparent"
  if (c === BLACK || c === "#000000" || c === "#000") return "Black"
  if (c === WHITE || c === "#fff") return "White"
  const exact = familyOf.get(c)
  if (exact) {
    const { family, shade } = exact
    return shade === family.strokeShade ? family.name : `${family.name}, ${SHADE_WORDS[shade]}`
  }
  const rgb = toRgb(c)
  if (!rgb) return "Custom colour"
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
  const spread = Math.max(...rgb) - Math.min(...rgb)
  if (spread < 24) {
    // near-white paper colours (the canvas palette) still have a hue worth naming
    if (lum > 0.9) return spread < TINT_SPREAD ? "White" : `${tintFamily(rgb).name} tint`
    return lum < 0.15 ? "Black" : "Grey"
  }
  return nearestFamily(c).name
}

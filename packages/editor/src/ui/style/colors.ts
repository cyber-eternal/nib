import { type NibElement, canvasBackground, storedColorFor, themeColor } from "@nib/core"
import { canvasPaletteFor } from "../../theme/themes"
import type { ThemeDef } from "../../theme/themes"
import {
  BACKGROUND_PALETTE,
  CANVAS_PALETTE,
  STROKE_PALETTE,
  TRANSPARENT,
  colorName,
  nearestFamily,
} from "../palette"
import { normalizeColor, sameColor } from "./hex"

/** One pickable colour: what the file stores, and what the board shows for it under the current theme. */
export interface Swatch {
  stored: string
  display: string
  name: string
  /** What the canvas paints when the board's contrast floor changes `display`; shown as a dot on the chip. */
  drawn?: string
}

export type ColorTarget = "stroke" | "background" | "canvas"

type ThemeLike = Pick<ThemeDef, "mode" | "board">

/** Fills show as remapped; strokes also get the board's contrast floor, as the canvas draws them. */
export type SwatchRole = "stroke" | "fill"

export const roleFor = (target: ColorTarget): SwatchRole => (target === "background" ? "fill" : "stroke")

/** How a stored element colour looks on this theme's board. */
export const displayColor = (stored: string, theme: ThemeLike, role: SwatchRole = "stroke"): string =>
  themeColor(stored, theme.mode, theme.board, role)

/** The colour to store so the board shows `display`; dark themes keep files light-authored. */
export const storedColor = (display: string, theme: ThemeLike): string =>
  normalizeColor(storedColorFor(display, theme.mode, theme.board))

/** The canvas colour as painted: the default white is the theme's own board. */
export const displayCanvasColor = (stored: string, theme: ThemeDef): string =>
  canvasBackground(stored, theme.mode, canvasPaletteFor(theme))

const fromStored = (stored: string, theme: ThemeLike, role: SwatchRole): Swatch => ({
  stored,
  display: displayColor(stored, theme, role),
  name: colorName(stored),
})

/** The theme's five marker caps, given as display colours, stored canonically (dark themes remap). */
export const themeCapSwatches = (theme: ThemeDef): Swatch[] =>
  theme.caps.map((cap, i) => ({
    stored: storedColor(cap, theme),
    display: cap,
    // the tray speaks these names; palette names collide within a theme ("Grey", "Grey")
    name: theme.capNames[i] ?? colorName(cap),
  }))

export const paletteSwatches = (target: ColorTarget, theme: ThemeDef): Swatch[] => {
  if (target === "canvas")
    return CANVAS_PALETTE.map((c, i) => ({
      stored: c,
      display: displayCanvasColor(c, theme),
      name: i === 0 ? "Theme default" : colorName(c),
    }))
  return (target === "stroke" ? STROKE_PALETTE : BACKGROUND_PALETTE).map((c) =>
    fromStored(c, theme, roleFor(target)),
  )
}

/**
 * A shade shows remapped but unfloored: on tinted and dark boards the floor clamps faint shades to one
 * colour, and the five must stay tellable apart.
 */
const shadeFromStored = (stored: string, theme: ThemeLike, role: SwatchRole): Swatch => {
  if (role === "fill") return fromStored(stored, theme, role)
  const display = themeColor(stored, theme.mode, theme.board, role, null)
  const drawn = displayColor(stored, theme, role)
  return sameColor(drawn, display)
    ? { stored, display, name: colorName(stored) }
    : { stored, display, name: colorName(stored), drawn }
}

/** The five shades of the family the current colour belongs to (or is nearest), lightest first. */
export const shadeSwatches = (
  current: string | null,
  target: Exclude<ColorTarget, "canvas">,
  theme: ThemeDef,
): Swatch[] => {
  const base = current && current !== TRANSPARENT ? current : STROKE_PALETTE[0]!
  return nearestFamily(normalizeColor(base)).shades.map((c) => shadeFromStored(c, theme, roleFor(target)))
}

export const swatchesFor = (colors: readonly string[], target: ColorTarget, theme: ThemeDef): Swatch[] =>
  colors.map((c) =>
    target === "canvas"
      ? { stored: c, display: displayCanvasColor(c, theme), name: colorName(c) }
      : fromStored(c, theme, roleFor(target)),
  )

export const isSelectedSwatch = (swatch: Swatch, current: string | null): boolean =>
  current !== null && sameColor(swatch.stored, current)

export const RECENT_MAX = 8
const RECENT_KEY = "nib.recentColors"

type RecentStore = Record<ColorTarget, string[]>

const emptyRecent = (): RecentStore => ({ stroke: [], background: [], canvas: [] })

let recent: RecentStore | null = null
const recentListeners = new Set<() => void>()

const loadRecent = (): RecentStore => {
  if (recent) return recent
  recent = emptyRecent()
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(RECENT_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<RecentStore>) : null
    for (const k of ["stroke", "background", "canvas"] as const) {
      const list = parsed?.[k]
      if (Array.isArray(list))
        recent[k] = list.filter((c): c is string => typeof c === "string").slice(0, RECENT_MAX)
    }
  } catch {
    // storage blocked or corrupt: recents are a convenience, start empty
  }
  return recent
}

/** Puts `color` first in a most-recent-first list, without duplicates, capped at `max`. */
export const pushRecent = (list: readonly string[], color: string, max = RECENT_MAX): string[] => {
  const c = normalizeColor(color)
  return [c, ...list.filter((x) => !sameColor(x, c))].slice(0, max)
}

export const recentColors = (target: ColorTarget): readonly string[] => loadRecent()[target]

export const rememberColor = (target: ColorTarget, color: string): void => {
  if (color === TRANSPARENT) return
  const store = loadRecent()
  store[target] = pushRecent(store[target], color)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(store))
  } catch {
    // keep the in-memory list
  }
  for (const l of recentListeners) l()
}

export const subscribeRecent = (cb: () => void): (() => void) => {
  recentListeners.add(cb)
  return () => recentListeners.delete(cb)
}

/** Colours already on the canvas for a property, most used first. */
export const sceneColors = (elements: readonly NibElement[], target: "stroke" | "background"): string[] => {
  const counts = new Map<string, number>()
  for (const el of elements) {
    if (el.isDeleted) continue
    const c = normalizeColor(target === "stroke" ? el.strokeColor : el.backgroundColor)
    if (c === TRANSPARENT || c === "") continue
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
}

/** The Recent row: what the user picked last, then colours used on this canvas, never repeating the palette. */
export const recentRow = (
  picked: readonly string[],
  onCanvas: readonly string[],
  exclude: readonly string[],
  max = RECENT_MAX,
): string[] => {
  const out: string[] = []
  for (const c of [...picked, ...onCanvas]) {
    if (out.length >= max) break
    if (out.some((x) => sameColor(x, c)) || exclude.some((x) => sameColor(x, c))) continue
    out.push(normalizeColor(c))
  }
  return out
}

interface EyeDropperLike {
  open(opts?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }>
}

export const eyeDropperSupported = (): boolean => typeof window !== "undefined" && "EyeDropper" in window

/** Samples a colour from anywhere on screen (Chromium's EyeDropper); null when cancelled or unsupported. */
export const pickScreenColor = async (): Promise<string | null> => {
  if (!eyeDropperSupported()) return null
  const Ctor = (window as unknown as { EyeDropper: new () => EyeDropperLike }).EyeDropper
  try {
    const { sRGBHex } = await new Ctor().open()
    return normalizeColor(sRGBHex)
  } catch {
    return null
  }
}

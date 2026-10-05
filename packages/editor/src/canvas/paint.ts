import type { CanvasPalette } from "@nib/core"

/** Everything the static layer's pixels depend on besides the scene itself (which staticVersion covers). */
export interface StaticKey {
  version: number
  width: number
  height: number
  dpr: number
  palette: CanvasPalette | undefined
  /** Bumps when a bitmap finishes decoding. */
  images: number
  /** Bumps when web fonts finish loading. */
  fonts: number
  hiddenFrameLabel: string | null
}

/** Palettes compared by colour, so a parent that derives a fresh object per render does not force repaints. */
export const samePalette = (a: CanvasPalette | undefined, b: CanvasPalette | undefined): boolean => {
  if (a === b) return true
  if (!a || !b) return false
  for (const k of Object.keys(a) as (keyof CanvasPalette)[]) if (a[k] !== b[k]) return false
  return Object.keys(b).length === Object.keys(a).length
}

/** The static layer repaints only when one of these changed, not on hover, marquee or laser frames. */
export const staticKeyChanged = (prev: StaticKey | null, next: StaticKey): boolean =>
  prev === null ||
  prev.version !== next.version ||
  prev.width !== next.width ||
  prev.height !== next.height ||
  prev.dpr !== next.dpr ||
  !samePalette(prev.palette, next.palette) ||
  prev.images !== next.images ||
  prev.fonts !== next.fonts ||
  prev.hiddenFrameLabel !== next.hiddenFrameLabel

export const CORRECTION_FLASH_MS = 150

/** The pencil's correction outline fading out: t runs 0 to 1 over 150ms, and is skipped under reduced motion. */
export const correctionFlashAt = (
  last: { elementId: string; at: number } | null,
  now: number,
  reducedMotion: boolean,
): { elementId: string; t: number } | null => {
  if (!last || reducedMotion) return null
  const t = (now - last.at) / CORRECTION_FLASH_MS
  if (!(t >= 0) || t >= 1) return null
  return { elementId: last.elementId, t }
}

/** Canvas backing-store size for a CSS size at a device pixel ratio; never zero, which would throw. */
export const backingSize = (css: number, dpr: number): number => Math.max(1, Math.round(css * dpr))

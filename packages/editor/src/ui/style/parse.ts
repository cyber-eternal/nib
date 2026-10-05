import { MAX_FONT_SIZE, MAX_GRID_SIZE, MIN_FONT_SIZE, MIN_GRID_SIZE } from "@nib/core"

/** Reads a typed font size: a whole number of pixels within the core's limits, or null. */
export const parseFontSize = (raw: string): number | null => {
  const s = raw.trim().replace(/px$/i, "").trim()
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const n = Math.round(Number(s))
  return n >= MIN_FONT_SIZE && n <= MAX_FONT_SIZE ? n : null
}

/** What a typed grid size means: null hides the grid, a number is clamped to the core's limits. */
export const parseGridSize = (raw: string): { ok: true; size: number | null } | { ok: false } => {
  const s = raw.trim().replace(/px$/i, "").trim()
  if (s === "" || /^off$/i.test(s)) return { ok: true, size: null }
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false }
  return { ok: true, size: Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, Math.round(Number(s)))) }
}

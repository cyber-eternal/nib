import { elementCorners, getElementVisualBounds } from "../geometry/elementBounds"
import { type Bounds, boundsFromPoints, unionBounds } from "../math/bounds"
import type { NibElement } from "../model/types"
import { arrowheadSize } from "./arrowheads"

const finite = (b: Bounds): boolean => b.every(Number.isFinite)

const roughShape = (el: NibElement): boolean =>
  el.type === "rectangle" ||
  el.type === "diamond" ||
  el.type === "ellipse" ||
  el.type === "line" ||
  el.type === "arrow" ||
  el.type === "embeddable"

/** Room above a frame for its name, in scene px at zoom 1; the canvas keeps it constant on screen. */
export const FRAME_LABEL_HEIGHT = 20

/**
 * Everything an element can paint outside its outline: arrowhead wings, freehand ink width,
 * rough jitter and the frame name. Used for viewport culling and export sizing.
 */
export const getElementRenderBounds = (el: NibElement): Bounds => {
  let b: Bounds
  try {
    b = getElementVisualBounds(el)
  } catch {
    b = boundsFromPoints(elementCorners(el))
  }
  if (!finite(b)) b = boundsFromPoints(elementCorners(el))
  const sw = Number.isFinite(el.strokeWidth) ? Math.max(0, el.strokeWidth) : 0
  let pad = 0
  if (roughShape(el) && Number.isFinite(el.roughness)) pad += Math.max(0, el.roughness) * (sw + 4)
  if (el.type === "freedraw") pad += sw * 1.2
  if (el.type === "text") pad += 2
  if (el.type === "arrow" && (el.startArrowhead || el.endArrowhead)) {
    const size = Math.max(
      el.startArrowhead ? arrowheadSize(el.startArrowhead, sw, Number.POSITIVE_INFINITY) : 0,
      el.endArrowhead ? arrowheadSize(el.endArrowhead, sw, Number.POSITIVE_INFINITY) : 0,
    )
    pad += size * 0.5 + sw
  }
  const top = el.type === "frame" ? FRAME_LABEL_HEIGHT : 0
  return [b[0] - pad, b[1] - pad - top, b[2] + pad, b[3] + pad]
}

/** Union of render bounds, skipping elements whose geometry is not finite. */
export const getCommonRenderBounds = (els: readonly NibElement[]): Bounds => {
  let out: Bounds | null = null
  for (const el of els) {
    const b = getElementRenderBounds(el)
    if (!finite(b)) continue
    out = out ? unionBounds(out, b) : b
  }
  return out ?? [0, 0, 0, 0]
}

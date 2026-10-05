import { type Bounds, boundsFromPoints, unionBounds } from "../math/bounds"
import { type Point, rotatePoint } from "../math/vector"
import type { NibElement } from "../model/types"
import { elementCenter, elementOutline } from "./outline"

/** The four rotated corners of the element's own box (not its drawn outline). */
export const elementCorners = (el: NibElement): [Point, Point, Point, Point] => {
  const c = elementCenter(el)
  const raw: Point[] = [
    [el.x, el.y],
    [el.x + el.width, el.y],
    [el.x + el.width, el.y + el.height],
    [el.x, el.y + el.height],
  ]
  return raw.map((p) => rotatePoint(p, c, el.angle)) as [Point, Point, Point, Point]
}

const isPointsElement = (el: NibElement): boolean =>
  el.type === "line" || el.type === "arrow" || el.type === "freedraw"

const isFiniteBounds = (b: Bounds): boolean => b.every((v) => Number.isFinite(v))

/**
 * Axis-aligned box of the element, used for selection frames, snapping and
 * alignment. Lines and strokes use their drawn path, so curves that overshoot
 * their points and rotated lines are boxed tightly.
 */
export const getElementBounds = (el: NibElement): Bounds => {
  if (isPointsElement(el)) {
    const outline = safeOutline(el)
    if (outline.length > 0) {
      const b = boundsFromPoints(outline)
      if (isFiniteBounds(b)) return b
    }
  }
  return boundsFromPoints(elementCorners(el))
}

// zoom-to-fit, export and culling run over every element, so a malformed one must not throw
const safeOutline = (el: NibElement): Point[] => {
  try {
    return elementOutline(el)
  } catch {
    return []
  }
}

/** Axis-aligned box of what is actually drawn, used for export and zoom-to-fit. */
export const getElementVisualBounds = (el: NibElement): Bounds => {
  const outline = safeOutline(el)
  const b = boundsFromPoints(outline.length === 0 ? elementCorners(el) : outline)
  if (!isFiniteBounds(b)) return boundsFromPoints(elementCorners(el))
  const pad = Number.isFinite(el.strokeWidth) ? el.strokeWidth : 0
  return [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad]
}

export const getCommonBounds = (els: readonly NibElement[]): Bounds => {
  if (els.length === 0) return [0, 0, 0, 0]
  return els.map(getElementBounds).reduce(unionBounds)
}

export const getCommonVisualBounds = (els: readonly NibElement[]): Bounds => {
  if (els.length === 0) return [0, 0, 0, 0]
  return els.map(getElementVisualBounds).reduce(unionBounds)
}

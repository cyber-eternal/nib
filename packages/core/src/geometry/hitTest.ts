import type { Bounds } from "../math/bounds"
import { boundsContainBounds, boundsFromPoints, boundsIntersect, expandBounds } from "../math/bounds"
import {
  type Point,
  distanceToSegment,
  rotatePoint,
  segmentIntersection,
  segmentToSegmentDistance,
} from "../math/vector"
import type { AppState, NibElement } from "../model/types"
import { getElementBounds } from "./elementBounds"
import { elementCenter, elementOutline, isClosedShape } from "./outline"

export const pointInPolygon = (p: Point, poly: readonly Point[]): boolean => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside
  }
  return inside
}

export const distanceToPolyline = (p: Point, poly: readonly Point[], closed: boolean): number => {
  if (poly.length === 0) return Number.POSITIVE_INFINITY
  if (poly.length === 1) return Math.hypot(p[0] - poly[0]![0], p[1] - poly[0]![1])
  let best = Number.POSITIVE_INFINITY
  const n = closed ? poly.length : poly.length - 1
  for (let i = 0; i < n; i++) {
    const d = distanceToSegment(p, poly[i]!, poly[(i + 1) % poly.length]!)
    if (d < best) best = d
  }
  return best
}

/**
 * True when `p` is inside the element or within `threshold` of its outline.
 * Binding uses this rather than the stroke test, because people start arrows
 * from the middle of a shape whether or not it has a fill.
 */
export const isNearElement = (el: NibElement, p: Point, threshold: number): boolean => {
  if (el.isDeleted) return false
  const outline = elementOutline(el)
  if (outline.length < 2) return false
  if (pointInPolygon(p, outline)) return true
  return distanceToPolyline(p, outline, true) <= threshold
}

export const isFilled = (el: NibElement): boolean =>
  el.backgroundColor !== "transparent" && el.backgroundColor !== ""

/**
 * A shape is hit near its stroke; only filled shapes are hit in their interior.
 * Frames are the exception: their interior is never a hit target so that
 * elements inside stay clickable.
 */
export const hitTestElement = (el: NibElement, p: Point, tolerance: number): boolean => {
  if (el.isDeleted) return false
  const outline = elementOutline(el)
  if (outline.length === 0) return false
  const tol = tolerance + el.strokeWidth / 2
  const closed = isClosedShape(el)

  // only the ink is painted, whatever backgroundColor says, so only the ink is hit
  if (el.type === "freedraw") return distanceToPolyline(p, outline, false) <= tol + 4
  if (el.type === "image" || el.type === "embeddable") {
    return pointInPolygon(p, outline) || distanceToPolyline(p, outline, true) <= tol
  }
  if (el.type === "text") {
    return pointInPolygon(p, outline) || distanceToPolyline(p, outline, true) <= tol
  }
  if (el.type === "frame") {
    // header strip plus border, so the frame can be grabbed without hitting children
    const b = getElementBounds(el)
    const headerHit = p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] - 26 && p[1] <= b[1]
    return headerHit || distanceToPolyline(p, outline, true) <= tol + 2
  }
  if (distanceToPolyline(p, outline, closed) <= tol) return true
  return closed && isFilled(el) && pointInPolygon(p, outline)
}

export const hitTestElementBox = (el: NibElement, p: Point, tolerance = 0): boolean => {
  const local = rotatePoint(p, elementCenter(el), -el.angle)
  return (
    local[0] >= el.x - tolerance &&
    local[0] <= el.x + el.width + tolerance &&
    local[1] >= el.y - tolerance &&
    local[1] <= el.y + el.height + tolerance
  )
}

/**
 * True when the segment a-b passes over the element's hit area, so a fast
 * eraser stroke catches everything between two pointer samples.
 */
export const segmentHitsElement = (a: Point, b: Point, el: NibElement, tolerance: number): boolean => {
  if (el.isDeleted) return false
  if (hitTestElement(el, a, tolerance) || hitTestElement(el, b, tolerance)) return true
  const outline = elementOutline(el)
  if (outline.length === 0) return false
  const tol = tolerance + el.strokeWidth / 2 + (el.type === "freedraw" ? 4 : 0)
  if (!boundsIntersect(expandBounds(boundsFromPoints([a, b]), tol), boundsFromPoints(outline))) return false
  if (outline.length === 1) return distanceToSegment(outline[0]!, a, b) <= tol
  const closed = isClosedShape(el)
  const n = closed ? outline.length : outline.length - 1
  for (let i = 0; i < n; i++) {
    if (segmentToSegmentDistance(a, b, outline[i]!, outline[(i + 1) % outline.length]!) <= tol) return true
  }
  return false
}

/** Topmost element under `p`, honouring z-order, locks and frame membership. */
export const elementAtPoint = (
  elements: readonly NibElement[],
  p: Point,
  zoom: number,
  appState: Pick<AppState, "editingGroupId">,
  opts: { includeLocked?: boolean } = {},
): NibElement | null => {
  const tolerance = 10 / zoom
  const skipLocked = !opts.includeLocked
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]!
    if (el.isDeleted || (skipLocked && el.locked)) continue
    if (appState.editingGroupId && !el.groupIds.includes(appState.editingGroupId)) continue
    if (!hitTestElement(el, p, tolerance)) continue
    // a label belongs to its container, so clicking the words grabs the shape
    if (el.type === "text" && el.containerId) {
      const container = elements.find(
        (c) => c.id === el.containerId && !c.isDeleted && !(skipLocked && c.locked),
      )
      if (container) return container
      continue
    }
    return el
  }
  return null
}

/**
 * Topmost element whose box contains `p` and that can carry a label. Uses the
 * box rather than the stroke so double-clicking inside an unfilled shape
 * labels it, which is what people expect. Open lines and arrows have no inside,
 * so they only count within `tolerance` of their stroke; closed lines count inside.
 */
export const labelContainerAtPoint = (
  elements: readonly NibElement[],
  p: Point,
  canLabel: (el: NibElement) => boolean,
  tolerance = 10,
): NibElement | null => {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]!
    if (el.isDeleted || el.locked || el.type === "frame") continue
    if (!canLabel(el)) continue
    if (el.type === "line" && el.polygon) {
      if (pointInPolygon(p, elementOutline(el)) || hitTestElement(el, p, tolerance)) return el
      continue
    }
    if (el.type === "line" || el.type === "arrow" || el.type === "freedraw") {
      if (hitTestElement(el, p, tolerance)) return el
      continue
    }
    if (hitTestElementBox(el, p)) return el
  }
  return null
}

/** Labels whose container is present travel with it, so selection skips them. */
const isAttachedLabel = (el: NibElement, ids: ReadonlySet<string>): boolean =>
  el.type === "text" && !!el.containerId && ids.has(el.containerId)

const liveIds = (elements: readonly NibElement[]): Set<string> =>
  new Set(elements.filter((e) => !e.isDeleted).map((e) => e.id))

export const elementsInBounds = (elements: readonly NibElement[], b: Bounds): NibElement[] => {
  const ids = liveIds(elements)
  return elements.filter(
    (el) =>
      !el.isDeleted &&
      !el.locked &&
      !isAttachedLabel(el, ids) &&
      boundsContainBounds(b, getElementBounds(el)),
  )
}

const polylineCrossesPolygon = (line: readonly Point[], closed: boolean, poly: readonly Point[]): boolean => {
  const n = closed ? line.length : line.length - 1
  for (let i = 0; i < n; i++) {
    const a = line[i]!
    const b = line[(i + 1) % line.length]!
    for (let j = 0; j < poly.length; j++) {
      if (segmentIntersection(a, b, poly[j]!, poly[(j + 1) % poly.length]!)) return true
    }
  }
  return false
}

/**
 * Lasso selection: an element is caught when part of its outline is inside the
 * loop or its stroke crosses the loop, and a filled shape also when the loop is
 * drawn inside it.
 */
export const elementsInLasso = (elements: readonly NibElement[], lasso: readonly Point[]): NibElement[] => {
  if (lasso.length < 3) return []
  const ids = liveIds(elements)
  const lassoBounds = boundsFromPoints(lasso)
  return elements.filter((el) => {
    if (el.isDeleted || el.locked) return false
    if (isAttachedLabel(el, ids)) return false
    const outline = elementOutline(el)
    if (outline.length === 0) return false
    if (!boundsIntersect(lassoBounds, boundsFromPoints(outline))) return false
    if (outline.some((p) => pointInPolygon(p, lasso))) return true
    const closed = isClosedShape(el)
    if (outline.length > 1 && polylineCrossesPolygon(outline, closed, lasso)) return true
    return closed && el.type !== "frame" && isFilled(el) && pointInPolygon(lasso[0]!, outline)
  })
}

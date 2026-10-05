import { type Point, rotatePoint } from "../math/vector"
import { mutateElement } from "../model/element"

export type PointsElement = {
  x: number
  y: number
  width: number
  height: number
  angle?: number
  points: readonly Point[]
}

type PointsLike = {
  x: number
  y: number
  points: readonly Point[]
  width?: number
  height?: number
  angle?: number
}

const centreOf = (el: PointsLike): Point => [el.x + (el.width ?? 0) / 2, el.y + (el.height ?? 0) / 2]

/** Scene-space points exactly as drawn, with the element's rotation applied about its box centre. */
export const absolutePointsOf = (el: PointsLike): Point[] => {
  const angle = el.angle ?? 0
  if (!angle) return el.points.map((p): Point => [el.x + p[0], el.y + p[1]])
  const c = centreOf(el)
  return el.points.map((p) => rotatePoint([el.x + p[0], el.y + p[1]], c, angle))
}

/** A scene point in the element's own (unrotated) point space, relative to x/y. */
export const sceneToLocalPoint = (el: PointsLike, p: Point): Point => {
  const angle = el.angle ?? 0
  const local = angle ? rotatePoint(p, centreOf(el), -angle) : p
  return [local[0] - el.x, local[1] - el.y]
}

/**
 * Re-anchors a points-based element so x/y is the top-left of what it actually
 * draws and every point is relative to that corner. `absolute` are the scene
 * points to draw (rotation applied), so a rotated element keeps its angle and
 * still draws exactly those points.
 *
 * Keeping points[0] at the origin instead, as an earlier version did, left x/y
 * pointing at the first point rather than at the bounding box. An arrow drawn
 * right-to-left then reported a box mirrored onto the wrong side, which threw
 * off the selection frame, marquee hits, alignment and zoom-to-fit.
 */
export const rebaseFromPoints = <T extends PointsElement>(el: T, absolute: readonly Point[]): T => {
  if (absolute.length === 0) return el
  return mutateElement(el as never, rebasePatch(el, absolute, el.angle ?? 0) as never) as T
}

const rebasePatch = (el: PointsElement, absolute: readonly Point[], angle: number) => {
  const pivot = centreOf(el)
  const local = angle ? absolute.map((p) => rotatePoint(p, pivot, -angle)) : absolute
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of local) {
    if (p[0] < minX) minX = p[0]
    if (p[1] < minY) minY = p[1]
    if (p[0] > maxX) maxX = p[0]
    if (p[1] > maxY) maxY = p[1]
  }
  const width = maxX - minX
  const height = maxY - minY
  // the new box rotates about its own centre, so place that centre where the pivot frame puts it
  const centre = angle ? rotatePoint([minX + width / 2, minY + height / 2], pivot, angle) : null
  return {
    x: centre ? centre[0] - width / 2 : minX,
    y: centre ? centre[1] - height / 2 : minY,
    width,
    height,
    points: local.map((p): Point => [p[0] - minX, p[1] - minY]),
  }
}

/** The same drawing with its rotation folded into the points and `angle` reset to 0. */
export const bakeRotation = <T extends PointsElement>(el: T): T => {
  if (!el.angle || el.points.length === 0) return el
  return mutateElement(el as never, { ...rebasePatch(el, absolutePointsOf(el), 0), angle: 0 } as never) as T
}

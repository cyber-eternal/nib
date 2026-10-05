import { type Bounds, boundsFromPoints, boundsIntersect, expandBounds, unionBounds } from "../math/bounds"
import type { Point } from "../math/vector"
import { type NibElement, isBindableElement } from "../model/types"
import { attachAlongRay } from "./binding"
import { routeCrossesBoxes, routeElbow } from "./elbow"
import { getElementBounds } from "./elementBounds"

/** Clearance kept between a routed connector and the shapes it goes around. */
export const OBSTACLE_PADDING = 16
/** How far beyond its ends and shapes a route may detour, which bounds the obstacle search. */
export const OBSTACLE_REACH = 200

/**
 * Padded boxes of the shapes near a connector that its route should go around: every live
 * shape (not frames or labels) close to `ends` and to the `skip` elements, which are the
 * connector itself and the shapes it joins.
 */
export const connectorObstacles = (
  elements: readonly NibElement[],
  ends: readonly Point[],
  skip: ReadonlySet<string>,
): Bounds[] => {
  let area = boundsFromPoints(ends)
  for (const el of elements)
    if (skip.has(el.id) && !el.isDeleted && isBindableElement(el))
      area = unionBounds(area, getElementBounds(el))
  area = expandBounds(area, OBSTACLE_REACH)
  const out: Bounds[] = []
  for (const el of elements) {
    if (el.isDeleted || skip.has(el.id) || !isBindableElement(el) || el.type === "frame") continue
    if (el.type === "text" && el.containerId) continue
    const b = getElementBounds(el)
    if (boundsIntersect(b, area)) out.push(expandBounds(b, OBSTACLE_PADDING))
  }
  return out
}

/** Below this the shapes barely face each other and a straight run looks wrong. */
export const MIN_FACING_OVERLAP = 12

const overlap = (a0: number, a1: number, b0: number, b1: number): [number, number] | null => {
  const lo = Math.max(a0, b0)
  const hi = Math.min(a1, b1)
  return hi - lo >= MIN_FACING_OVERLAP ? [lo, hi] : null
}

const centreOf = (b: Bounds): Point => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]

/**
 * Where the axis-aligned ray from `outside` toward `inside` meets the real
 * outline of `el`, `gap` short of it. Falls back to the box edge plus the gap
 * when the outline is only grazed.
 */
const edgePoint = (el: NibElement, outside: Point, inside: Point, boxEdge: Point, gap: number): Point => {
  const hit = attachAlongRay(el, outside, inside, gap)
  if (hit) return hit
  const dx = Math.sign(outside[0] - inside[0])
  const dy = Math.sign(outside[1] - inside[1])
  return [boxEdge[0] + dx * gap, boxEdge[1] + dy * gap]
}

/**
 * A straight run between two shapes when their boxes face each other, otherwise
 * null. The line sits in the middle of the overlapping band and stops `gap`
 * short of each real outline. Shapes too close for both gaps get null too, so
 * the run never points backwards.
 */
export const straightRun = (
  a: NibElement,
  b: NibElement,
  startGap: number,
  endGap: number,
): [Point, Point] | null => {
  const ab = getElementBounds(a)
  const bb = getElementBounds(b)

  const run = (axis: 0 | 1, at: number, forward: boolean): [Point, Point] | null => {
    const pt = (along: number): Point => (axis === 0 ? [along, at] : [at, along])
    const aNear = forward ? ab[axis + 2]! : ab[axis]!
    const aFar = forward ? ab[axis]! : ab[axis + 2]!
    const bNear = forward ? bb[axis]! : bb[axis + 2]!
    const bFar = forward ? bb[axis + 2]! : bb[axis]!
    const start = edgePoint(a, pt(bNear), pt(aFar), pt(aNear), startGap)
    const end = edgePoint(b, pt(aNear), pt(bFar), pt(bNear), endGap)
    const length = (end[axis]! - start[axis]!) * (forward ? 1 : -1)
    return length > 0 ? [start, end] : null
  }

  const vertical = overlap(ab[1], ab[3], bb[1], bb[3])
  if (vertical) {
    const y = (vertical[0] + vertical[1]) / 2
    if (bb[0] >= ab[2]) return run(0, y, true)
    if (ab[0] >= bb[2]) return run(0, y, false)
  }

  const horizontal = overlap(ab[0], ab[2], bb[0], bb[2])
  if (horizontal) {
    const x = (horizontal[0] + horizontal[1]) / 2
    if (bb[1] >= ab[3]) return run(1, x, true)
    if (ab[1] >= bb[3]) return run(1, x, false)
  }

  return null
}

/**
 * An L-shaped orthogonal connector for shapes that do not face each other. It
 * always leaves the source on the side pointing at the target and arrives on
 * the target's facing side, which is what makes the bend read as deliberate.
 * Both ends sit `gap` short of the real outlines.
 */
export const orthogonalConnector = (
  a: NibElement,
  b: NibElement,
  startGap: number,
  endGap: number,
): Point[] => {
  const ab = getElementBounds(a)
  const bb = getElementBounds(b)
  const ac = centreOf(ab)
  const bc = centreOf(bb)
  const dx = bc[0] - ac[0]
  const dy = bc[1] - ac[1]

  if (Math.abs(dx) >= Math.abs(dy)) {
    // leave sideways, arrive from above or below
    const sideX = dx > 0 ? ab[2] : ab[0]
    const outX = dx > 0 ? ab[2] + 1 : ab[0] - 1
    const start = edgePoint(a, [outX, ac[1]], ac, [sideX, ac[1]], startGap)
    const topY = dy > 0 ? bb[1] : bb[3]
    const outY = dy > 0 ? bb[1] - 1 : bb[3] + 1
    const end = edgePoint(b, [bc[0], outY], bc, [bc[0], topY], endGap)
    return [start, [end[0], start[1]], end]
  }

  // leave vertically, arrive from the left or right
  const sideY = dy > 0 ? ab[3] : ab[1]
  const outY = dy > 0 ? ab[3] + 1 : ab[1] - 1
  const start = edgePoint(a, [ac[0], outY], ac, [ac[0], sideY], startGap)
  const sideX = dx > 0 ? bb[0] : bb[2]
  const outX = dx > 0 ? bb[0] - 1 : bb[2] + 1
  const end = edgePoint(b, [outX, bc[1]], bc, [sideX, bc[1]], endGap)
  return [start, [start[0], end[1]], end]
}

/**
 * Straight where the shapes line up, a single clean bend where they do not.
 * When that simple route would cut through one of `obstacles`, it detours
 * around them instead.
 */
export const connectorBetween = (
  a: NibElement,
  b: NibElement,
  startGap: number,
  endGap: number,
  obstacles: readonly Bounds[] = [],
): Point[] => {
  const simple = straightRun(a, b, startGap, endGap) ?? orthogonalConnector(a, b, startGap, endGap)
  if (obstacles.length === 0 || !routeCrossesBoxes(simple, obstacles)) return simple
  return routeElbow(simple[0]!, simple[simple.length - 1]!, a, b, { obstacles })
}

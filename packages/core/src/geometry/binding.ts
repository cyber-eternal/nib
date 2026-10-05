import { type Bounds, expandBounds } from "../math/bounds"
import { type Point, clamp, distance, normalize, rotatePoint, segmentIntersection, sub } from "../math/vector"
import { mutateElement } from "../model/element"
import type { ArrowElement, BoundElementRef, NibElement, PointBinding } from "../model/types"
import { isBindableElement } from "../model/types"
import { getElementBounds } from "./elementBounds"
import { distanceToPolyline, isNearElement, pointInPolygon } from "./hitTest"
import { absolutePointsOf, rebaseFromPoints } from "./linear"
import { elementCenter, elementOutline } from "./outline"

export const BINDING_HIGHLIGHT_GAP = 4
export const MIN_BINDING_GAP = 4
export const MAX_BINDING_GAP = 32
/** How far outside a shape the pointer still counts as "aiming at it". */
export const BINDING_THRESHOLD = 16
/** How deep inside a shape, as a share of its half-span, a dropped tip pins to that exact spot. */
export const FIXED_BINDING_DEPTH = 0.25
/** Never less than this deep, so a tip dropped on a small shape still binds to its outline. */
export const MIN_FIXED_BINDING_DEPTH = 8

export const bindableElementAt = (
  elements: readonly NibElement[],
  p: Point,
  zoom: number,
  excludeId?: string,
  threshold = BINDING_THRESHOLD,
): NibElement | null => {
  const tol = threshold / zoom
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]!
    if (el.isDeleted || el.locked || el.id === excludeId) continue
    if (!isBindableElement(el) || el.type === "frame") continue
    // labels belong to their container, which is the thing worth binding to
    if (el.type === "text" && el.containerId) continue
    if (isNearElement(el, p, tol)) return el
  }
  return null
}

const halfSpan = (el: NibElement): number => Math.max(1, Math.min(el.width, el.height) / 2)

/** Signed perpendicular offset of the shape centre from the arrow's line, normalised. */
const computeFocus = (el: NibElement, from: Point, to: Point): number => {
  const dir = normalize(sub(to, from))
  if (dir[0] === 0 && dir[1] === 0) return 0
  const c = elementCenter(el)
  const perp: Point = [-dir[1], dir[0]]
  const d = (c[0] - from[0]) * perp[0] + (c[1] - from[1]) * perp[1]
  return clamp(-d / halfSpan(el), -1, 1)
}

/**
 * Point inside the shape that the arrow aims at, given its focus offset. The
 * offset is clamped to the shape so a ray toward it always reaches the outline,
 * which matters near the tips of diamonds and thin ellipses.
 */
const focusPoint = (el: NibElement, focus: number, from: Point, outline: readonly Point[]): Point => {
  const c = elementCenter(el)
  if (!focus) return c
  const dir = normalize(sub(c, from))
  const perp: Point = [-dir[1], dir[0]]
  const off = focus * halfSpan(el)
  const aim: Point = [c[0] + perp[0] * off, c[1] + perp[1] * off]
  if (pointInPolygon(aim, outline)) return aim
  const edge = intersectPolygon(outline, c, aim)
  if (!edge) return c
  const reach = distance(c, edge) * 0.95
  const sign = off < 0 ? -1 : 1
  return [c[0] + perp[0] * reach * sign, c[1] + perp[1] * reach * sign]
}

const intersectPolygon = (outline: readonly Point[], from: Point, aim: Point): Point | null => {
  if (outline.length < 2) return null
  // extend past the aim so the ray always reaches the far side
  const far: Point = [aim[0] + (aim[0] - from[0]) * 4, aim[1] + (aim[1] - from[1]) * 4]
  let best: Point | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!
    const b = outline[(i + 1) % outline.length]!
    const hit = segmentIntersection(from, far, a, b)
    if (!hit) continue
    const d = distance(from, hit)
    if (d < bestDist) {
      bestDist = d
      best = hit
    }
  }
  return best
}

/** Where a ray from `from` toward `aim` leaves the shape outline. */
export const intersectOutline = (el: NibElement, from: Point, aim: Point): Point | null =>
  intersectPolygon(elementOutline(el), from, aim)

/**
 * Backs off from `hit` toward `from` until the point is `gap` away from the
 * outline itself, not just `gap` along the ray, so grazing arrows keep a gap.
 */
const backOffToGap = (outline: readonly Point[], from: Point, hit: Point, requested: number): Point => {
  const gap = Number.isFinite(requested) ? requested : MIN_BINDING_GAP
  const dir = normalize(sub(hit, from))
  const at = (s: number): Point => [hit[0] - dir[0] * s, hit[1] - dir[1] * s]
  const room = distance(from, hit)
  if (gap <= 0 || pointInPolygon(from, outline) || room <= gap) return at(gap)
  const dist = (s: number): number => distanceToPolyline(at(s), outline, true)
  if (dist(gap) >= gap - 0.01) return at(gap)
  let lo = gap
  let hi = Math.min(gap * 12, room - 0.5)
  if (hi <= lo || dist(hi) <= gap) return at(Math.max(lo, hi))
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (dist(mid) < gap) lo = mid
    else hi = mid
  }
  return at(hi)
}

/**
 * The point `gap` short of where a ray from `from` toward `aim` first meets the
 * outline of `shape`, or null when the ray misses it.
 */
export const attachAlongRay = (shape: NibElement, from: Point, aim: Point, gap: number): Point | null => {
  const outline = elementOutline(shape)
  const hit = intersectPolygon(outline, from, aim)
  return hit ? backOffToGap(outline, from, hit, gap) : null
}

/**
 * Where an arrow end bound with `binding` sits when the rest of the arrow
 * approaches from `neighbour`. Shared by the live hint and the committed arrow.
 */
export const solveEndpoint = (
  binding: Pick<PointBinding, "focus" | "gap" | "fixedPoint">,
  shape: NibElement,
  neighbour: Point,
): Point | null => {
  const fixed = validFixedPoint(binding.fixedPoint)
  if (fixed) return fromFixedPoint(shape, fixed)
  const outline = elementOutline(shape)
  if (outline.length < 2) return null
  let aim = focusPoint(shape, binding.focus, neighbour, outline)
  let hit = intersectPolygon(outline, neighbour, aim)
  if (!hit && binding.focus) {
    aim = elementCenter(shape)
    hit = intersectPolygon(outline, neighbour, aim)
  }
  if (!hit) return null
  return backOffToGap(outline, neighbour, hit, binding.gap)
}

/**
 * True when `tip` sits deep enough inside `shape` (FIXED_BINDING_DEPTH of its
 * half-span from the outline, and at least MIN_FIXED_BINDING_DEPTH) that the
 * arrow should pin to that spot rather than stop at the outline.
 */
export const isFixedBindingPoint = (shape: NibElement, tip: Point, depth = FIXED_BINDING_DEPTH): boolean => {
  const outline = elementOutline(shape)
  if (outline.length < 3 || !pointInPolygon(tip, outline)) return false
  return distanceToPolyline(tip, outline, true) >= Math.max(depth * halfSpan(shape), MIN_FIXED_BINDING_DEPTH)
}

export interface BindingOptions {
  /** Pin an end dropped deep inside the shape to that spot (see isFixedBindingPoint). */
  allowFixed?: boolean
}

/**
 * The point on `shape` an arrow coming from `from` would attach to. Pass the
 * tip the arrow would end at, so the dot matches the committed endpoint;
 * without it the arrow aims at the centre.
 */
export const previewAttachPoint = (
  shape: NibElement,
  from: Point,
  tip?: Point,
  opts: BindingOptions = {},
): Point | null => {
  if (tip && opts.allowFixed && isFixedBindingPoint(shape, tip)) return tip
  const target = tip ?? elementCenter(shape)
  const binding = {
    focus: computeFocus(shape, from, target),
    gap: tip ? gapFor(shape, tip) : MIN_BINDING_GAP,
  }
  return solveEndpoint(binding, shape, from)
}

/**
 * Binding for the `end` of `arrow` on `shape`. `gap` overrides the gap measured
 * from the tip. With `allowFixed`, a tip dropped deep inside the shape is
 * pinned there through `fixedPoint`.
 */
export const createBinding = (
  shape: NibElement,
  arrow: ArrowElement,
  end: "start" | "end",
  gap?: number,
  opts: BindingOptions = {},
): PointBinding => {
  const abs = arrowAbsolutePoints(arrow)
  const tip = end === "start" ? abs[0]! : abs[abs.length - 1]!
  const neighbour = end === "start" ? (abs[1] ?? abs[0]!) : (abs[abs.length - 2] ?? tip)
  const focus = computeFocus(shape, neighbour, tip)
  if (opts.allowFixed && isFixedBindingPoint(shape, tip))
    return { elementId: shape.id, focus, gap: gap ?? MIN_BINDING_GAP, fixedPoint: toFixedPoint(shape, tip) }
  return { elementId: shape.id, focus, gap: gap ?? gapFor(shape, tip) }
}

/** A binding pinned to `p` in the shape's own frame, so it follows moves, resizes and rotation. */
export const createFixedBinding = (shape: NibElement, p: Point): PointBinding => ({
  elementId: shape.id,
  focus: 0,
  gap: MIN_BINDING_GAP,
  fixedPoint: toFixedPoint(shape, p),
})

/**
 * How far short of the shape the arrow should stop. Dragging the tip inside the
 * shape means "touch it", so that collapses to the minimum rather than to the
 * distance from the tip out to the border.
 */
const gapFor = (shape: NibElement, tip: Point): number => {
  const outline = elementOutline(shape)
  if (outline.length < 2) return MIN_BINDING_GAP
  if (pointInPolygon(tip, outline)) return MIN_BINDING_GAP
  return clamp(distanceToPolyline(tip, outline, true), MIN_BINDING_GAP, MAX_BINDING_GAP)
}

/** Scene-space points of a linear element, rotation applied. */
export const arrowAbsolutePoints = (el: {
  x: number
  y: number
  points: readonly Point[]
  width?: number
  height?: number
  angle?: number
}): Point[] => absolutePointsOf(el)

/**
 * Recompute both endpoints of `arrow` from its bindings. The neighbouring point
 * is the aim origin so the arrow always points at the shape it is attached to.
 */
export const updateBoundArrow = (
  arrow: ArrowElement,
  getElement: (id: string) => NibElement | undefined,
): ArrowElement => {
  if (!arrow.startBinding && !arrow.endBinding) return arrow
  const abs = arrowAbsolutePoints(arrow)
  if (abs.length < 2) return arrow

  const shapeFor = (binding: PointBinding | null): NibElement | null => {
    const shape = binding ? getElement(binding.elementId) : undefined
    return shape && !shape.isDeleted ? shape : null
  }
  const pinned = (binding: PointBinding | null): Point | null => {
    const shape = shapeFor(binding)
    const fixed = validFixedPoint(binding?.fixedPoint)
    return shape && fixed ? fromFixedPoint(shape, fixed) : null
  }
  const solve = (binding: PointBinding | null, neighbour: Point): Point | null => {
    const shape = shapeFor(binding)
    return binding && shape ? solveEndpoint(binding, shape, neighbour) : null
  }

  const last = abs.length - 1
  const next = [...abs]
  // pinned ends are known outright, so an outline end aims from where they now are
  const pinnedStart = pinned(arrow.startBinding)
  const pinnedEnd = pinned(arrow.endBinding)
  if (pinnedStart) next[0] = pinnedStart
  if (pinnedEnd) next[last] = pinnedEnd
  const newStart = pinnedStart ? null : solve(arrow.startBinding, next[1]!)
  const newEnd = pinnedEnd ? null : solve(arrow.endBinding, next[last - 1]!)
  if (!pinnedStart && !pinnedEnd && !newStart && !newEnd) return arrow

  if (newStart) next[0] = newStart
  if (newEnd) next[last] = newEnd
  return rebaseFromPoints(arrow, next)
}

/** Every arrow bound to any of `ids`, refreshed. */
export const updateArrowsBoundTo = (
  ids: ReadonlySet<string>,
  elements: readonly NibElement[],
  getElement: (id: string) => NibElement | undefined,
): NibElement[] => {
  const out: NibElement[] = []
  for (const el of elements) {
    if (el.type !== "arrow" || el.isDeleted) continue
    const boundToMoved =
      (el.startBinding && ids.has(el.startBinding.elementId)) ||
      (el.endBinding && ids.has(el.endBinding.elementId))
    if (!boundToMoved) continue
    const updated = updateBoundArrow(el, getElement)
    if (updated !== el) out.push(updated)
  }
  return out
}

export const addBoundElement = (el: NibElement, ref: BoundElementRef): NibElement => {
  const existing = el.boundElements ?? []
  if (existing.some((b) => b.id === ref.id)) return el
  return mutateElement(el, { boundElements: [...existing, ref] })
}

export const removeBoundElement = (el: NibElement, id: string): NibElement => {
  const existing = el.boundElements ?? []
  if (!existing.some((b) => b.id === id)) return el
  return mutateElement(el, { boundElements: existing.filter((b) => b.id !== id) })
}

export const bindingHighlightBounds = (el: NibElement): Bounds =>
  expandBounds(getElementBounds(el), BINDING_HIGHLIGHT_GAP)

const validFixedPoint = (fp: Point | null | undefined): Point | null =>
  fp && Number.isFinite(fp[0]) && Number.isFinite(fp[1]) ? fp : null

/**
 * Unit position of `p` in the shape's own (unrotated) box, so [0.5, 0.5] is the
 * centre. Works for every bindable type, rotated or not.
 */
export const toFixedPoint = (el: NibElement, p: Point): Point => {
  const local = rotatePoint(p, elementCenter(el), -el.angle)
  return [
    el.width === 0 ? 0.5 : (local[0] - el.x) / el.width,
    el.height === 0 ? 0.5 : (local[1] - el.y) / el.height,
  ]
}

/** Scene point for a fixed point of `el`, following its position, size and rotation. */
export const fromFixedPoint = (el: NibElement, fp: Point): Point =>
  rotatePoint([el.x + fp[0] * el.width, el.y + fp[1] * el.height], elementCenter(el), el.angle)

import type { Bounds } from "../math/bounds"
import type { Point } from "../math/vector"
import type { NibElement } from "../model/types"
import { isLinearElement } from "../model/types"
import { getElementBounds } from "./elementBounds"
import { absolutePointsOf } from "./linear"
import type { HandleType } from "./transformHandles"

export interface SnapLine {
  /** Screen-space guide drawn while the snap is active. */
  readonly axis: "x" | "y"
  readonly at: number
  readonly from: number
  readonly to: number
  /** "gap" marks one of the equal spaces of a spacing snap; absent means an alignment guide. */
  readonly kind?: "align" | "gap"
  /** Length of a gap marker in scene units, for its distance label. */
  readonly distance?: number
}

export interface SnapResult {
  readonly offset: Point
  readonly lines: readonly SnapLine[]
}

export interface SnapOptions {
  /** How close, in screen pixels, a snap starts to pull. */
  threshold?: number
  /** Also snap to equal spacing between neighbouring shapes (default true). */
  gaps?: boolean
}

export interface PointSnapOptions {
  threshold?: number
  /** Which coordinates may snap; a side handle moves only one (see handleSnapAxes). */
  axes?: { readonly x: boolean; readonly y: boolean }
  /** Any coordinate no object pulled is rounded to this grid. */
  gridSize?: number | null
}

export interface PointSnapResult {
  readonly point: Point
  readonly lines: readonly SnapLine[]
}

export const SNAP_THRESHOLD = 6
export const DEFAULT_GRID_SIZE = 20
export const MIN_GRID_SIZE = 4
export const MAX_GRID_SIZE = 200

/** Same-coordinate test for guides; far below anything visible. */
const SAME = 1e-6

const validGrid = (gridSize: number | null | undefined): gridSize is number =>
  typeof gridSize === "number" && Number.isFinite(gridSize) && gridSize > 0

/** A usable grid size from a stored preference or file value, or null for no grid. */
export const normalizeGridSize = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null
  return Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, Math.round(value)))
}

export const snapToGrid = (p: Point, gridSize: number | null): Point =>
  validGrid(gridSize) ? [Math.round(p[0] / gridSize) * gridSize, Math.round(p[1] / gridSize) * gridSize] : p

/** The pointer coordinates a resize handle moves, so only those snap. */
export const handleSnapAxes = (handle: HandleType): { x: boolean; y: boolean } => {
  if (handle === "rotation") return { x: false, y: false }
  if (handle === "n" || handle === "s") return { x: false, y: true }
  if (handle === "e" || handle === "w") return { x: true, y: false }
  return { x: true, y: true }
}

const edgesOf = (b: Bounds): { x: number[]; y: number[] } => ({
  x: [b[0], (b[0] + b[2]) / 2, b[2]],
  y: [b[1], (b[1] + b[3]) / 2, b[3]],
})

type Axis = 0 | 1

interface Candidate {
  delta: number
  /** Guides for this snap, given the moving box where it lands. */
  lines: (snapped: Bounds) => SnapLine[]
}

const better = (c: Candidate, best: Candidate | null): boolean =>
  !best || Math.abs(c.delta) < Math.abs(best.delta)

const lineAxis = (axis: Axis): "x" | "y" => (axis === 0 ? "x" : "y")

/** One guide through `at` spanning the moving box and every target with an edge or centre on it. */
const alignmentLine = (axis: Axis, at: number, snapped: Bounds, targets: readonly Bounds[]): SnapLine => {
  const cross = (axis ^ 1) as Axis
  let from = snapped[cross]
  let to = snapped[cross + 2]!
  for (const t of targets) {
    const values = axis === 0 ? edgesOf(t).x : edgesOf(t).y
    if (!values.some((v) => Math.abs(v - at) <= SAME)) continue
    from = Math.min(from, t[cross])
    to = Math.max(to, t[cross + 2]!)
  }
  return { axis: lineAxis(axis), at, from, to }
}

/** Marker for the empty space between `a` and `b` along `axis`, drawn through their shared band. */
const gapLine = (axis: Axis, a: Bounds, b: Bounds): SnapLine => {
  const cross = (axis ^ 1) as Axis
  const lo = Math.max(a[cross], b[cross])
  const hi = Math.min(a[cross + 2]!, b[cross + 2]!)
  const from = a[axis + 2]!
  const to = b[axis]
  return {
    axis: lineAxis(cross),
    at: lo <= hi ? (lo + hi) / 2 : (a[cross] + a[cross + 2]! + b[cross] + b[cross + 2]!) / 4,
    from,
    to,
    kind: "gap",
    distance: to - from,
  }
}

const overlaps = (a: Bounds, b: Bounds, axis: Axis): boolean =>
  a[axis] < b[axis + 2]! && b[axis] < a[axis + 2]!

const shift = (b: Bounds, axis: Axis, delta: number): Bounds =>
  axis === 0 ? [b[0] + delta, b[1], b[2] + delta, b[3]] : [b[0], b[1] + delta, b[2], b[3] + delta]

/**
 * Equal-spacing snaps along `axis`: centred between two neighbours, or one
 * more step of the gap between two neighbours on either side of them. Only
 * shapes sharing a band with the moving box across the axis count.
 */
const gapCandidates = (
  moving: Bounds,
  targets: readonly Bounds[],
  axis: Axis,
  threshold: number,
): Candidate | null => {
  const cross = (axis ^ 1) as Axis
  const row = targets.filter((t) => overlaps(t, moving, cross)).sort((p, q) => p[axis] - q[axis])
  const size = moving[axis + 2]! - moving[axis]
  let best: Candidate | null = null
  const offer = (c: Candidate): void => {
    if (Math.abs(c.delta) <= threshold && better(c, best)) best = c
  }
  for (let i = 0; i < row.length; i++) {
    const a = row[i]!
    for (let j = i + 1; j < row.length; j++) {
      const b = row[j]!
      const gap = b[axis] - a[axis + 2]!
      if (gap <= 0) continue
      // a shape sitting in the space means these two are not neighbours, nor is anything further on
      if (row.some((t) => t !== a && t !== b && t[axis] < b[axis] && t[axis + 2]! > a[axis + 2]!)) break
      if (size < gap) {
        const room = (gap - size) / 2
        offer({
          delta: a[axis + 2]! + room - moving[axis],
          lines: (s) => [gapLine(axis, a, s), gapLine(axis, s, b)],
        })
      }
      offer({
        delta: b[axis + 2]! + gap - moving[axis],
        lines: (s) => [gapLine(axis, a, b), gapLine(axis, b, s)],
      })
      offer({
        delta: a[axis] - gap - moving[axis + 2]!,
        lines: (s) => [gapLine(axis, s, a), gapLine(axis, a, b)],
      })
    }
  }
  return best
}

const alignmentCandidate = (
  values: readonly number[],
  targets: readonly Bounds[],
  axis: Axis,
  threshold: number,
): Candidate | null => {
  let best: Candidate | null = null
  for (const t of targets) {
    const theirs = axis === 0 ? edgesOf(t).x : edgesOf(t).y
    for (const mine of values) {
      for (const at of theirs) {
        const delta = at - mine
        if (Math.abs(delta) > threshold || (best && Math.abs(delta) >= Math.abs(best.delta))) continue
        best = { delta, lines: (s) => [alignmentLine(axis, at, s, targets)] }
      }
    }
  }
  return best
}

/**
 * Align `moving` to the edges and centres of `targets`, or space it evenly
 * between them. Returns the offset to add to the moving box and the guides to
 * draw where it lands.
 */
export const computeBoundsSnap = (
  moving: Bounds,
  targets: readonly Bounds[],
  zoom: number,
  opts: SnapOptions = {},
): SnapResult => {
  const threshold = (opts.threshold ?? SNAP_THRESHOLD) / zoom
  const me = edgesOf(moving)
  const pick = (axis: Axis): Candidate | null => {
    const align = alignmentCandidate(axis === 0 ? me.x : me.y, targets, axis, threshold)
    const gap = opts.gaps === false ? null : gapCandidates(moving, targets, axis, threshold)
    return gap && better(gap, align) ? gap : align
  }
  const bestX = pick(0)
  const bestY = pick(1)
  const offset: Point = [bestX ? bestX.delta : 0, bestY ? bestY.delta : 0]
  // guides span the box where it lands, not where the pointer would have put it
  const snapped = shift(shift(moving, 0, offset[0]), 1, offset[1])
  const lines: SnapLine[] = []
  if (bestX) lines.push(...bestX.lines(snapped))
  if (bestY) lines.push(...bestY.lines(snapped))
  return { offset, lines }
}

/** `computeBoundsSnap` against the boxes of `others`. */
export const computeSnap = (
  moving: Bounds,
  others: readonly NibElement[],
  zoom: number,
  opts: SnapOptions = {},
): SnapResult => computeBoundsSnap(moving, others.map(getElementBounds), zoom, opts)

/**
 * Snap a single moving point (a resize handle, the free corner of a shape being
 * drawn, a line end) to the edges and centres of `others` and to the vertices
 * of their lines. Coordinates nothing pulled fall back to `gridSize`.
 */
export const computePointSnap = (
  p: Point,
  others: readonly NibElement[],
  zoom: number,
  opts: PointSnapOptions = {},
): PointSnapResult => {
  const threshold = (opts.threshold ?? SNAP_THRESHOLD) / zoom
  const axes = opts.axes ?? { x: true, y: true }
  // each target: the coordinates it offers on both axes, and the extent its guide should reach
  const anchors: { x: number[]; y: number[]; box: Bounds }[] = []
  for (const el of others) {
    if (el.isDeleted) continue
    const box = getElementBounds(el)
    anchors.push({ ...edgesOf(box), box })
    if (isLinearElement(el))
      for (const v of absolutePointsOf(el))
        anchors.push({ x: [v[0]], y: [v[1]], box: [v[0], v[1], v[0], v[1]] })
  }
  const nearest = (axis: Axis): number | null => {
    let best: number | null = null
    for (const a of anchors)
      for (const v of axis === 0 ? a.x : a.y)
        if (
          Math.abs(v - p[axis]) <= threshold &&
          (best === null || Math.abs(v - p[axis]) < Math.abs(best - p[axis]))
        )
          best = v
    return best
  }
  const sx = axes.x ? nearest(0) : null
  const sy = axes.y ? nearest(1) : null
  const grid = validGrid(opts.gridSize) ? snapToGrid(p, opts.gridSize) : p
  const point: Point = [sx ?? (axes.x ? grid[0] : p[0]), sy ?? (axes.y ? grid[1] : p[1])]
  const guide = (axis: Axis, at: number): SnapLine => {
    const cross = (axis ^ 1) as Axis
    let from = point[cross]
    let to = point[cross]
    for (const a of anchors) {
      if (!(axis === 0 ? a.x : a.y).some((v) => Math.abs(v - at) <= SAME)) continue
      from = Math.min(from, a.box[cross])
      to = Math.max(to, a.box[cross + 2]!)
    }
    return { axis: lineAxis(axis), at, from, to }
  }
  const lines: SnapLine[] = []
  if (sx !== null) lines.push(guide(0, sx))
  if (sy !== null) lines.push(guide(1, sy))
  return { point, lines }
}

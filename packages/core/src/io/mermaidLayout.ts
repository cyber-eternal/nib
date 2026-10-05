import { boundsFromPoints } from "../math/bounds"
import type { Point } from "../math/vector"
import type { MermaidDirection } from "./mermaid"

export interface LayoutItem {
  key: string
  w: number
  h: number
}

export interface LayeredLayout {
  /** Top-left of each item, relative to the top-left of the whole block. */
  positions: Map<string, Point>
  width: number
  height: number
}

const GAP_MAIN = 90
const GAP_CROSS = 40

/**
 * Longest-path layering, so every edge points from a lower rank to a higher one. Edges that close
 * a cycle (found depth-first in declaration order) are left out, otherwise a loop such as
 * A → B → A keeps pushing both ranks up and the layers stop meaning anything.
 */
export const rankItems = (
  keys: readonly string[],
  edges: readonly [string, string][],
): Map<string, number> => {
  const rank = new Map<string, number>()
  for (const k of keys) rank.set(k, 0)
  const adjacent = new Map<string, string[]>()
  for (const [from, to] of edges) {
    if (from === to || !rank.has(from) || !rank.has(to)) continue
    adjacent.set(from, [...(adjacent.get(from) ?? []), to])
  }
  const outgoing = new Map<string, string[]>()
  const state = new Map<string, "open" | "done">()
  const visit = (key: string) => {
    state.set(key, "open")
    for (const to of adjacent.get(key) ?? []) {
      if (state.get(to) === "open") continue
      outgoing.set(key, [...(outgoing.get(key) ?? []), to])
      if (!state.has(to)) visit(to)
    }
    state.set(key, "done")
  }
  for (const k of keys) if (!state.has(k)) visit(k)
  // the graph is acyclic now, so this settles within node-count passes
  for (let pass = 0; pass < keys.length; pass++) {
    let changed = false
    for (const [from, targets] of outgoing) {
      const base = rank.get(from) ?? 0
      for (const to of targets) {
        if ((rank.get(to) ?? 0) < base + 1) {
          rank.set(to, base + 1)
          changed = true
        }
      }
    }
    if (!changed) break
  }
  return rank
}

/** Places items in ranks along the diagram direction, each rank centred on the cross axis. */
export const layoutLayered = (
  items: readonly LayoutItem[],
  edges: readonly [string, string][],
  direction: MermaidDirection,
): LayeredLayout => {
  const positions = new Map<string, Point>()
  if (items.length === 0) return { positions, width: 0, height: 0 }
  const horizontal = direction === "LR" || direction === "RL"
  const rank = rankItems(
    items.map((i) => i.key),
    edges,
  )
  const byRank = new Map<number, LayoutItem[]>()
  for (const item of items) {
    const r = rank.get(item.key) ?? 0
    byRank.set(r, [...(byRank.get(r) ?? []), item])
  }
  const along = (i: LayoutItem) => (horizontal ? i.w : i.h)
  const across = (i: LayoutItem) => (horizontal ? i.h : i.w)

  const ranks = [...byRank.keys()].sort((a, b) => a - b)
  let mainOffset = 0
  let minCross = Number.POSITIVE_INFINITY
  let maxCross = Number.NEGATIVE_INFINITY
  for (const r of ranks) {
    const group = byRank.get(r)!
    const lane = Math.max(...group.map(along))
    const crossTotal = group.reduce((sum, i) => sum + across(i), 0) + GAP_CROSS * (group.length - 1)
    let cross = -crossTotal / 2
    minCross = Math.min(minCross, cross)
    maxCross = Math.max(maxCross, cross + crossTotal)
    for (const item of group) {
      const main = mainOffset + (lane - along(item)) / 2
      positions.set(item.key, horizontal ? [main, cross] : [cross, main])
      cross += across(item) + GAP_CROSS
    }
    mainOffset += lane + GAP_MAIN
  }
  const extent = mainOffset - GAP_MAIN
  const byKey = new Map(items.map((i) => [i.key, i]))
  for (const [key, p] of positions) {
    const item = byKey.get(key)!
    let [x, y] = horizontal ? [p[0], p[1] - minCross] : [p[0] - minCross, p[1]]
    if (direction === "BT") y = extent - y - item.h
    if (direction === "RL") x = extent - x - item.w
    positions.set(key, [x, y])
  }
  const crossExtent = maxCross - minCross
  return horizontal
    ? { positions, width: extent, height: crossExtent }
    : { positions, width: crossExtent, height: extent }
}

export interface LayoutBox {
  x: number
  y: number
  w: number
  h: number
}

/** Where the segment from the centre of `box` towards `target` leaves the box. */
export const boxExitPoint = (box: LayoutBox, target: Point): Point => {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const dx = target[0] - cx
  const dy = target[1] - cy
  if (dx === 0 && dy === 0) return [cx, box.y]
  const t = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : box.w / 2 / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : box.h / 2 / Math.abs(dy),
  )
  return [cx + dx * t, cy + dy * t]
}

/** x/y at the top-left of the points, which is where Nib's tools keep a linear element's origin. */
export const rebased = (
  abs: readonly Point[],
): { x: number; y: number; width: number; height: number; points: Point[] } => {
  const b = boundsFromPoints(abs)
  return {
    x: b[0],
    y: b[1],
    width: b[2] - b[0],
    height: b[3] - b[1],
    points: abs.map((p): Point => [p[0] - b[0], p[1] - b[1]]),
  }
}

// Liang-Barsky: does the segment a-b pass through `box` grown by `pad`?
const segmentHitsBox = (a: Point, b: Point, box: LayoutBox, pad: number): boolean => {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  let t0 = 0
  let t1 = 1
  const edges: [number, number][] = [
    [-dx, a[0] - (box.x - pad)],
    [dx, box.x + box.w + pad - a[0]],
    [-dy, a[1] - (box.y - pad)],
    [dy, box.y + box.h + pad - a[1]],
  ]
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    const t = q / p
    if (p < 0) t0 = Math.max(t0, t)
    else t1 = Math.min(t1, t)
    if (t0 > t1) return false
  }
  return true
}

const DETOURS = [60, 110, 170, 240, 320]

/**
 * A point to bend a straight a-b connector through so it goes around `obstacles` instead of
 * across them, or null when the straight line is already clear (or no nearby bend clears it).
 */
export const detourPoint = (a: Point, b: Point, obstacles: readonly LayoutBox[]): Point | null => {
  const blocked = (p: Point, q: Point) => obstacles.some((o) => segmentHitsBox(p, q, o, 8))
  if (!blocked(a, b)) return null
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  const nx = -(b[1] - a[1]) / len
  const ny = (b[0] - a[0]) / len
  const mx = (a[0] + b[0]) / 2
  const my = (a[1] + b[1]) / 2
  for (const d of DETOURS) {
    for (const side of [1, -1]) {
      const m: Point = [mx + nx * d * side, my + ny * d * side]
      if (!blocked(a, m) && !blocked(m, b)) return m
    }
  }
  return null
}

import { type Bounds, boundsFromPoints, boundsIntersect, expandBounds, unionBounds } from "../math/bounds"
import type { Point } from "../math/vector"
import type { NibElement } from "../model/types"
import { getElementBounds } from "./elementBounds"

export type Heading = "up" | "down" | "left" | "right"

const PADDING = 20
const BEND_COST = 40
/** Turning right at the stub that leaves a shape looks cramped; prefer turning further out. */
const STUB_BEND_COST = 1
/**
 * Route lengths are compared in whole 1/256ths of a unit, so equally long routes
 * tie exactly and the off-centre preference (a second, tie-only cost) decides.
 */
const UNIT = 256
const EPS = 0.5
/** How far past the ends a detour first looks for obstacles; ones it then runs into are pulled in. */
const OBSTACLE_REGION_MARGIN = 4 * PADDING
const MAX_OBSTACLE_PASSES = 4
/** Above this many boxes the search turns only where visibility segments cross (see turnPoints). */
const SPARSE_FROM_BOXES = 8

const headingFromBox = (b: Bounds, p: Point): Heading => {
  const cx = (b[0] + b[2]) / 2
  const cy = (b[1] + b[3]) / 2
  const dx = p[0] - cx
  const dy = p[1] - cy
  const w = Math.max(1, (b[2] - b[0]) / 2)
  const h = Math.max(1, (b[3] - b[1]) / 2)
  return Math.abs(dx / w) > Math.abs(dy / h) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up"
}

const DIRS: Record<Heading, Point> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }
const HEADINGS: Heading[] = ["left", "right", "up", "down"]
const OPPOSITE: Record<Heading, Heading> = { left: "right", right: "left", up: "down", down: "up" }

const isHorizontal = (h: Heading): boolean => h === "left" || h === "right"

/** Step from `p` along `h` until clear of the padded box (at least PADDING). */
const exitPoint = (p: Point, h: Heading, box: Bounds): Point => {
  switch (h) {
    case "left":
      return [Math.min(p[0] - PADDING, box[0]), p[1]]
    case "right":
      return [Math.max(p[0] + PADDING, box[2]), p[1]]
    case "up":
      return [p[0], Math.min(p[1] - PADDING, box[1])]
    case "down":
      return [p[0], Math.max(p[1] + PADDING, box[3])]
  }
}

const dedupe = (pts: Point[]): Point[] => {
  const out: Point[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && Math.abs(last[0] - p[0]) < EPS && Math.abs(last[1] - p[1]) < EPS) continue
    out.push(p)
  }
  // drop collinear midpoints so segment dragging stays predictable
  const cleaned: Point[] = []
  for (let i = 0; i < out.length; i++) {
    const prev = cleaned[cleaned.length - 1]
    const next = out[i + 1]
    const cur = out[i]!
    if (prev && next) {
      const a = Math.abs(prev[0] - cur[0]) < EPS && Math.abs(cur[0] - next[0]) < EPS
      const b = Math.abs(prev[1] - cur[1]) < EPS && Math.abs(cur[1] - next[1]) < EPS
      if (a || b) continue
    }
    cleaned.push(cur)
  }
  return cleaned
}

/** True when the axis-aligned segment a-b passes through the open interior of `box`. */
const crossesBox = (a: Point, b: Point, box: Bounds): boolean => {
  const minX = Math.min(a[0], b[0])
  const maxX = Math.max(a[0], b[0])
  const minY = Math.min(a[1], b[1])
  const maxY = Math.max(a[1], b[1])
  return minX < box[2] - EPS && maxX > box[0] + EPS && minY < box[3] - EPS && maxY > box[1] + EPS
}

const insideBox = (p: Point, box: Bounds): boolean =>
  p[0] > box[0] + EPS && p[0] < box[2] - EPS && p[1] > box[1] + EPS && p[1] < box[3] - EPS

/** First index whose value is >= v, or > v when `strict`. */
const bound = (vals: readonly number[], v: number, strict: boolean): number => {
  let lo = 0
  let hi = vals.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (strict ? vals[mid]! <= v : vals[mid]! < v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Sorted rail coordinates; `exact` values win over nearby ones so the route ends exactly on them. */
const rails = (exact: readonly number[], others: readonly number[]): number[] => {
  const fixed: number[] = []
  for (const v of exact) if (Number.isFinite(v) && !fixed.some((o) => Math.abs(o - v) <= EPS)) fixed.push(v)
  const rest = others.filter((v) => Number.isFinite(v)).sort((x, y) => x - y)
  const out = [...fixed]
  let last = Number.NEGATIVE_INFINITY
  for (const v of rest) {
    if (v - last <= EPS || fixed.some((o) => Math.abs(o - v) <= EPS)) continue
    out.push(v)
    last = v
  }
  return out.sort((x, y) => x - y)
}

const nearestIndex = (vals: readonly number[], v: number): number => {
  const i = bound(vals, v, false)
  if (i >= vals.length) return vals.length - 1
  if (i > 0 && Math.abs(vals[i - 1]! - v) < Math.abs(vals[i]! - v)) return i - 1
  return i
}

/**
 * Binary min-heap of search states, ordered by estimated length, then by how
 * far off-centre the route so far runs, then deepest first (which heads
 * straight for the target instead of fanning out across equal rails), then by
 * insertion order.
 */
class StateHeap {
  private f = new Float64Array(256)
  private s = new Float64Array(256)
  private g = new Float64Array(256)
  private seq = new Int32Array(256)
  private key = new Int32Array(256)
  private n = 0
  private counter = 0
  /** Estimate and off-centre cost of the state last returned by pop(). */
  topF = 0
  topS = 0

  get size(): number {
    return this.n
  }

  private before(f: number, s: number, g: number, seq: number, at: number): boolean {
    if (f !== this.f[at]) return f < this.f[at]!
    if (s !== this.s[at]) return s < this.s[at]!
    if (g !== this.g[at]) return g > this.g[at]!
    return seq < this.seq[at]!
  }

  private copy(from: number, to: number): void {
    this.f[to] = this.f[from]!
    this.s[to] = this.s[from]!
    this.g[to] = this.g[from]!
    this.seq[to] = this.seq[from]!
    this.key[to] = this.key[from]!
  }

  private put(at: number, f: number, s: number, g: number, seq: number, key: number): void {
    this.f[at] = f
    this.s[at] = s
    this.g[at] = g
    this.seq[at] = seq
    this.key[at] = key
  }

  private grow(): void {
    const size = this.f.length * 2
    const widen = <T extends Float64Array | Int32Array>(old: T, next: T): T => {
      next.set(old)
      return next
    }
    this.f = widen(this.f, new Float64Array(size))
    this.s = widen(this.s, new Float64Array(size))
    this.g = widen(this.g, new Float64Array(size))
    this.seq = widen(this.seq, new Int32Array(size))
    this.key = widen(this.key, new Int32Array(size))
  }

  push(key: number, f: number, s: number, g: number): void {
    if (this.n === this.f.length) this.grow()
    const seq = this.counter++
    let i = this.n++
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!this.before(f, s, g, seq, parent)) break
      this.copy(parent, i)
      i = parent
    }
    this.put(i, f, s, g, seq, key)
  }

  pop(): number {
    const key = this.key[0]!
    this.topF = this.f[0]!
    this.topS = this.s[0]!
    const n = --this.n
    if (n === 0) return key
    const f = this.f[n]!
    const s = this.s[n]!
    const g = this.g[n]!
    const seq = this.seq[n]!
    const k = this.key[n]!
    let i = 0
    for (;;) {
      const l = i * 2 + 1
      if (l >= n) break
      const r = l + 1
      const m = r < n && this.before(this.f[r]!, this.s[r]!, this.g[r]!, this.seq[r]!, l) ? r : l
      if (this.before(f, s, g, seq, m)) break
      this.copy(m, i)
      i = m
    }
    this.put(i, f, s, g, seq, k)
    return key
  }
}

/** Sign class of an offset: 0 behind or left/up, 1 level, 2 ahead or right/down. */
const signClass = (v: number): number => (v < -EPS ? 0 : v > EPS ? 2 : 1)

/**
 * Fewest bends from a point travelling heading d (4 = not yet moving) to a
 * target whose offset has sign classes (sx, sy), arriving heading e (4 = any).
 * Built once by trying every heading sequence, so the A* estimate stays
 * admissible while knowing which side the route has to enter from.
 */
const BEND_TABLE = (() => {
  const table = new Uint8Array(5 * 5 * 9).fill(255)
  // can segments along these headings (each > 0, except a first one that may be 0) sum to these signs?
  const feasible = (seq: readonly number[], firstFree: boolean, sx: number, sy: number): boolean => {
    const axis = (neg: number, pos: number, sign: number): boolean => {
      let p = 0
      let ps = 0
      let n = 0
      let ns = 0
      seq.forEach((h, i) => {
        const strict = !(i === 0 && firstFree)
        if (h === pos) {
          p++
          if (strict) ps++
        } else if (h === neg) {
          n++
          if (strict) ns++
        }
      })
      if (p > 0 && n > 0) return true
      if (p > 0) return sign === 2 || (sign === 1 && ps === 0)
      if (n > 0) return sign === 0 || (sign === 1 && ns === 0)
      return sign === 1
    }
    return axis(0, 1, sx) && axis(2, 3, sy)
  }
  const perpendicular = (h: number, n: number): boolean => h < 2 !== n < 2
  const sequences: number[][][] = [[[0], [1], [2], [3]]]
  for (let k = 1; k <= 5; k++) {
    const next: number[][] = []
    for (const seq of sequences[k - 1]!)
      for (let n = 0; n < 4; n++) if (perpendicular(seq[seq.length - 1]!, n)) next.push([...seq, n])
    sequences.push(next)
  }
  for (let d = 0; d < 5; d++)
    for (let e = 0; e < 5; e++)
      for (let sx = 0; sx < 3; sx++)
        for (let sy = 0; sy < 3; sy++) {
          if (sx === 1 && sy === 1 && (d === 4 || e === 4 || e === d)) {
            table[(d * 5 + e) * 9 + sx * 3 + sy] = 0
            continue
          }
          for (let k = 0; k < sequences.length; k++) {
            const ok = sequences[k]!.some(
              (seq) =>
                (d === 4 || seq[0] === d) &&
                (e === 4 || seq[seq.length - 1] === e) &&
                feasible(seq, d !== 4, sx, sy),
            )
            if (ok) {
              table[(d * 5 + e) * 9 + sx * 3 + sy] = k
              break
            }
          }
        }
  return table
})()

/** Fewest bends to reach offset (dx, dy) from heading d, arriving heading e (4 = any). */
const minBends = (d: number, e: number, dx: number, dy: number): number =>
  BEND_TABLE[(d * 5 + e) * 9 + signClass(dx) * 3 + signClass(dy)]!

/**
 * Where the search may turn, as a flag per grid node. A rail through a box side
 * or an end only matters as far as it can see before an obstacle cuts it off
 * (the orthogonal visibility graph), which keeps an optimal route but leaves
 * far fewer nodes on a crowded board.
 */
const turnPoints = (
  xs: readonly number[],
  ys: readonly number[],
  boxes: readonly Bounds[],
  ends: readonly Point[],
  open: { x: readonly number[]; y: readonly number[] },
): Uint8Array => {
  const nx = xs.length
  const ny = ys.length
  const marks = new Uint8Array(nx * ny)
  // extent of the line `at` (vertical when axis 0) through [from, to] before a box interior blocks it
  const reach = (axis: 0 | 1, at: number, from: number, to: number): [number, number] => {
    let lo = Number.NEGATIVE_INFINITY
    let hi = Number.POSITIVE_INFINITY
    for (const bx of boxes) {
      if (!(at > bx[axis]! + EPS && at < bx[axis + 2]! - EPS)) continue
      const near = bx[(axis ^ 1) + 2]!
      const far = bx[axis ^ 1]!
      if (near <= from + EPS && near > lo) lo = near
      if (far >= to - EPS && far < hi) hi = far
    }
    return [lo, hi]
  }
  const markX = (x: number, span: [number, number]): void => {
    const i = nearestIndex(xs, x)
    const j1 = bound(ys, span[1] + EPS, true)
    for (let j = bound(ys, span[0] - EPS, false); j < j1; j++) marks[j * nx + i]! |= 1
  }
  const markY = (y: number, span: [number, number]): void => {
    const j = nearestIndex(ys, y)
    const i1 = bound(xs, span[1] + EPS, true)
    for (let i = bound(xs, span[0] - EPS, false); i < i1; i++) marks[j * nx + i]! |= 2
  }
  const full: [number, number] = [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]
  for (const x of open.x) markX(x, full)
  for (const y of open.y) markY(y, full)
  for (const bx of boxes) {
    markX(bx[0], reach(0, bx[0], bx[1], bx[3]))
    markX(bx[2], reach(0, bx[2], bx[1], bx[3]))
    markY(bx[1], reach(1, bx[1], bx[0], bx[2]))
    markY(bx[3], reach(1, bx[3], bx[0], bx[2]))
  }
  for (const p of ends) {
    markX(p[0], reach(0, p[0], p[1], p[1]))
    markY(p[1], reach(1, p[1], p[0], p[0]))
    marks[nearestIndex(ys, p[1]) * nx + nearestIndex(xs, p[0])] = 3
  }
  return marks
}

/**
 * Cheapest orthogonal path from `a` (already travelling `startDir`, if any) to
 * `b`, over a grid of rails through the points and the box edges, never
 * entering a box. Cost is length plus a penalty per bend; with `centre`, equally
 * long routes go for the rails nearest the middle. A* with an estimate that
 * knows the fewest bends still needed keeps it fast on hundreds of obstacles.
 */
const searchRoute = (
  a: Point,
  startDir: Heading | null,
  b: Point,
  endDir: Heading | null,
  boxes: readonly Bounds[],
  frame: Bounds | null = null,
  centre = true,
): Point[] | null => {
  const midX = (a[0] + b[0]) / 2
  const midY = (a[1] + b[1]) / 2
  const frameX = frame ? [frame[0], frame[2]] : []
  const frameY = frame ? [frame[1], frame[3]] : []
  const xs = rails([a[0], b[0]], [midX, ...frameX, ...boxes.flatMap((bx) => [bx[0], bx[2]])])
  const ys = rails([a[1], b[1]], [midY, ...frameY, ...boxes.flatMap((bx) => [bx[1], bx[3]])])
  const nx = xs.length
  const ny = ys.length
  const ai = nearestIndex(xs, a[0])
  const aj = nearestIndex(ys, a[1])
  const bi = nearestIndex(xs, b[0])
  const bj = nearestIndex(ys, b[1])

  // an edge between neighbouring rails is blocked when it runs through a box's open interior
  const hBlocked = new Uint8Array(Math.max(0, nx - 1) * ny)
  const vBlocked = new Uint8Array(nx * Math.max(0, ny - 1))
  for (const bx of boxes) {
    const xIn0 = bound(xs, bx[0] + EPS, true)
    const xIn1 = bound(xs, bx[2] - EPS, false)
    const yIn0 = bound(ys, bx[1] + EPS, true)
    const yIn1 = bound(ys, bx[3] - EPS, false)
    const hFrom = Math.max(0, xIn0 - 1)
    const hTo = Math.min(nx - 2, xIn1 - 1)
    for (let j = yIn0; j < yIn1; j++) for (let i = hFrom; i <= hTo; i++) hBlocked[j * (nx - 1) + i] = 1
    const vFrom = Math.max(0, yIn0 - 1)
    const vTo = Math.min(ny - 2, yIn1 - 1)
    for (let i = xIn0; i < xIn1; i++) for (let j = vFrom; j <= vTo; j++) vBlocked[i * (ny - 1) + j] = 1
  }
  const edgeBlocked = (i: number, j: number, d: number): boolean => {
    switch (d) {
      case 0:
        return hBlocked[j * (nx - 1) + i - 1] === 1
      case 1:
        return hBlocked[j * (nx - 1) + i] === 1
      case 2:
        return vBlocked[i * (ny - 1) + j - 1] === 1
      default:
        return vBlocked[i * (ny - 1) + j] === 1
    }
  }

  const turns =
    boxes.length >= SPARSE_FROM_BOXES
      ? turnPoints(xs, ys, boxes, [a, b], { x: [midX, ...frameX], y: [midY, ...frameY] })
      : null

  const dirIndex = (h: Heading | null): number => (h ? HEADINGS.indexOf(h) : 4)
  const endIndex = dirIndex(endDir)
  const key = (i: number, j: number, d: number): number => (j * nx + i) * 5 + d
  // lengths in whole UNITs: exact sums, so equal routes really tie
  const xq = xs.map((v) => Math.round(v * UNIT))
  const yq = ys.map((v) => Math.round(v * UNIT))
  const bend = BEND_COST * UNIT
  const stubBend = STUB_BEND_COST * UNIT
  const dist = new Float64Array(nx * ny * 5).fill(Number.POSITIVE_INFINITY)
  const offDist = new Float64Array(nx * ny * 5)
  const prev = new Int32Array(nx * ny * 5).fill(-1)
  const estimate = (i: number, j: number, d: number): number => {
    const dx = xq[bi]! - xq[i]!
    const dy = yq[bj]! - yq[j]!
    const len = Math.abs(dx) + Math.abs(dy)
    const sx = b[0] - xs[i]!
    const sy = b[1] - ys[j]!
    const free = minBends(d, 4, sx, sy) * bend
    if (endIndex === 4) return len + free
    return len + Math.min(minBends(d, endIndex, sx, sy) * bend, free + bend + stubBend)
  }
  const open = new StateHeap()
  const startKey = key(ai, aj, dirIndex(startDir))
  dist[startKey] = 0
  open.push(startKey, estimate(ai, aj, dirIndex(startDir)), 0, 0)

  let bestEnd = -1
  let bestLen = Number.POSITIVE_INFINITY
  let bestOff = Number.POSITIVE_INFINITY
  while (open.size > 0) {
    const k = open.pop()
    const f = open.topF
    const off = open.topS
    if (f > bestLen || (f === bestLen && off >= bestOff)) break
    const d = k % 5
    const cell = (k - d) / 5
    const i = cell % nx
    const j = (cell - i) / nx
    const cost = dist[k]!
    if (f !== cost + estimate(i, j, d) || off !== offDist[k]) continue
    if (i === bi && j === bj) {
      const arriving = d === 4 ? null : HEADINGS[d]!
      const total = cost + (endDir && arriving && arriving !== endDir ? bend + stubBend : 0)
      if (total < bestLen || (total === bestLen && off < bestOff)) {
        bestLen = total
        bestOff = off
        bestEnd = k
      }
      continue
    }
    const atStub = (i === ai && j === aj) || (i === bi && j === bj)
    for (let nd = 0; nd < 4; nd++) {
      const h = HEADINGS[nd]!
      if (d !== 4 && OPPOSITE[HEADINGS[d]!] === h) continue
      const [dx, dy] = DIRS[h]
      // run straight to the next node the route could turn at; every grid node is one without `turns`
      let ni = i
      let nj = j
      let reached = false
      for (;;) {
        const ti = ni + dx
        const tj = nj + dy
        if (ti < 0 || tj < 0 || ti >= nx || tj >= ny || edgeBlocked(ni, nj, nd)) break
        ni = ti
        nj = tj
        if (!turns || turns[nj * nx + ni] === 3) {
          reached = true
          break
        }
      }
      if (!reached) continue
      const turning = d !== 4 && d !== nd
      const run = Math.abs(xq[ni]! - xq[i]!) + Math.abs(yq[nj]! - yq[j]!)
      const nc = cost + run + (turning ? bend + (atStub ? stubBend : 0) : 0)
      // among equally long routes, prefer rails near the middle of the run
      const no = centre
        ? off +
          (Math.abs(xs[ni]! - xs[i]!) + Math.abs(ys[nj]! - ys[j]!)) *
            (isHorizontal(h) ? Math.abs(ys[nj]! - midY) : Math.abs(xs[ni]! - midX))
        : 0
      const nk = key(ni, nj, nd)
      if (nc < dist[nk]! || (nc === dist[nk]! && no < offDist[nk]!)) {
        dist[nk] = nc
        offDist[nk] = no
        prev[nk] = k
        open.push(nk, nc + estimate(ni, nj, nd), no, nc)
      }
    }
  }
  if (bestEnd < 0) return null
  const path: Point[] = []
  for (let cur = bestEnd; cur >= 0; cur = prev[cur]!) {
    const cell = (cur - (cur % 5)) / 5
    const i = cell % nx
    path.push([xs[i]!, ys[(cell - i) / nx]!])
  }
  path.reverse()
  path[0] = a
  path[path.length - 1] = b
  return path
}

/**
 * Route that also stays out of `obstacles`. It starts with the obstacles in
 * `region` (around the ends) and pulls in any further ones the route runs
 * into, so a dense board only costs as much as the part of it the route
 * crosses. A route that clears every obstacle while avoiding only some of them
 * is still the cheapest one overall.
 */
const searchAround = (
  a: Point,
  startDir: Heading,
  b: Point,
  endDir: Heading | null,
  own: readonly Bounds[],
  obstacles: readonly Bounds[],
  region: Bounds,
): Point[] | null => {
  const used = new Set<Bounds>(obstacles.filter((o) => boundsIntersect(o, region)))
  // no centring here: picking the most central of many equal detours costs more search than it shows
  for (let pass = 0; pass < MAX_OBSTACLE_PASSES; pass++) {
    const route = searchRoute(a, startDir, b, endDir, [...own, ...used], region, false)
    if (!route) return null
    const missed = obstacles.filter((o) => !used.has(o) && routeCrossesBoxes(route, [o]))
    if (missed.length === 0) return route
    for (const o of missed) used.add(o)
  }
  return searchRoute(a, startDir, b, endDir, [...own, ...obstacles], region, false)
}

/** The old fixed-shape bend, used only when no clear route exists (overlapping shapes). */
const simpleBend = (a: Point, b: Point, startHeading: Heading): Point[] =>
  isHorizontal(startHeading)
    ? [a, [(a[0] + b[0]) / 2, a[1]], [(a[0] + b[0]) / 2, b[1]], b]
    : [a, [a[0], (a[1] + b[1]) / 2], [b[0], (a[1] + b[1]) / 2], b]

export interface ElbowRouteOptions {
  /** Other shapes' boxes (already padded) to route around; ignored where they cover an end. */
  obstacles?: readonly Bounds[]
}

/**
 * Orthogonal route from `start` to `end`. Exits each bound shape along its
 * nearest side, then finds the cheapest bend sequence that stays clear of both
 * shapes (padded), including U-turns behind the start shape and self-loops.
 * The plain route is kept whenever it already clears every obstacle, so routes
 * only change shape when something is actually in the way.
 */
export const routeElbow = (
  start: Point,
  end: Point,
  startShape?: NibElement | null,
  endShape?: NibElement | null,
  opts: ElbowRouteOptions = {},
): Point[] => {
  const startRaw = startShape ? getElementBounds(startShape) : null
  const endRaw = endShape ? getElementBounds(endShape) : null
  const startBox = startRaw ? expandBounds(startRaw, PADDING) : null
  const endBox = endRaw ? expandBounds(endRaw, PADDING) : null

  const towardEnd: Heading =
    Math.abs(end[0] - start[0]) >= Math.abs(end[1] - start[1])
      ? end[0] > start[0]
        ? "right"
        : "left"
      : end[1] > start[1]
        ? "down"
        : "up"
  const startHeading: Heading = startRaw ? headingFromBox(startRaw, start) : towardEnd
  const endHeading: Heading | null = endRaw ? headingFromBox(endRaw, end) : null

  const a = startBox ? exitPoint(start, startHeading, startBox) : start
  const b = endBox && endHeading ? exitPoint(end, endHeading, endBox) : end
  const arriveDir = endHeading ? OPPOSITE[endHeading] : null

  const padded = [startBox, endBox].filter((x): x is Bounds => x !== null)
  const raw = [startRaw, endRaw].filter((x): x is Bounds => x !== null)
  const obstacles = (opts.obstacles ?? []).filter(
    (o) => !insideBox(start, o) && !insideBox(end, o) && !insideBox(a, o) && !insideBox(b, o),
  )
  let region = boundsFromPoints([start, end, a, b])
  for (const box of padded) region = unionBounds(region, box)
  region = expandBounds(region, OBSTACLE_REGION_MARGIN)

  // shapes closer than twice the padding: route against the shapes themselves
  const owns = raw.length > 0 ? [padded, raw] : [padded]
  for (const own of owns) {
    const plain = searchRoute(a, startHeading, b, arriveDir, own)
    if (!plain) continue
    if (obstacles.length === 0 || !routeCrossesBoxes(plain, obstacles)) return dedupe([start, ...plain, end])
    const around = searchAround(a, startHeading, b, arriveDir, own, obstacles, region)
    return dedupe([start, ...(around ?? plain), end])
  }
  return dedupe([start, ...simpleBend(a, b, startHeading), end])
}

/** True when any segment of the orthogonal route passes through one of `boxes`. */
export const routeCrossesBoxes = (route: readonly Point[], boxes: readonly Bounds[]): boolean => {
  for (let i = 0; i < route.length - 1; i++) {
    if (boxes.some((bx) => crossesBox(route[i]!, route[i + 1]!, bx))) return true
  }
  return false
}

/** A draggable segment of an orthogonal route, from `points[index]` to `points[index + 1]`. */
export interface ElbowSegment {
  readonly index: number
  readonly mid: Point
  readonly horizontal: boolean
  readonly length: number
}

/** The straight, non-empty segments of an orthogonal route, for segment-drag handles. */
export const elbowSegments = (points: readonly Point[]): ElbowSegment[] => {
  const out: ElbowSegment[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i]!
    const q = points[i + 1]!
    const dx = Math.abs(q[0] - p[0])
    const dy = Math.abs(q[1] - p[1])
    if (dx < EPS && dy < EPS) continue
    if (dx >= EPS && dy >= EPS) continue
    out.push({ index: i, mid: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], horizontal: dy < EPS, length: dx + dy })
  }
  return out
}

/**
 * Slides segment `index` of an orthogonal route sideways so it runs through
 * `to`, stretching its neighbours so every segment stays horizontal or
 * vertical. The ends never move: dragging the first or last segment keeps a
 * short stub leaving that end the way it did before.
 */
export const moveElbowSegment = (points: readonly Point[], index: number, to: Point): Point[] => {
  const n = points.length
  const copy = points.map((p): Point => [p[0], p[1]])
  if (index < 0 || index >= n - 1) return copy
  const p = points[index]!
  const q = points[index + 1]!
  const horizontal = Math.abs(p[1] - q[1]) < EPS
  if (!horizontal && Math.abs(p[0] - q[0]) >= EPS) return copy
  const axis = horizontal ? 1 : 0
  const along = axis ^ 1
  const at = to[axis]!
  const place = (pt: Point): Point => (axis === 1 ? [pt[0], at] : [at, pt[1]])
  const span = q[along]! - p[along]!
  const stub = Math.min(PADDING, Math.abs(span) / 3) * Math.sign(span)
  const offsetAlong = (pt: Point, by: number): Point =>
    along === 0 ? [pt[0] + by, pt[1]] : [pt[0], pt[1] + by]

  const head: Point[] = copy.slice(0, index)
  const tail: Point[] = copy.slice(index + 2)
  const middle: Point[] = []
  if (index === 0) {
    const out = offsetAlong(p, stub)
    middle.push(p, out, place(out))
  } else middle.push(place(p))
  if (index + 1 === n - 1) {
    const back = offsetAlong(q, -stub)
    middle.push(place(back), back, q)
  } else middle.push(place(q))
  return dedupe([...head, ...middle, ...tail])
}

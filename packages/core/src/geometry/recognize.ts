import {
  circularArcFit,
  convexHull,
  cumulativeLengths,
  douglasPeucker,
  fitEllipse,
  minAreaRect,
  pathLength,
  pca,
  polygonArea,
  resample,
} from "../math/fit"
import { type Point, distanceToSegment } from "../math/vector"

/**
 * A recognised stroke in absolute scene coordinates; angles are radians, rotating about the centre.
 * `rx` and `w` lie along `angle`. Triangle vertices wind with positive shoelace area whichever way the
 * stroke went (clockwise on a y-down screen). A rectangle is `rounded` when the stroke clearly rounded
 * its corners. Parallelogram vertices run clockwise (y-down) from the top-left-most one, with opposite
 * sides exactly parallel; polygon vertices (4-6, straight edges) also run clockwise. An arrow runs from
 * `from` to `to`, optionally curving through `via`; its head is at `to` unless `startHead`, when the
 * head was drawn first and sits at `from`. `score` is the fit error over its acceptance threshold (0 is
 * perfect, never above 1).
 */
export type Recognized =
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number; angle: number; score: number }
  | {
      kind: "rectangle"
      cx: number
      cy: number
      w: number
      h: number
      angle: number
      rounded?: boolean
      score: number
    }
  | { kind: "diamond"; cx: number; cy: number; w: number; h: number; score: number }
  | { kind: "triangle"; vertices: [Point, Point, Point]; score: number }
  | { kind: "parallelogram"; vertices: [Point, Point, Point, Point]; score: number }
  | { kind: "polygon"; vertices: Point[]; score: number }
  | { kind: "line"; from: Point; to: Point; score: number }
  | { kind: "arrow"; from: Point; to: Point; via?: Point; score: number; startHead?: boolean }

export interface RecognizeOptions {
  zoom: number
  shift?: boolean
}

const N = 64
const M = 72
const MIN_POINTS = 6
const DEG = Math.PI / 180
const TAU = Math.PI * 2

// Mean outline distance over the bbox diagonal at which a closed shape scores 1; anything worse stays raw.
const T_CLOSED = 0.035
// BEAT[a][b]: the error factor by which model b (ellipse, triangle, quad, pentagon, hexagon) must
// beat a simpler model a, and MIN_GAIN the least absolute improvement that counts.
const BEAT = [
  [1, 0.7, 0.6, 0.8, 0.8],
  [1, 1, 0.55, 0.5, 0.5],
  [1, 1, 1, 0.5, 0.5],
  [1, 1, 1, 1, 0.5],
  [1, 1, 1, 1, 1],
]
const MIN_GAIN = 0.0015

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
  w: number
  h: number
  diag: number
}

const boxOf = (points: readonly Point[]): Box => {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of points) {
    if (p[0] < minX) minX = p[0]
    if (p[0] > maxX) maxX = p[0]
    if (p[1] < minY) minY = p[1]
    if (p[1] > maxY) maxY = p[1]
  }
  const w = maxX - minX
  const h = maxY - minY
  return { minX, minY, maxX, maxY, w, h, diag: Math.hypot(w, h) }
}

const sanitize = (points: readonly Point[]): Point[] => {
  const out: Point[] = []
  for (const p of points) {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue
    const last = out[out.length - 1]
    if (last && last[0] === p[0] && last[1] === p[1]) continue
    out.push([p[0], p[1]])
  }
  return out
}

const angleBetween = (a: Point, b: Point): number => {
  const la = Math.hypot(a[0], a[1])
  const lb = Math.hypot(b[0], b[1])
  if (la === 0 || lb === 0) return 0
  return Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (la * lb))))
}

const signedTurn = (a: Point, b: Point): number =>
  Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]]
const dist = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1])

const centroidOf = (pts: readonly Point[]): Point => {
  let x = 0
  let y = 0
  for (const p of pts) {
    x += p[0]
    y += p[1]
  }
  return [x / pts.length, y / pts.length]
}

const pointAt = (points: readonly Point[], cum: readonly number[], s: number): Point => {
  if (s <= 0) return points[0]!
  const total = cum[cum.length - 1]!
  if (s >= total) return points[points.length - 1]!
  let lo = 0
  let hi = cum.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cum[mid]! < s) lo = mid
    else hi = mid
  }
  const t = cum[hi]! > cum[lo]! ? (s - cum[lo]!) / (cum[hi]! - cum[lo]!) : 0
  const a = points[lo]!
  const b = points[hi]!
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

// Squared distances and one square root: this is the inner loop of every template comparison.
const distanceToPath = (p: Point, path: readonly Point[], closed: boolean): number => {
  let best = Number.POSITIVE_INFINITY
  const n = path.length
  const edges = closed ? n : n - 1
  const px = p[0]
  const py = p[1]
  for (let i = 0; i < edges; i++) {
    const a = path[i]!
    const b = path[i + 1 === n ? 0 : i + 1]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    let t = len2 > 0 ? ((px - a[0]) * dx + (py - a[1]) * dy) / len2 : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const ex = px - a[0] - t * dx
    const ey = py - a[1] - t * dy
    const d = ex * ex + ey * ey
    if (d < best) best = d
  }
  return Math.sqrt(best)
}

const samplePolygon = (verts: readonly Point[], m: number): Point[] =>
  resample([...verts, verts[0]!], m + 1).slice(0, m)

const ellipsePolygon = (cx: number, cy: number, rx: number, ry: number, angle: number, m = 72): Point[] => {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const out: Point[] = []
  for (let i = 0; i < m; i++) {
    const t = (i / m) * TAU
    const x = rx * Math.cos(t)
    const y = ry * Math.sin(t)
    out.push([cx + x * c - y * s, cy + x * s + y * c])
  }
  return out
}

const roundedRectPolygon = (
  cx: number,
  cy: number,
  w: number,
  h: number,
  angle: number,
  r: number,
): Point[] => {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const corners: [number, number, number][] = [
    [w / 2 - r, -h / 2 + r, -Math.PI / 2],
    [w / 2 - r, h / 2 - r, 0],
    [-w / 2 + r, h / 2 - r, Math.PI / 2],
    [-w / 2 + r, -h / 2 + r, Math.PI],
  ]
  const out: Point[] = []
  for (const [x0, y0, a0] of corners) {
    const steps = r > 0 ? 6 : 0
    for (let k = 0; k <= steps; k++) {
      const a = a0 + (k / Math.max(steps, 1)) * (Math.PI / 2)
      const x = x0 + r * Math.cos(a)
      const y = y0 + r * Math.sin(a)
      out.push([cx + x * c - y * s, cy + x * s + y * c])
    }
  }
  return out
}

// Two-way mean distance over the diagonal, the outline measured against the ring with its closing gap
// bridged, so a gap the hand left open does not count against a shape that would close it.
const templateError = (
  stroke: readonly Point[],
  outline: readonly Point[],
  ring: readonly Point[],
  diag: number,
): number => {
  let fwd = 0
  for (const q of stroke) fwd += distanceToPath(q, outline, true)
  fwd /= stroke.length
  const samples = samplePolygon(outline, 48)
  let bwd = 0
  for (const s of samples) bwd += distanceToPath(s, ring, true)
  bwd /= samples.length
  return (fwd + bwd) / 2 / diag
}

// Winding number rather than summed edge turns, which sharp corners make spiky.
const windingAround = (loop: readonly Point[], c: Point): number => {
  let sum = 0
  const n = loop.length
  for (let i = 0; i < n; i++) sum += signedTurn(sub(loop[i]!, c), sub(loop[(i + 1) % n]!, c))
  return Math.round(sum / TAU)
}

// Chords `w` samples long keep per-point noise out of the turn, and never span the closing gap, where
// a hand-drawn loop's ends rarely meet cleanly. Convex turns come out positive.
const chordTurns = (loop: readonly Point[], w: number, orientation: number): number[] => {
  const out: number[] = []
  for (let i = w; i < loop.length - w; i++)
    out.push(orientation * signedTurn(sub(loop[i]!, loop[i - w]!), sub(loop[i + w]!, loop[i]!)))
  return out
}

interface Line2 {
  p: Point
  d: Point
}

const intersectLines = (a: Line2, b: Line2): Point | null => {
  const den = a.d[0] * b.d[1] - a.d[1] * b.d[0]
  if (Math.abs(den) < 1e-9) return null
  const t = ((b.p[0] - a.p[0]) * b.d[1] - (b.p[1] - a.p[1]) * b.d[0]) / den
  return [a.p[0] + a.d[0] * t, a.p[1] + a.d[1] * t]
}

/** Moves each polygon vertex to where least-squares lines through its two edges' points meet. */
const refinePolygon = (loop: readonly Point[], verts: readonly Point[], diag: number): Point[] => {
  let current = [...verts]
  const k = current.length
  for (let iter = 0; iter < 2; iter++) {
    const groups: Point[][] = Array.from({ length: k }, () => [])
    for (const q of loop) {
      let best = Number.POSITIVE_INFINITY
      let edge = -1
      let tBest = 0
      for (let e = 0; e < k; e++) {
        const a = current[e]!
        const b = current[(e + 1) % k]!
        const dx = b[0] - a[0]
        const dy = b[1] - a[1]
        const len2 = dx * dx + dy * dy
        const t = len2 === 0 ? 0 : ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / len2
        const tc = Math.max(0, Math.min(1, t))
        const d = (q[0] - (a[0] + tc * dx)) ** 2 + (q[1] - (a[1] + tc * dy)) ** 2
        if (d < best) {
          best = d
          edge = e
          tBest = t
        }
      }
      // Points near a corner belong to both edges and are bent by the drawn rounding, so skip them.
      if (edge >= 0 && tBest > 0.15 && tBest < 0.85) groups[edge]!.push(q)
    }
    const lines: Line2[] = groups.map((g, e) => {
      const a = current[e]!
      const b = current[(e + 1) % k]!
      if (g.length < 3) return { p: a, d: sub(b, a) }
      const axes = pca(g)
      return { p: axes.mean, d: [Math.cos(axes.angle), Math.sin(axes.angle)] }
    })
    const next: Point[] = []
    for (let i = 0; i < k; i++) {
      const hit = intersectLines(lines[(i - 1 + k) % k]!, lines[i]!)
      next.push(hit ?? current[i]!)
    }
    current = next
  }
  const [cx, cy] = centroidOf(verts)
  return current.map((p, i) => {
    const from = verts[i]!
    const move = sub(p, from)
    const outward = move[0] * (from[0] - cx) + move[1] * (from[1] - cy) >= 0
    const d = Math.hypot(move[0], move[1])
    // Outward recovers a corner the hand rounded off, but a slight bow at a sharp corner moves the
    // intersection far; inward only as far as a noisy hull vertex sticks out past its corner.
    const cap = (outward ? 0.08 : 0.025) * diag
    return d <= cap ? p : [from[0] + (move[0] * cap) / d, from[1] + (move[1] * cap) / d]
  })
}

// The ends are skipped: an overshoot trimmed at the closure can still wobble across itself there.
const selfCrossings = (pts: readonly Point[], skip: number): number => {
  let count = 0
  const n = pts.length
  for (let i = skip; i < n - 1 - skip; i++) {
    for (let j = i + 2; j < n - 1 - skip; j++)
      if (crossing(pts[i]!, pts[i + 1]!, pts[j]!, pts[j + 1]!)) count++
  }
  return count
}

// The k-gon search is cubic in the hull's size, and a dense hull's extra vertices barely bend it.
const reduceHull = (hull: readonly Point[], diag: number, limit = 24): Point[] => {
  if (hull.length <= limit) return [...hull]
  let eps = 0.003 * diag
  for (;;) {
    const kept = douglasPeucker(hull, eps, true)
    if (kept.length <= limit) return kept.map((i) => hull[i]!)
    eps *= 1.5
  }
}

const maxAreaPolygon = (hull: readonly Point[], k: number): Point[] | null => {
  const h = hull.length
  if (h < k) return null
  const tri = (a: Point, b: Point, c: Point) =>
    Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
  let bestArea = -1
  let best: number[] | null = null
  const dp: Float64Array[] = Array.from({ length: k }, () => new Float64Array(h))
  const from: Int32Array[] = Array.from({ length: k }, () => new Int32Array(h))
  // Fan from the first chosen vertex `s`; every other vertex comes later in the hull's order.
  for (let s = 0; s + k - 1 < h; s++) {
    const o = hull[s]!
    for (let j = s + 1; j < h; j++) dp[1]![j] = 0
    for (let m = 2; m < k; m++) {
      for (let j = s + m; j < h; j++) {
        let v = -1
        let arg = -1
        for (let i = s + m - 1; i < j; i++) {
          const a = dp[m - 1]![i]! + tri(o, hull[i]!, hull[j]!)
          if (a > v) {
            v = a
            arg = i
          }
        }
        dp[m]![j] = v
        from[m]![j] = arg
      }
    }
    for (let j = s + k - 1; j < h; j++) {
      if (dp[k - 1]![j]! > bestArea) {
        bestArea = dp[k - 1]![j]!
        const chain = [j]
        for (let m = k - 1; m >= 2; m--) chain.push(from[m]![chain[chain.length - 1]!]!)
        chain.push(s)
        best = chain.reverse()
      }
    }
  }
  return best ? best.map((i) => hull[i]!) : null
}

const interiorAngles = (verts: readonly Point[]): number[] =>
  verts.map((v, i) => {
    const n = verts.length
    return angleBetween(sub(verts[(i - 1 + n) % n]!, v), sub(verts[(i + 1) % n]!, v))
  })

const foldQuarter = (angle: number): number => {
  let a = angle % (Math.PI / 2)
  if (a > Math.PI / 4) a -= Math.PI / 2
  if (a <= -Math.PI / 4) a += Math.PI / 2
  return a
}

const foldHalf = (angle: number): number => {
  let a = angle % Math.PI
  if (a > Math.PI / 2) a -= Math.PI
  if (a <= -Math.PI / 2) a += Math.PI
  return a
}

const rotate = (p: Point, c: Point, angle: number): Point => {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = p[0] - c[0]
  const dy = p[1] - c[1]
  return [c[0] + dx * cos - dy * sin, c[1] + dx * sin + dy * cos]
}

// Top-left-most is the smallest x + y, which picks the same corner whichever way a shape leans.
const clockwiseFromTopLeft = <T extends Point[]>(verts: T): T => {
  const vs = polygonArea(verts) < 0 ? [...verts].reverse() : [...verts]
  let first = 0
  for (let i = 1; i < vs.length; i++) {
    const a = vs[i]![0] + vs[i]![1]
    const b = vs[first]![0] + vs[first]![1]
    if (a < b - 1e-9 || (Math.abs(a - b) <= 1e-9 && vs[i]![1] < vs[first]![1])) first = i
  }
  return [...vs.slice(first), ...vs.slice(0, first)] as T
}

type Shape<K extends Recognized["kind"]> = Extract<Recognized, { kind: K }>

interface Frame {
  cx: number
  cy: number
  w: number
  h: number
  angle: number
}

// Sides sit at the mean of each side's middle stretch, which a rounded corner, a wobble or an overshoot
// pulls far less than they pull the extremes; a corner `radius` narrows the stretch to the straight part.
const fitFrame = (pts: readonly Point[], angle: number, radius = 0): Frame | null => {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const uv = pts.map((p) => [p[0] * c + p[1] * s, -p[0] * s + p[1] * c] as const)
  let u0 = Number.POSITIVE_INFINITY
  let u1 = Number.NEGATIVE_INFINITY
  let v0 = Number.POSITIVE_INFINITY
  let v1 = Number.NEGATIVE_INFINITY
  for (const [u, v] of uv) {
    u0 = Math.min(u0, u)
    u1 = Math.max(u1, u)
    v0 = Math.min(v0, v)
    v1 = Math.max(v1, v)
  }
  const margin = (len: number) => Math.min(0.45, Math.max(0.3, radius / len + 0.02))
  for (let iter = 0; iter < 3; iter++) {
    const w = u1 - u0
    const h = v1 - v0
    const mu = margin(w)
    const mv = margin(h)
    const sum = [0, 0, 0, 0]
    const cnt = [0, 0, 0, 0]
    for (const [u, v] of uv) {
      const d = [Math.abs(v - v0), Math.abs(u - u1), Math.abs(v - v1), Math.abs(u - u0)]
      const side = d.indexOf(Math.min(...d))
      const along = side % 2 === 0 ? (u - u0) / w : (v - v0) / h
      const m = side % 2 === 0 ? mu : mv
      if (along < m || along > 1 - m) continue
      sum[side]! += side % 2 === 0 ? v : u
      cnt[side]!++
    }
    if (cnt[0]! >= 2) v0 = sum[0]! / cnt[0]!
    if (cnt[1]! >= 2) u1 = sum[1]! / cnt[1]!
    if (cnt[2]! >= 2) v1 = sum[2]! / cnt[2]!
    if (cnt[3]! >= 2) u0 = sum[3]! / cnt[3]!
  }
  const w = u1 - u0
  const h = v1 - v0
  if (!(w > 0) || !(h > 0)) return null
  const uc = (u0 + u1) / 2
  const vc = (v0 + v1) / 2
  return { cx: uc * c - vc * s, cy: uc * s + vc * c, w, h, angle }
}

// Quadrupled angles average the edges' directions modulo 90°, so a box's four sides agree.
const quarterAngle = (verts: readonly Point[]): number => {
  let s = 0
  let c = 0
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]!
    const b = verts[(i + 1) % verts.length]!
    const len = dist(a, b)
    const alpha = Math.atan2(b[1] - a[1], b[0] - a[0])
    s += len * Math.sin(4 * alpha)
    c += len * Math.cos(4 * alpha)
  }
  return Math.atan2(s, c) / 4
}

const beautifyEllipse = (r: Shape<"ellipse">): Shape<"ellipse"> => {
  let { rx, ry, angle } = r
  angle = foldQuarter(angle)
  // foldQuarter turned the major axis by ±90°, so the semi-axes swap with it.
  const turns = Math.round((r.angle - angle) / (Math.PI / 2))
  if (turns % 2 !== 0) [rx, ry] = [ry, rx]
  if (Math.max(rx, ry) / Math.min(rx, ry) <= 1.12) {
    const m = (rx + ry) / 2
    return { ...r, rx: m, ry: m, angle: 0 }
  }
  if (Math.abs(angle) <= 8 * DEG) angle = 0
  return { ...r, rx, ry, angle }
}

const beautifyRectangle = (r: Shape<"rectangle">): Shape<"rectangle"> => {
  let { w, h, angle } = r
  const folded = foldQuarter(angle)
  if (Math.round((angle - folded) / (Math.PI / 2)) % 2 !== 0) [w, h] = [h, w]
  angle = Math.abs(folded) <= 10 * DEG ? 0 : folded
  if (Math.max(w, h) / Math.min(w, h) <= 1.12) {
    const m = (w + h) / 2
    w = m
    h = m
  }
  return { ...r, w, h, angle }
}

const beautifyDiamond = (r: Shape<"diamond">): Shape<"diamond"> => {
  const ratio = r.w / r.h
  if (ratio >= 1 / 1.1 && ratio <= 1.1) {
    const m = (r.w + r.h) / 2
    return { ...r, w: m, h: m }
  }
  return r
}

const beautifyTriangle = (r: Shape<"triangle">): Shape<"triangle"> => {
  let v = [...r.vertices] as [Point, Point, Point]
  if (polygonArea(v) < 0) v = [v[0], v[2], v[1]]
  const centroid = centroidOf(v)
  let level = -1
  let levelDelta = Number.POSITIVE_INFINITY
  for (let i = 0; i < 3; i++) {
    const a = v[i]!
    const b = v[(i + 1) % 3]!
    const alpha = foldHalf(Math.atan2(b[1] - a[1], b[0] - a[0]))
    if (Math.abs(alpha) < Math.abs(levelDelta)) {
      levelDelta = alpha
      level = i
    }
  }
  if (Math.abs(levelDelta) <= 6 * DEG)
    v = v.map((p) => rotate(p, centroid, -levelDelta)) as [Point, Point, Point]
  else level = -1
  const side = (i: number) => dist(v[i]!, v[(i + 1) % 3]!)
  const sides = [side(0), side(1), side(2)]
  const close = (a: number, b: number) => Math.abs(a - b) / Math.max(a, b) <= 0.08
  if (close(sides[0]!, sides[1]!) && close(sides[1]!, sides[2]!) && close(sides[0]!, sides[2]!)) {
    // Equilateral about the same centroid, keeping the levelled (or longest) edge's direction.
    const baseIdx = level >= 0 ? level : sides.indexOf(Math.max(...sides))
    const a = v[baseIdx]!
    const b = v[(baseIdx + 1) % 3]!
    const apex = v[(baseIdx + 2) % 3]!
    const s = (sides[0]! + sides[1]! + sides[2]!) / 3
    const dir: Point = [(b[0] - a[0]) / dist(a, b), (b[1] - a[1]) / dist(a, b)]
    let nrm: Point = [-dir[1], dir[0]]
    if ((apex[0] - a[0]) * nrm[0] + (apex[1] - a[1]) * nrm[1] < 0) nrm = [-nrm[0], -nrm[1]]
    const hgt = (s * Math.sqrt(3)) / 2
    const baseMid: Point = [centroid[0] - (nrm[0] * hgt) / 3, centroid[1] - (nrm[1] * hgt) / 3]
    const out: [Point, Point, Point] = [v[0], v[1], v[2]]
    out[baseIdx] = [baseMid[0] - (dir[0] * s) / 2, baseMid[1] - (dir[1] * s) / 2]
    out[(baseIdx + 1) % 3] = [baseMid[0] + (dir[0] * s) / 2, baseMid[1] + (dir[1] * s) / 2]
    out[(baseIdx + 2) % 3] = [baseMid[0] + nrm[0] * hgt, baseMid[1] + nrm[1] * hgt]
    return { ...r, vertices: out }
  }
  // Isosceles: the apex sits between the two near-equal sides; slide it onto the base's bisector. A
  // levelled edge stays put, so only the vertex opposite it may move.
  for (let apexIdx = 0; apexIdx < 3; apexIdx++) {
    if (level >= 0 && apexIdx !== (level + 2) % 3) continue
    const legA = sides[(apexIdx + 2) % 3]!
    const legB = sides[apexIdx]!
    if (!close(legA, legB)) continue
    const a = v[(apexIdx + 1) % 3]!
    const b = v[(apexIdx + 2) % 3]!
    const apex = v[apexIdx]!
    const baseLen = dist(a, b)
    const dir: Point = [(b[0] - a[0]) / baseLen, (b[1] - a[1]) / baseLen]
    const nrm: Point = [-dir[1], dir[0]]
    const hgt = (apex[0] - a[0]) * nrm[0] + (apex[1] - a[1]) * nrm[1]
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const out: [Point, Point, Point] = [v[0], v[1], v[2]]
    out[apexIdx] = [mid[0] + nrm[0] * hgt, mid[1] + nrm[1] * hgt]
    return { ...r, vertices: out }
  }
  return { ...r, vertices: v }
}

const beautifyParallelogram = (q: readonly Point[], score: number): Shape<"parallelogram"> => {
  const pair = (e: number) => {
    const a = sub(q[e + 1]!, q[e]!)
    const b = sub(q[e + 2]!, q[(e + 3) % 4]!)
    const la = Math.hypot(a[0], a[1])
    const lb = Math.hypot(b[0], b[1])
    // Doubled angles average the two directions whichever way each one points.
    const t = Math.atan2(a[1], a[0])
    const u = Math.atan2(b[1], b[0])
    let mean =
      Math.atan2(la * Math.sin(2 * t) + lb * Math.sin(2 * u), la * Math.cos(2 * t) + lb * Math.cos(2 * u)) / 2
    if (Math.cos(mean - t) < 0) mean += Math.PI
    return { angle: mean, len: (la + lb) / 2 }
  }
  const pa = pair(0)
  const pb = pair(1)
  const tiltA = foldHalf(pa.angle)
  const tiltB = foldHalf(pb.angle)
  const tilt = Math.abs(tiltA) <= Math.abs(tiltB) ? tiltA : tiltB
  const turn = Math.abs(tilt) <= 10 * DEG ? -tilt : 0
  const a: Point = [pa.len * Math.cos(pa.angle + turn), pa.len * Math.sin(pa.angle + turn)]
  const b: Point = [pb.len * Math.cos(pb.angle + turn), pb.len * Math.sin(pb.angle + turn)]
  const c = centroidOf(q)
  const vertices: [Point, Point, Point, Point] = [
    [c[0] - (a[0] + b[0]) / 2, c[1] - (a[1] + b[1]) / 2],
    [c[0] + (a[0] - b[0]) / 2, c[1] + (a[1] - b[1]) / 2],
    [c[0] + (a[0] + b[0]) / 2, c[1] + (a[1] + b[1]) / 2],
    [c[0] - (a[0] - b[0]) / 2, c[1] - (a[1] - b[1]) / 2],
  ]
  return { kind: "parallelogram", vertices: clockwiseFromTopLeft(vertices), score }
}

const asDiamond = (q: readonly Point[], score: number): Shape<"diamond"> | null => {
  const byY = [...q].sort((a, b) => a[1] - b[1])
  const byX = [...q].sort((a, b) => a[0] - b[0])
  const top = byY[0]!
  const bottom = byY[3]!
  const left = byX[0]!
  const right = byX[3]!
  if (new Set([top, bottom, left, right]).size !== 4) return null
  const w = right[0] - left[0]
  const h = bottom[1] - top[1]
  if (!(w > 0) || !(h > 0)) return null
  const cx = ((left[0] + right[0]) / 2 + (top[0] + bottom[0]) / 2) / 2
  const cy = ((top[1] + bottom[1]) / 2 + (left[1] + right[1]) / 2) / 2
  const offX = Math.max(Math.abs(top[0] - cx), Math.abs(bottom[0] - cx)) / w
  const offY = Math.max(Math.abs(left[1] - cy), Math.abs(right[1] - cy)) / h
  if (offX > 0.15 || offY > 0.15) return null
  // A parallelogram turned so its corners fall mid-side has clearly unequal sides; a diamond's, even a
  // lopsided one's, are close.
  const sides = q.map((p, i) => dist(p, q[(i + 1) % 4]!))
  if (Math.max(...sides) > 1.6 * Math.min(...sides)) return null
  return { kind: "diamond", cx, cy, w, h, score }
}

interface Fit<S> {
  err: number
  shape: S
}

interface Analysis {
  ring: Point[]
  stroke: Point[]
  // Sampled finely enough to show how closely the stroke turns each corner.
  fine: Point[]
  zoom: number
  box: Box
  hull: Point[]
  hullArea: number
}

const fitEllipseShape = (a: Analysis): Fit<Shape<"ellipse">> | null => {
  const fit = fitEllipse(a.stroke)
  if (!fit) return null
  const { center, rx, ry, angle } = fit
  const { box } = a
  if (center[0] < box.minX || center[0] > box.maxX || center[1] < box.minY || center[1] > box.maxY)
    return null
  const areaRatio = (Math.PI * rx * ry) / a.hullArea
  if (areaRatio < 0.75 || areaRatio > 1.3) return null
  const err = templateError(a.stroke, ellipsePolygon(center[0], center[1], rx, ry, angle), a.ring, box.diag)
  return { err, shape: { kind: "ellipse", cx: center[0], cy: center[1], rx, ry, angle, score: 0 } }
}

const fitPolygonShape = (a: Analysis, reduced: readonly Point[], k: number): Fit<Point[]> | null => {
  const init = maxAreaPolygon(reduced, k)
  if (!init) return null
  const verts = refinePolygon(a.stroke, init, a.box.diag)
  const area = Math.abs(polygonArea(verts))
  if (area / a.hullArea < 0.75 || area / a.hullArea > 1.3) return null
  // A vertex that barely turns, or a needle-sharp one, means fewer or other corners than k. Past four
  // corners a short edge between two blunt ones is a rounded corner cut off, not a corner of its own.
  const flattest = k === 4 ? 150 * DEG : 145 * DEG
  for (const t of interiorAngles(verts)) if (t > flattest || t < 12 * DEG) return null
  if (k > 4) {
    const sides = verts.map((p, i) => dist(p, verts[(i + 1) % k]!))
    if (Math.min(...sides) < 0.4 * Math.max(...sides)) return null
  }
  return { err: templateError(a.stroke, verts, a.ring, a.box.diag), shape: verts }
}

interface RectFit {
  frame: Frame
  sharp: number
  rounded: number
  radius: number
  cut: number
  cutPx: number
}

const ROUNDINGS = [0.08, 0.14, 0.2, 0.27, 0.35, 0.43, 0.5]

const fitRect = (a: Analysis, quad: readonly Point[] | null): RectFit | null => {
  const angle = quad ? quarterAngle(quad) : minAreaRect(a.hull).angle
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  // The radius is chosen on the stroke-to-outline distance alone, which a rounded box has in closed
  // form; only the winner pays for the full two-way comparison.
  const sweep = (frame: Frame) => {
    const { cx, cy, w, h } = frame
    const uv = a.stroke.map((p) => {
      const dx = p[0] - cx
      const dy = p[1] - cy
      return [Math.abs(dx * c + dy * s), Math.abs(-dx * s + dy * c)] as const
    })
    let bestFwd = Number.POSITIVE_INFINITY
    let radius = 0
    for (const f of [0, ...ROUNDINGS]) {
      const r = f * Math.min(w, h)
      let fwd = 0
      for (const [u, v] of uv) {
        const qx = u - (w / 2 - r)
        const qy = v - (h / 2 - r)
        const out = Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2)
        fwd += Math.abs(out + Math.min(Math.max(qx, qy), 0) - r)
      }
      if (fwd < bestFwd) {
        bestFwd = fwd
        radius = f
      }
    }
    return radius
  }
  let frame = fitFrame(a.fine, angle)
  if (!frame) return null
  let radius = sweep(frame)
  // Wide roundings reach into the side middles the frame was measured on, so measure again between.
  if (radius >= 0.2) {
    const refit = fitFrame(a.fine, angle, radius * Math.min(frame.w, frame.h))
    if (refit) {
      frame = refit
      radius = sweep(frame)
    }
  }
  const { cx, cy, w, h } = frame
  const sharp = templateError(a.stroke, roundedRectPolygon(cx, cy, w, h, angle, 0), a.ring, a.box.diag)
  const rounded =
    radius > 0
      ? templateError(
          a.stroke,
          roundedRectPolygon(cx, cy, w, h, angle, radius * Math.min(w, h)),
          a.ring,
          a.box.diag,
        )
      : sharp
  // How far the stroke stays from the corners its sides make, over the shorter side: the hand that
  // rounds a corner on purpose leaves a clear cut; one that only lags at a corner barely does.
  const corners = quad ?? roundedRectPolygon(cx, cy, w, h, angle, 0)
  const cuts = corners.map((c) => distanceToPath(c, a.fine, false)).sort((x, y) => x - y)
  const cut = (cuts[1]! + cuts[2]!) / 2 / Math.min(w, h)
  return { frame, sharp, rounded, radius, cut, cutPx: cut * Math.min(w, h) * a.zoom }
}

const classifyQuad = (q: Point[], rect: RectFit | null, score: number): Recognized | null => {
  const angles = interiorAngles(q)
  const dev = angles.map((t) => t - Math.PI / 2)
  const maxDev = Math.max(...dev.map(Math.abs))
  const alternating = dev.map((d, i) => (i % 2 === 0 ? d : -d))
  const skew = alternating.reduce((s, d) => s + d, 0) / 4
  const spread = Math.max(...alternating.map((d) => Math.abs(d - skew)))
  const sides = q.map((p, i) => dist(p, q[(i + 1) % 4]!))
  const aspect = (sides[0]! + sides[2]!) / (sides[1]! + sides[3]!)
  const tilt = Math.abs(Math.abs(foldQuarter(quarterAngle(q))) - Math.PI / 4)
  // A square turned about 45° is the diamond the user meant; a squarish box at another tilt is not.
  const squareOnPoint = aspect > 0.8 && aspect < 1.25 && tilt < 15 * DEG
  if (maxDev > 15 * DEG || squareOnPoint) {
    const diamond = asDiamond(q, score)
    if (diamond) return diamond
  }
  if (Math.abs(skew) >= 17 * DEG && spread <= 9 * DEG) return beautifyParallelogram(q, score)
  if (maxDev <= 31 * DEG && rect) {
    const { cx, cy, w, h, angle } = rect.frame
    return { kind: "rectangle", cx, cy, w, h, angle, score }
  }
  return { kind: "polygon", vertices: clockwiseFromTopLeft(q), score }
}

const classifyClosed = (loop: readonly Point[], fine: Point[], zoom: number): Recognized | null => {
  const ring = resample([...loop, loop[0]!], M + 1).slice(0, M)
  const stroke = resample(loop, M)
  const box = boxOf(ring)
  if (box.diag <= 0) return null
  const hull = convexHull(ring)
  const hullArea = Math.abs(polygonArea(hull))
  if (!(hullArea > 0)) return null
  const ringArea = polygonArea(ring)
  const convexity = Math.abs(ringArea) / hullArea
  if (convexity < 0.72 || convexity > 1.1) return null
  if (Math.abs(windingAround(ring, centroidOf(hull))) !== 1) return null
  // An outline does not cross itself; a scribble that happens to end where it began does, often.
  if (selfCrossings(stroke, 6) > 0) return null
  const mar = minAreaRect(hull)
  // A sliver this thin is a line drawn back over itself, not a shape.
  if (Math.min(mar.width, mar.height) < 0.1 * Math.max(mar.width, mar.height)) return null

  // A turn past ±150° is a sharp convex corner whose sign the sampling flipped, not a dent.
  const turns = chordTurns(stroke, 3, Math.sign(ringArea) || 1).map((t) => (t < -150 * DEG ? -t : t))
  // A convex template cannot explain a clear inward bend (heart cusp, cloud scallops, a dent). Hands
  // often kink just before a sharp corner, so a bend right next to one is not a dent.
  for (let i = 0; i < turns.length; i++) {
    if (turns[i]! >= -35 * DEG) continue
    const near = turns.slice(Math.max(0, i - 3), i + 4)
    if (Math.max(...near) < 75 * DEG) return null
  }
  // The same across the closure: a heart drawn from its cusp closes on an inward corner.
  const junction =
    (Math.sign(ringArea) || 1) * signedTurn(sub(stroke[M - 1]!, stroke[M - 4]!), sub(stroke[3]!, stroke[0]!))
  if (junction < -35 * DEG && junction > -150 * DEG) return null

  const a: Analysis = { ring, stroke, fine, box, hull, hullArea, zoom }
  const reduced = reduceHull(hull, box.diag)
  const ellipse = fitEllipseShape(a)
  const tri = fitPolygonShape(a, reduced, 3)
  const quad = fitPolygonShape(a, reduced, 4)
  const rect = fitRect(a, quad?.shape ?? null)
  const pent = fitPolygonShape(a, reduced, 5)
  const hex = fitPolygonShape(a, reduced, 6)
  const quadErr = Math.min(quad?.err ?? Number.POSITIVE_INFINITY, rect?.rounded ?? Number.POSITIVE_INFINITY)
  const errs = [
    ellipse?.err ?? Number.POSITIVE_INFINITY,
    tri?.err ?? Number.POSITIVE_INFINITY,
    quadErr,
    pent?.err ?? Number.POSITIVE_INFINITY,
    hex?.err ?? Number.POSITIVE_INFINITY,
  ]
  const beats = (a: number, b: number): boolean => {
    const ea = errs[a]!
    const eb = errs[b]!
    if (ea - eb < MIN_GAIN) return false
    if (a === 1 && b === 2 && quad) {
      // A quad beating a triangle by cutting off one rounded corner has a stub for a fourth side.
      const sides = quad.shape.map((p, i) => dist(p, quad.shape[(i + 1) % 4]!))
      return eb <= (Math.min(...sides) >= 0.25 * Math.max(...sides) ? 0.7 : 0.4) * ea
    }
    if (a !== 0 || b !== 2) return eb <= BEAT[a]![b]! * ea
    // Against an ellipse a rounded rectangle needs the bigger margin, the rounder it is: at its
    // roundest it is nearly an ellipse itself.
    const sharp = quad?.err ?? Number.POSITIVE_INFINITY
    const rounded = rect?.rounded ?? Number.POSITIVE_INFINITY
    return sharp <= 0.85 * ea || rounded <= ((rect?.radius ?? 0) >= 0.4 ? 0.55 : 0.78) * ea
  }
  // Simplest first: a model with more corners must beat the current pick by a clear factor, since
  // extra vertices always absorb some wobble and cut off rounded corners.
  let pick = -1
  for (let k = 0; k < errs.length; k++) {
    if (!Number.isFinite(errs[k]!)) continue
    if (pick < 0 || beats(pick, k)) pick = k
  }
  if (pick < 0 || !(errs[pick]! <= T_CLOSED)) return null
  const score = Math.min(1, errs[pick]! / T_CLOSED)
  switch (pick) {
    case 0:
      return { ...beautifyEllipse(ellipse!.shape), score }
    case 1:
      return beautifyTriangle({ kind: "triangle", vertices: tri!.shape as [Point, Point, Point], score })
    case 2: {
      const shape = quad ? classifyQuad(quad.shape, rect, score) : null
      if (shape && shape.kind !== "rectangle")
        return shape.kind === "diamond" ? beautifyDiamond(shape) : shape
      if (!rect) return null
      const { cx, cy, w, h, angle } = rect.frame
      // Clearly rounded: the stroke keeps well off the corners, relative to the box and on screen.
      const rounded = rect.cut >= 0.06 && rect.cutPx >= 5
      return {
        ...beautifyRectangle({ kind: "rectangle", cx, cy, w, h, angle, score }),
        ...(rounded && { rounded }),
      }
    }
    case 3:
      return { kind: "polygon", vertices: clockwiseFromTopLeft(pent!.shape), score }
    case 4:
      return { kind: "polygon", vertices: clockwiseFromTopLeft(hex!.shape), score }
    default:
      return null
  }
}

/** Drops a short flick at either end (pen-down or lift-off hook) that turns sharply off the stroke. */
const trimHooks = (points: readonly Point[], zoom: number): Point[] => {
  let pts = [...points]
  for (let pass = 0; pass < 2; pass++) {
    const cum = cumulativeLengths(pts)
    const total = cum[cum.length - 1]!
    const hookMax = Math.min(Math.max(0.06 * total, 4 / zoom), 0.15 * total, 10 / zoom)
    const reach = Math.max(0.12 * total, 3 * hookMax)
    let cut = 0
    let sharpest = 60 * DEG
    for (let k = 1; k < pts.length - 1 && cum[k]! <= hookMax; k++) {
      const ahead = pointAt(pts, cum, cum[k]! + reach)
      const a = angleBetween(sub(pts[k]!, pts[0]!), sub(ahead, pts[k]!))
      if (a > sharpest) {
        sharpest = a
        cut = k
      }
    }
    if (cut > 0) pts = pts.slice(cut)
    pts.reverse()
  }
  return pts
}

const snapSegment = (from: Point, to: Point, shift: boolean): [Point, Point] => {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0])
  const step = shift ? Math.PI / 12 : Math.PI / 4
  const target = Math.round(angle / step) * step
  if (!shift && Math.abs(target - angle) > 4 * DEG) return [from, to]
  const mid: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
  return [rotate(from, mid, target - angle), rotate(to, mid, target - angle)]
}

const maxDeviation = (
  points: readonly Point[],
  a: Point,
  b: Point,
  from = 0,
  to = points.length - 1,
): number => {
  let worst = 0
  for (let i = from; i <= to; i++) {
    const d = distanceToSegment(points[i]!, a, b)
    if (d > worst) worst = d
  }
  return worst
}

const tryLine = (pts: readonly Point[], length: number, zoom: number, shift: boolean): Recognized | null => {
  const a = pts[0]!
  const b = pts[pts.length - 1]!
  const chord = dist(a, b)
  if (chord / length < 0.93) return null
  const limit = 0.06 * chord + 3 / zoom
  const dev = maxDeviation(pts, a, b)
  if (dev > limit) return null
  const [from, to] = snapSegment(a, b, shift)
  return { kind: "line", from, to, score: Math.max(dev / limit, (1 - chord / length) / 0.07) }
}

interface ArrowFit {
  from: Point
  to: Point
  via?: Point
  score: number
}

/** An arrow whose head is drawn at the end of `pts`: a straight or arced shaft, then 1-2 barbs. */
const tryArrow = (pts: readonly Point[], zoom: number, shift: boolean): ArrowFit | null => {
  const cum = cumulativeLengths(pts)
  const length = cum[cum.length - 1]!
  const box = boxOf(pts)
  // The tip is the first sharp reversal past the shaft. Simplified vertices catch it at coarse scale;
  // short chords catch a barb that doubles back next to the shaft, which simplification can swallow.
  const idx = douglasPeucker(pts, Math.max(0.04 * box.diag, 1.5 / zoom))
  let tipIdx = -1
  for (let k = 1; k < idx.length - 1; k++) {
    const v = idx[k]!
    if (cum[v]! < 0.35 * length) continue
    const turn = angleBetween(sub(pts[v]!, pts[idx[k - 1]!]!), sub(pts[idx[k + 1]!]!, pts[v]!))
    if (turn >= 100 * DEG) {
      tipIdx = v
      break
    }
  }
  const w = 2
  const chordTurn = (i: number) => angleBetween(sub(pts[i]!, pts[i - w]!), sub(pts[i + w]!, pts[i]!))
  for (let i = w; i < pts.length - w && (tipIdx < 0 || i < tipIdx); i++) {
    if (cum[i]! < 0.35 * length || chordTurn(i) < 100 * DEG) continue
    let sharpest = i
    for (let j = i + 1; j < Math.min(pts.length - w, i + 2 * w + 1); j++) {
      if (chordTurn(j) > chordTurn(sharpest)) sharpest = j
    }
    tipIdx = sharpest
    break
  }
  if (tipIdx < 0) return null
  // The detected vertex lands near the corner; the true tip is the point furthest along the shaft.
  const approach = sub(pts[tipIdx]!, pts[Math.max(0, tipIdx - 6)]!)
  let tip = tipIdx
  for (let i = Math.max(1, tipIdx - 3); i <= Math.min(pts.length - 1, tipIdx + 3); i++) {
    const d = (pts[i]![0] - pts[tip]![0]) * approach[0] + (pts[i]![1] - pts[tip]![1]) * approach[1]
    if (d > 0) tip = i
  }
  const shaftLen = cum[tip]!
  if (shaftLen < 0.35 * length) return null
  const start = pts[0]!
  const tipPt = pts[tip]!
  const chord = dist(start, tipPt)
  if (chord <= 0) return null
  const dev = maxDeviation(pts, start, tipPt, 0, tip)
  const straightLimit = 0.06 * chord + 3 / zoom
  let dir: Point
  let via: Point | undefined
  let shaftScore: number
  if (dev <= straightLimit && chord / shaftLen >= 0.93) {
    dir = [(tipPt[0] - start[0]) / chord, (tipPt[1] - start[1]) / chord]
    shaftScore = dev / straightLimit
  } else {
    const shaft = pts.slice(0, tip + 1)
    const arc = circularArcFit(shaft)
    if (!arc) return null
    const rmsLimit = 0.03 * chord + 1.5 / zoom
    if (arc.rms > rmsLimit) return null
    const sag = dev / chord
    if (sag < 0.05 || sag > 0.6) return null
    const angles = shaft.map((p) => Math.atan2(p[1] - arc.center[1], p[0] - arc.center[0]))
    const steps = angles.slice(1).map((a, i) => {
      const d = a - angles[i]!
      return d > Math.PI ? d - TAU : d < -Math.PI ? d + TAU : d
    })
    const sweep = steps.reduce((acc, d) => acc + d, 0)
    const sign = Math.sign(sweep)
    // The shaft must run one way round the circle, not wander back and forth along it.
    const backward = steps.reduce((acc, d) => (d * sign < 0 ? acc + Math.abs(d) : acc), 0)
    if (Math.abs(sweep) > 220 * DEG || backward > 0.1 * Math.abs(sweep)) return null
    const mid = angles[0]! + sweep / 2
    via = [arc.center[0] + arc.radius * Math.cos(mid), arc.center[1] + arc.radius * Math.sin(mid)]
    const radial = sub(tipPt, arc.center)
    const rl = Math.hypot(radial[0], radial[1])
    dir = [(-radial[1] / rl) * sign, (radial[0] / rl) * sign]
    shaftScore = arc.rms / rmsLimit
  }
  const back: Point = [-dir[0], -dir[1]]
  const head = pts.slice(tip)
  let extent = 0
  for (const h of head) extent = Math.max(extent, dist(h, tipPt))
  if (extent < 0.06 * shaftLen || extent > 0.5 * shaftLen) return null
  // One barb, barb-back-barb or a closed triangle all stay within about four barb lengths.
  if (length - shaftLen > 4.6 * extent) return null
  // Every head point sits in a cone around the reversed shaft, and the first barb comes straight away.
  let travelled = 0
  let reached = false
  let minSide = 0
  let maxSide = 0
  for (let k = 1; k < head.length; k++) {
    travelled += dist(head[k]!, head[k - 1]!)
    const v = sub(head[k]!, tipPt)
    const d = Math.hypot(v[0], v[1])
    if (v[0] * dir[0] + v[1] * dir[1] > Math.max(0.45 * extent, 3 / zoom)) return null
    if (d < 0.6 * extent) continue
    if (!reached && travelled > 1.6 * extent) return null
    reached = true
    // Nearer the tip the angle mostly reflects where the pen landed coming back to it, so only the
    // outer part of each barb is measured.
    if (d < 0.7 * extent) continue
    const ang = Math.atan2(back[0] * v[1] - back[1] * v[0], back[0] * v[0] + back[1] * v[1])
    if (Math.abs(ang) > 80 * DEG) return null
    minSide = Math.min(minSide, ang)
    maxSide = Math.max(maxSide, ang)
  }
  if (!reached) return null
  let headScore: number
  if (minSide < -6 * DEG && maxSide > 6 * DEG) {
    // Two barbs: judge them against their own bisector, which absorbs error in the shaft's direction.
    const skew = Math.abs(minSide + maxSide) / 2
    if (maxSide - minSide > 130 * DEG || skew > 25 * DEG) return null
    headScore = Math.max((maxSide - minSide) / (130 * DEG), skew / (25 * DEG))
  } else {
    const barb = Math.max(-minSide, maxSide)
    // Doubling straight back is a retrace; a lone barb splayed wide reads as a check mark or a corner.
    if (barb < 6 * DEG || barb > 55 * DEG) return null
    headScore = barb / (55 * DEG)
  }
  let from = start
  let to = tipPt
  if (!via) [from, to] = snapSegment(start, tipPt, shift)
  return { from, to, via, score: Math.max(shaftScore, headScore) }
}

const recognizeOpen = (raw: readonly Point[], zoom: number, shift: boolean): Recognized | null => {
  const trimmed = trimHooks(raw, zoom)
  if (trimmed.length < 2) return null
  const pts = resample(trimmed, N)
  const length = pathLength(pts)
  if (!(length > 0)) return null
  const line = tryLine(pts, length, zoom, shift)
  if (line) return line
  const forward = tryArrow(pts, zoom, shift)
  if (forward) return { kind: "arrow", ...forward }
  const reversed = tryArrow([...pts].reverse(), zoom, shift)
  if (reversed) {
    // Head drawn first: keep the drawing direction, so the head sits at `from`.
    const { from, to, via, score } = reversed
    return { kind: "arrow", from: to, to: from, via, score, startHead: true }
  }
  return null
}

// The crossing's position as a fraction along each segment, which places it on the stroke.
const crossing = (a: Point, b: Point, c: Point, d: Point): [number, number] | null => {
  const r = sub(b, a)
  const s = sub(d, c)
  const den = r[0] * s[1] - r[1] * s[0]
  if (Math.abs(den) < 1e-12) return null
  const ca = sub(c, a)
  const t = (ca[0] * s[1] - ca[1] * s[0]) / den
  const u = (ca[0] * r[1] - ca[1] * r[0]) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null
}

// Arc-length positions on the stroke.
interface Loop {
  from: number
  to: number
}

// Crossing ends trim both tails at the crossing. Otherwise the ends' closest approach closes the loop,
// across a gap of up to 30% of the diagonal when the stroke went most of the way round toward its start.
const findLoop = (pts: readonly Point[], box: Box, step: number, zoom: number): Loop | null => {
  const n = pts.length
  const reach = Math.ceil(0.4 * (n - 1))
  const minSpan = Math.floor(n / 3)
  let crossed: Loop | null = null
  for (let i = 0; i < reach; i++) {
    for (let j = n - 1 - reach; j < n - 1; j++) {
      if (j - i < minSpan) continue
      const hit = crossing(pts[i]!, pts[i + 1]!, pts[j]!, pts[j + 1]!)
      if (!hit) continue
      const from = (i + hit[0]) * step
      const to = (j + hit[1]) * step
      if (!crossed || to - from > crossed.to - crossed.from) crossed = { from, to }
    }
  }
  if (crossed) return crossed
  let gap = Number.POSITIVE_INFINITY
  let gi = 0
  let gj = n - 1
  for (let i = 0; i <= reach; i++) {
    for (let j = n - 1 - reach; j < n; j++) {
      if (j - i < minSpan) continue
      const d = dist(pts[i]!, pts[j]!)
      if (d < gap) {
        gap = d
        gi = i
        gj = j
      }
    }
  }
  if (gap > Math.max(0.3 * box.diag, 12 / zoom)) return null
  if (gap > Math.max(0.06 * box.diag, 6 / zoom)) {
    let turn = 0
    for (let k = gi + 1; k < gj; k++) turn += signedTurn(sub(pts[k]!, pts[k - 1]!), sub(pts[k + 1]!, pts[k]!))
    if (Math.abs(turn) < 160 * DEG || Math.abs(turn) > 480 * DEG) return null
    // A loop left open heads on across its gap, though one end may meet it square where the gap cuts
    // a corner; a spiral's gap runs across its direction of travel at both ends.
    const across = sub(pts[gi]!, pts[gj]!)
    const arriving = sub(pts[gj]!, pts[Math.max(0, gj - 3)]!)
    const leaving = sub(pts[Math.min(n - 1, gi + 3)]!, pts[gi]!)
    const a1 = angleBetween(arriving, across)
    const a2 = angleBetween(leaving, across)
    if (Math.max(a1, a2) > 120 * DEG || a1 + a2 > 165 * DEG) return null
  }
  return { from: gi * step, to: gj * step }
}

/**
 * Recognises a freehand stroke (absolute scene points) as a clean shape, or returns null to keep the
 * stroke raw. Pixel tolerances are screen pixels, so they are divided by `zoom`.
 */
export function recognizeStroke(points: readonly Point[], opts: RecognizeOptions): Recognized | null {
  const zoom = Number.isFinite(opts.zoom) && opts.zoom > 0 ? opts.zoom : 1
  const raw = sanitize(points)
  if (raw.length < MIN_POINTS) return null
  const rawBox = boxOf(raw)
  if (rawBox.diag < 16 / zoom) return null
  const open = () => recognizeOpen(raw, zoom, opts.shift ?? false)
  const cum = cumulativeLengths(raw)
  const total = cum[cum.length - 1]!
  const pts = resample(raw, N, 0, total, cum)
  const box = boxOf(pts)
  const step = total / (N - 1)
  const loop = total / box.diag >= 1.8 ? findLoop(pts, box, step, zoom) : null
  if (!loop) return open()
  const loopLen = loop.to - loop.from
  const head = loop.from
  const tail = total - loop.to
  // What the closure trims must be overshoot or a hook. A long lead-in or a second loop means the
  // crossing was incidental: a lasso, or an arrowhead's barb across its own shaft.
  if (head > 0.3 * loopLen || tail > 0.3 * loopLen || head + tail > 0.4 * loopLen) return open()
  const outline = resample(raw, N, loop.from, loop.to, cum)
  const slack = Math.max(0.2 * boxOf(outline).diag, 10 / zoom)
  for (let i = 0; i < N; i++) {
    const s = i * step
    if (s >= loop.from && s <= loop.to) continue
    if (distanceToPath(pts[i]!, outline, true) > slack) return open()
  }
  return classifyClosed(
    resample(raw, M, loop.from, loop.to, cum),
    resample(raw, 4 * M, loop.from, loop.to, cum),
    zoom,
  )
}

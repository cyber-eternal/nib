import { type Point, distanceToSegment } from "./vector"

export const pointToSegment = distanceToSegment

// Math.sqrt over Math.hypot: strokes run to thousands of points and hypot is several times slower.
const segment = (a: Point, b: Point): number => {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  return Math.sqrt(dx * dx + dy * dy)
}

export const pathLength = (points: readonly Point[]): number => {
  let len = 0
  for (let i = 1; i < points.length; i++) len += segment(points[i - 1]!, points[i]!)
  return len
}

/** Running arc length at each vertex; the first entry is 0 and the last is the path length. */
export const cumulativeLengths = (points: readonly Point[]): number[] => {
  const out = new Array<number>(points.length)
  let acc = 0
  for (let i = 0; i < points.length; i++) {
    if (i > 0) acc += segment(points[i - 1]!, points[i]!)
    out[i] = acc
  }
  return out
}

/**
 * `n` points spaced equally along the path's arc length between `from` and `to` (arc-length positions,
 * default the whole path), both ends included. Pass `cumulative` when it is already computed.
 */
export const resample = (
  points: readonly Point[],
  n: number,
  from = 0,
  to = Number.POSITIVE_INFINITY,
  cumulative?: readonly number[],
): Point[] => {
  if (points.length === 0 || n < 1) return []
  if (points.length === 1 || n === 1) return Array.from({ length: n }, () => points[0]!)
  const cum = cumulative ?? cumulativeLengths(points)
  const total = cum[cum.length - 1]!
  const a = Math.min(Math.max(from, 0), total)
  const b = Math.min(Math.max(to, a), total)
  const out: Point[] = []
  let seg = 1
  for (let k = 0; k < n; k++) {
    const s = a + ((b - a) * k) / (n - 1)
    while (seg < points.length - 1 && cum[seg]! < s) seg++
    while (seg > 1 && cum[seg - 1]! > s) seg--
    const s0 = cum[seg - 1]!
    const s1 = cum[seg]!
    const t = s1 > s0 ? Math.min(Math.max((s - s0) / (s1 - s0), 0), 1) : 0
    const p = points[seg - 1]!
    const q = points[seg]!
    out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
  }
  return out
}

/** Convex hull (Andrew's monotone chain) without collinear points or a repeated closing vertex. */
export const convexHull = (points: readonly Point[]): Point[] => {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const turn = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Point[] = []
  for (const p of pts) {
    while (lower.length >= 2 && turn(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Point[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!
    while (upper.length >= 2 && turn(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/** Signed shoelace area of the closed polygon; the sign follows the winding. */
export const polygonArea = (points: readonly Point[]): number => {
  let a = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += points[j]![0] * points[i]![1] - points[i]![0] * points[j]![1]
  }
  return a / 2
}

export interface OrientedRect {
  center: Point
  /** Extent along `angle`. */
  width: number
  height: number
  angle: number
  corners: [Point, Point, Point, Point]
}

interface CaliperBox {
  area: number
  angle: number
  u0: number
  u1: number
  v0: number
  v1: number
}

const boxAlong = (hull: readonly Point[], angle: number): CaliperBox => {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  let u0 = Number.POSITIVE_INFINITY
  let u1 = Number.NEGATIVE_INFINITY
  let v0 = Number.POSITIVE_INFINITY
  let v1 = Number.NEGATIVE_INFINITY
  for (const p of hull) {
    const u = p[0] * c + p[1] * s
    const v = -p[0] * s + p[1] * c
    if (u < u0) u0 = u
    if (u > u1) u1 = u
    if (v < v0) v0 = v
    if (v > v1) v1 = v
  }
  return { area: (u1 - u0) * (v1 - v0), angle, u0, u1, v0, v1 }
}

/**
 * Smallest-area enclosing rectangle by rotating calipers: the optimum has a side on a hull edge, and
 * the extreme points for consecutive edges only ever advance round the hull, so the search is linear.
 */
export const minAreaRect = (points: readonly Point[]): OrientedRect => {
  const raw = convexHull(points)
  const extent = boxAlong(raw, 0)
  // Float-level near-duplicates survive the hull; their edge direction is noise that stalls the calipers.
  const minEdge = 1e-9 * Math.max(extent.u1 - extent.u0, extent.v1 - extent.v0)
  const hull: Point[] = []
  for (const p of raw) {
    const last = hull[hull.length - 1]
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > minEdge) hull.push(p)
  }
  while (
    hull.length > 1 &&
    Math.hypot(hull[0]![0] - hull[hull.length - 1]![0], hull[0]![1] - hull[hull.length - 1]![1]) <= minEdge
  )
    hull.pop()
  const n = hull.length
  let best: CaliperBox | null = null
  if (n === 1) best = boxAlong(hull, 0)
  else if (n === 2) best = boxAlong(hull, Math.atan2(hull[1]![1] - hull[0]![1], hull[1]![0] - hull[0]![0]))
  else if (n > 2) {
    const dot = (p: Point, d: Point) => p[0] * d[0] + p[1] * d[1]
    const advance = (k: number, d: Point, sign: number) => {
      for (let step = 0; step < n; step++) {
        const next = (k + 1) % n
        if (sign * (dot(hull[next]!, d) - dot(hull[k]!, d)) <= 0) break
        k = next
      }
      return k
    }
    // The hull winds with positive area, so its interior lies to the left of every edge.
    let hi = 1
    let far = -1
    let lo = -1
    for (let i = 0; i < n; i++) {
      const a = hull[i]!
      const b = hull[(i + 1) % n]!
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const e: Point = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
      const nrm: Point = [-e[1], e[0]]
      hi = advance(hi, e, 1)
      far = advance(far < 0 ? hi : far, nrm, 1)
      lo = advance(lo < 0 ? far : lo, e, -1)
      const u0 = dot(hull[lo]!, e)
      const u1 = dot(hull[hi]!, e)
      const v0 = dot(a, nrm)
      const v1 = dot(hull[far]!, nrm)
      const area = (u1 - u0) * (v1 - v0)
      if (!best || area < best.area) best = { area, angle: Math.atan2(e[1], e[0]), u0, u1, v0, v1 }
    }
  }
  if (!best) {
    const p = points[0] ?? [0, 0]
    return { center: p, width: 0, height: 0, angle: 0, corners: [p, p, p, p] }
  }
  const { angle, u0, u1, v0, v1 } = best
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const toWorld = (u: number, v: number): Point => [u * c - v * s, u * s + v * c]
  return {
    center: toWorld((u0 + u1) / 2, (v0 + v1) / 2),
    width: u1 - u0,
    height: v1 - v0,
    angle,
    corners: [toWorld(u0, v0), toWorld(u1, v0), toWorld(u1, v1), toWorld(u0, v1)],
  }
}

export interface PrincipalAxes {
  mean: Point
  /** Direction of the major axis. */
  angle: number
  /** Variance along the major axis. */
  lambda1: number
  lambda2: number
}

export const pca = (points: readonly Point[]): PrincipalAxes => {
  const n = points.length || 1
  let mx = 0
  let my = 0
  for (const p of points) {
    mx += p[0]
    my += p[1]
  }
  mx /= n
  my /= n
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (const p of points) {
    const dx = p[0] - mx
    const dy = p[1] - my
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
  }
  sxx /= n
  sxy /= n
  syy /= n
  const half = (sxx + syy) / 2
  const root = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy))
  return {
    mean: [mx, my],
    angle: 0.5 * Math.atan2(2 * sxy, sxx - syy),
    lambda1: half + root,
    lambda2: Math.max(0, half - root),
  }
}

const simplifyRange = (
  points: readonly Point[],
  first: number,
  last: number,
  eps: number,
  keep: boolean[],
) => {
  const stack: [number, number][] = [[first, last]]
  while (stack.length > 0) {
    const [a, b] = stack.pop()!
    let maxD = -1
    let idx = -1
    for (let i = a + 1; i < b; i++) {
      const d = distanceToSegment(points[i]!, points[a]!, points[b]!)
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (idx >= 0 && maxD > eps) {
      keep[idx] = true
      stack.push([a, idx], [idx, b])
    }
  }
}

/**
 * Douglas-Peucker simplification; returns the indices of the kept vertices in path order. A closed
 * polygon is split at two mutually far vertices so the result does not depend on where the path starts;
 * its indices run round the loop from the first of those.
 */
export const douglasPeucker = (points: readonly Point[], epsilon: number, closed = false): number[] => {
  const n = points.length
  if (n <= 2) return points.map((_, i) => i)
  if (!closed) {
    const keep = new Array<boolean>(n).fill(false)
    keep[0] = true
    keep[n - 1] = true
    simplifyRange(points, 0, n - 1, epsilon, keep)
    return keep.flatMap((k, i) => (k ? [i] : []))
  }
  let a = 0
  let far = -1
  for (let i = 0; i < n; i++) {
    const d = (points[i]![0] - points[0]![0]) ** 2 + (points[i]![1] - points[0]![1]) ** 2
    if (d > far) {
      far = d
      a = i
    }
  }
  let b = a
  far = -1
  for (let i = 0; i < n; i++) {
    const d = (points[i]![0] - points[a]![0]) ** 2 + (points[i]![1] - points[a]![1]) ** 2
    if (d > far) {
      far = d
      b = i
    }
  }
  if (a === b) return [0]
  // Rotate so the loop starts at `a` and walk a → b → a as two open runs.
  const order = Array.from({ length: n + 1 }, (_, k) => (a + k) % n)
  const loop = order.map((i) => points[i]!)
  const mid = (b - a + n) % n
  const keep = new Array<boolean>(n + 1).fill(false)
  keep[0] = true
  keep[mid] = true
  keep[n] = true
  simplifyRange(loop, 0, mid, epsilon, keep)
  simplifyRange(loop, mid, n, epsilon, keep)
  const out: number[] = []
  for (let k = 0; k < n; k++) if (keep[k]) out.push(order[k]!)
  return out
}

export interface CircleFit {
  center: Point
  radius: number
  /** Root-mean-square distance of the points from the circle. */
  rms: number
}

const solve3 = (m: number[][], r: number[]): [number, number, number] | null => {
  const a = m.map((row, i) => [...row, r[i]!])
  for (let c = 0; c < 3; c++) {
    let piv = c
    for (let i = c + 1; i < 3; i++) if (Math.abs(a[i]![c]!) > Math.abs(a[piv]![c]!)) piv = i
    if (Math.abs(a[piv]![c]!) < 1e-12) return null
    ;[a[c], a[piv]] = [a[piv]!, a[c]!]
    for (let i = 0; i < 3; i++) {
      if (i === c) continue
      const f = a[i]![c]! / a[c]![c]!
      for (let k = c; k < 4; k++) a[i]![k]! -= f * a[c]![k]!
    }
  }
  return [a[0]![3]! / a[0]![0]!, a[1]![3]! / a[1]![1]!, a[2]![3]! / a[2]![2]!]
}

/** Least-squares circle through the points (Kåsa, then a few geometric Gauss-Newton steps). */
export const circularArcFit = (points: readonly Point[]): CircleFit | null => {
  const n = points.length
  if (n < 3) return null
  let mx = 0
  let my = 0
  for (const p of points) {
    mx += p[0]
    my += p[1]
  }
  mx /= n
  my /= n
  let scale = 0
  for (const p of points) scale += (p[0] - mx) ** 2 + (p[1] - my) ** 2
  scale = Math.sqrt(scale / n)
  if (!(scale > 0)) return null
  const m = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  const r = [0, 0, 0]
  for (const p of points) {
    const x = (p[0] - mx) / scale
    const y = (p[1] - my) / scale
    const z = x * x + y * y
    const row = [x, y, 1]
    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < 3; k++) m[i]![k]! += row[i]! * row[k]!
      r[i]! -= row[i]! * z
    }
  }
  const sol = solve3(m, r)
  if (!sol) return null
  let cx = -sol[0] / 2
  let cy = -sol[1] / 2
  let rad = Math.sqrt(Math.max(0, cx * cx + cy * cy - sol[2]))
  if (!Number.isFinite(rad) || rad > 1e4) return null
  for (let iter = 0; iter < 5; iter++) {
    const jtj = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]
    const jtr = [0, 0, 0]
    for (const p of points) {
      const x = (p[0] - mx) / scale
      const y = (p[1] - my) / scale
      const d = Math.hypot(x - cx, y - cy) || 1e-12
      const res = d - rad
      const jac = [-(x - cx) / d, -(y - cy) / d, -1]
      for (let i = 0; i < 3; i++) {
        for (let k = 0; k < 3; k++) jtj[i]![k]! += jac[i]! * jac[k]!
        jtr[i]! -= jac[i]! * res
      }
    }
    const step = solve3(jtj, jtr)
    if (!step) break
    cx += step[0]
    cy += step[1]
    rad += step[2]
    if (Math.abs(step[0]) + Math.abs(step[1]) + Math.abs(step[2]) < 1e-9) break
  }
  if (!(rad > 0) || !Number.isFinite(rad)) return null
  let ss = 0
  for (const p of points) {
    const x = (p[0] - mx) / scale
    const y = (p[1] - my) / scale
    ss += (Math.hypot(x - cx, y - cy) - rad) ** 2
  }
  return { center: [mx + cx * scale, my + cy * scale], radius: rad * scale, rms: Math.sqrt(ss / n) * scale }
}

export interface EllipseFit {
  center: Point
  /** Semi-axis along `angle`. */
  rx: number
  ry: number
  angle: number
}

const realCubicRoots = (b: number, c: number, d: number): number[] => {
  // x³ + b x² + c x + d = 0
  const p = c - (b * b) / 3
  const q = (2 * b * b * b) / 27 - (b * c) / 3 + d
  const shift = -b / 3
  const disc = (q * q) / 4 + (p * p * p) / 27
  if (Math.abs(p) < 1e-14) return [Math.cbrt(-q) + shift]
  if (disc > 1e-14) {
    const s = Math.sqrt(disc)
    return [Math.cbrt(-q / 2 + s) + Math.cbrt(-q / 2 - s) + shift]
  }
  const r = Math.sqrt(-p / 3)
  const phi = Math.acos(Math.min(1, Math.max(-1, (3 * q) / (2 * p * r))))
  return [0, 1, 2].map((k) => 2 * r * Math.cos(phi / 3 - (2 * Math.PI * k) / 3) + shift)
}

/** Direct least-squares ellipse fit (Fitzgibbon, in Halir and Flusser's stable form). */
export const fitEllipse = (points: readonly Point[]): EllipseFit | null => {
  const n = points.length
  if (n < 5) return null
  let mx = 0
  let my = 0
  for (const p of points) {
    mx += p[0]
    my += p[1]
  }
  mx /= n
  my /= n
  let scale = 0
  for (const p of points) scale += (p[0] - mx) ** 2 + (p[1] - my) ** 2
  scale = Math.sqrt(scale / n)
  if (!(scale > 0)) return null
  const s1 = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  const s2 = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  const s3 = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (const p of points) {
    const x = (p[0] - mx) / scale
    const y = (p[1] - my) / scale
    const d1 = [x * x, x * y, y * y]
    const d2 = [x, y, 1]
    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < 3; k++) {
        s1[i * 3 + k]! += d1[i]! * d1[k]!
        s2[i * 3 + k]! += d1[i]! * d2[k]!
        s3[i * 3 + k]! += d2[i]! * d2[k]!
      }
    }
  }
  const inv3 = (m: number[]): number[] | null => {
    const [a, b, c, d, e, f, g, h, i] = m as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ]
    const A = e * i - f * h
    const B = -(d * i - f * g)
    const C = d * h - e * g
    const det = a * A + b * B + c * C
    if (Math.abs(det) < 1e-14) return null
    return [
      A / det,
      -(b * i - c * h) / det,
      (b * f - c * e) / det,
      B / det,
      (a * i - c * g) / det,
      -(a * f - c * d) / det,
      C / det,
      -(a * h - b * g) / det,
      (a * e - b * d) / det,
    ]
  }
  const mul = (a: number[], b: number[]): number[] => {
    const out = new Array<number>(9).fill(0)
    for (let i = 0; i < 3; i++)
      for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) out[i * 3 + k]! += a[i * 3 + j]! * b[j * 3 + k]!
    return out
  }
  const s3inv = inv3(s3)
  if (!s3inv) return null
  const s2t = [s2[0]!, s2[3]!, s2[6]!, s2[1]!, s2[4]!, s2[7]!, s2[2]!, s2[5]!, s2[8]!]
  const t = mul(s3inv, s2t).map((v) => -v)
  const m0 = mul(s2, t).map((v, i) => v + s1[i]!)
  // Premultiply by inv(C1), C1 = [[0,0,2],[0,-1,0],[2,0,0]].
  const m = [
    m0[6]! / 2,
    m0[7]! / 2,
    m0[8]! / 2,
    -m0[3]!,
    -m0[4]!,
    -m0[5]!,
    m0[0]! / 2,
    m0[1]! / 2,
    m0[2]! / 2,
  ]
  const tr = m[0]! + m[4]! + m[8]!
  const minors = m[0]! * m[4]! - m[1]! * m[3]! + m[0]! * m[8]! - m[2]! * m[6]! + m[4]! * m[8]! - m[5]! * m[7]!
  const det =
    m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) -
    m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) +
    m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!)
  let best: number[] | null = null
  for (const lambda of realCubicRoots(-tr, minors, -det)) {
    const r0 = [m[0]! - lambda, m[1]!, m[2]!]
    const r1 = [m[3]!, m[4]! - lambda, m[5]!]
    const r2 = [m[6]!, m[7]!, m[8]! - lambda]
    const cross = (u: number[], v: number[]) => [
      u[1]! * v[2]! - u[2]! * v[1]!,
      u[2]! * v[0]! - u[0]! * v[2]!,
      u[0]! * v[1]! - u[1]! * v[0]!,
    ]
    const cands = [cross(r0, r1), cross(r0, r2), cross(r1, r2)]
    let v = cands[0]!
    let vn = 0
    for (const c of cands) {
      const nn = c[0]! ** 2 + c[1]! ** 2 + c[2]! ** 2
      if (nn > vn) {
        vn = nn
        v = c
      }
    }
    if (vn < 1e-24) continue
    if (4 * v[0]! * v[2]! - v[1]! ** 2 > 0) {
      best = v
      break
    }
  }
  if (!best) return null
  const [A, B, C] = best as [number, number, number]
  const lin = [
    t[0]! * A + t[1]! * B + t[2]! * C,
    t[3]! * A + t[4]! * B + t[5]! * C,
    t[6]! * A + t[7]! * B + t[8]! * C,
  ]
  const [D, E, F] = lin as [number, number, number]
  const den = 4 * A * C - B * B
  if (!(Math.abs(den) > 1e-14)) return null
  const x0 = (B * E - 2 * C * D) / den
  const y0 = (B * D - 2 * A * E) / den
  const f0 = A * x0 * x0 + B * x0 * y0 + C * y0 * y0 + D * x0 + E * y0 + F
  const angle = 0.5 * Math.atan2(B, A - C)
  const ca = Math.cos(angle)
  const sa = Math.sin(angle)
  const mu1 = A * ca * ca + B * ca * sa + C * sa * sa
  const mu2 = A * sa * sa - B * ca * sa + C * ca * ca
  const rx = Math.sqrt(-f0 / mu1)
  const ry = Math.sqrt(-f0 / mu2)
  if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx <= 0 || ry <= 0) return null
  return { center: [mx + x0 * scale, my + y0 * scale], rx: rx * scale, ry: ry * scale, angle }
}

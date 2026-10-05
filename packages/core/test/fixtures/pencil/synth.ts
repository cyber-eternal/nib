import { cumulativeLengths, resample } from "../../../src/math/fit"
import { type Rng, mulberry32 } from "../../../src/math/random"
import type { Point } from "../../../src/math/vector"

export type ShapeKind =
  | "ellipse"
  | "rectangle"
  | "diamond"
  | "triangle"
  | "line"
  | "arrow"
  | "parallelogram"
  | "polygon"

export const SHAPE_KINDS: readonly ShapeKind[] = [
  "ellipse",
  "rectangle",
  "diamond",
  "triangle",
  "line",
  "arrow",
  "parallelogram",
  "polygon",
]

/** The ways real mouse and trackpad strokes went uncorrected, each with the shape the user meant. */
export const CASES = {
  "rect-wavy": "rectangle",
  "rect-loose": "rectangle",
  "rect-tails": "rectangle",
  "rect-gap": "rectangle",
  "rect-rounded": "rectangle",
  "square-slanted": "rectangle",
  blob: "rectangle",
  "ellipse-gap": "ellipse",
  "triangle-tails": "triangle",
  "parallelogram-wavy": "parallelogram",
} as const satisfies Record<string, ShapeKind>

export type CaseName = keyof typeof CASES

export const CASE_NAMES = Object.keys(CASES) as CaseName[]

export const NEGATIVE_KINDS = [
  "scribble",
  "spiral",
  "zigzag",
  "s-curve",
  "c-arc",
  "star",
  "figure-8",
  "squiggle",
  "dot",
  "heart",
  "cloud",
  "check",
  "wave",
  "retrace",
  "gentle-arc",
  "cursive",
  "lasso",
] as const

export type NegativeKind = (typeof NEGATIVE_KINDS)[number]

export type Truth =
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number; angle: number }
  | {
      kind: "rectangle"
      cx: number
      cy: number
      w: number
      h: number
      angle: number
      /** Corners drawn clearly rounded. */
      rounded?: boolean
      /** The drawn quad when only roughly rectangular; the result is judged against it. */
      quad?: Point[]
    }
  | { kind: "diamond"; cx: number; cy: number; w: number; h: number }
  | { kind: "triangle"; vertices: [Point, Point, Point] }
  | { kind: "parallelogram"; vertices: [Point, Point, Point, Point] }
  | { kind: "polygon"; vertices: Point[] }
  | { kind: "line"; from: Point; to: Point }
  | { kind: "arrow"; from: Point; to: Point; via?: Point; startHead: boolean }

export interface Sample {
  points: Point[]
  zoom: number
  label: string
  truth?: Truth
}

const DEG = Math.PI / 180

const uniform = (rng: Rng, a: number, b: number) => a + (b - a) * rng()
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!
const gauss = (rng: Rng) => {
  const u = Math.max(rng(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}
const rot = (p: Point, angle: number, c: Point = [0, 0]): Point => {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = p[0] - c[0]
  const dy = p[1] - c[1]
  return [c[0] + dx * cos - dy * sin, c[1] + dx * sin + dy * cos]
}
const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Dense polyline through straight segments. */
const polyline = (verts: readonly Point[], perSegment = 40): Point[] => {
  const out: Point[] = []
  for (let i = 0; i < verts.length - 1; i++) {
    for (let k = 0; k < perSegment; k++) out.push(lerp(verts[i]!, verts[i + 1]!, k / perSegment))
  }
  out.push(verts[verts.length - 1]!)
  return out
}

/** Closed outline with each corner cut by a quadratic curve `cornerFrac` of the shorter adjacent edge. */
const roundedPolygon = (verts: readonly Point[], cornerFrac: number): Point[] => {
  const n = verts.length
  const out: Point[] = []
  for (let i = 0; i < n; i++) {
    const prev = verts[(i - 1 + n) % n]!
    const v = verts[i]!
    const next = verts[(i + 1) % n]!
    const t = cornerFrac * Math.min(dist(prev, v), dist(v, next))
    const pin = lerp(v, prev, t / dist(prev, v))
    const pout = lerp(v, next, t / dist(v, next))
    for (let k = 0; k <= 8; k++) {
      const s = k / 8
      const a = lerp(pin, v, s)
      const b = lerp(v, pout, s)
      out.push(lerp(a, b, s))
    }
    const nextIn = lerp(verts[(i + 1) % n]!, v, t / dist(v, next) || 0)
    for (let k = 1; k < 40; k++) out.push(lerp(pout, nextIn, k / 40))
  }
  return out
}

const ellipseOutline = (cx: number, cy: number, rx: number, ry: number, angle: number): Point[] => {
  const out: Point[] = []
  for (let i = 0; i < 720; i++) {
    const t = (i / 720) * Math.PI * 2
    out.push(rot([cx + rx * Math.cos(t), cy + ry * Math.sin(t)], angle, [cx, cy]))
  }
  return out
}

/** Walks a closed outline from `startFrac`, either way round, stopping `gap` short or `overshoot` past. */
const traceClosed = (outline: readonly Point[], rng: Rng, gap: number, overshootFrac: number): Point[] => {
  let ring = [...outline]
  if (rng() < 0.5) ring.reverse()
  const startIdx = Math.floor(rng() * ring.length)
  ring = ring.slice(startIdx).concat(ring.slice(0, startIdx))
  const loop = [...ring, ring[0]!]
  const cum = cumulativeLengths(loop)
  const perimeter = cum[cum.length - 1]!
  const travel = perimeter * (1 + overshootFrac) - gap
  const twice = [...loop, ...loop.slice(1)]
  const n = Math.ceil(travel / (perimeter / 900))
  return resample(twice, Math.max(n, 50), 0, travel)
}

/** Signed shoelace area; positive for clockwise on a y-down screen. */
const shoelace = (verts: readonly Point[]) => {
  let a = 0
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++)
    a += verts[j]![0] * verts[i]![1] - verts[i]![0] * verts[j]![1]
  return a / 2
}

interface OutlineOptions {
  /** Corner cut as a fraction of the shorter adjacent edge, per vertex. */
  cornerFrac: readonly number[]
  /** Peak outward offset of each edge's middle as a fraction of its length (negative bows inward). */
  bulge?: readonly number[]
  /** Wobble amplitude along each edge in scene units; it fades out towards the corners. */
  wave?: number
  rng: Rng
}

/**
 * Closed outline from vertex 0 round to it again: edges that bulge or wobble, corners rounded by a
 * quadratic curve. Vertex 0 stays sharp when its corner fraction is 0, so tails can leave from it.
 */
const shapeOutline = (verts: readonly Point[], o: OutlineOptions): Point[] => {
  const n = verts.length
  const sign = Math.sign(shoelace(verts)) || 1
  const len = verts.map((v, i) => dist(v, verts[(i + 1) % n]!))
  const cut = verts.map((_, i) => o.cornerFrac[i]! * Math.min(len[(i - 1 + n) % n]!, len[i]!))
  const waves = verts.map(() => ({
    k: Math.floor(uniform(o.rng, 2, 6)),
    phase: uniform(o.rng, 0, 2 * Math.PI),
  }))
  const onEdge = (e: number, t: number): Point => {
    const a = verts[e]!
    const b = verts[(e + 1) % n]!
    const d: Point = [(b[0] - a[0]) / len[e]!, (b[1] - a[1]) / len[e]!]
    const out: Point = [sign * d[1], -sign * d[0]]
    const env = Math.sin(Math.PI * t)
    const off =
      (o.bulge?.[e] ?? 0) * len[e]! * env +
      (o.wave ?? 0) * env * Math.sin(waves[e]!.k * Math.PI * t + waves[e]!.phase)
    const p = lerp(a, b, t)
    return [p[0] + out[0] * off, p[1] + out[1] * off]
  }
  const pts: Point[] = []
  for (let e = 0; e < n; e++) {
    const t0 = cut[e]! / len[e]!
    const t1 = 1 - cut[(e + 1) % n]! / len[e]!
    const steps = 60
    for (let k = 0; k <= steps; k++) pts.push(onEdge(e, t0 + ((t1 - t0) * k) / steps))
    const next = (e + 1) % n
    const from = onEdge(e, t1)
    const to = onEdge(next, cut[next]! / len[next]!)
    for (let k = 1; k < 10; k++) {
      const s = k / 10
      pts.push(lerp(lerp(from, verts[next]!, s), lerp(verts[next]!, to, s), s))
    }
  }
  pts.push(pts[0]!)
  return pts
}

/** `verts` rotated to start at a random vertex, either way round. */
const startAnywhere = (verts: readonly Point[], rng: Rng): Point[] => {
  let vs = [...verts]
  if (rng() < 0.5) vs.reverse()
  const k = Math.floor(rng() * vs.length)
  vs = vs.slice(k).concat(vs.slice(0, k))
  return vs
}

type Tail = "x" | "end-l" | "start-l" | "retrace" | "hook"

/** A closed outline that starts at its (sharp) first vertex, with the overshoot or hook of `tail`. */
const withTail = (outline: readonly Point[], tail: Tail, rng: Rng, size: number): Point[] => {
  const start = outline[0]!
  const firstDir = (() => {
    const p = outline.find((q) => dist(q, start) > 1e-6 * size) ?? start
    const l = dist(p, start) || 1
    return [(p[0] - start[0]) / l, (p[1] - start[1]) / l] as Point
  })()
  const lastDir = (() => {
    let p = start
    for (let i = outline.length - 2; i >= 0; i--) {
      if (dist(outline[i]!, start) > 1e-6 * size) {
        p = outline[i]!
        break
      }
    }
    const l = dist(p, start) || 1
    return [(start[0] - p[0]) / l, (start[1] - p[1]) / l] as Point
  })()
  let path = [...outline]
  const along = (p: Point, d: Point, s: number): Point => [p[0] + d[0] * s, p[1] + d[1] * s]
  if (tail === "x" || tail === "start-l")
    path = [along(start, firstDir, -uniform(rng, 0.04, 0.13) * size), ...path]
  if (tail === "x" || tail === "end-l") path.push(along(start, lastDir, uniform(rng, 0.04, 0.16) * size))
  if (tail === "retrace") {
    const cum = cumulativeLengths(outline)
    const extra = resample(outline, 40, 0, uniform(rng, 0.03, 0.12) * cum[cum.length - 1]!, cum)
    path.push(...extra.slice(1))
  }
  if (tail === "hook") {
    const turn = (rng() < 0.5 ? 1 : -1) * uniform(rng, 100, 160) * DEG
    const dir = Math.atan2(firstDir[1], firstDir[0]) + turn
    const len = uniform(rng, 0.03, 0.07) * size
    const tip: Point = [start[0] + Math.cos(dir) * len, start[1] + Math.sin(dir) * len]
    path = [tip, lerp(tip, start, 0.5), ...path]
  }
  return path
}

interface HandOptions {
  size: number
  zoom: number
  jitter: number
  hooks: boolean
  minPoints?: number
}

interface Drawn {
  points: Point[]
  /** Where the hand put an ideal path point: the drift at the nearest point along the path. */
  displace: (p: Point) => Point
}

const hand = (path: readonly Point[], rng: Rng, o: HandOptions): Point[] => handDrawn(path, rng, o).points

/** Turns an ideal path into a mouse-like stroke: smooth wobble, uneven spacing, noise and end hooks. */
const handDrawn = (path: readonly Point[], rng: Rng, o: HandOptions): Drawn => {
  const cum = cumulativeLengths(path)
  const total = cum[cum.length - 1]!
  if (total === 0) return { points: [...path], displace: (p) => p }
  const amp = o.jitter * o.size
  // The hand drifts as a smooth 2D displacement of the pen, so a sharp corner moves rigidly rather
  // than being pushed out along its bisector as an offset along the normal would.
  const wave = () => {
    const l1 = total * uniform(rng, 0.3, 1)
    const l2 = total * uniform(rng, 0.1, 0.25)
    const p1 = uniform(rng, 0, 2 * Math.PI)
    const p2 = uniform(rng, 0, 2 * Math.PI)
    return (s: number) =>
      amp * (0.7 * Math.sin((2 * Math.PI * s) / l1 + p1) + 0.3 * Math.sin((2 * Math.PI * s) / l2 + p2))
  }
  const driftX = wave()
  const driftY = wave()
  const lv = total * uniform(rng, 0.2, 0.6)
  const pv = uniform(rng, 0, 2 * Math.PI)
  let spacing = uniform(rng, 2, 14) / o.zoom
  spacing = Math.min(spacing, total / (o.minPoints ?? 10))
  const window = Math.max(0.015 * total, 2 / o.zoom)
  // Hands slow down into sharp turns, so points bunch up at corners and arrow tips.
  const slowdown = (s: number) => {
    const a = at(Math.max(0, s - window))
    const b = at(s)
    const c = at(Math.min(total, s + window))
    const u: Point = [b[0] - a[0], b[1] - a[1]]
    const v: Point = [c[0] - b[0], c[1] - b[1]]
    const lu = Math.hypot(u[0], u[1])
    const lv2 = Math.hypot(v[0], v[1])
    if (lu === 0 || lv2 === 0) return 1
    const turn = Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (lu * lv2))))
    return 1 - 0.75 * Math.min(1, turn / (Math.PI / 2))
  }
  const positions: number[] = [0]
  for (let s = 0; s < total; ) {
    s += spacing * slowdown(s) * (1 + 0.5 * Math.sin((2 * Math.PI * s) / lv + pv)) * uniform(rng, 0.7, 1.3)
    positions.push(Math.min(s, total))
  }
  function at(s: number): Point {
    if (s <= 0) return path[0]!
    if (s >= total) return path[path.length - 1]!
    let lo = 0
    let hi = cum.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (cum[mid]! < s) lo = mid
      else hi = mid
    }
    const span = cum[hi]! - cum[lo]!
    return lerp(path[lo]!, path[hi]!, span > 0 ? (s - cum[lo]!) / span : 0)
  }
  const noise = Math.min(0.004 * o.size, 0.6 / o.zoom)
  const quantum = rng() < 0.5 ? 0.5 / o.zoom : 0
  const out: Point[] = []
  for (const s of positions) {
    const p = at(s)
    let q: Point = [p[0] + driftX(s) + gauss(rng) * noise, p[1] + driftY(s) + gauss(rng) * noise]
    if (quantum) q = [Math.round(q[0] / quantum) * quantum, Math.round(q[1] / quantum) * quantum]
    out.push(q)
  }
  if (o.hooks && out.length > 4) {
    const hook = (end: Point, toward: Point): Point[] => {
      const dir = Math.atan2(toward[1] - end[1], toward[0] - end[0])
      const ang = dir + (rng() < 0.5 ? 1 : -1) * uniform(rng, 90, 160) * DEG
      const len = uniform(rng, 1.5, 5) / o.zoom
      const tipPt: Point = [end[0] + Math.cos(ang) * len, end[1] + Math.sin(ang) * len]
      return [tipPt, lerp(tipPt, end, 0.5)]
    }
    if (rng() < 0.6) out.unshift(...hook(out[0]!, out[3]!))
    if (rng() < 0.6) out.push(...hook(out[out.length - 1]!, out[out.length - 4]!).reverse())
  }
  const displace = (p: Point): Point => {
    let best = 0
    for (let i = 1; i < path.length; i++) if (dist(path[i]!, p) < dist(path[best]!, p)) best = i
    const at = cum[best]!
    return [p[0] + driftX(at), p[1] + driftY(at)]
  }
  return { points: out, displace }
}

const logUniform = (rng: Rng, a: number, b: number) => Math.exp(uniform(rng, Math.log(a), Math.log(b)))

interface Setup {
  rng: Rng
  zoom: number
  /** Shape size in scene units (the on-screen size is size × zoom). */
  size: number
  center: Point
  jitter: number
}

const setup = (seed: number, minScreen = 20, maxScreen = 800): Setup => {
  const rng = mulberry32(seed)
  const zoom = pick(rng, [0.5, 1, 1, 1, 2])
  const screen = logUniform(rng, minScreen, maxScreen)
  return {
    rng,
    zoom,
    size: screen / zoom,
    center: [uniform(rng, -2000, 2000), uniform(rng, -2000, 2000)],
    jitter: uniform(rng, 0.02, 0.04),
  }
}

const closure = (rng: Rng, diag: number) => {
  const r = rng()
  if (r < 0.35) return { gap: uniform(rng, 0, 0.15) * diag, overshoot: 0 }
  if (r < 0.7) return { gap: 0, overshoot: uniform(rng, 0, 0.1) }
  return { gap: 0, overshoot: 0 }
}

const foldHalf = (a: number) => {
  let r = a % Math.PI
  if (r > Math.PI / 2) r -= Math.PI
  if (r < -Math.PI / 2) r += Math.PI
  return r
}

/** How far edge `e` of a closed polygon is from level, in [0, 90°]. */
const sideTilt = (verts: readonly Point[], e: number) => {
  const a = verts[e]!
  const b = verts[(e + 1) % verts.length]!
  return Math.abs(foldHalf(Math.atan2(b[1] - a[1], b[0] - a[0])))
}

/** Corners near the middles of the bounding box's sides, as a diamond's are. */
const diamondLike = (verts: readonly Point[]) => {
  const xs = verts.map((p) => p[0])
  const ys = verts.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const mid: Point[] = [
    [(x0 + x1) / 2, y0],
    [x1, (y0 + y1) / 2],
    [(x0 + x1) / 2, y1],
    [x0, (y0 + y1) / 2],
  ]
  return mid.every((m) => verts.some((v) => dist(v, m) < 0.25 * Math.min(x1 - x0, y1 - y0)))
}

const boxVerts = (cx: number, cy: number, w: number, h: number, angle: number): Point[] =>
  (
    [
      [cx - w / 2, cy - h / 2],
      [cx + w / 2, cy - h / 2],
      [cx + w / 2, cy + h / 2],
      [cx - w / 2, cy + h / 2],
    ] as Point[]
  ).map((p) => rot(p, angle, [cx, cy]))

/** Top side shifted right by `skew` (a positive skew leans the sides right), clockwise from top-left. */
const parallelogramVerts = (cx: number, cy: number, w: number, h: number, skew: number, angle: number) => {
  const s = (h * Math.tan(skew)) / 2
  const upright: Point[] = [
    [cx - w / 2 + s, cy - h / 2],
    [cx + w / 2 + s, cy - h / 2],
    [cx + w / 2 - s, cy + h / 2],
    [cx - w / 2 - s, cy + h / 2],
  ]
  return upright.map((p) => rot(p, angle, [cx, cy]))
}

const polygonVerts = (
  style: "trapezoid" | "pentagon" | "hexagon",
  rng: Rng,
  cx: number,
  cy: number,
  size: number,
): Point[] => {
  if (style === "trapezoid") {
    const w = size
    let h: number
    let beta: number
    do {
      h = w / uniform(rng, 1.1, 2.5)
      beta = uniform(rng, 35, 55) * DEG
    } while (w - (2 * h) / Math.tan(beta) < 0.3 * w)
    const inset = h / Math.tan(beta)
    const right = rng() < 0.3
    const top: [Point, Point] = right
      ? [
          [cx - w / 2, cy - h / 2],
          [cx + w / 2 - inset, cy - h / 2],
        ]
      : [
          [cx - w / 2 + inset, cy - h / 2],
          [cx + w / 2 - inset, cy - h / 2],
        ]
    const verts: Point[] = [top[0], top[1], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]]
    const flip = rng() < 0.3 ? Math.PI : 0
    return verts.map((p) => rot(p, flip + uniform(rng, -3, 3) * DEG, [cx, cy]))
  }
  const k = style === "pentagon" ? 5 : 6
  const stretch = style === "hexagon" ? uniform(rng, 1, 1.4) : 1
  const turn = uniform(rng, 0, 2 * Math.PI)
  const spin = uniform(rng, 0, Math.PI)
  const verts: Point[] = []
  for (let i = 0; i < k; i++) {
    const a = turn + (i * 2 * Math.PI) / k
    const r = (size / 2) * uniform(rng, 0.95, 1.05)
    verts.push(rot([cx + r * Math.cos(a) * stretch, cy + r * Math.sin(a)], spin, [cx, cy]))
  }
  return verts
}

const rectSize = (rng: Rng, size: number, squareChance = 0.3) => {
  const square = rng() < squareChance
  const aspect = square ? uniform(rng, 1, 1.05) : uniform(rng, 1.25, 3.2)
  return { w: size, h: size / aspect, square }
}

const rectAngle = (rng: Rng, square: boolean) =>
  rng() < 0.6 ? uniform(rng, -3, 3) * DEG : (rng() < 0.5 ? -1 : 1) * uniform(rng, 12, square ? 30 : 40) * DEG

const interiorAngles = (verts: readonly Point[]): number[] =>
  verts.map((v, i) => {
    const a = verts[(i - 1 + verts.length) % verts.length]!
    const b = verts[(i + 1) % verts.length]!
    const u: Point = [a[0] - v[0], a[1] - v[1]]
    const w: Point = [b[0] - v[0], b[1] - v[1]]
    return Math.acos(
      Math.max(
        -1,
        Math.min(1, (u[0] * w[0] + u[1] * w[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(w[0], w[1]))),
      ),
    )
  })

/** Where the lines through a→b and c→d meet. */
const meet = (a: Point, b: Point, c: Point, d: Point): Point => {
  const r: Point = [b[0] - a[0], b[1] - a[1]]
  const s: Point = [d[0] - c[0], d[1] - c[1]]
  const den = r[0] * s[1] - r[1] * s[0]
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den
  return [a[0] + r[0] * t, a[1] + r[1] * t]
}

/** Turns side `e` of a quad about its first vertex, sliding the next vertex along the side after it. */
const slopeSide = (vs: Point[], e: number, slope: number) => {
  const a = vs[e]!
  const b = rot(vs[(e + 1) % 4]!, slope, a)
  vs[(e + 1) % 4] = meet(a, b, vs[(e + 1) % 4]!, vs[(e + 2) % 4]!)
}

/**
 * A rectangle drawn loosely: one side sloped `main` degrees off square, maybe a neighbouring side by
 * `second`, every corner within 65-115° and no side shrunk to a sliver, so it still reads as a box.
 */
const looseQuad = (
  rng: Rng,
  verts: readonly Point[],
  main: [number, number],
  second: [number, number],
): Point[] => {
  const sides = (vs: readonly Point[]) => vs.map((v, i) => dist(v, vs[(i + 1) % 4]!))
  const before = sides(verts)
  const short = Math.min(...before)
  for (;;) {
    const vs = verts.map(
      (v) => [v[0] + uniform(rng, -0.03, 0.03) * short, v[1] + uniform(rng, -0.03, 0.03) * short] as Point,
    )
    const e = Math.floor(rng() * 4)
    slopeSide(vs, e, (rng() < 0.5 ? -1 : 1) * uniform(rng, main[0], main[1]) * DEG)
    slopeSide(
      vs,
      (e + (rng() < 0.5 ? 1 : 3)) % 4,
      (rng() < 0.5 ? -1 : 1) * uniform(rng, second[0], second[1]) * DEG,
    )
    const after = sides(vs)
    if (after.some((l, i) => l < 0.7 * before[i]! || l > 1.3 * before[i]!)) continue
    if (interiorAngles(vs).every((t) => Math.abs(t - Math.PI / 2) <= 25 * DEG)) return vs
  }
}

/** A triangle `size` across: equilateral, isosceles, scalene or right; level or clearly not. */
const triangleVerts = (rng: Rng, size: number, center: Point) => {
  const [cx, cy] = center
  const style = pick(rng, ["equilateral", "isosceles", "scalene", "right"] as const)
  let verts: Point[]
  if (style === "equilateral") {
    verts = [0, 1, 2].map(
      (k) =>
        [
          Math.cos(-Math.PI / 2 + (k * 2 * Math.PI) / 3),
          Math.sin(-Math.PI / 2 + (k * 2 * Math.PI) / 3),
        ] as Point,
    )
  } else if (style === "isosceles") {
    const apexAngle = uniform(rng, 35, 110) * DEG
    verts = [
      [0, -1],
      [Math.sin(apexAngle / 2) * 2, -1 + Math.cos(apexAngle / 2) * 2],
      [-Math.sin(apexAngle / 2) * 2, -1 + Math.cos(apexAngle / 2) * 2],
    ]
  } else if (style === "right") {
    const legs = uniform(rng, 1.25, 2.2)
    verts = [
      [0, 0],
      [legs, 0],
      [0, 1],
    ]
  } else {
    // Scalene: rejection-sample until every pair of sides differs by over 15% and no angle is under 25°.
    for (;;) {
      const v: Point[] = [
        [0, 0],
        [1, 0],
        [uniform(rng, -0.3, 1.3), uniform(rng, 0.4, 1.2)],
      ]
      const sides = [dist(v[0]!, v[1]!), dist(v[1]!, v[2]!), dist(v[2]!, v[0]!)].sort((a, b) => a - b)
      const ok = sides[1]! / sides[0]! > 1.15 && sides[2]! / sides[1]! > 1.15
      const ang = (a: Point, b: Point, c: Point) =>
        Math.acos(((b[0] - a[0]) * (c[0] - a[0]) + (b[1] - a[1]) * (c[1] - a[1])) / (dist(a, b) * dist(a, c)))
      const minAngle = Math.min(ang(v[0]!, v[1]!, v[2]!), ang(v[1]!, v[2]!, v[0]!), ang(v[2]!, v[0]!, v[1]!))
      if (ok && minAngle > 25 * DEG) {
        verts = v
        break
      }
    }
  }
  // Either one edge level, or every edge well away from level so beautify leaves it alone.
  const level = rng() < 0.4
  let rotation = 0
  const edgeTilt = (vs: readonly Point[], r: number) =>
    Math.min(
      ...[0, 1, 2].map((i) => {
        const a = rot(vs[i]!, r)
        const b = rot(vs[(i + 1) % 3]!, r)
        const t = Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0])) % Math.PI
        return Math.min(t, Math.PI - t)
      }),
    )
  if (level) {
    const a = verts[0]!
    const b = verts[1]!
    rotation = -Math.atan2(b[1] - a[1], b[0] - a[0]) + uniform(rng, -2, 2) * DEG
    if (style === "equilateral" || style === "isosceles")
      rotation = uniform(rng, -2, 2) * DEG + (rng() < 0.5 ? 0 : Math.PI)
  } else {
    do rotation = uniform(rng, 0, 2 * Math.PI)
    while (edgeTilt(verts, rotation) < 12 * DEG)
  }
  const bbox = (vs: readonly Point[]) => {
    const xs = vs.map((p) => p[0])
    const ys = vs.map((p) => p[1])
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  }
  const rotated = verts.map((p) => rot(p, rotation))
  const k = size / bbox(rotated)
  const cen: Point = [
    (rotated[0]![0] + rotated[1]![0] + rotated[2]![0]) / 3,
    (rotated[0]![1] + rotated[1]![1] + rotated[2]![1]) / 3,
  ]
  const tri = rotated.map((p) => [cx + (p[0] - cen[0]) * k, cy + (p[1] - cen[1]) * k] as Point) as [
    Point,
    Point,
    Point,
  ]
  return { tri, style, level }
}

/** A labelled stroke of a recognisable shape. `seed` fully determines it. */
export const synthShape = (kind: ShapeKind, seed: number): Sample => {
  const s = setup(seed)
  const { rng, zoom, size, center } = s
  const hooks = rng() < 0.4
  // People draw small shapes slower (isochrony), so even a quick shape yields a dozen-plus samples.
  const base = { size, zoom, jitter: s.jitter, hooks, minPoints: 16 }
  const [cx, cy] = center
  switch (kind) {
    case "ellipse": {
      const round = rng() < 0.4
      const aspect = round ? uniform(rng, 1, 1.05) : uniform(rng, 1.3, 3)
      const rx = size / 2
      const ry = rx / aspect
      // Near an axis (beautify snaps it) or well clear of the 8° snap band.
      const angle =
        rng() < 0.4
          ? (pick(rng, [0, 90]) + uniform(rng, -3, 3)) * DEG
          : (pick(rng, [0, 90]) + uniform(rng, 15, 75)) * DEG
      const c = closure(rng, Math.hypot(2 * rx, 2 * ry))
      const path = traceClosed(ellipseOutline(cx, cy, rx, ry, angle), rng, c.gap, c.overshoot)
      return {
        points: hand(path, rng, { ...base, size: rx + ry }),
        zoom,
        label: `ellipse a=${aspect.toFixed(2)} ang=${(angle / DEG).toFixed(0)}`,
        truth: { kind, cx, cy, rx, ry, angle },
      }
    }
    case "rectangle": {
      const square = rng() < 0.3
      const aspect = square ? uniform(rng, 1, 1.05) : uniform(rng, 1.25, 3.5)
      const w = size
      const h = w / aspect
      const angle =
        rng() < 0.5
          ? uniform(rng, -3, 3) * DEG
          : (rng() < 0.5 ? -1 : 1) * uniform(rng, 12, square ? 30 : 40) * DEG
      const upright: Point[] = [
        [cx - w / 2, cy - h / 2],
        [cx + w / 2, cy - h / 2],
        [cx + w / 2, cy + h / 2],
        [cx - w / 2, cy + h / 2],
      ]
      const corners = upright.map((p) => rot(p, angle, center))
      const c = closure(rng, Math.hypot(w, h))
      const path = traceClosed(roundedPolygon(corners, uniform(rng, 0, 0.12)), rng, c.gap, c.overshoot)
      return {
        points: hand(path, rng, { ...base, size: (w + h) / 2 }),
        zoom,
        label: `rect a=${aspect.toFixed(2)} ang=${(angle / DEG).toFixed(0)}`,
        truth: { kind, cx, cy, w, h, angle },
      }
    }
    case "diamond": {
      // Either equalised by beautify (within 10%) or clearly not.
      const aspect = rng() < 0.3 ? uniform(rng, 1, 1.04) : uniform(rng, 1.2, 2)
      const wide = rng() < 0.5
      const w = wide ? size : size / aspect
      const h = wide ? size / aspect : size
      const tilt = uniform(rng, -3, 3) * DEG
      const upright: Point[] = [
        [cx, cy - h / 2],
        [cx + w / 2, cy],
        [cx, cy + h / 2],
        [cx - w / 2, cy],
      ]
      const verts = upright.map((p) => rot(p, tilt, center))
      const c = closure(rng, Math.hypot(w, h))
      const path = traceClosed(roundedPolygon(verts, uniform(rng, 0, 0.1)), rng, c.gap, c.overshoot)
      const drawn = handDrawn(path, rng, { ...base, size: (w + h) / 2 })
      // Each corner drifts with the hand, so the drawn diamond's extents are what the user made.
      const [top, right, bottom, left] = verts.map(drawn.displace) as [Point, Point, Point, Point]
      return {
        points: drawn.points,
        zoom,
        label: `diamond a=${aspect.toFixed(2)}`,
        truth: {
          kind,
          cx: ((left[0] + right[0]) / 2 + (top[0] + bottom[0]) / 2) / 2,
          cy: ((top[1] + bottom[1]) / 2 + (left[1] + right[1]) / 2) / 2,
          w: right[0] - left[0],
          h: bottom[1] - top[1],
        },
      }
    }
    case "triangle": {
      const { tri, style, level } = triangleVerts(rng, size, center)
      const perimeter = dist(tri[0], tri[1]) + dist(tri[1], tri[2]) + dist(tri[2], tri[0])
      const c = closure(rng, size * 1.2)
      const path = traceClosed(roundedPolygon(tri, uniform(rng, 0, 0.1)), rng, c.gap, c.overshoot)
      const drawn = handDrawn(path, rng, { ...base, size: perimeter / 3 })
      return {
        points: drawn.points,
        zoom,
        label: `triangle ${style}${level ? " level" : ""}`,
        truth: { kind, vertices: tri.map(drawn.displace) as [Point, Point, Point] },
      }
    }
    case "parallelogram": {
      const skew = (rng() < 0.5 ? -1 : 1) * uniform(rng, 23, 38) * DEG
      const aspect = uniform(rng, 1, 2.8)
      const w = size
      const h = w / aspect
      let rotation = uniform(rng, -3, 3) * DEG
      let verts = parallelogramVerts(cx, cy, w, h, skew, rotation)
      if (rng() < 0.4) {
        // Clear of the 10° level snap for whichever pair of sides ends up more horizontal, and not a
        // rhombus turned onto its diagonals, which is the diamond a user would mean.
        do {
          rotation = (rng() < 0.5 ? -1 : 1) * uniform(rng, 15, 40) * DEG
          verts = parallelogramVerts(cx, cy, w, h, skew, rotation)
        } while (Math.min(sideTilt(verts, 0), sideTilt(verts, 1)) < 15 * DEG || diamondLike(verts))
      }
      const c = closure(rng, Math.hypot(w, h))
      const corners = verts.map(() => uniform(rng, 0, 0.08))
      const path = traceClosed(
        shapeOutline(verts, { cornerFrac: corners, rng }).slice(0, -1),
        rng,
        c.gap,
        c.overshoot,
      )
      const drawn = handDrawn(path, rng, { ...base, size: (w + h) / 2 })
      return {
        points: drawn.points,
        zoom,
        label: `parallelogram skew=${(skew / DEG).toFixed(0)} rot=${(rotation / DEG).toFixed(0)}`,
        truth: { kind, vertices: verts.map(drawn.displace) as [Point, Point, Point, Point] },
      }
    }
    case "polygon": {
      const style = pick(rng, ["trapezoid", "pentagon", "hexagon"] as const)
      const verts = polygonVerts(style, rng, cx, cy, size)
      const sides = verts.length
      const perimeter = verts.reduce((acc, v, i) => acc + dist(v, verts[(i + 1) % sides]!), 0)
      const c = closure(rng, size * 1.2)
      const corners = verts.map(() => uniform(rng, 0, 0.06))
      const path = traceClosed(
        shapeOutline(verts, { cornerFrac: corners, rng }).slice(0, -1),
        rng,
        c.gap,
        c.overshoot,
      )
      const drawn = handDrawn(path, rng, { ...base, size: Math.min(size, (2.5 * perimeter) / sides) })
      return {
        points: drawn.points,
        zoom,
        label: `polygon ${style}`,
        truth: { kind, vertices: verts.map(drawn.displace) },
      }
    }
    case "line": {
      const snapped = rng() < 0.3
      let angle: number
      if (snapped)
        angle = pick(rng, [0, 45, 90, 135, 180, 225, 270, 315]) * DEG + uniform(rng, -1.5, 1.5) * DEG
      else {
        do angle = uniform(rng, 0, 2 * Math.PI)
        while (Math.abs(((angle / DEG + 22.5) % 45) - 22.5) < 10)
      }
      const half: Point = [(Math.cos(angle) * size) / 2, (Math.sin(angle) * size) / 2]
      const from: Point = [cx - half[0], cy - half[1]]
      const to: Point = [cx + half[0], cy + half[1]]
      const sag = uniform(rng, -0.02, 0.02) * size
      const ctrl: Point = [cx - Math.sin(angle) * sag * 2, cy + Math.cos(angle) * sag * 2]
      const path: Point[] = []
      for (let i = 0; i <= 100; i++) {
        const t = i / 100
        path.push(lerp(lerp(from, ctrl, t), lerp(ctrl, to, t), t))
      }
      const drawn = handDrawn(path, rng, { ...base, jitter: s.jitter / 2, minPoints: 6 })
      return {
        points: drawn.points,
        zoom,
        label: `line ang=${(angle / DEG).toFixed(0)}`,
        truth: { kind, from: drawn.displace(from), to: drawn.displace(to) },
      }
    }
    case "arrow": {
      const curved = rng() < 0.3
      const startHead = rng() < 0.25
      let angle: number
      do angle = uniform(rng, 0, 2 * Math.PI)
      while (Math.abs(((angle / DEG + 22.5) % 45) - 22.5) < 8)
      const half: Point = [(Math.cos(angle) * size) / 2, (Math.sin(angle) * size) / 2]
      const tail: Point = [cx - half[0], cy - half[1]]
      const tip: Point = [cx + half[0], cy + half[1]]
      const shaft: Point[] = []
      let via: Point | undefined
      let tipDir = angle
      if (curved) {
        const sag = (rng() < 0.5 ? -1 : 1) * uniform(rng, 0.12, 0.3) * size
        // Circle through tail, tip and the sagitta point.
        const chord = size
        const radius = (chord * chord) / (8 * Math.abs(sag)) + Math.abs(sag) / 2
        const nrm: Point = [-Math.sin(angle), Math.cos(angle)]
        const mid: Point = [cx + nrm[0] * sag, cy + nrm[1] * sag]
        const centerPt: Point = [
          mid[0] - nrm[0] * radius * Math.sign(sag),
          mid[1] - nrm[1] * radius * Math.sign(sag),
        ]
        const a0 = Math.atan2(tail[1] - centerPt[1], tail[0] - centerPt[0])
        let a1 = Math.atan2(tip[1] - centerPt[1], tip[0] - centerPt[0])
        const am = Math.atan2(mid[1] - centerPt[1], mid[0] - centerPt[0])
        // Pick the way round that passes the sagitta point.
        let sweep = a1 - a0
        while (sweep > Math.PI) sweep -= 2 * Math.PI
        while (sweep < -Math.PI) sweep += 2 * Math.PI
        let half2 = am - a0
        while (half2 > Math.PI) half2 -= 2 * Math.PI
        while (half2 < -Math.PI) half2 += 2 * Math.PI
        if (Math.sign(half2) !== Math.sign(sweep))
          sweep = sweep > 0 ? sweep - 2 * Math.PI : sweep + 2 * Math.PI
        a1 = a0 + sweep
        for (let i = 0; i <= 100; i++) {
          const t = a0 + ((a1 - a0) * i) / 100
          shaft.push([centerPt[0] + radius * Math.cos(t), centerPt[1] + radius * Math.sin(t)])
        }
        via = mid
        tipDir = a1 + (Math.sign(sweep) * Math.PI) / 2
      } else {
        const sag = uniform(rng, -0.02, 0.02) * size
        const ctrl: Point = [cx - Math.sin(angle) * sag * 2, cy + Math.cos(angle) * sag * 2]
        for (let i = 0; i <= 100; i++) {
          const t = i / 100
          shaft.push(lerp(lerp(tail, ctrl, t), lerp(ctrl, tip, t), t))
        }
      }
      const backAngle = tipDir + Math.PI
      const len1 = uniform(rng, 0.15, 0.32) * size
      const len2 = len1 * uniform(rng, 0.8, 1.2)
      const side = rng() < 0.5 ? 1 : -1
      const spread1 = backAngle + side * uniform(rng, 20, 45) * DEG
      const spread2 = backAngle - side * uniform(rng, 20, 45) * DEG
      const b1: Point = [tip[0] + Math.cos(spread1) * len1, tip[1] + Math.sin(spread1) * len1]
      const b2: Point = [tip[0] + Math.cos(spread2) * len2, tip[1] + Math.sin(spread2) * len2]
      const style = pick(rng, ["single", "back", "open", "barb-back-barb", "closed"] as const)
      const headVerts: Point[] =
        style === "single"
          ? [tip, b1]
          : style === "back"
            ? [tip, b1, tip]
            : style === "open"
              ? [tip, b1, b2]
              : style === "barb-back-barb"
                ? [tip, b1, tip, b2]
                : [tip, b1, b2, tip]
      let path = [...shaft, ...polyline(headVerts, 30).slice(1)]
      if (startHead) path = path.reverse()
      const drawn = handDrawn(path, rng, { ...base, jitter: s.jitter / 2, hooks: hooks && !startHead })
      const [dTail, dTip] = [drawn.displace(tail), drawn.displace(tip)]
      const dVia = via && drawn.displace(via)
      const truth: Truth = startHead
        ? { kind, from: dTip, to: dTail, via: dVia, startHead }
        : { kind, from: dTail, to: dTip, via: dVia, startHead }
      return {
        points: drawn.points,
        zoom,
        label: `arrow ${curved ? "curved " : ""}${style}${startHead ? " start-head" : ""}`,
        truth,
      }
    }
  }
}

const centroid = (vs: readonly Point[]): Point => [
  vs.reduce((a, p) => a + p[0], 0) / vs.length,
  vs.reduce((a, p) => a + p[1], 0) / vs.length,
]

/** A stroke reproducing one way real input went uncorrected; `CASES[name]` is the shape meant. */
export const synthCase = (name: CaseName, seed: number): Sample => {
  // A rounding is only clearly meant when it is big enough on screen to see.
  const s = setup(seed, name === "rect-rounded" || name === "blob" ? 120 : 40, 800)
  const { rng, zoom, size, center } = s
  const [cx, cy] = center
  const base = { size, zoom, jitter: s.jitter, hooks: rng() < 0.4, minPoints: 16 }
  const sharpish = (n: number, hi = 0.08) => Array.from({ length: n }, () => uniform(rng, 0, hi))
  switch (name) {
    case "rect-wavy": {
      const { w, h, square } = rectSize(rng, size)
      const angle = rectAngle(rng, square)
      const verts = boxVerts(cx, cy, w, h, angle)
      const bulgeEdge = Math.floor(rng() * 4)
      const bulge = verts.map((_, e) => {
        if (e !== bulgeEdge) return uniform(rng, -0.015, 0.015)
        const len = e % 2 === 0 ? w : h
        return (rng() < 0.7 ? 1 : -1) * Math.min(uniform(rng, 0.03, 0.07), (0.1 * h) / len)
      })
      const wave = (uniform(rng, 0.005, 0.02) * (w + h)) / 2
      const outline = shapeOutline(verts, { cornerFrac: sharpish(4), bulge, wave, rng })
      const c = closure(rng, Math.hypot(w, h))
      const path = traceClosed(outline.slice(0, -1), rng, c.gap, c.overshoot)
      return {
        points: hand(path, rng, { ...base, size: (w + h) / 2 }),
        zoom,
        label: `${name} a=${(w / h).toFixed(2)} ang=${(angle / DEG).toFixed(0)}`,
        truth: { kind: "rectangle", cx, cy, w, h, angle },
      }
    }
    case "rect-loose":
    case "square-slanted": {
      const slanted = name === "square-slanted"
      const { w, h, square } = slanted
        ? { w: size, h: size / uniform(rng, 0.85, 1.2), square: true }
        : rectSize(rng, size)
      const angle = slanted ? uniform(rng, -3, 3) * DEG : rectAngle(rng, square)
      const quad = slanted
        ? looseQuad(rng, boxVerts(cx, cy, w, h, angle), [5, 15], [3, 10])
        : looseQuad(rng, boxVerts(cx, cy, w, h, angle), [10, 25], [0, 6])
      const corners = slanted ? [uniform(rng, 0.15, 0.3), ...sharpish(3, 0.05)] : sharpish(4)
      const outline = shapeOutline(quad, { cornerFrac: corners, wave: 0.005 * size, rng })
      const c = closure(rng, Math.hypot(w, h))
      const path = traceClosed(outline.slice(0, -1), rng, c.gap, c.overshoot)
      const drawn = handDrawn(path, rng, { ...base, size: (w + h) / 2 })
      const [qx, qy] = centroid(quad)
      return {
        points: drawn.points,
        zoom,
        label: `${name} a=${(w / h).toFixed(2)} ang=${(angle / DEG).toFixed(0)}`,
        truth: { kind: "rectangle", cx: qx, cy: qy, w, h, angle, quad: quad.map(drawn.displace) },
      }
    }
    case "rect-tails": {
      const { w, h, square } = rectSize(rng, size)
      const angle = rectAngle(rng, square)
      const verts = startAnywhere(boxVerts(cx, cy, w, h, angle), rng)
      const outline = shapeOutline(verts, { cornerFrac: [0, ...sharpish(3)], rng })
      const tail = pick(rng, ["x", "end-l", "start-l", "retrace", "hook"] as const)
      const path = withTail(outline, tail, rng, (w + h) / 2)
      return {
        points: hand(path, rng, { ...base, size: (w + h) / 2, hooks: false }),
        zoom,
        label: `${name} ${tail} a=${(w / h).toFixed(2)} ang=${(angle / DEG).toFixed(0)}`,
        truth: { kind: "rectangle", cx, cy, w, h, angle },
      }
    }
    case "rect-gap": {
      const { w, h, square } = rectSize(rng, size)
      const angle = rectAngle(rng, square)
      const outline = shapeOutline(boxVerts(cx, cy, w, h, angle), { cornerFrac: sharpish(4), rng })
      const gap = uniform(rng, 0.12, 0.28)
      const path = traceClosed(outline.slice(0, -1), rng, gap * Math.hypot(w, h), 0)
      return {
        points: hand(path, rng, { ...base, size: (w + h) / 2 }),
        zoom,
        label: `${name} gap=${gap.toFixed(2)} a=${(w / h).toFixed(2)} ang=${(angle / DEG).toFixed(0)}`,
        truth: { kind: "rectangle", cx, cy, w, h, angle },
      }
    }
    case "rect-rounded": {
      const { w, h, square } = rectSize(rng, size, 0.4)
      const angle = rectAngle(rng, square)
      const frac = uniform(rng, 0.18, 0.35)
      const verts = boxVerts(cx, cy, w, h, angle)
      const outline = shapeOutline(verts, {
        cornerFrac: verts.map(() => frac * uniform(rng, 0.85, 1.15)),
        rng,
      })
      const gap = rng() < 0.7 ? uniform(rng, 0.03, 0.2) : 0
      const path = traceClosed(
        outline.slice(0, -1),
        rng,
        gap * Math.hypot(w, h),
        gap ? 0 : uniform(rng, 0, 0.06),
      )
      return {
        points: hand(path, rng, { ...base, size: (w + h) / 2 }),
        zoom,
        label: `${name} r=${frac.toFixed(2)} gap=${gap.toFixed(2)} a=${(w / h).toFixed(2)}`,
        truth: { kind: "rectangle", cx, cy, w, h, angle, rounded: true },
      }
    }
    case "blob": {
      // A big rounded square left open: straight-ish sides between wide corners.
      const w = size
      const h = w / (rng() < 0.5 ? uniform(rng, 1, 1.05) : uniform(rng, 1.2, 1.4))
      const angle = (rng() < 0.7 ? uniform(rng, -3, 3) : (rng() < 0.5 ? -1 : 1) * uniform(rng, 15, 25)) * DEG
      const verts = boxVerts(cx, cy, w, h, angle)
      const frac = uniform(rng, 0.3, 0.42)
      const outline = shapeOutline(verts, { cornerFrac: verts.map(() => frac * uniform(rng, 0.9, 1.1)), rng })
      const gap = uniform(rng, 0.08, 0.25)
      const path = traceClosed(outline.slice(0, -1), rng, gap * Math.hypot(w, h), 0)
      return {
        points: hand(path, rng, { ...base, size: (w + h) / 2 }),
        zoom,
        label: `${name} r=${frac.toFixed(2)} gap=${gap.toFixed(2)}`,
        truth: { kind: "rectangle", cx, cy, w, h, angle, rounded: true },
      }
    }
    case "ellipse-gap": {
      const round = rng() < 0.5
      const aspect = round ? uniform(rng, 1, 1.05) : uniform(rng, 1.3, 2.2)
      const rx = size / 2
      const ry = rx / aspect
      const angle =
        rng() < 0.4
          ? (pick(rng, [0, 90]) + uniform(rng, -3, 3)) * DEG
          : (pick(rng, [0, 90]) + uniform(rng, 15, 75)) * DEG
      const gap = round ? uniform(rng, 0.12, 0.28) : uniform(rng, 0.12, 0.2)
      const path = traceClosed(
        ellipseOutline(cx, cy, rx, ry, angle),
        rng,
        gap * Math.hypot(2 * rx, 2 * ry),
        0,
      )
      return {
        points: hand(path, rng, { ...base, size: rx + ry }),
        zoom,
        label: `${name} gap=${gap.toFixed(2)} a=${aspect.toFixed(2)}`,
        truth: { kind: "ellipse", cx, cy, rx, ry, angle },
      }
    }
    case "triangle-tails": {
      const { tri, style } = triangleVerts(rng, size, center)
      const verts = startAnywhere(tri, rng)
      const outline = shapeOutline(verts, { cornerFrac: [0, ...sharpish(2)], rng })
      const tail = pick(rng, ["x", "end-l", "retrace"] as const)
      const perimeter = dist(tri[0], tri[1]) + dist(tri[1], tri[2]) + dist(tri[2], tri[0])
      const path = withTail(outline, tail, rng, perimeter / 3)
      const drawn = handDrawn(path, rng, { ...base, size: perimeter / 3, hooks: false })
      return {
        points: drawn.points,
        zoom,
        label: `${name} ${style} ${tail}`,
        truth: { kind: "triangle", vertices: tri.map(drawn.displace) as [Point, Point, Point] },
      }
    }
    case "parallelogram-wavy": {
      const skew = (rng() < 0.5 ? -1 : 1) * uniform(rng, 23, 38) * DEG
      const w = size
      const h = w / uniform(rng, 1.3, 2.5)
      const verts = parallelogramVerts(cx, cy, w, h, skew, uniform(rng, -3, 3) * DEG)
      const bulge = verts.map(() => uniform(rng, -0.02, 0.02))
      const wave = uniform(rng, 0.008, 0.02) * size
      const tails = rng() < 0.5
      const order = tails ? startAnywhere(verts, rng) : verts
      const outline = shapeOutline(order, { cornerFrac: [0, ...sharpish(3)], bulge, wave, rng })
      let path: Point[]
      let label: string = name
      if (tails) {
        const tail = pick(rng, ["x", "end-l", "retrace"] as const)
        path = withTail(outline, tail, rng, (w + h) / 2)
        label += ` ${tail}`
      } else {
        const c = closure(rng, Math.hypot(w, h))
        path = traceClosed(outline.slice(0, -1), rng, c.gap, c.overshoot)
      }
      const drawn = handDrawn(path, rng, { ...base, size: (w + h) / 2, hooks: base.hooks && !tails })
      return {
        points: drawn.points,
        zoom,
        label: `${label} skew=${(skew / DEG).toFixed(0)}`,
        truth: { kind: "parallelogram", vertices: verts.map(drawn.displace) as [Point, Point, Point, Point] },
      }
    }
  }
}

/** A stroke that must stay raw. */
export const synthNegative = (kind: NegativeKind, seed: number): Sample => {
  const s = setup(seed, kind === "dot" ? 1 : 40, 800)
  const { rng, zoom, size, center } = s
  const base = { size, zoom, jitter: s.jitter, hooks: rng() < 0.3 }
  const [cx, cy] = center
  const turn = uniform(rng, 0, 2 * Math.PI)
  const place = (pts: readonly Point[]) =>
    pts.map((p) => rot([cx + p[0] * size, cy + p[1] * size], turn, center))
  const done = (path: Point[], label: string = kind): Sample => ({
    points: hand(path, rng, base),
    zoom,
    label,
  })
  switch (kind) {
    case "scribble": {
      const ctrl: Point[] = Array.from(
        { length: Math.floor(uniform(rng, 6, 13)) },
        () => [uniform(rng, -0.5, 0.5), uniform(rng, -0.5, 0.5)] as Point,
      )
      const out: Point[] = []
      for (let i = 0; i < ctrl.length - 1; i++) {
        const p0 = ctrl[Math.max(0, i - 1)]!
        const p1 = ctrl[i]!
        const p2 = ctrl[i + 1]!
        const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)]!
        for (let k = 0; k < 30; k++) {
          const t = k / 30
          const t2 = t * t
          const t3 = t2 * t
          out.push([
            0.5 *
              (2 * p1[0] +
                (-p0[0] + p2[0]) * t +
                (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
                (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
            0.5 *
              (2 * p1[1] +
                (-p0[1] + p2[1]) * t +
                (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
                (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
          ])
        }
      }
      return done(place(out))
    }
    case "spiral": {
      const turns = uniform(rng, 1.75, 3.5)
      const r0 = uniform(rng, 0, 0.2)
      const dir = rng() < 0.5 ? 1 : -1
      const out: Point[] = []
      for (let i = 0; i <= 600; i++) {
        const t = i / 600
        const r = 0.5 * (r0 + (1 - r0) * t)
        const a = dir * t * turns * 2 * Math.PI
        out.push([r * Math.cos(a), r * Math.sin(a)])
      }
      return done(place(rng() < 0.5 ? out : out.reverse()))
    }
    case "zigzag": {
      const n = Math.floor(uniform(rng, 3, 9))
      const amp = uniform(rng, 0.15, 0.6)
      const verts: Point[] = Array.from(
        { length: n + 1 },
        (_, i) => [i / n - 0.5, i % 2 === 0 ? -amp / 2 : amp / 2] as Point,
      )
      return done(place(polyline(verts)))
    }
    case "s-curve": {
      const amp = uniform(rng, 0.15, 0.35)
      const out: Point[] = []
      for (let i = 0; i <= 200; i++) {
        const t = i / 200
        out.push([t - 0.5, amp * Math.sin(2 * Math.PI * t)])
      }
      return done(place(out))
    }
    case "c-arc": {
      const sweep = uniform(rng, 100, 270) * DEG
      const out: Point[] = []
      for (let i = 0; i <= 200; i++) {
        const a = (sweep * i) / 200
        out.push([0.5 * Math.cos(a), 0.5 * Math.sin(a)])
      }
      return done(place(out))
    }
    case "star": {
      const pentagram = rng() < 0.5
      const verts: Point[] = []
      if (pentagram) {
        for (let k = 0; k <= 5; k++) {
          const a = -Math.PI / 2 + (k * 2 * 2 * Math.PI) / 5
          verts.push([0.5 * Math.cos(a), 0.5 * Math.sin(a)])
        }
      } else {
        const inner = uniform(rng, 0.35, 0.5)
        for (let k = 0; k <= 10; k++) {
          const a = -Math.PI / 2 + (k * Math.PI) / 5
          const r = k % 2 === 0 ? 0.5 : 0.5 * inner
          verts.push([r * Math.cos(a), r * Math.sin(a)])
        }
      }
      return done(place(polyline(verts)), pentagram ? "star pentagram" : "star outline")
    }
    case "figure-8": {
      const aspect = uniform(rng, 0.5, 1)
      const out: Point[] = []
      for (let i = 0; i <= 400; i++) {
        const t = (i / 400) * 2 * Math.PI
        out.push([0.5 * Math.sin(t), 0.5 * aspect * Math.sin(t) * Math.cos(t)])
      }
      return done(place(out))
    }
    case "squiggle": {
      const loops = Math.floor(uniform(rng, 3, 7))
      const out: Point[] = []
      if (rng() < 0.5) {
        // Cursive "eeee": a trochoid that loops back on itself.
        const r = uniform(rng, 0.6, 1)
        const c = uniform(rng, 0.25, 0.5)
        for (let i = 0; i <= 120 * loops; i++) {
          const t = (i / 120) * 2 * Math.PI
          out.push([(c * t - r * Math.sin(t)) / (loops * 2 * Math.PI * c), (-r * Math.cos(t) * 0.25) / loops])
        }
      } else {
        const f1 = uniform(rng, 3, 7)
        const f2 = uniform(rng, 7, 13)
        const ph = uniform(rng, 0, 6)
        for (let i = 0; i <= 400; i++) {
          const t = i / 400
          out.push([
            t - 0.5 + 0.06 * Math.sin(2 * Math.PI * f2 * t),
            0.15 * Math.sin(2 * Math.PI * f1 * t + ph) + 0.05 * Math.cos(2 * Math.PI * f2 * t),
          ])
        }
      }
      return done(place(out))
    }
    case "dot": {
      const n = Math.floor(uniform(rng, 1, 25))
      const r = uniform(rng, 0.5, 6) / zoom
      const pts: Point[] = Array.from(
        { length: n },
        () => [cx + uniform(rng, -r, r), cy + uniform(rng, -r, r)] as Point,
      )
      return { points: pts, zoom, label: "dot" }
    }
    case "heart": {
      const out: Point[] = []
      for (let i = 0; i <= 400; i++) {
        const t = (i / 400) * 2 * Math.PI
        out.push([
          (16 * Math.sin(t) ** 3) / 34,
          -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 34,
        ])
      }
      return done(place(out))
    }
    case "cloud": {
      const bumps = Math.floor(uniform(rng, 5, 10))
      const depth = uniform(rng, 0.2, 0.35)
      const aspect = uniform(rng, 1, 1.6)
      const out: Point[] = []
      for (let i = 0; i <= 600; i++) {
        const t = (i / 600) * 2 * Math.PI
        const r = 0.5 * (1 - depth + depth * Math.abs(Math.sin((bumps * t) / 2)))
        out.push([r * Math.cos(t), (r * Math.sin(t)) / aspect])
      }
      return done(place(out))
    }
    case "check": {
      const short = uniform(rng, 0.25, 0.45)
      const vertex = uniform(rng, 60, 100) * DEG
      const a: Point = [0, 0]
      const b: Point = [short * Math.cos(Math.PI / 4), short * Math.sin(Math.PI / 4)]
      const outDir = (5 * Math.PI) / 4 + vertex
      const c: Point = [b[0] + Math.cos(outDir), b[1] + Math.sin(outDir)]
      const pts = polyline([a, b, c])
      return done(place(rng() < 0.5 ? pts : pts.reverse()))
    }
    case "wave": {
      const periods = Math.floor(uniform(rng, 2, 5))
      const amp = uniform(rng, 0.06, 0.15)
      const out: Point[] = []
      for (let i = 0; i <= 300; i++) {
        const t = i / 300
        out.push([t - 0.5, amp * Math.sin(2 * Math.PI * periods * t)])
      }
      return done(place(out))
    }
    case "retrace": {
      const off = uniform(rng, 0.005, 0.03)
      const passes = Math.floor(uniform(rng, 2, 4))
      const verts: Point[] = []
      for (let k = 0; k <= passes; k++) verts.push([k % 2 === 0 ? -0.5 : 0.5, k * off])
      return done(place(polyline(verts)))
    }
    case "cursive": {
      // Joined handwriting: forward loops ("e", "l") and arches ("n", "m") along a baseline.
      const glyphs = Math.floor(uniform(rng, 3, 8))
      const out: Point[] = []
      let x = 0
      for (let g = 0; g < glyphs; g++) {
        const tall = uniform(rng, 0.5, 1.6)
        const wide = uniform(rng, 0.5, 1)
        const loop = rng() < 0.6
        const back = uniform(rng, 0.25, 0.4)
        for (let i = g === 0 ? 0 : 1; i <= 60; i++) {
          const t = (i / 60) * 2 * Math.PI
          out.push(
            loop
              ? [x + wide * (t / (2 * Math.PI) - back * Math.sin(t)), (-tall * (1 - Math.cos(t))) / 2]
              : [x + (wide * t) / (2 * Math.PI), -tall * 0.6 * Math.sin(t / 2)],
          )
        }
        x += wide
      }
      const xs = out.map((p) => p[0])
      const span = Math.max(...xs) - Math.min(...xs)
      return done(place(out.map((p) => [p[0] / span - 0.5, p[1] / span] as Point)))
    }
    case "lasso": {
      // A loop on a long string: a balloon, a "6", a lasso. The string is most of a loop's length.
      const r = 0.25
      const lead = uniform(rng, 0.6, 1.2) * 2 * Math.PI * r
      const bend = uniform(rng, -0.3, 0.3)
      const out: Point[] = []
      for (let i = 0; i <= 80; i++) {
        const t = i / 80
        out.push([bend * Math.sin(Math.PI * t) * lead, r + lead * (1 - t)])
      }
      const dir = rng() < 0.5 ? 1 : -1
      const sweep = uniform(rng, 1.05, 1.2) * 2 * Math.PI
      for (let i = 1; i <= 200; i++) {
        const a = Math.PI / 2 + (dir * sweep * i) / 200
        out.push([r * Math.cos(a), r * Math.sin(a)])
      }
      return done(place(rng() < 0.5 ? out : out.reverse()))
    }
    case "gentle-arc": {
      const sag = uniform(rng, 0.1, 0.35)
      const radius = 1 / (8 * sag) + sag / 2
      const half = Math.asin(0.5 / radius)
      const out: Point[] = []
      for (let i = 0; i <= 200; i++) {
        const a = -half + (2 * half * i) / 200
        out.push([radius * Math.sin(a), radius * Math.cos(a) - radius + sag])
      }
      return done(place(out))
    }
  }
}

const DEG_TOL = 5 * DEG

const angleDiff = (a: number, b: number, period: number) => {
  const d = (((a - b) % period) + period) % period
  return Math.min(d, period - d)
}

/** The expected output after beautify, for truths generated clear of the snapping thresholds. */
const expected = (t: Truth): Truth => {
  switch (t.kind) {
    case "ellipse": {
      const major = Math.max(t.rx, t.ry)
      const minor = Math.min(t.rx, t.ry)
      if (major / minor <= 1.12) return { ...t, rx: (t.rx + t.ry) / 2, ry: (t.rx + t.ry) / 2, angle: 0 }
      const dir = t.rx >= t.ry ? t.angle : t.angle + Math.PI / 2
      const snapped = Math.round(dir / (Math.PI / 2)) * (Math.PI / 2)
      return {
        ...t,
        rx: major,
        ry: minor,
        angle: angleDiff(dir, snapped, Math.PI) <= 8 * DEG ? snapped : dir,
      }
    }
    case "rectangle": {
      const ratio = t.w / t.h
      const square = ratio >= 1 / 1.12 && ratio <= 1.12
      const m = (t.w + t.h) / 2
      const quarter = Math.round(t.angle / (Math.PI / 2)) * (Math.PI / 2)
      const angle = angleDiff(t.angle, quarter, Math.PI / 2) <= 10 * DEG ? quarter : t.angle
      return { ...t, w: square ? m : t.w, h: square ? m : t.h, angle }
    }
    case "diamond": {
      const ratio = t.w / t.h
      if (ratio >= 1 / 1.1 && ratio <= 1.1) return { ...t, w: (t.w + t.h) / 2, h: (t.w + t.h) / 2 }
      return t
    }
    case "parallelogram": {
      // The more horizontal pair of sides is levelled when within 10°.
      const v = t.vertices
      const pair = (e: number) => {
        const a = Math.atan2(v[e + 1]![1] - v[e]![1], v[e + 1]![0] - v[e]![0])
        const b = Math.atan2(v[e + 2]![1] - v[(e + 3) % 4]![1], v[e + 2]![0] - v[(e + 3) % 4]![0])
        return foldHalf(Math.atan2(Math.sin(2 * a) + Math.sin(2 * b), Math.cos(2 * a) + Math.cos(2 * b)) / 2)
      }
      const tilt = [pair(0), pair(1)].sort((a, b) => Math.abs(a) - Math.abs(b))[0]!
      if (Math.abs(tilt) > 10 * DEG) return t
      const c = centroid(v)
      return { ...t, vertices: v.map((p) => rot(p, -tilt, c)) as [Point, Point, Point, Point] }
    }
    case "line": {
      const angle = Math.atan2(t.to[1] - t.from[1], t.to[0] - t.from[0])
      const target = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)
      if (Math.abs(target - angle) > 4 * DEG) return t
      const mid: Point = [(t.from[0] + t.to[0]) / 2, (t.from[1] + t.to[1]) / 2]
      return { ...t, from: rot(t.from, target - angle, mid), to: rot(t.to, target - angle, mid) }
    }
    default:
      return t
  }
}

/** Corners of a rectangle as a set, for comparisons that ignore which side is called the width. */
const rectCorners = (cx: number, cy: number, w: number, h: number, angle: number): Point[] =>
  [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => rot([cx + x!, cy + y!], angle, [cx, cy]))

const setDistance = (a: readonly Point[], b: readonly Point[]): number =>
  Math.max(
    ...a.map((p) => Math.min(...b.map((q) => dist(p, q)))),
    ...b.map((p) => Math.min(...a.map((q) => dist(p, q)))),
  )

export interface Recognised {
  kind: string
  [key: string]: unknown
}

/**
 * Null when the recognised shape matches the truth: centre within 5% of the stroke's bbox diagonal D,
 * axes within 8% and angle within 5°; triangle vertices within 8% of D (the hand's drift moves each
 * corner on its own), and so are parallelogram and polygon vertices; a loosely drawn rectangle's corners
 * within 20% of D of the drawn quad's; line and arrow ends within 5% of D or 4 screen px (an untrimmed pen-down hook
 * that runs on along the line is part of what was drawn), and a curved arrow's via within 8% of D.
 */
export const compareToTruth = (r: Recognised, truth: Truth, diag: number, zoom = 1): string | null => {
  if (r.kind !== truth.kind) return `kind ${r.kind}`
  const t = expected(truth)
  const near = (a: Point, b: Point, tol = 0.05) => dist(a, b) <= tol * diag
  const nearEnd = (a: Point, b: Point) => dist(a, b) <= Math.max(0.05 * diag, 4 / zoom)
  switch (t.kind) {
    case "ellipse": {
      const e = r as unknown as { cx: number; cy: number; rx: number; ry: number; angle: number }
      if (!near([e.cx, e.cy], [t.cx, t.cy])) return "centre"
      const major = Math.max(e.rx, e.ry)
      const minor = Math.min(e.rx, e.ry)
      if (Math.abs(major - t.rx) > 0.08 * t.rx || Math.abs(minor - t.ry) > 0.08 * t.rx) return "axes"
      const dir = e.rx >= e.ry ? e.angle : e.angle + Math.PI / 2
      if (t.rx / t.ry >= 1.4 && angleDiff(dir, t.angle, Math.PI) > DEG_TOL) return "angle"
      return null
    }
    case "rectangle": {
      const e = r as unknown as { cx: number; cy: number; w: number; h: number; angle: number }
      if (t.quad) {
        // A loose quad is judged by how well the rectangle covers it, not by the hand's exact corners.
        if (!near([e.cx, e.cy], centroid(t.quad), 0.06)) return "centre"
        const got = rectCorners(e.cx, e.cy, e.w, e.h, e.angle)
        return setDistance(got, t.quad) <= 0.2 * diag ? null : "corners"
      }
      if (!near([e.cx, e.cy], [t.cx, t.cy])) return "centre"
      const [a1, b1] = [Math.max(e.w, e.h), Math.min(e.w, e.h)]
      const [a2, b2] = [Math.max(t.w, t.h), Math.min(t.w, t.h)]
      if (Math.abs(a1 - a2) > 0.08 * a2 || Math.abs(b1 - b2) > 0.08 * a2) return "axes"
      const got = rectCorners(e.cx, e.cy, e.w, e.h, e.angle)
      const want = rectCorners(t.cx, t.cy, t.w, t.h, t.angle)
      if (setDistance(got, want) > 0.08 * diag) return "corners"
      if (Math.abs(a2 / b2 - 1) > 0.15 && angleDiff(e.angle, t.angle, Math.PI / 2) > DEG_TOL) return "angle"
      return null
    }
    case "diamond": {
      const e = r as unknown as { cx: number; cy: number; w: number; h: number }
      if (!near([e.cx, e.cy], [t.cx, t.cy])) return "centre"
      if (Math.abs(e.w - t.w) > 0.08 * Math.max(t.w, t.h) || Math.abs(e.h - t.h) > 0.08 * Math.max(t.w, t.h))
        return "axes"
      return null
    }
    case "triangle": {
      const e = r as unknown as { vertices: Point[] }
      return setDistance(e.vertices, t.vertices) <= 0.08 * diag ? null : "vertices"
    }
    case "parallelogram":
    case "polygon": {
      const e = r as unknown as { vertices: Point[] }
      if (e.vertices.length !== t.vertices.length) return `${e.vertices.length} vertices`
      return setDistance(e.vertices, t.vertices) <= 0.08 * diag ? null : "vertices"
    }
    case "line": {
      const e = r as unknown as { from: Point; to: Point }
      const same = nearEnd(e.from, t.from) && nearEnd(e.to, t.to)
      const swapped = nearEnd(e.from, t.to) && nearEnd(e.to, t.from)
      return same || swapped ? null : "endpoints"
    }
    case "arrow": {
      const e = r as unknown as { from: Point; to: Point; via?: Point; startHead?: boolean }
      if (!nearEnd(e.from, t.from) || !nearEnd(e.to, t.to)) return "endpoints"
      if (Boolean(e.startHead) !== t.startHead) return "head end"
      if (t.via && !e.via) return "missing via"
      if (t.via && e.via && !near(e.via, t.via, 0.08)) return "via"
      if (!t.via && e.via) return "unexpected via"
      return null
    }
  }
}

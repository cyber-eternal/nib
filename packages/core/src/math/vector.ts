export type Point = readonly [number, number]

export const point = (x: number, y: number): Point => [x, y]

export const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]]
export const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]]
export const scale = (a: Point, s: number): Point => [a[0] * s, a[1] * s]

export const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1])
export const distanceSq = (a: Point, b: Point): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2

export const length = (a: Point): number => Math.hypot(a[0], a[1])

export const normalize = (a: Point): Point => {
  const l = length(a)
  return l === 0 ? [0, 0] : [a[0] / l, a[1] / l]
}

export const dot = (a: Point, b: Point): number => a[0] * b[0] + a[1] * b[1]
export const cross = (a: Point, b: Point): number => a[0] * b[1] - a[1] * b[0]

export const rotatePoint = (p: Point, c: Point, angle: number): Point => {
  if (angle === 0) return p
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = p[0] - c[0]
  const dy = p[1] - c[1]
  return [c[0] + dx * cos - dy * sin, c[1] + dx * sin + dy * cos]
}

export const midpoint = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

export const lerpPoint = (a: Point, b: Point, t: number): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
]

export const angleOf = (a: Point, b: Point): number => Math.atan2(b[1] - a[1], b[0] - a[0])

export const normalizeAngle = (angle: number): number => {
  const a = angle % (Math.PI * 2)
  return a < 0 ? a + Math.PI * 2 : a
}

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

export const roundTo = (v: number, precision: number): number => {
  const f = 10 ** precision
  return Math.round(v * f) / f
}

/** Shortest distance from `p` to segment `a`-`b`. */
export const distanceToSegment = (p: Point, a: Point, b: Point): number => {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, 0, 1)
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

export const closestPointOnSegment = (p: Point, a: Point, b: Point): Point => {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2, 0, 1)
  return [a[0] + t * dx, a[1] + t * dy]
}

/** Intersection point of segments ab and cd, or null when they do not cross. */
export const segmentIntersection = (a: Point, b: Point, c: Point, d: Point): Point | null => {
  const r: Point = [b[0] - a[0], b[1] - a[1]]
  const s: Point = [d[0] - c[0], d[1] - c[1]]
  const denom = cross(r, s)
  if (denom === 0) return null
  const t = cross(sub(c, a), s) / denom
  const u = cross(sub(c, a), r) / denom
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return [a[0] + t * r[0], a[1] + t * r[1]]
}

/** Shortest distance between segments ab and cd (0 when they cross). */
export const segmentToSegmentDistance = (a: Point, b: Point, c: Point, d: Point): number => {
  if (segmentIntersection(a, b, c, d)) return 0
  return Math.min(
    distanceToSegment(a, c, d),
    distanceToSegment(b, c, d),
    distanceToSegment(c, a, b),
    distanceToSegment(d, a, b),
  )
}

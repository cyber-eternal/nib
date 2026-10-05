import type { Point } from "../math/vector"
import type { Roundness } from "../model/types"

export const DEFAULT_PROPORTIONAL_RADIUS = 0.25
export const DEFAULT_ADAPTIVE_RADIUS = 32

/**
 * Excalidraw's getCornerRadius for a shape whose short side is `size`: type 2 is
 * proportional, type 3 is adaptive (proportional up to a fixed cap).
 */
export const getCornerRadius = (size: number, roundness: Roundness): number => {
  if (!roundness || !(size > 0)) return 0
  const proportional = size * DEFAULT_PROPORTIONAL_RADIUS
  if (roundness.type === 2) return proportional
  const value = roundness.value
  const fixed =
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : DEFAULT_ADAPTIVE_RADIUS
  return Math.min(proportional, fixed)
}

export type PathSegment = { kind: "line"; to: Point } | { kind: "quad"; control: Point; to: Point }

/** A closed outline in element-local coordinates, shared by the renderer and hit-testing. */
export interface ShapePath {
  start: Point
  segments: PathSegment[]
}

export const roundedRectShapePath = (w: number, h: number, r: number): ShapePath => {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2))
  return {
    start: [rr, 0],
    segments: [
      { kind: "line", to: [w - rr, 0] },
      { kind: "quad", control: [w, 0], to: [w, rr] },
      { kind: "line", to: [w, h - rr] },
      { kind: "quad", control: [w, h], to: [w - rr, h] },
      { kind: "line", to: [rr, h] },
      { kind: "quad", control: [0, h], to: [0, h - rr] },
      { kind: "line", to: [0, rr] },
      { kind: "quad", control: [0, 0], to: [rr, 0] },
    ],
  }
}

const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

/** Straight edges trimmed by `t` at each end, with the vertex as the control point of each corner. */
export const roundedDiamondShapePath = (w: number, h: number, r: number): ShapePath => {
  const verts: Point[] = [
    [w / 2, 0],
    [w, h / 2],
    [w / 2, h],
    [0, h / 2],
  ]
  const side = Math.hypot(w / 2, h / 2)
  const t = side > 0 ? Math.max(0, Math.min(0.4, r / side)) : 0
  const segments: PathSegment[] = []
  for (let i = 0; i < 4; i++) {
    const a = verts[i]!
    const b = verts[(i + 1) % 4]!
    const next = verts[(i + 2) % 4]!
    segments.push({ kind: "line", to: lerp(a, b, 1 - t) })
    segments.push({ kind: "quad", control: b, to: lerp(b, next, t) })
  }
  return { start: lerp(verts[0]!, verts[1]!, t), segments }
}

export const shapePathToSvg = (path: ShapePath): string => {
  let d = `M ${path.start[0]} ${path.start[1]}`
  for (const s of path.segments) {
    d +=
      s.kind === "line"
        ? ` L ${s.to[0]} ${s.to[1]}`
        : ` Q ${s.control[0]} ${s.control[1]}, ${s.to[0]} ${s.to[1]}`
  }
  return `${d} Z`
}

/** SVG path data for a rounded rectangle, radius clamped to half the short side. */
export const roundedRectPathData = (w: number, h: number, r: number): string =>
  shapePathToSvg(roundedRectShapePath(w, h, r))

/** SVG path data for a rounded diamond; matches the outline used for binding and hit-testing. */
export const roundedDiamondPathData = (w: number, h: number, r: number): string =>
  shapePathToSvg(roundedDiamondShapePath(w, h, r))

/** Polygon through the path, offset to scene space; the closing point is not repeated. */
export const sampleShapePath = (path: ShapePath, offset: Point = [0, 0], quadSteps = 6): Point[] => {
  const [ox, oy] = offset
  const out: Point[] = [[path.start[0] + ox, path.start[1] + oy]]
  let from = path.start
  for (const s of path.segments) {
    if (s.kind === "line") {
      out.push([s.to[0] + ox, s.to[1] + oy])
    } else {
      for (let i = 1; i <= quadSteps; i++) {
        const t = i / quadSteps
        const u = 1 - t
        out.push([
          u * u * from[0] + 2 * u * t * s.control[0] + t * t * s.to[0] + ox,
          u * u * from[1] + 2 * u * t * s.control[1] + t * t * s.to[1] + oy,
        ])
      }
    }
    from = s.to
  }
  const first = out[0]!
  const last = out[out.length - 1]!
  if (out.length > 1 && Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) out.pop()
  return out
}

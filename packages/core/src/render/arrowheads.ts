import type { Point } from "../math/vector"
import { distance, normalize, sub } from "../math/vector"
import type { ArrowElement, Arrowhead, NibElement } from "../model/types"
import type { Canvas2D } from "./canvasTypes"

const SIZE_BASE = 14

/** Every head is built from these, so the canvas and SVG renderers draw identical geometry. */
export type ArrowheadPrimitive =
  | { type: "polyline"; points: Point[] }
  | { type: "polygon"; points: Point[]; fill: string | null }
  | { type: "circle"; center: Point; radius: number; fill: string | null }

const DEGENERATE = 1e-6

/** The point a head at `end` aims away from: the nearest neighbour that is not the tip itself. */
export const arrowheadBase = (points: readonly Point[], end: "start" | "end"): Point | null => {
  const n = points.length
  if (n < 2) return null
  const tip = end === "end" ? points[n - 1]! : points[0]!
  const step = end === "end" ? -1 : 1
  for (let i = end === "end" ? n - 2 : 1; i >= 0 && i < n; i += step) {
    const p = points[i]!
    if (distance(p, tip) > DEGENERATE) return p
  }
  return null
}

/** Heads scale with stroke weight but never outgrow the segment they sit on. */
export const arrowheadSize = (kind: Arrowhead, strokeWidth: number, segmentLength: number): number => {
  const share = kind === "diamond" || kind === "diamond_outline" ? 0.25 : 0.5
  return Math.min(SIZE_BASE + strokeWidth * 2, segmentLength * share)
}

export const arrowheadPrimitives = (
  kind: Arrowhead,
  tip: Point,
  from: Point,
  strokeWidth: number,
  stroke: string,
  background: string,
): ArrowheadPrimitive[] => {
  const dir = normalize(sub(tip, from))
  if (dir[0] === 0 && dir[1] === 0) return []
  const size = arrowheadSize(kind, strokeWidth, distance(tip, from))
  const perp: Point = [-dir[1], dir[0]]
  const back = (d: number): Point => [tip[0] - dir[0] * d, tip[1] - dir[1] * d]
  const side = (base: Point, d: number): Point => [base[0] + perp[0] * d, base[1] + perp[1] * d]
  const bg = background && background !== "transparent" ? background : null

  switch (kind) {
    case "arrow": {
      const b = back(size * 0.9)
      return [{ type: "polyline", points: [side(b, size * 0.45), tip, side(b, -size * 0.45)] }]
    }
    case "triangle":
    case "triangle_outline": {
      const b = back(size)
      const fill = kind === "triangle" ? stroke : bg
      return [{ type: "polygon", points: [tip, side(b, size * 0.4), side(b, -size * 0.4)], fill }]
    }
    case "diamond":
    case "diamond_outline": {
      const mid = back(size * 0.6)
      const fill = kind === "diamond" ? stroke : bg
      return [
        {
          type: "polygon",
          points: [tip, side(mid, size * 0.4), back(size * 1.2), side(mid, -size * 0.4)],
          fill,
        },
      ]
    }
    case "dot":
    case "circle":
    case "circle_outline": {
      const r = size * 0.35
      return [{ type: "circle", center: back(r), radius: r, fill: kind === "circle_outline" ? bg : stroke }]
    }
    case "bar":
      return [{ type: "polyline", points: [side(tip, size * 0.5), side(tip, -size * 0.5)] }]
    case "crowfoot_one": {
      const b = back(size * 0.7)
      return [{ type: "polyline", points: [side(b, size * 0.5), side(b, -size * 0.5)] }]
    }
    case "crowfoot_many":
    case "crowfoot_one_or_many": {
      // prongs spread at the entity and converge back along the line
      const joint = back(size)
      const out: ArrowheadPrimitive[] = [
        { type: "polyline", points: [side(tip, size * 0.5), joint, side(tip, -size * 0.5)] },
        { type: "polyline", points: [joint, tip] },
      ]
      if (kind === "crowfoot_one_or_many") {
        const bar = back(size * 1.4)
        out.push({ type: "polyline", points: [side(bar, size * 0.4), side(bar, -size * 0.4)] })
      }
      return out
    }
    default:
      return []
  }
}

/** Heads for both ends of an arrow, in element-local space. */
export const arrowElementHeads = (
  el: ArrowElement,
  stroke: string,
  background: string,
): ArrowheadPrimitive[] => {
  const pts = el.points
  const out: ArrowheadPrimitive[] = []
  if (el.endArrowhead) {
    const from = arrowheadBase(pts, "end")
    if (from)
      out.push(
        ...arrowheadPrimitives(
          el.endArrowhead,
          pts[pts.length - 1]!,
          from,
          el.strokeWidth,
          stroke,
          background,
        ),
      )
  }
  if (el.startArrowhead) {
    const from = arrowheadBase(pts, "start")
    if (from)
      out.push(...arrowheadPrimitives(el.startArrowhead, pts[0]!, from, el.strokeWidth, stroke, background))
  }
  return out
}

export const drawArrowheadPrimitives = (
  ctx: Canvas2D,
  primitives: readonly ArrowheadPrimitive[],
  stroke: string,
  strokeWidth: number,
): void => {
  if (primitives.length === 0) return
  ctx.save()
  try {
    ctx.strokeStyle = stroke
    ctx.lineWidth = strokeWidth
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.setLineDash([])
    for (const p of primitives) {
      ctx.beginPath()
      if (p.type === "circle") {
        ctx.arc(p.center[0], p.center[1], p.radius, 0, Math.PI * 2)
      } else {
        ctx.moveTo(p.points[0]![0], p.points[0]![1])
        for (let i = 1; i < p.points.length; i++) ctx.lineTo(p.points[i]![0], p.points[i]![1])
        if (p.type === "polygon") ctx.closePath()
      }
      if (p.type !== "polyline" && p.fill) {
        ctx.fillStyle = p.fill
        ctx.fill()
      }
      ctx.stroke()
    }
  } finally {
    ctx.restore()
  }
}

/** Draw `kind` at `tip`, aimed away from `from`. */
export const drawArrowhead = (
  ctx: Canvas2D,
  kind: Arrowhead,
  tip: Point,
  from: Point,
  el: NibElement,
  stroke: string,
  background: string,
): void => {
  drawArrowheadPrimitives(
    ctx,
    arrowheadPrimitives(kind, tip, from, el.strokeWidth, stroke, background),
    stroke,
    el.strokeWidth,
  )
}

export const ARROWHEAD_KINDS: (Arrowhead | null)[] = [
  null,
  "arrow",
  "triangle",
  "triangle_outline",
  "diamond",
  "diamond_outline",
  "circle",
  "circle_outline",
  "bar",
  "crowfoot_one",
  "crowfoot_many",
  "crowfoot_one_or_many",
]

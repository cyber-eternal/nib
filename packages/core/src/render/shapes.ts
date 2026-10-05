import { getStroke } from "perfect-freehand"
import type { Drawable, Options } from "roughjs/bin/core"
import { RoughGenerator } from "roughjs/bin/generator"
import { cornerRadius } from "../geometry/outline"
import { roundedDiamondPathData, roundedRectPathData } from "../geometry/shapePaths"
import { catmullRomToBezier } from "../math/curve"
import type { Point } from "../math/vector"
import type { FreedrawElement, NibElement, Theme } from "../model/types"
import { themeColor } from "./theme"

const generator = new RoughGenerator()

const dashPattern = (el: NibElement): number[] | undefined => {
  if (el.strokeStyle === "dashed") return [8, 8 + el.strokeWidth]
  if (el.strokeStyle === "dotted") return [1.5, 6 + el.strokeWidth]
  return undefined
}

// roughjs falls back to Math.random for a zero seed, and Math.imul truncates fractional ones to zero
const stableSeed = (seed: number): number => (Number.isFinite(seed) ? Math.trunc(seed) | 0 : 0) || 1

const roughOptions = (el: NibElement, theme: Theme, board?: string, surface?: string | null): Options => {
  const fill =
    el.backgroundColor === "transparent" ? undefined : themeColor(el.backgroundColor, theme, board, "fill")
  return {
    seed: stableSeed(el.seed),
    strokeWidth: el.strokeWidth,
    stroke: themeColor(el.strokeColor, theme, board, "stroke", surface),
    strokeLineDash: dashPattern(el),
    disableMultiStroke: el.strokeStyle !== "solid",
    roughness: el.roughness,
    fill,
    fillStyle: el.fillStyle,
    fillWeight: el.strokeWidth / 2,
    hachureGap: el.strokeWidth * 4,
    curveFitting: 1,
    preserveVertices: true,
  }
}

const curvePath = (pts: readonly Point[]): string => {
  if (pts.length < 2) return ""
  if (pts.length === 2) return `M ${pts[0]![0]} ${pts[0]![1]} L ${pts[1]![0]} ${pts[1]![1]}`
  const segs = catmullRomToBezier(pts)
  let d = `M ${pts[0]![0]} ${pts[0]![1]}`
  for (const s of segs) d += ` C ${s.c1[0]} ${s.c1[1]}, ${s.c2[0]} ${s.c2[1]}, ${s.to[0]} ${s.to[1]}`
  return d
}

const samePoint = (a: Point, b: Point): boolean =>
  Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6

/** Closed lines store their first point again at the end; roughjs closes polygons itself. */
const polygonVertices = (pts: readonly Point[]): Point[] =>
  pts.length > 3 && samePoint(pts[0]!, pts[pts.length - 1]!) ? pts.slice(0, -1) : [...pts]

/**
 * Shapes are generated in element-local space; the painter applies the transform. `surface` is
 * what the stroke is kept legible against (the board unless given; null for none).
 */
export const generateShape = (
  el: NibElement,
  theme: Theme,
  board?: string,
  surface?: string | null,
): Drawable[] => {
  const o = roughOptions(el, theme, board, surface)
  const w = el.width
  const h = el.height

  switch (el.type) {
    case "rectangle":
    case "embeddable": {
      const r = cornerRadius(el)
      return r > 0 ? [generator.path(roundedRectPathData(w, h, r), o)] : [generator.rectangle(0, 0, w, h, o)]
    }
    case "diamond": {
      const r = cornerRadius(el)
      return r > 0
        ? [generator.path(roundedDiamondPathData(w, h, r), o)]
        : [
            generator.polygon(
              [
                [w / 2, 0],
                [w, h / 2],
                [w / 2, h],
                [0, h / 2],
              ],
              o,
            ),
          ]
    }
    case "ellipse":
      return [generator.ellipse(w / 2, h / 2, w, h, o)]
    case "line":
    case "arrow": {
      const pts = el.points as Point[]
      if (pts.length < 2) return []
      if (el.type === "line" && el.polygon) {
        const verts = polygonVertices(pts)
        if (verts.length >= 3) return [generator.polygon(verts as [number, number][], o)]
      }
      const rounded = el.roundness !== null && !(el.type === "arrow" && el.elbowed)
      if (rounded && pts.length > 2) {
        return [generator.path(curvePath(pts), { ...o, fill: undefined })]
      }
      return [generator.linearPath(pts as [number, number][], { ...o, fill: undefined })]
    }
    default:
      return []
  }
}

/** The filled ink outline of a freehand stroke, shared by the canvas and SVG renderers. */
export const freedrawOutline = (el: FreedrawElement): number[][] => {
  const input = el.points.map((p, i) => [p[0], p[1], el.pressures[i] ?? 0.5])
  return getStroke(input, {
    size: el.strokeWidth * 4.25,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    easing: (t) => Math.sin((t * Math.PI) / 2),
    simulatePressure: el.simulatePressure,
    last: el.lastCommittedPoint !== null,
  }) as number[][]
}

const pointsOf = (el: NibElement): unknown =>
  el.type === "line" || el.type === "arrow" || el.type === "freedraw" ? el.points : null

/**
 * Versions alone are not unique (undo, reloads and resize-back reuse them), so an entry is only
 * reused for the same object or one that matches on everything a shape is generated from.
 */
const sameContent = (a: NibElement, b: NibElement): boolean =>
  a === b ||
  (a.type === b.type &&
    a.version === b.version &&
    a.versionNonce === b.versionNonce &&
    a.width === b.width &&
    a.height === b.height &&
    a.seed === b.seed &&
    a.strokeWidth === b.strokeWidth &&
    a.strokeColor === b.strokeColor &&
    a.backgroundColor === b.backgroundColor &&
    a.fillStyle === b.fillStyle &&
    a.strokeStyle === b.strokeStyle &&
    a.roughness === b.roughness &&
    a.roundness?.type === b.roundness?.type &&
    a.roundness?.value === b.roundness?.value &&
    pointsOf(a) === pointsOf(b) &&
    (a.type !== "freedraw" || (b.type === "freedraw" && a.pressures === b.pressures)))

interface ShapeEntry {
  el: NibElement
  colorKey: string
  shapes: Drawable[]
}

interface OutlineEntry {
  el: FreedrawElement
  outline: number[][]
}

export class ShapeCache {
  private shapes = new Map<string, ShapeEntry>()
  private outlines = new Map<string, OutlineEntry>()

  get(el: NibElement, theme: Theme, board?: string, surface?: string | null): Drawable[] {
    // the stroke floor depends on the board in light themes too
    const colorKey = `${theme}|${board ?? ""}|${surface === undefined ? "~" : (surface ?? "none")}`
    const hit = this.shapes.get(el.id)
    if (hit && hit.colorKey === colorKey && sameContent(hit.el, el)) return hit.shapes
    const shapes = generateShape(el, theme, board, surface)
    this.shapes.set(el.id, { el, colorKey, shapes })
    return shapes
  }

  freedrawOutline(el: FreedrawElement): number[][] {
    const hit = this.outlines.get(el.id)
    if (hit && sameContent(hit.el, el)) return hit.outline
    const outline = freedrawOutline(el)
    this.outlines.set(el.id, { el, outline })
    return outline
  }

  get size(): number {
    return Math.max(this.shapes.size, this.outlines.size)
  }

  /** Drops entries for elements that are no longer in `live`. */
  retain(live: readonly NibElement[]): void {
    const ids = new Set(live.map((e) => e.id))
    for (const id of this.shapes.keys()) if (!ids.has(id)) this.shapes.delete(id)
    for (const id of this.outlines.keys()) if (!ids.has(id)) this.outlines.delete(id)
  }

  delete(id: string): void {
    this.shapes.delete(id)
    this.outlines.delete(id)
  }

  clear(): void {
    this.shapes.clear()
    this.outlines.clear()
  }
}

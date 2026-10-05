import { catmullRomPolyline } from "../math/curve"
import type { Point } from "../math/vector"
import { rotatePoint } from "../math/vector"
import type { NibElement } from "../model/types"
import { getCornerRadius, roundedDiamondShapePath, roundedRectShapePath, sampleShapePath } from "./shapePaths"

export const elementCenter = (el: NibElement): Point => [el.x + el.width / 2, el.y + el.height / 2]

/** Corner radius of a rounded rectangle or diamond, never more than half its short side. */
export const cornerRadius = (el: NibElement): number =>
  getCornerRadius(Math.min(Math.abs(el.width), Math.abs(el.height)), el.roundness)

/**
 * Element outline as a polygon in scene coordinates, rotation applied.
 * Curves and rounded corners are sampled so hit-testing matches the render.
 */
export const elementOutline = (el: NibElement): Point[] => {
  const pts = localOutline(el)
  if (!el.angle) return pts
  const c = elementCenter(el)
  return pts.map((p) => rotatePoint(p, c, el.angle))
}

const boxOutline = (x: number, y: number, w: number, h: number): Point[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
]

const localOutline = (el: NibElement): Point[] => {
  const { x, y, width: w, height: h } = el
  switch (el.type) {
    case "rectangle":
    case "image":
    case "frame":
    case "embeddable":
    case "text": {
      const r = el.type === "rectangle" || el.type === "embeddable" ? cornerRadius(el) : 0
      if (r <= 0) return boxOutline(x, y, w, h)
      return sampleShapePath(roundedRectShapePath(w, h, r), [x, y])
    }
    case "diamond": {
      const r = cornerRadius(el)
      if (r <= 0)
        return [
          [x + w / 2, y],
          [x + w, y + h / 2],
          [x + w / 2, y + h],
          [x, y + h / 2],
        ]
      return sampleShapePath(roundedDiamondShapePath(w, h, r), [x, y])
    }
    case "ellipse": {
      const out: Point[] = []
      const rx = w / 2
      const ry = h / 2
      const steps = 64
      for (let i = 0; i < steps; i++) {
        const t = (i / steps) * Math.PI * 2
        out.push([x + rx + rx * Math.cos(t), y + ry + ry * Math.sin(t)])
      }
      return out
    }
    case "line":
    case "arrow": {
      const abs = (el.points ?? []).map((p): Point => [x + p[0], y + p[1]])
      // closed polygon lines are drawn with straight edges even when they carry roundness
      const straight = ("elbowed" in el && el.elbowed) || (el.type === "line" && el.polygon)
      if (el.roundness && abs.length > 2 && !straight) return catmullRomPolyline(abs, 10)
      return abs
    }
    case "freedraw": {
      return (el.points ?? []).map((p): Point => [x + p[0], y + p[1]])
    }
    default:
      // unknown types from hostile or newer files still get a hit area and bounds
      return boxOutline(x, y, w, h)
  }
}

export const isClosedShape = (el: NibElement): boolean => {
  if (el.type === "line") return el.polygon
  return el.type !== "arrow" && el.type !== "freedraw"
}

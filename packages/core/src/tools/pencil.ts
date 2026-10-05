import { rebaseFromPoints } from "../geometry/linear"
import type { Recognized } from "../geometry/recognize"
import { type Point, normalizeAngle } from "../math/vector"
import { newElement } from "../model/element"
import type { AppState, FreedrawElement, NibElement } from "../model/types"
import { closedPoints, polygonRoundness } from "./parallelogramTool"

/**
 * The clean element a recognised pencil stroke becomes: the stroke's own ink
 * (colour, width, roughness, opacity) plus the current fill, stroke style,
 * roundness and arrowheads. Triangles, parallelograms and other polygons are closed polygon lines.
 */
export const shapeFromRecognized = (
  r: Recognized,
  stroke: FreedrawElement,
  a: AppState,
  index: string,
): NibElement => {
  const style = {
    index,
    strokeColor: stroke.strokeColor,
    strokeWidth: stroke.strokeWidth,
    roughness: stroke.roughness,
    opacity: stroke.opacity,
    strokeStyle: a.currentItemStrokeStyle,
    fillStyle: a.currentItemFillStyle,
    backgroundColor: a.currentItemBackgroundColor,
    groupIds: stroke.groupIds,
    frameId: stroke.frameId,
  }
  const cornerRoundness = a.currentItemRoundness === "round" ? { type: 3 as const } : null
  const box = (cx: number, cy: number, w: number, h: number) => ({
    x: cx - w / 2,
    y: cy - h / 2,
    width: w,
    height: h,
  })
  switch (r.kind) {
    case "ellipse":
      return newElement("ellipse", {
        ...style,
        ...box(r.cx, r.cy, 2 * r.rx, 2 * r.ry),
        angle: normalizeAngle(r.angle),
      })
    case "rectangle":
      return newElement("rectangle", {
        ...style,
        ...box(r.cx, r.cy, r.w, r.h),
        angle: normalizeAngle(r.angle),
        roundness: r.rounded ? { type: 3 } : cornerRoundness,
      })
    case "diamond":
      return newElement("diamond", { ...style, ...box(r.cx, r.cy, r.w, r.h), roundness: cornerRoundness })
    case "triangle": {
      const [v1, v2, v3] = r.vertices
      const pts: Point[] = [v1, v2, v3, v1]
      return rebaseFromPoints(newElement("line", { ...style, polygon: true }), pts)
    }
    case "parallelogram":
    case "polygon":
      return rebaseFromPoints(
        newElement("line", { ...style, polygon: true, roundness: polygonRoundness(a) }),
        closedPoints(r.vertices),
      )
    case "line":
      return rebaseFromPoints(
        newElement("line", { ...style, roundness: a.currentItemRoundness === "round" ? { type: 2 } : null }),
        [r.from, r.to],
      )
    case "arrow": {
      const head = a.currentItemEndArrowhead ?? "arrow"
      const tail = a.currentItemStartArrowhead
      const pts: Point[] = r.via ? [r.from, r.via, r.to] : [r.from, r.to]
      const curved = !!r.via || a.currentItemArrowType === "round"
      return rebaseFromPoints(
        newElement("arrow", {
          ...style,
          roundness: curved ? { type: 2 } : null,
          startArrowhead: r.startHead ? head : tail,
          endArrowhead: r.startHead ? tail : head,
          elbowed: false,
        }),
        pts,
      )
    }
  }
}

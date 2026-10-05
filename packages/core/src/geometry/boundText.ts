import { catmullRomPolyline } from "../math/curve"
import { type Point, distance, rotatePoint } from "../math/vector"
import { mutateElement } from "../model/element"
import type { NibElement, TextElement } from "../model/types"
import { lineHeightPx, measureMultiline, wrapText } from "../render/textMeasure"
import { absolutePointsOf } from "./linear"
import { elementCenter } from "./outline"
import type { HandleType } from "./transformHandles"

export const BOUND_TEXT_PADDING = 5

export const getBoundTextId = (el: NibElement): string | null =>
  el.boundElements?.find((b) => b.type === "text")?.id ?? null

export const getBoundText = (
  el: NibElement,
  get: (id: string) => NibElement | undefined,
): TextElement | null => {
  const id = getBoundTextId(el)
  if (!id) return null
  const text = get(id)
  return text && text.type === "text" && !text.isDeleted ? text : null
}

/** A closed polygon line (a corrected triangle, say) holds its label inside, like a shape. */
const isPolygonContainer = (el: NibElement): boolean => el.type === "line" && el.polygon

/** Arrows and open lines carry their label along the path rather than inside a box. */
const isPathContainer = (el: NibElement): boolean =>
  el.type === "arrow" || (el.type === "line" && !el.polygon)

export const containerMaxTextWidth = (container: NibElement): number => {
  if (container.type === "ellipse") return (container.width / 2) * Math.SQRT2 - BOUND_TEXT_PADDING * 2
  if (container.type === "diamond") return container.width / 2 - BOUND_TEXT_PADDING * 2
  // half the width keeps a label clear of a triangle's slanted sides around its centroid
  if (isPolygonContainer(container)) return container.width / 2 - BOUND_TEXT_PADDING * 2
  if (isPathContainer(container)) return Math.max(60, container.width * 0.9)
  return container.width - BOUND_TEXT_PADDING * 2
}

/** Smallest container height whose inscribed text box fits `textHeight` plus padding. */
export const containerMinHeight = (container: NibElement, textHeight: number): number => {
  const pad = BOUND_TEXT_PADDING * 2
  if (container.type === "ellipse") return (textHeight + pad) * Math.SQRT2
  if (container.type === "diamond") return (textHeight + pad) * 2
  return textHeight + pad
}

/** Offset of the text box inside the container's own (unrotated) box: the inscribed rectangle plus padding. */
const containerTextInset = (container: NibElement): Point => {
  if (container.type === "ellipse") {
    const k = 1 - Math.SQRT1_2
    return [BOUND_TEXT_PADDING + (container.width / 2) * k, BOUND_TEXT_PADDING + (container.height / 2) * k]
  }
  if (container.type === "diamond")
    return [BOUND_TEXT_PADDING + container.width / 4, BOUND_TEXT_PADDING + container.height / 4]
  return [BOUND_TEXT_PADDING, BOUND_TEXT_PADDING]
}

const polylinePointAtHalf = (pts: readonly Point[]): Point => {
  let total = 0
  for (let i = 1; i < pts.length; i++) total += distance(pts[i - 1]!, pts[i]!)
  let remaining = total / 2
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    const len = distance(a, b)
    if (len > 0 && remaining <= len) {
      const t = remaining / len
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    }
    remaining -= len
  }
  return pts[pts.length - 1]!
}

/** Area centroid of a closed polygon (the vertex mean when it has no area). */
const polygonCentroid = (pts: readonly Point[]): Point => {
  let area = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!
    const [x1, y1] = pts[(i + 1) % pts.length]!
    const cross = x0 * y1 - x1 * y0
    area += cross
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }
  if (Math.abs(area) > 1e-9) return [cx / (3 * area), cy / (3 * area)]
  let sx = 0
  let sy = 0
  for (const p of pts) {
    sx += p[0]
    sy += p[1]
  }
  return pts.length ? [sx / pts.length, sy / pts.length] : [0, 0]
}

/** Where the label of a closed polygon line sits: its area centroid, rotation included. */
export const polygonLabelAnchor = (el: NibElement): Point => {
  if (el.type !== "line") return elementCenter(el)
  const pts = absolutePointsOf(el)
  return pts.length ? polygonCentroid(pts) : elementCenter(el)
}

/** Where an arrow's label sits: halfway along the path as drawn, curves and rotation included. */
export const arrowLabelAnchor = (arrow: NibElement): Point => {
  if (arrow.type !== "arrow" && arrow.type !== "line") return elementCenter(arrow)
  const pts = absolutePointsOf(arrow)
  if (pts.length === 0) return [arrow.x, arrow.y]
  const curved = arrow.roundness !== null && pts.length > 2 && !(arrow.type === "arrow" && arrow.elbowed)
  return polylinePointAtHalf(curved ? catmullRomPolyline(pts, 16) : pts)
}

export interface BoundTextLayoutOptions {
  /** The resize handle being dragged; the container grows away from the edge opposite it. */
  handle?: HandleType | null
  fromCenter?: boolean
}

/**
 * Grow `container` to `height` in its own frame without moving the anchored
 * edge, so rotated containers grow along their own axis.
 */
const growContainer = (container: NibElement, height: number, opts: BoundTextLayoutOptions): NibElement => {
  const delta = height - container.height
  const anchor = opts.fromCenter ? "center" : opts.handle?.includes("n") ? "bottom" : "top"
  const shift = anchor === "top" ? delta / 2 : anchor === "bottom" ? -delta / 2 : 0
  const c = elementCenter(container)
  const nc = rotatePoint([c[0], c[1] + shift], c, container.angle)
  return mutateElement(container, { height, x: nc[0] - container.width / 2, y: nc[1] - height / 2 })
}

/**
 * Re-wrap a label to its container and reposition both. Containers grow
 * vertically so text never clips; arrows just centre the label on the midpoint.
 */
export const layoutBoundText = (
  container: NibElement,
  text: TextElement,
  opts: BoundTextLayoutOptions = {},
): { container: NibElement; text: TextElement } => {
  const maxWidth = containerMaxTextWidth(container)
  const wrapped = wrapText(text.originalText, maxWidth, text.fontSize, text.fontFamily)
  const metrics = measureMultiline(wrapped, text.fontSize, text.fontFamily, text.lineHeight)
  const height = Math.max(lineHeightPx(text.fontSize, text.lineHeight), metrics.height)

  if (isPolygonContainer(container)) {
    // the box follows the points, so the container never grows; the label just centres
    const [cx, cy] = polygonLabelAnchor(container)
    return {
      container,
      text: mutateElement(text, {
        text: wrapped,
        width: metrics.width,
        height,
        x: cx - metrics.width / 2,
        y: cy - height / 2,
        angle: container.angle,
      }),
    }
  }

  if (isPathContainer(container)) {
    const [cx, cy] = arrowLabelAnchor(container)
    return {
      container,
      text: mutateElement(text, {
        text: wrapped,
        width: metrics.width,
        height,
        x: cx - metrics.width / 2,
        y: cy - height / 2,
        textAlign: "center",
        verticalAlign: "middle",
      }),
    }
  }

  const needed = containerMinHeight(container, height)
  const next = container.height < needed ? growContainer(container, needed, opts) : container

  const [insetX, insetY] = containerTextInset(next)
  const innerY =
    text.verticalAlign === "top"
      ? next.y + insetY
      : text.verticalAlign === "bottom"
        ? next.y + next.height - height - insetY
        : next.y + (next.height - height) / 2
  const innerX =
    text.textAlign === "left"
      ? next.x + insetX
      : text.textAlign === "right"
        ? next.x + next.width - metrics.width - insetX
        : next.x + (next.width - metrics.width) / 2

  // lay out in the container's own frame, then carry the label round with it
  const centre = rotatePoint(
    [innerX + metrics.width / 2, innerY + height / 2],
    elementCenter(next),
    next.angle,
  )
  return {
    container: next,
    text: mutateElement(text, {
      text: wrapped,
      width: metrics.width,
      height,
      x: centre[0] - metrics.width / 2,
      y: centre[1] - height / 2,
      angle: next.angle,
    }),
  }
}

/** Resize a standalone text element to fit its content. */
export const layoutStandaloneText = (text: TextElement): TextElement => {
  const content = text.autoResize
    ? text.originalText
    : wrapText(text.originalText, text.width, text.fontSize, text.fontFamily)
  const metrics = measureMultiline(content, text.fontSize, text.fontFamily, text.lineHeight)
  const height = Math.max(lineHeightPx(text.fontSize, text.lineHeight), metrics.height)
  return mutateElement(text, {
    text: content,
    width: text.autoResize ? metrics.width : text.width,
    height,
  })
}

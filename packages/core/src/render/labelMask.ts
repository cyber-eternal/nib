import { BOUND_TEXT_PADDING } from "../geometry/boundText"
import { type Bounds, boundsFromPoints, expandBounds, unionBounds } from "../math/bounds"
import { type Point, rotatePoint } from "../math/vector"
import type { NibElement, TextElement } from "../model/types"
import { getElementRenderBounds } from "./bounds"

export type ElementLookup = (id: string) => NibElement | undefined

/** Where an arrow may paint (`bounds`) and the padded label box it must leave clear (`hole`), in scene space. */
export interface ArrowLabelMask {
  bounds: Bounds
  hole: Point[]
}

const finitePoint = (p: Point): boolean => Number.isFinite(p[0]) && Number.isFinite(p[1])

/** The arrow's visible label, when its text is bound both ways and has something to show. */
export const arrowLabel = (arrow: NibElement, get: ElementLookup): TextElement | null => {
  if (!Array.isArray(arrow.boundElements)) return null
  const ref = arrow.boundElements.find((b) => b && b.type === "text")
  if (!ref || typeof ref.id !== "string") return null
  const label = get(ref.id)
  if (!label || label.type !== "text" || label.isDeleted || label.containerId !== arrow.id) return null
  return typeof label.text === "string" && label.text.trim() ? label : null
}

/** The label box grown by the bound-text padding and turned with the label. */
const paddedCorners = (label: TextElement, pad: number): Point[] => {
  const c: Point = [label.x + label.width / 2, label.y + label.height / 2]
  const raw: Point[] = [
    [label.x - pad, label.y - pad],
    [label.x + label.width + pad, label.y - pad],
    [label.x + label.width + pad, label.y + label.height + pad],
    [label.x - pad, label.y + label.height + pad],
  ]
  return label.angle ? raw.map((p) => rotatePoint(p, c, label.angle)) : raw
}

/** The cut-out that keeps an arrow's line from running through its label, or null without one. */
export const arrowLabelMask = (arrow: NibElement, get: ElementLookup | undefined): ArrowLabelMask | null => {
  if (arrow.type !== "arrow" || !get) return null
  const label = arrowLabel(arrow, get)
  if (!label) return null
  const hole = paddedCorners(label, BOUND_TEXT_PADDING)
  if (!hole.every(finitePoint)) return null
  const bounds = expandBounds(unionBounds(getElementRenderBounds(arrow), boundsFromPoints(hole)), 2)
  return bounds.every(Number.isFinite) ? { bounds, hole } : null
}

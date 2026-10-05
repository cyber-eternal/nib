import type { NibElement } from "@nib/core"
import { frameDisplayName } from "./searchModel"

export type GeometryField = "x" | "y" | "width" | "height" | "angle"

export const GEOMETRY_FIELDS: readonly GeometryField[] = ["x", "y", "width", "height", "angle"]

export const FIELD_LABELS: Readonly<Record<GeometryField, string>> = {
  x: "X",
  y: "Y",
  width: "Width",
  height: "Height",
  angle: "Angle",
}

export const FIELD_SHORT: Readonly<Record<GeometryField, string>> = {
  x: "X",
  y: "Y",
  width: "W",
  height: "H",
  angle: "°",
}

/** The smallest width or height the editor keeps; anything below would be clamped silently. */
export const MIN_SIZE = 1

export const roundForDisplay = (n: number): number => Math.round(n * 100) / 100

const normalizeDegrees = (deg: number): number => {
  const d = deg % 360
  return roundForDisplay(d < 0 ? d + 360 : d)
}

/** The value a field shows: degrees for the angle, scene units otherwise. */
export const fieldValue = (el: NibElement, field: GeometryField): number =>
  field === "angle" ? normalizeDegrees((el.angle * 180) / Math.PI) : roundForDisplay(el[field])

export type FieldParse = { ok: true; value: number } | { ok: false; error: string }

/** Reads what was typed. Sizes below MIN_SIZE are refused with a reason instead of being clamped. */
export const parseFieldInput = (field: GeometryField, draft: string): FieldParse => {
  const text = draft.trim().replace(/,/g, ".").replace(/°$/, "").replace(/^−/, "-")
  if (text === "") return { ok: false, error: `Enter a number for ${FIELD_LABELS[field].toLowerCase()}.` }
  const value = Number(text)
  if (!Number.isFinite(value)) return { ok: false, error: `“${draft.trim()}” isn't a number.` }
  if ((field === "width" || field === "height") && value < MIN_SIZE)
    return {
      ok: false,
      error: `${FIELD_LABELS[field]} must be at least ${MIN_SIZE}. Use Flip in the style bar to mirror a shape.`,
    }
  return { ok: true, value: field === "angle" ? normalizeDegrees(value) : value }
}

export type CommitDecision =
  | { kind: "commit"; value: number }
  | { kind: "keep" }
  | { kind: "invalid"; error: string }

/** What Enter or leaving the field should do with the draft. Escape never reaches here: it reverts. */
export const decideCommit = (field: GeometryField, draft: string, current: number): CommitDecision => {
  const parsed = parseFieldInput(field, draft)
  if (!parsed.ok) return { kind: "invalid", error: parsed.error }
  if (roundForDisplay(parsed.value) === roundForDisplay(current)) return { kind: "keep" }
  return { kind: "commit", value: parsed.value }
}

/** The patch setElementGeometry takes for one field. */
export const geometryPatch = (
  field: GeometryField,
  value: number,
): { x?: number; y?: number; width?: number; height?: number; angle?: number } =>
  field === "angle" ? { angle: (value * Math.PI) / 180 } : { [field]: value }

export interface FieldState {
  disabled: boolean
  /** Why a disabled field can't be edited, for its aria-describedby. */
  reason?: string
}

export interface GeometryAvailability {
  fields: Readonly<Record<GeometryField, FieldState>>
  /** One sentence shown under the fields about how this element takes the edits. */
  note?: string
}

const all = (state: FieldState): Record<GeometryField, FieldState> => ({
  x: state,
  y: state,
  width: state,
  height: state,
  angle: state,
})

const isLinear = (el: NibElement): boolean =>
  el.type === "line" || el.type === "arrow" || el.type === "freedraw"

/** Which geometry fields an element accepts, and what a size edit means for it. */
export const geometryAvailability = (el: NibElement): GeometryAvailability => {
  if (el.locked) {
    const reason = "Locked. Unlock it to change its position or size."
    return { fields: all({ disabled: true, reason }), note: reason }
  }
  if (el.type === "text" && el.containerId) {
    const reason = "This label follows its shape. Select the shape to move or resize it."
    return { fields: all({ disabled: true, reason }), note: reason }
  }
  const fields = all({ disabled: false })
  let note: string | undefined
  if (el.type === "text") {
    note = el.autoResize
      ? "Width sets where the text wraps; height scales the font."
      : "Height scales the font; the text wraps at this width."
  }
  if (el.type === "frame") fields.angle = { disabled: true, reason: "Frames can't be rotated." }
  if (isLinear(el)) {
    if (el.width === 0) fields.width = { disabled: true, reason: "A vertical line has no width to scale." }
    if (el.height === 0) fields.height = { disabled: true, reason: "A level line has no height to scale." }
  }
  return { fields, note }
}

const TYPE_NAMES: Readonly<Record<string, string>> = {
  rectangle: "Rectangle",
  diamond: "Diamond",
  ellipse: "Ellipse",
  arrow: "Arrow",
  line: "Line",
  freedraw: "Freehand stroke",
  text: "Text",
  image: "Image",
  frame: "Frame",
  embeddable: "Embed",
}

/** "Rectangle", "Label", "Closed line" or the frame's own name, for the panel heading. */
export const elementTypeLabel = (el: NibElement): string => {
  if (el.type === "text" && el.containerId) return "Label"
  if (el.type === "line" && (el as { polygon?: boolean }).polygon) return "Closed line"
  if (el.type === "frame") return frameDisplayName(el as { name?: string | null })
  return TYPE_NAMES[el.type] ?? el.type
}

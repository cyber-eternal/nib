import type { EditorCore, NibElement } from "@nib/core"
import { applyStyle } from "../style/apply"

export type PickTarget = "stroke" | "background"

/** The stored colour to take from an element: its stroke, or its fill for the background picker. */
export const sampleColor = (el: NibElement | null | undefined, target: PickTarget): string | null => {
  if (!el) return null
  const color = target === "background" ? el.backgroundColor : el.strokeColor
  return color && color !== "transparent" ? color : null
}

/**
 * Gives the selection (or, with nothing selected, the next element) the picked element's colour. The
 * colour is already in stored form, so no theme remap is needed. Returns the colour, or null.
 */
export const applyPickedColor = (core: EditorCore, el: NibElement, target: PickTarget): string | null => {
  const color = sampleColor(el, target)
  if (!color) return null
  // applyStyle keeps a sampled fill off open lines, arrows and frames
  applyStyle(core, target === "background" ? { backgroundColor: color } : { strokeColor: color })
  return color
}

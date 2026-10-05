import type { ImageElement } from "../model/types"

/** A dashed box drawn in place of content that cannot be painted; shared by canvas and SVG. */
export interface BoxPlaceholder {
  stroke: string
  dash: number[]
  fill: string | null
  /** Diagonals through the box, so a failure reads differently from "still loading". */
  cross: boolean
}

export const RENDER_ERROR_PLACEHOLDER: BoxPlaceholder = {
  stroke: "#e03131",
  dash: [6, 4],
  fill: null,
  cross: false,
}

const IMAGE_LOADING: BoxPlaceholder = { stroke: "#999999", dash: [6, 6], fill: null, cross: false }
const IMAGE_FAILED: BoxPlaceholder = {
  stroke: "#e03131",
  dash: [4, 4],
  fill: "rgba(224, 49, 49, 0.06)",
  cross: true,
}

export const imagePlaceholder = (el: ImageElement): BoxPlaceholder =>
  el.status === "error" ? IMAGE_FAILED : IMAGE_LOADING

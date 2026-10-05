import {
  type EditorCore,
  type Point,
  type Viewport,
  fitBounds,
  getCommonVisualBounds,
  screenToScene,
} from "@nib/core"
import type { NibElement } from "@nib/core"

export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

/** Room the floating chrome takes: the top row, and the tray with its style bar at the bottom. */
export const CHROME_INSETS: Insets = { top: 64, right: 16, bottom: 132, left: 16 }

/** Room the presentation bar takes at the bottom edge (12px gap plus its 48px row); slides fit above it. */
export const SLIDE_INSETS: Insets = { top: 0, right: 0, bottom: 60, left: 0 }

/** fitBounds into the part of the viewport the chrome leaves free, so fitted content never sits under the tray. */
export const fitWithin = (
  els: readonly NibElement[],
  width: number,
  height: number,
  insets: Insets = CHROME_INSETS,
): Viewport | null => {
  if (els.length === 0) return null
  const w = Math.max(1, width - insets.left - insets.right)
  const h = Math.max(1, height - insets.top - insets.bottom)
  const vp = fitBounds(getCommonVisualBounds(els), w, h)
  return {
    zoom: vp.zoom,
    scrollX: vp.scrollX + insets.left / vp.zoom,
    scrollY: vp.scrollY + insets.top / vp.zoom,
  }
}

export const zoomToFitChrome = (core: EditorCore, onlySelection = false): void => {
  const size = core.viewportSize
  if (!size) return
  const els = onlySelection ? core.selectedElements() : core.scene.getNonDeleted()
  const vp = fitWithin(els, size.width, size.height)
  if (vp) core.setAppState({ viewport: vp })
  else if (!onlySelection) core.setAppState({ viewport: { scrollX: 0, scrollY: 0, zoom: 1 } })
}

const offscreenCache = new WeakMap<EditorCore, { version: number; w: number; h: number; value: boolean }>()

/** isContentOffscreen, rescanned only when the static layer (scene or viewport) changed. */
export const contentOffscreen = (core: EditorCore): boolean => {
  const size = core.viewportSize
  if (!size || size.width === 0) return false
  const hit = offscreenCache.get(core)
  if (hit && hit.version === core.staticVersion && hit.w === size.width && hit.h === size.height)
    return hit.value
  const value = core.isContentOffscreen(size.width, size.height)
  offscreenCache.set(core, { version: core.staticVersion, w: size.width, h: size.height, value })
  return value
}

export interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** The selection's bounds on screen, rounded to whole pixels so a selector can compare them; null when empty. */
export const selectionScreenRect = (core: EditorCore): ScreenRect | null => {
  const sel = core.selectedElements()
  if (sel.length === 0) return null
  const [x1, y1, x2, y2] = getCommonVisualBounds(sel)
  const { zoom, scrollX, scrollY } = core.appState.viewport
  return {
    left: Math.floor((x1 + scrollX) * zoom),
    top: Math.floor((y1 + scrollY) * zoom),
    right: Math.ceil((x2 + scrollX) * zoom),
    bottom: Math.ceil((y2 + scrollY) * zoom),
  }
}

export const rectsOverlap = (a: ScreenRect, b: ScreenRect): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/** Where a paste lands: under a pointer resting on the board, read through today's viewport, else mid-view. */
export const pastePoint = (core: EditorCore, pointer: Point | null): Point =>
  pointer ? screenToScene(pointer, core.appState.viewport) : core.viewportCenter()

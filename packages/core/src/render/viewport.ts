import type { Bounds } from "../math/bounds"
import { type Point, clamp } from "../math/vector"
import type { Viewport } from "../model/types"

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 30

export const sceneToScreen = (p: Point, vp: Viewport): Point => [
  (p[0] + vp.scrollX) * vp.zoom,
  (p[1] + vp.scrollY) * vp.zoom,
]

export const screenToScene = (p: Point, vp: Viewport): Point => [
  p[0] / vp.zoom - vp.scrollX,
  p[1] / vp.zoom - vp.scrollY,
]

export const panBy = (vp: Viewport, dxScreen: number, dyScreen: number): Viewport => ({
  ...vp,
  scrollX: vp.scrollX + dxScreen / vp.zoom,
  scrollY: vp.scrollY + dyScreen / vp.zoom,
})

export const zoomAt = (vp: Viewport, anchor: Point, factor: number): Viewport => {
  const zoom = clamp(vp.zoom * factor, MIN_ZOOM, MAX_ZOOM)
  if (zoom === vp.zoom) return vp
  const before = screenToScene(anchor, vp)
  return { zoom, scrollX: anchor[0] / zoom - before[0], scrollY: anchor[1] / zoom - before[1] }
}

export const zoomToValue = (vp: Viewport, anchor: Point, zoom: number): Viewport =>
  zoomAt(vp, anchor, clamp(zoom, MIN_ZOOM, MAX_ZOOM) / vp.zoom)

export const fitBounds = (b: Bounds, width: number, height: number, padding = 80): Viewport => {
  const bw = Math.max(1, b[2] - b[0])
  const bh = Math.max(1, b[3] - b[1])
  const zoom = clamp(Math.min((width - padding) / bw, (height - padding) / bh), MIN_ZOOM, 1)
  return {
    zoom,
    scrollX: width / zoom / 2 - (b[0] + b[2]) / 2,
    scrollY: height / zoom / 2 - (b[1] + b[3]) / 2,
  }
}

export const visibleSceneBounds = (vp: Viewport, width: number, height: number): Bounds => {
  const a = screenToScene([0, 0], vp)
  const b = screenToScene([width, height], vp)
  return [a[0], a[1], b[0], b[1]]
}

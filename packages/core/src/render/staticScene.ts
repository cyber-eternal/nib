import { boundsIntersect, expandBounds } from "../math/bounds"
import type { Scene } from "../model/scene"
import type { AppState, NibElement } from "../model/types"
import { FRAME_LABEL_HEIGHT, getElementRenderBounds } from "./bounds"
import type { Canvas2D } from "./canvasTypes"
import { type DrawContext, drawElement, drawRenderErrorBox } from "./drawElement"
import { FrameClipper, clippingFrameOf, liveFrames } from "./frameClip"
import { surfaceLookup } from "./surfaces"
import { type CanvasPalette, canvasBackground, defaultCanvasPalette } from "./theme"
import { visibleSceneBounds } from "./viewport"

export interface StaticSceneInput extends DrawContext {
  scene: Scene
  appState: AppState
  width: number
  height: number
  dpr: number
  /** Elements the eraser will delete on release; they and their labels are drawn faded. */
  pendingEraseIds?: readonly string[]
}

const drawGrid = (
  ctx: Canvas2D,
  size: number,
  appState: AppState,
  width: number,
  height: number,
  palette: CanvasPalette,
): void => {
  const { zoom, scrollX, scrollY } = appState.viewport
  const step = size * zoom
  if (step < 4) return
  const offX = (((scrollX * zoom) % step) + step) % step
  const offY = (((scrollY * zoom) % step) + step) % step
  const major = size * 5 * zoom
  const majorOffX = (((scrollX * zoom) % major) + major) % major
  const majorOffY = (((scrollY * zoom) % major) + major) % major

  ctx.save()
  try {
    ctx.setLineDash([])
    ctx.lineWidth = 1
    ctx.strokeStyle = palette.gridMinor
    ctx.beginPath()
    for (let x = offX; x < width; x += step) {
      ctx.moveTo(Math.round(x) + 0.5, 0)
      ctx.lineTo(Math.round(x) + 0.5, height)
    }
    for (let y = offY; y < height; y += step) {
      ctx.moveTo(0, Math.round(y) + 0.5)
      ctx.lineTo(width, Math.round(y) + 0.5)
    }
    ctx.stroke()

    if (major >= 12) {
      ctx.strokeStyle = palette.gridMajor
      ctx.beginPath()
      for (let x = majorOffX; x < width; x += major) {
        ctx.moveTo(Math.round(x) + 0.5, 0)
        ctx.lineTo(Math.round(x) + 0.5, height)
      }
      for (let y = majorOffY; y < height; y += major) {
        ctx.moveTo(0, Math.round(y) + 0.5)
        ctx.lineTo(width, Math.round(y) + 0.5)
      }
      ctx.stroke()
    }
  } finally {
    ctx.restore()
  }
}

// the link badge sits this many screen px outside the element's box
const LINK_BADGE_REACH = 24

const isVisible = (el: NibElement, visible: readonly [number, number, number, number], zoom: number) => {
  let b = getElementRenderBounds(el)
  if (el.link) b = expandBounds(b, LINK_BADGE_REACH / zoom)
  // the frame name keeps its screen size, so zoomed out it reaches further above the frame
  if (el.type === "frame" && zoom < 1) b = [b[0], b[1] - FRAME_LABEL_HEIGHT / zoom, b[2], b[3]]
  return boundsIntersect(b, visible)
}

const fadedIds = (pending: readonly string[] | undefined, elements: readonly NibElement[]) => {
  if (!pending || pending.length === 0) return undefined
  const ids = new Set(pending)
  for (const el of elements)
    if (el.type === "text" && el.containerId && ids.has(el.containerId)) ids.add(el.id)
  return ids
}

export const renderStaticScene = (ctx: Canvas2D, input: StaticSceneInput): void => {
  const { scene, appState, width, height, dpr } = input
  const palette = input.palette ?? defaultCanvasPalette(input.theme)
  const zoom = appState.viewport.zoom
  const elements = scene.getNonDeleted()
  const background = canvasBackground(appState.viewBackgroundColor, input.theme, palette)
  // ink is kept legible against the canvas colour actually painted, which a document may set
  const surface = input.surface !== undefined ? input.surface : background
  const dc: DrawContext = {
    ...input,
    palette,
    zoom,
    getElement: input.getElement ?? ((id) => scene.get(id)),
    fadedElementIds: input.fadedElementIds ?? fadedIds(input.pendingEraseIds, elements),
    surface,
    surfaceUnder: input.surfaceUnder ?? surfaceLookup(elements, input.theme, palette.board, surface),
  }
  ctx.save()
  try {
    ctx.setLineDash([])
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = background
    ctx.fillRect(0, 0, width, height)

    if (appState.gridSize) drawGrid(ctx, appState.gridSize, appState, width, height, palette)

    const visible = visibleSceneBounds(appState.viewport, width, height)
    ctx.scale(zoom, zoom)
    ctx.translate(appState.viewport.scrollX, appState.viewport.scrollY)

    const frames = liveFrames(elements)
    const clipper = new FrameClipper(ctx)
    const byId = (id: string) => scene.get(id)
    try {
      for (const el of elements) {
        try {
          if (!isVisible(el, visible, zoom)) continue
        } catch (error) {
          input.onError?.(el, error)
          drawRenderErrorBox(ctx, el, zoom)
          continue
        }
        if (frames.size > 0) clipper.enter(clippingFrameOf(el, frames, byId))
        drawElement(ctx, el, dc)
      }
    } finally {
      clipper.close()
    }
    if (input.cache.size > elements.length) input.cache.retain(elements)
  } finally {
    ctx.restore()
  }
}

/** Draws a fixed element list without viewport transform; used by exporters, so editor-only badges are off. */
export const renderElementsTo = (ctx: Canvas2D, elements: readonly NibElement[], dc: DrawContext): void => {
  const byId = new Map(elements.map((e) => [e.id, e]))
  const palette = dc.palette ?? defaultCanvasPalette(dc.theme)
  const exportDc: DrawContext = {
    ...dc,
    isExporting: dc.isExporting ?? true,
    getElement: dc.getElement ?? ((id) => byId.get(id)),
    surfaceUnder:
      dc.surfaceUnder ??
      surfaceLookup(elements, dc.theme, palette.board, dc.surface === undefined ? palette.board : dc.surface),
  }
  const frames = liveFrames(elements)
  const clipper = new FrameClipper(ctx)
  try {
    for (const el of elements) {
      if (frames.size > 0) clipper.enter(clippingFrameOf(el, frames, (id) => byId.get(id)))
      drawElement(ctx, el, exportDc)
    }
  } finally {
    clipper.close()
  }
}

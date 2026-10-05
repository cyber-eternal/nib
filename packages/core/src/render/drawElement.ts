import type { Drawable, OpSet } from "roughjs/bin/core"
import { elementCorners } from "../geometry/elementBounds"
import { type NibElement, type TextElement, type Theme, isLinearElement, isPolygonLine } from "../model/types"
import { arrowElementHeads, drawArrowheadPrimitives } from "./arrowheads"
import type { Canvas2D } from "./canvasTypes"
import { type ArrowLabelMask, type ElementLookup, arrowLabelMask } from "./labelMask"
import { type BoxPlaceholder, RENDER_ERROR_PLACEHOLDER, imagePlaceholder } from "./placeholder"
import type { ShapeCache } from "./shapes"
import { type SurfaceLookup, fillOver } from "./surfaces"
import { fontString, lineHeightPx, measureWithFont } from "./textMeasure"
import { type CanvasPalette, defaultCanvasPalette, themeColor } from "./theme"

export type ImageResolver = (fileId: string) => { image: unknown; width: number; height: number } | null

export interface DrawContext {
  theme: Theme
  cache: ShapeCache
  resolveImage?: ImageResolver
  /** Suppresses the label of a container while its text overlay is open. */
  hiddenElementIds?: ReadonlySet<string>
  /** Chrome colours and the board the dark remap inverts around; defaults to defaultCanvasPalette(theme). */
  palette?: CanvasPalette
  /** Leaves out editor-only decorations such as link badges. */
  isExporting?: boolean
  /** Keeps editor-only decorations a constant size on screen. */
  zoom?: number
  /** Called when an element fails to paint; it is drawn as a placeholder box instead. */
  onError?: (el: NibElement, error: unknown) => void
  /** Finds other elements, such as an arrow's label so the line can stop short of it. */
  getElement?: ElementLookup
  /** Elements drawn at PENDING_ERASE_ALPHA of their own opacity, such as those under the eraser trail. */
  fadedElementIds?: ReadonlySet<string>
  /** Frames whose name is hidden, such as while an inline rename field covers it. */
  hiddenFrameLabelIds?: ReadonlySet<string>
  /**
   * What is painted behind the elements (the canvas colour), which strokes and text are kept
   * legible against. Defaults to the palette's board; null when unknown, as in a transparent export.
   */
  surface?: string | null
  /** What each element sits on, such as a solid box under a line; without it, `surface` for all. */
  surfaceUnder?: SurfaceLookup
}

export const PENDING_ERASE_ALPHA = 0.3

const withSave = (ctx: Canvas2D, paint: () => void): void => {
  ctx.save()
  try {
    paint()
  } finally {
    ctx.restore()
  }
}

const traceOps = (ctx: Canvas2D, set: OpSet): void => {
  ctx.beginPath()
  for (const op of set.ops) {
    const d = op.data
    if (op.op === "move") ctx.moveTo(d[0]!, d[1]!)
    else if (op.op === "lineTo") ctx.lineTo(d[0]!, d[1]!)
    else if (op.op === "bcurveTo") ctx.bezierCurveTo(d[0]!, d[1]!, d[2]!, d[3]!, d[4]!, d[5]!)
  }
}

/** Fills that may self-intersect (curves, polygons) use evenodd, here and in SVG export. */
export const fillRuleFor = (drawable: Drawable): "evenodd" | "nonzero" =>
  drawable.shape === "curve" || drawable.shape === "polygon" ? "evenodd" : "nonzero"

export const drawDrawable = (ctx: Canvas2D, drawable: Drawable): void => {
  const o = drawable.options
  for (const set of drawable.sets) {
    withSave(ctx, () => {
      if (set.type === "path") {
        ctx.strokeStyle = o.stroke ?? "#000"
        ctx.lineWidth = o.strokeWidth ?? 1
        ctx.setLineDash(o.strokeLineDash ?? [])
        traceOps(ctx, set)
        ctx.stroke()
      } else if (set.type === "fillPath") {
        ctx.fillStyle = o.fill ?? "transparent"
        ctx.setLineDash([])
        traceOps(ctx, set)
        ctx.fill(fillRuleFor(drawable))
      } else if (set.type === "fillSketch") {
        ctx.strokeStyle = o.fill ?? "transparent"
        ctx.lineWidth = o.fillWeight && o.fillWeight > 0 ? o.fillWeight : (o.strokeWidth ?? 1) / 2
        ctx.setLineDash([])
        traceOps(ctx, set)
        ctx.stroke()
      }
    })
  }
}

export type ColorContext = Pick<DrawContext, "theme" | "palette" | "surface" | "surfaceUnder" | "getElement">

const boardOf = (dc: ColorContext): string => (dc.palette ?? defaultCanvasPalette(dc.theme)).board

/** The colour `el` is read against: what it sits on when known, else the surface. */
export const surfaceBehind = (el: NibElement, dc: ColorContext): string | null => {
  if (dc.surfaceUnder) return dc.surfaceUnder(el)
  return dc.surface === undefined ? boardOf(dc) : dc.surface
}

/**
 * What a text element is read against: its container's solid fill, laid over what the container
 * sits on with the container's opacity, or else what the text itself sits on.
 */
const behindText = (text: TextElement, dc: ColorContext): string | null => {
  const container = text.containerId ? dc.getElement?.(text.containerId) : undefined
  if (
    !container ||
    container.isDeleted ||
    container.fillStyle !== "solid" ||
    container.backgroundColor === "transparent" ||
    (isLinearElement(container) && !isPolygonLine(container))
  )
    return surfaceBehind(text, dc)
  return fillOver(container, dc.theme, boardOf(dc), surfaceBehind(container, dc))
}

/**
 * The colour a text element is painted in: its stroke, remapped for the theme and kept at 4.5:1
 * against its container's solid fill or what it sits on. The text editor overlay uses it too, so
 * typed text and drawn text match.
 */
export const displayTextColor = (text: TextElement, dc: ColorContext): string =>
  themeColor(text.strokeColor, dc.theme, boardOf(dc), "text", behindText(text, dc))

const drawFreedraw = (ctx: Canvas2D, el: NibElement & { type: "freedraw" }, dc: DrawContext): void => {
  if (el.points.length === 0) return
  const outline = dc.cache.freedrawOutline(el)
  if (outline.length < 2) return
  withSave(ctx, () => {
    ctx.fillStyle = themeColor(el.strokeColor, dc.theme, boardOf(dc), "stroke", surfaceBehind(el, dc))
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(outline[0]![0]!, outline[0]![1]!)
    for (let i = 1; i < outline.length; i++) {
      const a = outline[i]!
      const b = outline[(i + 1) % outline.length]!
      ctx.quadraticCurveTo(a[0]!, a[1]!, (a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2)
    }
    ctx.closePath()
    ctx.fill()
  })
}

const drawText = (ctx: Canvas2D, el: NibElement & { type: "text" }, dc: DrawContext): void => {
  withSave(ctx, () => {
    ctx.fillStyle = displayTextColor(el, dc)
    ctx.font = fontString(el.fontSize, el.fontFamily)
    ctx.textBaseline = "alphabetic"
    ctx.textAlign = el.textAlign === "center" ? "center" : el.textAlign === "right" ? "right" : "left"
    const lh = lineHeightPx(el.fontSize, el.lineHeight)
    const x = el.textAlign === "center" ? el.width / 2 : el.textAlign === "right" ? el.width : 0
    const lines = el.text.split("\n")
    lines.forEach((line, i) => {
      ctx.fillText(line, x, i * lh + lh * 0.82)
    })
  })
}

const drawPlaceholderBox = (
  ctx: Canvas2D,
  corners: readonly (readonly [number, number])[],
  spec: BoxPlaceholder,
  lineWidth: number,
): void => {
  withSave(ctx, () => {
    ctx.beginPath()
    corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])))
    ctx.closePath()
    if (spec.fill) {
      ctx.fillStyle = spec.fill
      ctx.fill()
    }
    ctx.strokeStyle = spec.stroke
    ctx.lineWidth = lineWidth
    ctx.setLineDash(spec.dash)
    ctx.stroke()
    if (spec.cross) {
      const [a, b, c, d] = corners
      ctx.beginPath()
      ctx.moveTo(a![0], a![1])
      ctx.lineTo(c![0], c![1])
      ctx.moveTo(b![0], b![1])
      ctx.lineTo(d![0], d![1])
      ctx.stroke()
    }
  })
}

const drawImage = (ctx: Canvas2D, el: NibElement & { type: "image" }, resolve?: ImageResolver): void => {
  const resolved = el.fileId && resolve ? resolve(el.fileId) : null
  if (!resolved) {
    const box: [number, number][] = [
      [0, 0],
      [el.width, 0],
      [el.width, el.height],
      [0, el.height],
    ]
    drawPlaceholderBox(ctx, box, imagePlaceholder(el), 1)
    return
  }
  withSave(ctx, () => {
    if (el.scale[0] < 0 || el.scale[1] < 0) {
      ctx.translate(el.scale[0] < 0 ? el.width : 0, el.scale[1] < 0 ? el.height : 0)
      ctx.scale(el.scale[0] < 0 ? -1 : 1, el.scale[1] < 0 ? -1 : 1)
    }
    if (el.crop) {
      ctx.drawImage(
        resolved.image,
        el.crop.x,
        el.crop.y,
        el.crop.width,
        el.crop.height,
        0,
        0,
        el.width,
        el.height,
      )
    } else {
      ctx.drawImage(resolved.image, 0, 0, el.width, el.height)
    }
  })
}

export const EMBEDDABLE_FILL = "#f1f3f5"
export const EMBEDDABLE_LABEL_FONT = "13px ui-sans-serif, system-ui, sans-serif"
export const FRAME_LABEL_SIZE = 12
export const FRAME_LABEL_FONT = `${FRAME_LABEL_SIZE}px ui-sans-serif, system-ui, sans-serif`
/** The frame name's left inset and baseline gap above the frame, in px at the label's own scale. */
export const FRAME_LABEL_INSET = 2
export const FRAME_LABEL_GAP = 6

/** A frame's display name; files may carry anything in `name`. */
export const frameName = (frame: { name?: unknown }): string =>
  typeof frame.name === "string" ? frame.name : "Frame"

/** Shortens `text` with an ellipsis until `measure` says it fits in `maxWidth`. */
export const ellipsize = (text: string, maxWidth: number, measure: (s: string) => number): string => {
  if (!(maxWidth > 0)) return ""
  if (measure(text) <= maxWidth) return text
  const chars = [...text]
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (measure(`${chars.slice(0, mid).join("")}…`) <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return lo === 0 ? "" : `${chars.slice(0, lo).join("")}…`
}

const positiveZoom = (zoom: number | undefined): number =>
  zoom !== undefined && zoom > 0 && Number.isFinite(zoom) ? zoom : 1

export interface FrameLabelLayout {
  text: string
  /** The name's box in the frame's unrotated local space (origin at its top-left corner), in scene units. */
  x: number
  y: number
  width: number
  height: number
}

/**
 * The frame name as drawn at `zoom` (1 for exports): a constant screen size, ellipsized to the
 * frame's on-screen width. Null when not even one character fits.
 */
export const frameLabelLayout = (
  frame: { width: number; name?: unknown },
  zoom: number,
  measure: (s: string) => number = (s) => measureWithFont(s, FRAME_LABEL_FONT),
): FrameLabelLayout | null => {
  const z = positiveZoom(zoom)
  const text = ellipsize(frameName(frame), frame.width * z - FRAME_LABEL_INSET * 2, measure)
  if (!text) return null
  return {
    text,
    x: FRAME_LABEL_INSET / z,
    y: -(FRAME_LABEL_GAP + FRAME_LABEL_SIZE) / z,
    width: measure(text) / z,
    // the ascent plus room for descenders below the baseline
    height: (FRAME_LABEL_SIZE + 4) / z,
  }
}

/** On canvas the name keeps a constant screen size and is cut to the frame's on-screen width. */
const drawFrame = (
  ctx: Canvas2D,
  el: NibElement & { type: "frame" },
  dc: DrawContext,
  palette: CanvasPalette,
): void => {
  withSave(ctx, () => {
    ctx.strokeStyle = palette.frameBorder
    ctx.lineWidth = 2
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.rect(0, 0, el.width, el.height)
    ctx.stroke()
    if (dc.hiddenFrameLabelIds?.has(el.id)) return
    const z = dc.isExporting ? 1 : positiveZoom(dc.zoom)
    ctx.font = FRAME_LABEL_FONT
    const label = frameLabelLayout(el, z, (s) => ctx.measureText(s).width)
    if (!label) return
    if (z !== 1) ctx.scale(1 / z, 1 / z)
    ctx.fillStyle = palette.frameLabel
    ctx.textBaseline = "alphabetic"
    ctx.textAlign = "left"
    ctx.fillText(label.text, FRAME_LABEL_INSET, -FRAME_LABEL_GAP)
  })
}

const drawEmbeddable = (ctx: Canvas2D, el: NibElement, dc: DrawContext, palette: CanvasPalette): void => {
  withSave(ctx, () => {
    ctx.fillStyle = themeColor(EMBEDDABLE_FILL, dc.theme, palette.board, "fill")
    ctx.fillRect(0, 0, el.width, el.height)
    ctx.fillStyle = palette.frameLabel
    ctx.font = EMBEDDABLE_LABEL_FONT
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    const label = ellipsize(el.link ?? "Embed", el.width - 16, (s) => ctx.measureText(s).width)
    if (label) ctx.fillText(label, el.width / 2, el.height / 2)
  })
}

const drawLinkBadge = (ctx: Canvas2D, el: NibElement, palette: CanvasPalette, zoom: number): void => {
  const z = positiveZoom(zoom)
  withSave(ctx, () => {
    ctx.globalAlpha = 1
    ctx.setLineDash([])
    ctx.beginPath()
    // clear of the ne resize handle, which reaches 10 screen px out from the corner
    ctx.arc(el.width + 16 / z, -16 / z, 4.5 / z, 0, Math.PI * 2)
    ctx.fillStyle = palette.selection
    ctx.fill()
    ctx.strokeStyle = palette.board
    ctx.lineWidth = 1.5 / z
    ctx.stroke()
  })
}

/** Clips the label box out of everything painted next, in scene space. */
const clipOutLabel = (ctx: Canvas2D, mask: ArrowLabelMask): void => {
  const [x1, y1, x2, y2] = mask.bounds
  ctx.beginPath()
  ctx.rect(x1, y1, x2 - x1, y2 - y1)
  mask.hole.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])))
  ctx.closePath()
  ctx.clip("evenodd")
}

const paintElement = (ctx: Canvas2D, el: NibElement, dc: DrawContext, palette: CanvasPalette): void => {
  withSave(ctx, () => {
    const fade = dc.fadedElementIds?.has(el.id) ? PENDING_ERASE_ALPHA : 1
    ctx.globalAlpha = (el.opacity / 100) * fade
    const mask = el.type === "arrow" ? arrowLabelMask(el, dc.getElement) : null
    if (mask) clipOutLabel(ctx, mask)
    ctx.translate(el.x + el.width / 2, el.y + el.height / 2)
    if (el.angle !== 0) ctx.rotate(el.angle)
    ctx.translate(-el.width / 2, -el.height / 2)
    ctx.lineCap = "round"
    ctx.lineJoin = "round"

    switch (el.type) {
      case "freedraw":
        drawFreedraw(ctx, el, dc)
        break
      case "text":
        drawText(ctx, el, dc)
        break
      case "image":
        drawImage(ctx, el, dc.resolveImage)
        break
      case "frame":
        drawFrame(ctx, el, dc, palette)
        break
      case "embeddable":
        drawEmbeddable(ctx, el, dc, palette)
        for (const shape of dc.cache.get(el, dc.theme, palette.board, surfaceBehind(el, dc)))
          drawDrawable(ctx, shape)
        break
      case "rectangle":
      case "diamond":
      case "ellipse":
      case "line":
      case "arrow":
        for (const shape of dc.cache.get(el, dc.theme, palette.board, surfaceBehind(el, dc)))
          drawDrawable(ctx, shape)
        break
      default:
        throw new Error(`Cannot render element type "${String((el as { type: unknown }).type)}"`)
    }

    if (el.type === "arrow" && el.points.length >= 2) {
      const stroke = themeColor(el.strokeColor, dc.theme, palette.board, "stroke", surfaceBehind(el, dc))
      const bg =
        el.backgroundColor === "transparent"
          ? "transparent"
          : themeColor(el.backgroundColor, dc.theme, palette.board, "fill")
      drawArrowheadPrimitives(ctx, arrowElementHeads(el, stroke, bg), stroke, el.strokeWidth)
    }

    if (el.link && !dc.isExporting && el.type !== "embeddable") drawLinkBadge(ctx, el, palette, dc.zoom ?? 1)
  })
}

/** Draws the failure placeholder over an element's rotated box, in scene space. */
export const drawRenderErrorBox = (ctx: Canvas2D, el: NibElement, zoom = 1): void => {
  try {
    const corners = elementCorners(el)
    if (!corners.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) return
    withSave(ctx, () => {
      ctx.globalAlpha = 1
      drawPlaceholderBox(ctx, corners, RENDER_ERROR_PLACEHOLDER, 1.5 / positiveZoom(zoom))
    })
  } catch {
    // nothing sensible left to draw
  }
}

/**
 * Paints one element with its own transform applied. A failure is contained to this element:
 * the canvas state is restored and a placeholder box is drawn in its place.
 */
export const drawElement = (ctx: Canvas2D, el: NibElement, dc: DrawContext): void => {
  if (el.isDeleted) return
  if (dc.hiddenElementIds?.has(el.id)) return
  const palette = dc.palette ?? defaultCanvasPalette(dc.theme)
  try {
    paintElement(ctx, el, dc, palette)
  } catch (error) {
    dc.onError?.(el, error)
    drawRenderErrorBox(ctx, el, dc.zoom)
  }
}

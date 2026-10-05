import { elbowSegments } from "../geometry/elbow"
import { getCommonBounds } from "../geometry/elementBounds"
import { elementCenter, elementOutline, isClosedShape } from "../geometry/outline"
import type { SnapLine } from "../geometry/snapping"
import {
  ELBOW_SEGMENT_HANDLE_MIN,
  HANDLE_SIZE,
  type HandleSet,
  type HandleType,
  SELECTION_PAD,
  getTransformHandles,
} from "../geometry/transformHandles"
import type { Bounds } from "../math/bounds"
import { type Point, rotatePoint } from "../math/vector"
import type { AppState, ImageElement, LinearElement, NibElement } from "../model/types"
import { isLinearElement, isPolygonLine } from "../model/types"
import type { Canvas2D } from "./canvasTypes"
import type { ImageResolver } from "./drawElement"
import { type CanvasPalette, defaultCanvasPalette } from "./theme"

export interface Collaborator {
  id: string
  name: string
  color: string
  pointer: Point | null
}

export interface InteractiveSceneInput {
  appState: AppState
  selected: readonly NibElement[]
  width: number
  height: number
  dpr: number
  marquee: Bounds | null
  lasso: readonly Point[] | null
  snapLines: readonly SnapLine[]
  bindingHighlight: NibElement | null
  /** Dots on shape borders showing where a connector will attach. */
  bindingHints: readonly Point[]
  frameHighlight: NibElement | null
  editingLinear: NibElement | null
  laserTrail: readonly { p: Point; t: number }[]
  collaborators?: readonly Collaborator[]
  suppressHandles?: boolean
  /** Chrome colours; defaults to defaultCanvasPalette(appState.theme). */
  palette?: CanvasPalette
  /** Resolves ids for correctionFlash and searchMatches; falls back to `selected`. */
  scene?: { get(id: string): NibElement | undefined }
  /** Pencil correction feedback: the new element's outline fades out as t goes 0 to 1. */
  correctionFlash?: { elementId: string; t: number }
  /** Element ids to highlight as search results. */
  searchMatches?: readonly string[]
  /** The search result the user is on; drawn more strongly than the other matches. */
  activeSearchMatch?: string | null
  /** Decoded bitmaps, for the full-image ghost shown around an image being cropped. */
  resolveImage?: ImageResolver
}

export interface HandleSetOptions {
  /** The image in crop mode: its handles sit on the crop box itself and it cannot be rotated. */
  croppingElementId?: string | null
}

/** Two-point lines and arrows are edited by their endpoints, so they get no box handles. */
export const isTwoPointLinear = (el: NibElement): el is LinearElement =>
  isLinearElement(el) && el.points.length === 2

/** Handles whose hit square would swallow a tiny element's centre are left out, so the body stays draggable. */
const withoutBodyCoveringHandles = (set: HandleSet, center: Point, zoom: number): HandleSet => {
  const r = HANDLE_SIZE / zoom
  const handles: HandleSet["handles"] = {}
  for (const key of Object.keys(set.handles) as HandleType[]) {
    const h = set.handles[key]!
    const covers = key !== "rotation" && Math.abs(center[0] - h[0]) <= r && Math.abs(center[1] - h[1]) <= r
    if (!covers) handles[key] = h
  }
  return { ...set, handles }
}

/** Crop handles on the box corners and edges, so the drawn brackets are what the pointer grabs. */
const cropHandleSet = (el: NibElement, zoom: number): HandleSet => {
  const pad = SELECTION_PAD / zoom
  return getTransformHandles(
    [el.x + pad, el.y + pad, el.x + el.width - pad, el.y + el.height - pad],
    el.angle,
    elementCenter(el),
    zoom,
    { omitRotation: true },
  )
}

export const selectionHandleSet = (
  selected: readonly NibElement[],
  zoom: number,
  opts: HandleSetOptions = {},
): HandleSet | null => {
  if (selected.length === 0) return null
  if (selected.length === 1) {
    const el = selected[0]!
    if (el.locked || isTwoPointLinear(el)) return null
    if (el.type === "image" && opts.croppingElementId === el.id) return cropHandleSet(el, zoom)
    const center = elementCenter(el)
    // a closed line is a shape, so it stretches along one axis like the others
    const omitSides =
      el.type === "freedraw" || el.type === "text" || (isLinearElement(el) && !isPolygonLine(el))
    // a frame's contents never turn with it, so it would only clip them (Excalidraw has no handle either)
    const set = getTransformHandles([el.x, el.y, el.x + el.width, el.y + el.height], el.angle, center, zoom, {
      omitSides,
      omitRotation: el.type === "frame",
    })
    if (el.type === "text" && !el.containerId) {
      // standalone text resizes its wrap width from the sides, whatever its height
      const [x1, y1, x2, y2] = set.bounds
      const my = (y1 + y2) / 2
      set.handles.e = rotatePoint([x2, my], center, el.angle)
      set.handles.w = rotatePoint([x1, my], center, el.angle)
    }
    return withoutBodyCoveringHandles(set, center, zoom)
  }
  const b = getCommonBounds(selected)
  const center: Point = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
  // side handles would stretch rotated members off their own axes
  const omitRotation = selected.some((el) => el.type === "frame")
  return withoutBodyCoveringHandles(
    getTransformHandles(b, 0, center, zoom, { omitSides: true, omitRotation }),
    center,
    zoom,
  )
}

const withSave = (ctx: Canvas2D, paint: () => void): void => {
  ctx.save()
  try {
    paint()
  } finally {
    ctx.restore()
  }
}

const strokeRectRotated = (ctx: Canvas2D, el: NibElement, pad: number): void => {
  withSave(ctx, () => {
    ctx.translate(el.x + el.width / 2, el.y + el.height / 2)
    if (el.angle !== 0) ctx.rotate(el.angle)
    ctx.strokeRect(-el.width / 2 - pad, -el.height / 2 - pad, el.width + pad * 2, el.height + pad * 2)
  })
}

const traceOutline = (ctx: Canvas2D, el: NibElement): void => {
  const outline = elementOutline(el)
  ctx.beginPath()
  outline.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])))
  if (isClosedShape(el)) ctx.closePath()
}

/** Points of a linear element in scene space, with its rotation applied. */
const scenePoints = (el: LinearElement): Point[] => {
  const c = elementCenter(el)
  return el.points.map((p) => rotatePoint([el.x + p[0], el.y + p[1]], c, el.angle))
}

/** Points-based shapes get a dashed frame, matching how they are only loosely
 * contained by their box; solid shapes fill theirs, so they get a solid one. */
const framedWithDashes = (el: NibElement): boolean =>
  el.type === "arrow" || el.type === "line" || el.type === "freedraw"

const drawPointHandles = (
  ctx: Canvas2D,
  points: readonly Point[],
  zoom: number,
  palette: CanvasPalette,
  picked: readonly number[] = [],
): void => {
  const size = HANDLE_SIZE / zoom
  ctx.strokeStyle = palette.selection
  ctx.lineWidth = 1.2 / zoom
  ctx.setLineDash([])
  points.forEach((p, i) => {
    ctx.fillStyle = picked.includes(i) ? palette.selection : palette.board
    ctx.beginPath()
    ctx.arc(p[0], p[1], size / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  })
}

/** Bars across the middle of each grabbable elbow segment, long side along the segment. */
const drawElbowSegmentHandles = (
  ctx: Canvas2D,
  points: readonly Point[],
  zoom: number,
  palette: CanvasPalette,
): void => {
  const long = (HANDLE_SIZE * 1.75) / zoom
  const short = (HANDLE_SIZE * 0.75) / zoom
  ctx.fillStyle = palette.board
  ctx.strokeStyle = palette.selection
  ctx.lineWidth = 1.2 / zoom
  ctx.setLineDash([])
  for (const seg of elbowSegments(points)) {
    if (seg.length * zoom < ELBOW_SEGMENT_HANDLE_MIN) continue
    const w = seg.horizontal ? long : short
    const h = seg.horizontal ? short : long
    ctx.beginPath()
    ctx.rect(seg.mid[0] - w / 2, seg.mid[1] - h / 2, w, h)
    ctx.fill()
    ctx.stroke()
  }
}

const isElbow = (el: NibElement | null): boolean => el?.type === "arrow" && el.elbowed

const toLocal = (ctx: Canvas2D, el: NibElement): void => {
  ctx.translate(el.x + el.width / 2, el.y + el.height / 2)
  if (el.angle !== 0) ctx.rotate(el.angle)
  ctx.translate(-el.width / 2, -el.height / 2)
}

export const CROP_GHOST_ALPHA = 0.3

/**
 * The whole bitmap's box in the image's local display space, at the crop's scale, so the part
 * the crop hides lines up with the part it keeps. Mirrored axes show the source the other way.
 */
export const cropGhostRect = (el: ImageElement): [number, number, number, number] | null => {
  const c = el.crop
  if (!c || !(c.width > 0) || !(c.height > 0)) return null
  const naturalW = c.naturalWidth || c.x + c.width
  const naturalH = c.naturalHeight || c.y + c.height
  const sx = el.width / c.width
  const sy = el.height / c.height
  const before = (start: number, length: number, natural: number, flipped: boolean): number =>
    flipped ? natural - start - length : start
  const rect: [number, number, number, number] = [
    -before(c.x, c.width, naturalW, el.scale[0] < 0) * sx,
    -before(c.y, c.height, naturalH, el.scale[1] < 0) * sy,
    naturalW * sx,
    naturalH * sy,
  ]
  return rect.every(Number.isFinite) ? rect : null
}

const drawCropGhost = (
  ctx: Canvas2D,
  el: ImageElement,
  resolve: ImageResolver | undefined,
  palette: CanvasPalette,
  zoom: number,
): void => {
  const rect = cropGhostRect(el)
  const crop = el.crop
  if (!rect || !crop) return
  const [gx, gy, gw, gh] = rect
  withSave(ctx, () => {
    toLocal(ctx, el)
    const resolved = el.fileId && resolve ? resolve(el.fileId) : null
    if (resolved) {
      withSave(ctx, () => {
        // only outside the crop box: the static layer already paints what the crop keeps
        ctx.beginPath()
        ctx.rect(gx, gy, gw, gh)
        ctx.rect(0, 0, el.width, el.height)
        ctx.clip("evenodd")
        ctx.globalAlpha = CROP_GHOST_ALPHA
        const flipX = el.scale[0] < 0
        const flipY = el.scale[1] < 0
        if (flipX || flipY) {
          ctx.translate(flipX ? el.width : 0, flipY ? el.height : 0)
          ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1)
        }
        ctx.drawImage(
          resolved.image,
          (-crop.x * el.width) / crop.width,
          (-crop.y * el.height) / crop.height,
          gw,
          gh,
        )
      })
    }
    ctx.globalAlpha = 0.6
    ctx.strokeStyle = palette.selection
    ctx.lineWidth = 1 / zoom
    ctx.setLineDash([4 / zoom, 4 / zoom])
    ctx.strokeRect(gx, gy, gw, gh)
  })
}

const CROP_ARM = 14
/** Half-length, in screen px, of the end ticks on an equal-spacing marker. */
const GAP_TICK = 4

/** L-shaped brackets on the crop corners and short bars on the edges that have handles. */
const drawCropHandles = (
  ctx: Canvas2D,
  el: NibElement,
  set: HandleSet,
  palette: CanvasPalette,
  zoom: number,
): void => {
  const w = el.width
  const h = el.height
  const arm = Math.min(CROP_ARM / zoom, Math.abs(w) / 2, Math.abs(h) / 2)
  withSave(ctx, () => {
    toLocal(ctx, el)
    ctx.setLineDash([])
    ctx.strokeStyle = palette.selection
    ctx.lineWidth = 1 / zoom
    ctx.strokeRect(0, 0, w, h)
    ctx.beginPath()
    for (const [cx, cy, dx, dy] of [
      [0, 0, 1, 1],
      [w, 0, -1, 1],
      [w, h, -1, -1],
      [0, h, 1, -1],
    ] as const) {
      ctx.moveTo(cx + dx * arm, cy)
      ctx.lineTo(cx, cy)
      ctx.lineTo(cx, cy + dy * arm)
    }
    const half = arm / 2
    if (set.handles.n) {
      ctx.moveTo(w / 2 - half, 0)
      ctx.lineTo(w / 2 + half, 0)
    }
    if (set.handles.s) {
      ctx.moveTo(w / 2 - half, h)
      ctx.lineTo(w / 2 + half, h)
    }
    if (set.handles.w) {
      ctx.moveTo(0, h / 2 - half)
      ctx.lineTo(0, h / 2 + half)
    }
    if (set.handles.e) {
      ctx.moveTo(w, h / 2 - half)
      ctx.lineTo(w, h / 2 + half)
    }
    ctx.lineCap = "square"
    ctx.lineJoin = "miter"
    // a board-coloured underlay keeps the brackets readable over any bitmap
    ctx.strokeStyle = palette.board
    ctx.lineWidth = 5 / zoom
    ctx.stroke()
    ctx.strokeStyle = palette.selection
    ctx.lineWidth = 3 / zoom
    ctx.stroke()
  })
}

const drawSearchMatch = (
  ctx: Canvas2D,
  el: NibElement,
  active: boolean,
  palette: CanvasPalette,
  zoom: number,
): void => {
  const px = 1 / zoom
  const pad = (active ? 8 : 6) * px
  withSave(ctx, () => {
    ctx.translate(el.x + el.width / 2, el.y + el.height / 2)
    if (el.angle !== 0) ctx.rotate(el.angle)
    const x = -el.width / 2 - pad
    const y = -el.height / 2 - pad
    const w = el.width + pad * 2
    const h = el.height + pad * 2
    ctx.setLineDash([])
    ctx.fillStyle = palette.searchHighlight
    ctx.globalAlpha = active ? 0.35 : 0.15
    ctx.fillRect(x, y, w, h)
    ctx.globalAlpha = 1
    ctx.strokeStyle = palette.searchHighlight
    ctx.lineWidth = (active ? 3 : 1.5) * px
    ctx.strokeRect(x, y, w, h)
  })
}

const renderSelection = (
  ctx: Canvas2D,
  input: InteractiveSceneInput,
  palette: CanvasPalette,
  zoom: number,
): void => {
  const { selected } = input
  const px = 1 / zoom
  ctx.strokeStyle = palette.selection
  ctx.lineWidth = px
  const single = selected.length === 1 ? selected[0]! : null

  const cropId = input.appState.croppingElementId
  if (single && single.type === "image" && single.id === cropId) {
    if (!input.suppressHandles) {
      const set = selectionHandleSet(selected, zoom, { croppingElementId: cropId })
      if (set) drawCropHandles(ctx, single, set, palette, zoom)
    }
    return
  }
  // a single selection's frame runs through its handles; group members get a tighter, quieter outline
  const pad = (single ? SELECTION_PAD : 4) * px

  for (const el of selected) {
    if (input.editingLinear?.id === el.id) continue
    if (single && isTwoPointLinear(el)) continue
    withSave(ctx, () => {
      if (single && framedWithDashes(el)) ctx.setLineDash([4 * px, 4 * px])
      else if (!single) ctx.globalAlpha = 0.55
      strokeRectRotated(ctx, el, pad)
    })
  }

  if (
    single &&
    isTwoPointLinear(single) &&
    !single.locked &&
    !input.editingLinear &&
    !input.suppressHandles
  ) {
    withSave(ctx, () => drawPointHandles(ctx, scenePoints(single), zoom, palette))
  }
  if (single && isElbow(single) && !single.locked && !input.editingLinear && !input.suppressHandles)
    withSave(ctx, () => drawElbowSegmentHandles(ctx, scenePoints(single as LinearElement), zoom, palette))

  const handleSet = input.suppressHandles ? null : selectionHandleSet(selected, zoom)
  if (handleSet && !input.editingLinear) {
    if (selected.length > 1) {
      withSave(ctx, () => {
        ctx.setLineDash([4 * px, 4 * px])
        ctx.strokeRect(
          handleSet.bounds[0],
          handleSet.bounds[1],
          handleSet.bounds[2] - handleSet.bounds[0],
          handleSet.bounds[3] - handleSet.bounds[1],
        )
      })
    }
    const size = HANDLE_SIZE / zoom
    ctx.fillStyle = palette.board
    ctx.lineWidth = 1.2 * px
    for (const key of Object.keys(handleSet.handles) as HandleType[]) {
      const h = handleSet.handles[key]!
      ctx.beginPath()
      if (key === "rotation") ctx.arc(h[0], h[1], size / 2, 0, Math.PI * 2)
      else ctx.rect(h[0] - size / 2, h[1] - size / 2, size, size)
      ctx.fill()
      ctx.stroke()
    }
  }

  if (input.editingLinear && isLinearElement(input.editingLinear)) {
    const pts = scenePoints(input.editingLinear)
    withSave(ctx, () => drawPointHandles(ctx, pts, zoom, palette, input.appState.selectedPointIndices))
    // elbow routes are reshaped by their segments; a midpoint vertex would make them diagonal
    if (isElbow(input.editingLinear)) {
      withSave(ctx, () => drawElbowSegmentHandles(ctx, pts, zoom, palette))
      return
    }
    withSave(ctx, () => {
      const size = HANDLE_SIZE / zoom
      ctx.fillStyle = palette.selection
      ctx.globalAlpha = 0.45
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!
        const b = pts[i + 1]!
        ctx.beginPath()
        ctx.arc((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, size / 3, 0, Math.PI * 2)
        ctx.fill()
      }
    })
  }
}

export const renderInteractiveScene = (ctx: Canvas2D, input: InteractiveSceneInput): void => {
  const { appState, width, height, dpr } = input
  const { zoom } = appState.viewport
  const palette = input.palette ?? defaultCanvasPalette(appState.theme)
  const lookup = (id: string): NibElement | null =>
    input.scene?.get(id) ?? input.selected.find((e) => e.id === id) ?? null

  ctx.save()
  try {
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)
    ctx.scale(zoom, zoom)
    ctx.translate(appState.viewport.scrollX, appState.viewport.scrollY)
    ctx.setLineDash([])
    const px = 1 / zoom

    const cropping = appState.croppingElementId ? lookup(appState.croppingElementId) : null
    if (cropping && cropping.type === "image" && !cropping.isDeleted)
      drawCropGhost(ctx, cropping, input.resolveImage, palette, zoom)

    const active = input.activeSearchMatch ?? null
    for (const id of input.searchMatches ?? []) {
      if (id === active) continue
      const el = lookup(id)
      if (el && !el.isDeleted) drawSearchMatch(ctx, el, false, palette, zoom)
    }
    const activeEl = active ? lookup(active) : null
    if (activeEl && !activeEl.isDeleted) drawSearchMatch(ctx, activeEl, true, palette, zoom)

    if (input.bindingHighlight) {
      const el = input.bindingHighlight
      withSave(ctx, () => {
        ctx.strokeStyle = palette.binding
        ctx.lineWidth = 2 * px
        ctx.setLineDash([])
        traceOutline(ctx, el)
        ctx.closePath()
        ctx.stroke()
      })
    }

    if (input.frameHighlight) {
      const el = input.frameHighlight
      withSave(ctx, () => {
        ctx.strokeStyle = palette.selection
        ctx.lineWidth = 2 * px
        ctx.setLineDash([])
        ctx.strokeRect(el.x, el.y, el.width, el.height)
      })
    }

    if (input.correctionFlash) {
      const el = lookup(input.correctionFlash.elementId)
      const t = Math.max(0, Math.min(1, input.correctionFlash.t))
      if (el && !el.isDeleted && t < 1) {
        withSave(ctx, () => {
          ctx.globalAlpha = 1 - t
          ctx.strokeStyle = palette.correctionFlash
          ctx.lineWidth = 3 * px
          ctx.lineCap = "round"
          ctx.lineJoin = "round"
          ctx.setLineDash([])
          traceOutline(ctx, el)
          ctx.stroke()
        })
      }
    }

    if (!appState.viewMode) withSave(ctx, () => renderSelection(ctx, input, palette, zoom))

    for (const dot of input.bindingHints) {
      withSave(ctx, () => {
        ctx.fillStyle = palette.board
        ctx.strokeStyle = palette.selection
        ctx.lineWidth = 1.5 * px
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.arc(dot[0], dot[1], 5 / zoom, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      })
    }

    if (input.marquee) {
      const [x1, y1, x2, y2] = input.marquee
      withSave(ctx, () => {
        ctx.fillStyle = palette.selectionFill
        ctx.strokeStyle = palette.selection
        ctx.lineWidth = px
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1)
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)
      })
    }

    if (input.lasso && input.lasso.length > 1) {
      const lasso = input.lasso
      withSave(ctx, () => {
        ctx.fillStyle = palette.selectionFill
        ctx.strokeStyle = palette.selection
        ctx.lineWidth = px
        ctx.beginPath()
        lasso.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])))
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      })
    }

    for (const line of input.snapLines) {
      withSave(ctx, () => {
        ctx.strokeStyle = palette.snapGuide
        ctx.lineWidth = px
        const gap = line.kind === "gap"
        // positions given along the guide and across it, so both orientations share one path
        const point = (along: number, across: number): Point =>
          line.axis === "x" ? [line.at + across, along] : [along, line.at + across]
        const segment = (a: Point, b: Point) => {
          ctx.moveTo(a[0], a[1])
          ctx.lineTo(b[0], b[1])
        }
        if (!gap) ctx.setLineDash([4 * px, 4 * px])
        ctx.beginPath()
        segment(point(line.from, 0), point(line.to, 0))
        if (gap)
          for (const end of [line.from, line.to])
            segment(point(end, -GAP_TICK * px), point(end, GAP_TICK * px))
        ctx.stroke()
        if (gap && line.distance !== undefined && Number.isFinite(line.distance)) {
          ctx.fillStyle = palette.snapGuide
          ctx.font = `${11 * px}px ui-sans-serif, system-ui, sans-serif`
          const mid = (line.from + line.to) / 2
          const label = String(Math.round(Math.abs(line.distance)))
          if (line.axis === "x") {
            ctx.textAlign = "left"
            ctx.textBaseline = "middle"
            ctx.fillText(label, line.at + (GAP_TICK + 3) * px, mid)
          } else {
            ctx.textAlign = "center"
            ctx.textBaseline = "bottom"
            ctx.fillText(label, mid, line.at - (GAP_TICK + 2) * px)
          }
        }
      })
    }

    if (input.laserTrail.length > 1) {
      const now = Date.now()
      withSave(ctx, () => {
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
        ctx.strokeStyle = palette.laser
        for (let i = 1; i < input.laserTrail.length; i++) {
          const a = input.laserTrail[i - 1]!
          const b = input.laserTrail[i]!
          const age = (now - b.t) / 1000
          if (age > 1) continue
          ctx.globalAlpha = Math.max(0, 1 - age)
          ctx.lineWidth = (6 * (1 - age * 0.5)) / zoom
          ctx.beginPath()
          ctx.moveTo(a.p[0], a.p[1])
          ctx.lineTo(b.p[0], b.p[1])
          ctx.stroke()
        }
      })
    }

    for (const c of input.collaborators ?? []) {
      if (!c.pointer) continue
      const pointer = c.pointer
      withSave(ctx, () => {
        ctx.translate(pointer[0], pointer[1])
        ctx.scale(1 / zoom, 1 / zoom)
        ctx.fillStyle = c.color
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(0, 16)
        ctx.lineTo(5, 12)
        ctx.lineTo(9, 19)
        ctx.lineTo(12, 17)
        ctx.lineTo(8, 11)
        ctx.lineTo(14, 10)
        ctx.closePath()
        ctx.fill()
        ctx.font = "11px ui-sans-serif, system-ui, sans-serif"
        ctx.textBaseline = "top"
        ctx.textAlign = "left"
        const w = ctx.measureText(c.name).width
        ctx.fillRect(12, 16, w + 8, 16)
        ctx.fillStyle = "#fff"
        ctx.fillText(c.name, 16, 19)
      })
    }
  } finally {
    ctx.restore()
  }
}

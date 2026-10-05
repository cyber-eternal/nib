import type { Bounds } from "../math/bounds"
import { type Point, normalizeAngle, rotatePoint } from "../math/vector"
import { mutateElement } from "../model/element"
import type { NibElement, PointBinding } from "../model/types"
import { absolutePointsOf, rebaseFromPoints } from "./linear"
import { elementCenter } from "./outline"
import type { HandleType } from "./transformHandles"

export interface ResizeOptions {
  keepAspect: boolean
  fromCenter: boolean
}

const MIN_SIZE = 1
const MIN_FONT_SIZE = 1

type PointsElement = Extract<NibElement, { type: "line" | "arrow" | "freedraw" }>

const hasPoints = (el: NibElement): el is PointsElement =>
  el.type === "line" || el.type === "arrow" || el.type === "freedraw"

/** A mirror reverses the side of the line the shape centre is on, so the focus sign flips with it. */
const mirrorBinding = (
  b: PointBinding | null,
  mirrorX: boolean,
  mirrorY: boolean,
  mirroredIds: ReadonlySet<string> | null,
): PointBinding | null => {
  if (!b || mirrorX === mirrorY) return b
  const fp = b.fixedPoint
  // a fixed point lives in the bound shape's frame, so it only mirrors when the shape does
  const fixedPoint =
    fp && mirroredIds?.has(b.elementId)
      ? ([mirrorX ? 1 - fp[0] : fp[0], mirrorY ? 1 - fp[1] : fp[1]] as Point)
      : fp
  return { ...b, focus: -b.focus, ...(fixedPoint !== undefined ? { fixedPoint } : {}) }
}

/** Patch for the parts of `el` that a scene-space mirror changes besides its position. */
const mirrorPatch = (
  el: NibElement,
  mirrorX: boolean,
  mirrorY: boolean,
  width: number,
  height: number,
  mirroredIds: ReadonlySet<string> | null,
): Record<string, unknown> => {
  const patch: Record<string, unknown> = {}
  if (!mirrorX && !mirrorY) return patch
  // reflecting a rotated box is reflecting it locally and negating the angle; two reflections cancel out
  if (mirrorX !== mirrorY && el.angle !== 0) patch.angle = normalizeAngle(-el.angle)
  if (el.type === "image") {
    patch.scale = [mirrorX ? -el.scale[0] : el.scale[0], mirrorY ? -el.scale[1] : el.scale[1]]
  }
  if (el.type === "arrow") {
    patch.startBinding = mirrorBinding(el.startBinding, mirrorX, mirrorY, mirroredIds)
    patch.endBinding = mirrorBinding(el.endBinding, mirrorX, mirrorY, mirroredIds)
  }
  if (hasPoints(el)) {
    patch.points = el.points.map(
      (p): Point => [mirrorX ? width - p[0] : p[0], mirrorY ? height - p[1] : p[1]],
    )
  }
  return patch
}

/**
 * Resize a line, arrow or stroke: its points are scaled in its own frame and
 * the box is derived from them, so a zero-height line stays zero-height and a
 * drag through the anchor mirrors the drawing.
 */
const resizePointsElement = <T extends NibElement>(
  el: T & PointsElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  center: Point,
): T => {
  const sx = el.width === 0 ? 1 : (x2 - x1) / el.width
  const sy = el.height === 0 ? 1 : (y2 - y1) / el.height
  const ox = el.width === 0 ? el.x : x1
  const oy = el.height === 0 ? el.y : y1
  const local = el.points.map((p): Point => [ox + p[0] * sx, oy + p[1] * sy])
  if (local.length === 0) return el
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of local) {
    minX = Math.min(minX, p[0])
    minY = Math.min(minY, p[1])
    maxX = Math.max(maxX, p[0])
    maxY = Math.max(maxY, p[1])
  }
  const width = maxX - minX
  const height = maxY - minY
  const newCenter = rotatePoint([minX + width / 2, minY + height / 2], center, el.angle)
  const patch: Record<string, unknown> = {
    x: newCenter[0] - width / 2,
    y: newCenter[1] - height / 2,
    width,
    height,
    points: local.map((p): Point => [p[0] - minX, p[1] - minY]),
  }
  if (el.type === "arrow" && sx < 0 !== sy < 0) {
    patch.startBinding = mirrorBinding(el.startBinding, sx < 0, sy < 0, null)
    patch.endBinding = mirrorBinding(el.endBinding, sx < 0, sy < 0, null)
  }
  return mutateElement(el, patch as Partial<Omit<T, "id" | "type">>) as T
}

/**
 * Resize `el` so the handle follows `pointer` while the opposite edge stays put.
 * Everything happens in the element's unrotated frame, then the new box is
 * re-anchored so it still rotates about its own centre.
 */
export const resizeElement = <T extends NibElement>(
  el: T,
  handle: HandleType,
  pointer: Point,
  opts: ResizeOptions,
): T => {
  if (handle === "rotation") return el
  const center = elementCenter(el)
  const local = rotatePoint(pointer, center, -el.angle)

  let x1 = el.x
  let y1 = el.y
  let x2 = el.x + el.width
  let y2 = el.y + el.height

  const west = handle.includes("w")
  const east = handle.includes("e")
  const north = handle.includes("n")
  const south = handle.includes("s")
  const horizontal = east || west
  const vertical = north || south
  const corner = horizontal && vertical
  // text scales as a whole from its corners, the way a picture would
  const keepAspect = opts.keepAspect || (el.type === "text" && corner)

  if (opts.fromCenter) {
    if (horizontal) {
      const dx = Math.abs(local[0] - center[0])
      x1 = center[0] - dx
      x2 = center[0] + dx
    }
    if (vertical) {
      const dy = Math.abs(local[1] - center[1])
      y1 = center[1] - dy
      y2 = center[1] + dy
    }
  } else {
    if (west) x1 = local[0]
    if (east) x2 = local[0]
    if (north) y1 = local[1]
    if (south) y2 = local[1]
  }

  if (keepAspect && el.width > 0 && el.height > 0) {
    const ratio = el.width / el.height
    let w = Math.abs(x2 - x1)
    let h = Math.abs(y2 - y1)
    if (corner) {
      if (w / h > ratio) w = h * ratio
      else h = w / ratio
    } else if (horizontal) {
      h = w / ratio
    } else {
      w = h * ratio
    }
    const sx = x2 >= x1 ? 1 : -1
    const sy = y2 >= y1 ? 1 : -1
    if (opts.fromCenter) {
      x1 = center[0] - w / 2
      x2 = center[0] + w / 2
      y1 = center[1] - h / 2
      y2 = center[1] + h / 2
    } else {
      // a side handle drives one axis; the other grows evenly about its middle
      if (!horizontal) {
        x1 = center[0] - w / 2
        x2 = center[0] + w / 2
      } else if (west) x1 = x2 - sx * w
      else x2 = x1 + sx * w
      if (!vertical) {
        y1 = center[1] - h / 2
        y2 = center[1] + h / 2
      } else if (north) y1 = y2 - sy * h
      else y2 = y1 + sy * h
    }
  }

  if (hasPoints(el)) return resizePointsElement(el, x1, y1, x2, y2, center)

  const nx = Math.min(x1, x2)
  const ny = Math.min(y1, y2)
  const nw = Math.max(MIN_SIZE, Math.abs(x2 - x1))
  const nh = Math.max(MIN_SIZE, Math.abs(y2 - y1))

  const newCenter = rotatePoint([nx + nw / 2, ny + nh / 2], center, el.angle)
  const patch: Record<string, unknown> = {
    x: newCenter[0] - nw / 2,
    y: newCenter[1] - nh / 2,
    width: nw,
    height: nh,
  }
  if (el.type === "image") {
    const flipX = x2 < x1 !== el.scale[0] < 0
    const flipY = y2 < y1 !== el.scale[1] < 0
    patch.scale = [flipX ? -1 : 1, flipY ? -1 : 1]
  }
  if (el.type === "text") {
    if (corner && el.height > 0) {
      patch.fontSize = Math.max(MIN_FONT_SIZE, el.fontSize * (nh / el.height))
    } else if (el.autoResize && horizontal && !vertical) {
      patch.autoResize = false
    }
  }
  return mutateElement(el, patch as Partial<Omit<T, "id" | "type">>)
}

export const rotateElementTo = <T extends NibElement>(
  el: T,
  pointer: Point,
  snap: boolean,
  offset = 0,
): T => {
  const c = elementCenter(el)
  let angle = Math.atan2(pointer[1] - c[1], pointer[0] - c[0]) + Math.PI / 2 - offset
  if (snap) {
    const step = Math.PI / 12
    angle = Math.round(angle / step) * step
  }
  return mutateElement(el, { angle: normalizeAngle(angle) } as Partial<Omit<T, "id" | "type">>)
}

/**
 * Turn `originals` by `delta` about `center`. Lines and arrows get the turn
 * baked into their points and keep angle 0, so every solver sees the points as
 * drawn; everything else orbits the centre and adds `delta` to its angle.
 */
export const rotateElements = (
  originals: readonly NibElement[],
  center: Point,
  delta: number,
): NibElement[] =>
  originals.map((o) => {
    if (o.type === "line" || o.type === "arrow") {
      const turned = absolutePointsOf(o).map((p) => rotatePoint(p, center, delta))
      return rebaseFromPoints({ ...o, angle: 0 }, turned)
    }
    const nc = rotatePoint(elementCenter(o), center, delta)
    return mutateElement(o, {
      angle: normalizeAngle(o.angle + delta),
      x: nc[0] - o.width / 2,
      y: nc[1] - o.height / 2,
    } as Partial<NibElement>)
  })

/**
 * Scene-axis scales expressed in the element's own frame. Exact for multiples
 * of 90deg; any other angle cannot stretch without shearing, so it scales
 * uniformly by the smaller factor and stays inside the new box.
 */
const localScale = (angle: number, sx: number, sy: number): [number, number] => {
  const quarters = normalizeAngle(angle) / (Math.PI / 2)
  const nearest = Math.round(quarters)
  if (Math.abs(quarters - nearest) < 1e-3) return nearest % 2 === 0 ? [sx, sy] : [sy, sx]
  const u = Math.min(sx, sy)
  return [u, u]
}

/**
 * Transform a whole selection so its common box matches the handle drag.
 * Each element's centre scales about the anchor; its size scales in its own
 * frame. Dragging through the anchor mirrors the selection, and Alt anchors at
 * the centre. Labels passed along with their containers only get their font
 * scaled; the caller re-lays them out.
 */
export const resizeMultiple = (
  elements: readonly NibElement[],
  original: Bounds,
  handle: HandleType,
  pointer: Point,
  opts: ResizeOptions,
): NibElement[] => {
  if (handle === "rotation") return [...elements]
  const [ox1, oy1, ox2, oy2] = original
  const ow = ox2 - ox1
  const oh = oy2 - oy1
  const west = handle.includes("w")
  const east = handle.includes("e")
  const north = handle.includes("n")
  const south = handle.includes("s")

  const ax = opts.fromCenter ? (ox1 + ox2) / 2 : west ? ox2 : ox1
  const ay = opts.fromCenter ? (oy1 + oy2) / 2 : north ? oy2 : oy1
  let sx = 1
  let sy = 1
  if (east || west) {
    const span = opts.fromCenter ? ow / 2 : ow
    if (span > 0) sx = (east ? pointer[0] - ax : ax - pointer[0]) / span
  }
  if (north || south) {
    const span = opts.fromCenter ? oh / 2 : oh
    if (span > 0) sy = (south ? pointer[1] - ay : ay - pointer[1]) / span
  }
  if (opts.keepAspect && (east || west) && (north || south)) {
    const s = Math.min(Math.abs(sx), Math.abs(sy))
    sx = sx < 0 ? -s : s
    sy = sy < 0 ? -s : s
  }

  const mirrorX = sx < 0
  const mirrorY = sy < 0
  const ids = new Set(elements.map((e) => e.id))

  return elements.map((el) => {
    const c = elementCenter(el)
    const nc: Point = [ax + (c[0] - ax) * sx, ay + (c[1] - ay) * sy]
    const [lx, ly] = localScale(el.angle, Math.abs(sx), Math.abs(sy))

    if (el.type === "text" && el.containerId && ids.has(el.containerId)) {
      return mutateElement(el, { fontSize: Math.max(MIN_FONT_SIZE, el.fontSize * Math.min(lx, ly)) })
    }

    let width: number
    let height: number
    const patch: Record<string, unknown> = {}
    if (hasPoints(el)) {
      width = el.width * lx
      height = el.height * ly
      patch.points = el.points.map((p): Point => [p[0] * lx, p[1] * ly])
    } else if (el.type === "text") {
      width = Math.max(MIN_SIZE, el.width * (el.autoResize ? ly : lx))
      height = Math.max(MIN_SIZE, el.height * ly)
      patch.fontSize = Math.max(MIN_FONT_SIZE, el.fontSize * ly)
    } else {
      width = el.width > 0 ? Math.max(MIN_SIZE, el.width * lx) : el.width
      height = el.height > 0 ? Math.max(MIN_SIZE, el.height * ly) : el.height
    }
    patch.x = nc[0] - width / 2
    patch.y = nc[1] - height / 2
    patch.width = width
    patch.height = height

    // text keeps reading left to right; only its placement and slant mirror
    const mirrored =
      el.type !== "text"
        ? mirrorPatch({ ...el, ...patch } as NibElement, mirrorX, mirrorY, width, height, ids)
        : mirrorX !== mirrorY && el.angle !== 0
          ? { angle: normalizeAngle(-el.angle) }
          : {}
    return mutateElement(el, { ...patch, ...mirrored } as Partial<NibElement>)
  })
}

/** Mirror `elements` inside `bounds`, as a reflection of the whole picture. */
export const flipElements = (
  elements: readonly NibElement[],
  bounds: Bounds,
  axis: "horizontal" | "vertical",
): NibElement[] => {
  const [x1, y1, x2, y2] = bounds
  const mirrorX = axis === "horizontal"
  const mirrorY = !mirrorX
  const ids = new Set(elements.map((e) => e.id))
  return elements.map((el) => {
    const patch: Record<string, unknown> = mirrorX
      ? { x: x1 + x2 - el.x - el.width }
      : { y: y1 + y2 - el.y - el.height }
    // text keeps reading left to right; only its placement and slant mirror
    if (el.type === "text") {
      if (el.angle !== 0) patch.angle = normalizeAngle(-el.angle)
    } else {
      Object.assign(patch, mirrorPatch(el, mirrorX, mirrorY, el.width, el.height, ids))
    }
    return mutateElement(el, patch as Partial<NibElement>)
  })
}

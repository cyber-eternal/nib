import type { Bounds } from "../math/bounds"
import { type Point, rotatePoint } from "../math/vector"
import type { NibElement } from "../model/types"
import { elementCenter } from "./outline"

export type SideHandle = "n" | "s" | "e" | "w"
export type CornerHandle = "nw" | "ne" | "sw" | "se"
export type HandleType = SideHandle | CornerHandle | "rotation"

export const HANDLE_SIZE = 8
/** Screen length below which an elbow segment gets no drag handle; its ends' handles cover it. */
export const ELBOW_SEGMENT_HANDLE_MIN = 30
export const ROTATION_GAP = 18
export const SELECTION_PAD = 6

export interface HandleSet {
  handles: Partial<Record<HandleType, Point>>
  bounds: Bounds
  angle: number
  center: Point
}

const SMALL = 40

/**
 * Handle positions in scene space. Sides disappear on small shapes so the
 * corners stay reachable, mirroring what feels right at high zoom-out.
 */
export const getTransformHandles = (
  bounds: Bounds,
  angle: number,
  center: Point,
  zoom: number,
  opts: { omitSides?: boolean; omitRotation?: boolean } = {},
): HandleSet => {
  const pad = SELECTION_PAD / zoom
  const [x1, y1, x2, y2] = [bounds[0] - pad, bounds[1] - pad, bounds[2] + pad, bounds[3] + pad]
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const w = (x2 - x1) * zoom
  const h = (y2 - y1) * zoom

  const raw: Partial<Record<HandleType, Point>> = {
    nw: [x1, y1],
    ne: [x2, y1],
    sw: [x1, y2],
    se: [x2, y2],
  }
  if (!opts.omitSides) {
    if (w > SMALL) {
      raw.n = [mx, y1]
      raw.s = [mx, y2]
    }
    if (h > SMALL) {
      raw.e = [x2, my]
      raw.w = [x1, my]
    }
  }
  if (!opts.omitRotation) raw.rotation = [mx, y1 - ROTATION_GAP / zoom]

  const handles: Partial<Record<HandleType, Point>> = {}
  for (const key of Object.keys(raw) as HandleType[]) {
    handles[key] = angle === 0 ? raw[key]! : rotatePoint(raw[key]!, center, angle)
  }
  return { handles, bounds: [x1, y1, x2, y2], angle, center }
}

export const handleSetForElement = (el: NibElement, zoom: number): HandleSet =>
  getTransformHandles([el.x, el.y, el.x + el.width, el.y + el.height], el.angle, elementCenter(el), zoom, {
    omitSides: el.type === "text" && !el.autoResize ? false : el.type === "freedraw",
  })

export const hitTestHandles = (set: HandleSet, p: Point, zoom: number): HandleType | null => {
  const r = HANDLE_SIZE / zoom
  for (const key of Object.keys(set.handles) as HandleType[]) {
    const h = set.handles[key]!
    if (Math.abs(p[0] - h[0]) <= r && Math.abs(p[1] - h[1]) <= r) return key
  }
  return null
}

export const handleCursor = (handle: HandleType, angle: number): string => {
  if (handle === "rotation") return "grab"
  const base: Record<Exclude<HandleType, "rotation">, number> = {
    e: 0,
    se: 45,
    s: 90,
    sw: 135,
    w: 180,
    nw: 225,
    n: 270,
    ne: 315,
  }
  const deg = (base[handle] + (angle * 180) / Math.PI + 360) % 360
  const idx = Math.round(deg / 45) % 8
  return [
    "ew-resize",
    "nwse-resize",
    "ns-resize",
    "nesw-resize",
    "ew-resize",
    "nwse-resize",
    "ns-resize",
    "nesw-resize",
  ][idx]!
}

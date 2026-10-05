import { elementCorners } from "../geometry/elementBounds"
import type { Point } from "../math/vector"
import type { NibElement } from "../model/types"
import type { Canvas2D } from "./canvasTypes"

/**
 * The frame an element is clipped to: its own frameId, or its container's for a label, and
 * only while that frame is among `frames`.
 */
export const clippingFrameOf = (
  el: NibElement,
  frames: ReadonlyMap<string, NibElement>,
  byId: (id: string) => NibElement | undefined,
): NibElement | null => {
  if (el.type === "frame") return null
  let frameId = el.frameId
  if (!frameId && el.type === "text" && el.containerId) frameId = byId(el.containerId)?.frameId ?? null
  return frameId ? (frames.get(frameId) ?? null) : null
}

export const liveFrames = (elements: readonly NibElement[]): Map<string, NibElement> => {
  const frames = new Map<string, NibElement>()
  for (const el of elements) if (el.type === "frame" && !el.isDeleted) frames.set(el.id, el)
  return frames
}

/**
 * What exporting one frame draws: the frame, which clips but is not itself drawn,
 * and everything clipped to it, labels included. Null when `frameId` is not a live frame.
 */
export const frameExport = (
  elements: readonly NibElement[],
  frameId: string,
): { frame: NibElement; elements: NibElement[] } | null => {
  const live = elements.filter((e) => !e.isDeleted)
  const frame = live.find((e) => e.id === frameId && e.type === "frame")
  if (!frame) return null
  const frames = new Map([[frame.id, frame]])
  const byId = new Map(live.map((e) => [e.id, e]))
  const members = live.filter(
    (e) => e === frame || clippingFrameOf(e, frames, (id) => byId.get(id)) === frame,
  )
  return { frame, elements: members }
}

/** The frame's rotated box in scene space, or null when its geometry is not finite. */
export const frameClipPolygon = (frame: NibElement): Point[] | null => {
  const corners = elementCorners(frame)
  return corners.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])) ? corners : null
}

/** Clips each run of consecutive children to their frame, opening one save() per run. */
export class FrameClipper {
  private open: NibElement | null = null

  constructor(private readonly ctx: Canvas2D) {}

  enter(frame: NibElement | null): void {
    if (frame === this.open) return
    this.close()
    const polygon = frame ? frameClipPolygon(frame) : null
    if (!frame || !polygon) return
    this.ctx.save()
    this.open = frame
    this.ctx.beginPath()
    polygon.forEach((p, i) => (i === 0 ? this.ctx.moveTo(p[0], p[1]) : this.ctx.lineTo(p[0], p[1])))
    this.ctx.closePath()
    this.ctx.clip()
  }

  close(): void {
    if (!this.open) return
    this.open = null
    this.ctx.restore()
  }
}

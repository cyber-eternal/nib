import { type Point, clamp, rotatePoint } from "../math/vector"
import { mutateElement } from "../model/element"
import type { ImageCrop, ImageElement } from "../model/types"
import { elementCenter } from "./outline"
import type { HandleType } from "./transformHandles"

const MIN_DISPLAY = 16

export const fullCrop = (naturalWidth: number, naturalHeight: number): ImageCrop => ({
  x: 0,
  y: 0,
  width: naturalWidth,
  height: naturalHeight,
  naturalWidth,
  naturalHeight,
})

interface AxisCrop {
  pos: number
  size: number
  start: number
  length: number
}

/**
 * Move one displayed edge of one axis by `delta` display pixels (positive is
 * rightward or downward). On a mirrored axis the displayed low edge shows the
 * source's high edge, so the trim lands on the other side of the source.
 */
const moveEdge = (
  axis: AxisCrop,
  edge: "low" | "high",
  pointerOffset: number,
  scale: number,
  natural: number,
  flipped: boolean,
): AxisCrop => {
  const { pos, size, start, length } = axis
  const lowMargin = flipped ? natural - (start + length) : start
  const highMargin = flipped ? start : natural - (start + length)
  // never shrink below the minimum, or below what is already shown when that is smaller
  const minSize = Math.min(MIN_DISPLAY, size)
  if (edge === "low") {
    const delta = clamp(pointerOffset, -lowMargin / scale, size - minSize)
    const trim = delta * scale
    return {
      pos: pos + delta,
      size: size - delta,
      start: flipped ? start : start + trim,
      length: length - trim,
    }
  }
  const delta = clamp(pointerOffset, -(size - minSize), highMargin / scale)
  const grow = delta * scale
  return {
    pos,
    size: size + delta,
    start: flipped ? start - grow : start,
    length: length + grow,
  }
}

/** Keeps the source rectangle inside the natural image without changing what it shows. */
const fitSource = (start: number, length: number, natural: number): [number, number] => {
  const len = clamp(length, 1, Math.max(1, natural))
  return [clamp(start, 0, Math.max(0, natural - len)), len]
}

/**
 * Drag a handle to trim the image. The element box shrinks and the source
 * rectangle shrinks with it, so the pixels that stay put on screen stay put,
 * mirrored images included. Handles can also be dragged back out, up to the
 * original bounds.
 */
export const cropElement = (el: ImageElement, handle: HandleType, pointer: Point): ImageElement => {
  if (handle === "rotation" || !el.crop) return el
  const crop = el.crop
  const local = rotatePoint(pointer, elementCenter(el), -el.angle)

  // scale between displayed pixels and source pixels on each axis
  const sx = el.width === 0 ? 1 : crop.width / el.width
  const sy = el.height === 0 ? 1 : crop.height / el.height
  const flipX = el.scale[0] < 0
  const flipY = el.scale[1] < 0

  let h: AxisCrop = { pos: el.x, size: el.width, start: crop.x, length: crop.width }
  let v: AxisCrop = { pos: el.y, size: el.height, start: crop.y, length: crop.height }
  if (handle.includes("w")) h = moveEdge(h, "low", local[0] - el.x, sx, crop.naturalWidth, flipX)
  if (handle.includes("e"))
    h = moveEdge(h, "high", local[0] - (el.x + el.width), sx, crop.naturalWidth, flipX)
  if (handle.includes("n")) v = moveEdge(v, "low", local[1] - el.y, sy, crop.naturalHeight, flipY)
  if (handle.includes("s"))
    v = moveEdge(v, "high", local[1] - (el.y + el.height), sy, crop.naturalHeight, flipY)

  // the box rotates about its own centre, so re-anchor after resizing
  const newCentre = rotatePoint([h.pos + h.size / 2, v.pos + v.size / 2], elementCenter(el), el.angle)
  const [cropX, cropW] = fitSource(h.start, h.length, crop.naturalWidth)
  const [cropY, cropH] = fitSource(v.start, v.length, crop.naturalHeight)

  return mutateElement(el, {
    x: newCentre[0] - h.size / 2,
    y: newCentre[1] - v.size / 2,
    width: h.size,
    height: v.size,
    crop: { ...crop, x: cropX, y: cropY, width: cropW, height: cropH },
  })
}

/**
 * Restores the whole source image at its cropped display scale, leaving the
 * visible pixels where they are on screen, mirrored or rotated.
 */
export const resetCrop = (el: ImageElement): ImageElement => {
  if (!el.crop) return el
  const crop = el.crop
  const sx = crop.width === 0 ? 1 : el.width / crop.width
  const sy = crop.height === 0 ? 1 : el.height / crop.height
  // on a mirrored axis the displayed low edge shows the source's high edge
  const before = (start: number, length: number, natural: number, flipped: boolean): number =>
    flipped ? natural - start - length : start
  const width = crop.naturalWidth * sx
  const height = crop.naturalHeight * sy
  const x = el.x - before(crop.x, crop.width, crop.naturalWidth, el.scale[0] < 0) * sx
  const y = el.y - before(crop.y, crop.height, crop.naturalHeight, el.scale[1] < 0) * sy
  const centre = rotatePoint([x + width / 2, y + height / 2], elementCenter(el), el.angle)
  return mutateElement(el, {
    x: centre[0] - width / 2,
    y: centre[1] - height / 2,
    width,
    height,
    crop: null,
  })
}

import { describe, expect, test } from "vitest"
import { cropElement, fullCrop, resetCrop } from "../../src/geometry/crop"
import { elementCenter } from "../../src/geometry/outline"
import { type Point, rotatePoint } from "../../src/math/vector"
import { newElement } from "../../src/model/element"
import type { ImageElement } from "../../src/model/types"

/** Source pixel painted at `scene`, following drawImage in render/drawElement.ts. */
const sourcePixelAt = (el: ImageElement, scene: Point): Point => {
  const local = rotatePoint(scene, elementCenter(el), -el.angle)
  let u = (local[0] - el.x) / el.width
  let v = (local[1] - el.y) / el.height
  if (el.scale[0] < 0) u = 1 - u
  if (el.scale[1] < 0) v = 1 - v
  const c = el.crop ?? fullCrop(1000, 1000)
  return [c.x + u * c.width, c.y + v * c.height]
}

const image = (over: Partial<ImageElement> = {}): ImageElement =>
  newElement("image", {
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    scale: [1, 1],
    crop: fullCrop(1000, 1000),
    status: "saved",
    fileId: "f",
    ...over,
  }) as ImageElement

const expectSamePixel = (a: Point, b: Point) => {
  expect(b[0]).toBeCloseTo(a[0], 3)
  expect(b[1]).toBeCloseTo(a[1], 3)
}

describe("cropping respects flip and rotation", () => {
  test("trimming a mirrored image keeps the visible pixels in place", () => {
    const img = image({ scale: [-1, 1] })
    const keep: Point = [150, 100]
    const before = sourcePixelAt(img, keep)
    const cropped = cropElement(img, "w", [100, 100])
    expectSamePixel(before, sourcePixelAt(cropped, keep))
  })

  test("resetting the crop of a rotated image keeps the visible pixels in place", () => {
    let img = image({ angle: Math.PI / 2 })
    img = cropElement(img, "e", rotatePoint([100, 100], elementCenter(img), img.angle))
    const probe = elementCenter(img)
    const before = sourcePixelAt(img, probe)
    expectSamePixel(before, sourcePixelAt(resetCrop(img), probe))
  })

  test("resetting the crop of a mirrored image keeps the visible pixels in place", () => {
    const img = image({
      scale: [-1, 1],
      crop: { x: 500, y: 0, width: 500, height: 1000, naturalWidth: 1000, naturalHeight: 1000 },
    })
    const probe: Point = [50, 100]
    const before = sourcePixelAt(img, probe)
    expectSamePixel(before, sourcePixelAt(resetCrop(img), probe))
  })
})

describe("cropping tiny images", () => {
  test("the source rectangle never exceeds the natural image", () => {
    const img = image({ width: 10, height: 10, crop: fullCrop(100, 100) })
    const c = cropElement(img, "w", [2, 5])
    expect(c.crop!.x + c.crop!.width).toBeLessThanOrEqual(100)
    expect(c.width).toBeLessThanOrEqual(10)
  })
})

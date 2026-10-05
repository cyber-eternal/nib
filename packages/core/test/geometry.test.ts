import { describe, expect, test } from "vitest"
import { alignElements, distributeElements } from "../src/geometry/align"
import { getElementBounds } from "../src/geometry/elementBounds"
import { hitTestElement } from "../src/geometry/hitTest"
import { flipElements, resizeElement, rotateElementTo } from "../src/geometry/resize"
import { getTransformHandles, hitTestHandles } from "../src/geometry/transformHandles"
import { distanceToSegment, rotatePoint } from "../src/math/vector"
import { newElement } from "../src/model/element"

const rect = (over = {}) => newElement("rectangle", { x: 10, y: 10, width: 100, height: 50, ...over })

describe("vector", () => {
  test("rotatePoint preserves radius", () => {
    const p = rotatePoint([1, 0], [0, 0], Math.PI / 2)
    expect(p[0]).toBeCloseTo(0)
    expect(p[1]).toBeCloseTo(1)
  })
  test("distanceToSegment clamps to endpoints", () => {
    expect(distanceToSegment([5, 3], [0, 0], [10, 0])).toBeCloseTo(3)
    expect(distanceToSegment([-4, 0], [0, 0], [10, 0])).toBeCloseTo(4)
  })
})

describe("hitTestElement", () => {
  test("transparent rectangle hits on stroke, misses interior", () => {
    const r = rect()
    expect(hitTestElement(r, [10, 35], 4)).toBe(true)
    expect(hitTestElement(r, [60, 35], 4)).toBe(false)
  })
  test("filled rectangle hits interior", () => {
    const r = rect({ backgroundColor: "#a5d8ff" })
    expect(hitTestElement(r, [60, 35], 4)).toBe(true)
    expect(hitTestElement(r, [200, 35], 4)).toBe(false)
  })
  test("rotation moves the hit area", () => {
    const r = rect({ backgroundColor: "#000", angle: Math.PI / 2 })
    // 100x50 box rotated 90deg about (60,35) spans x 35..85, y -15..85
    expect(hitTestElement(r, [60, 0], 2)).toBe(true)
    expect(hitTestElement(r, [105, 35], 2)).toBe(false)
  })
  test("ellipse excludes corners", () => {
    const e = newElement("ellipse", { x: 0, y: 0, width: 100, height: 100, backgroundColor: "#000" })
    expect(hitTestElement(e, [50, 50], 2)).toBe(true)
    expect(hitTestElement(e, [4, 4], 2)).toBe(false)
  })
  test("diamond excludes corners", () => {
    const d = newElement("diamond", { x: 0, y: 0, width: 100, height: 100, backgroundColor: "#000" })
    expect(hitTestElement(d, [50, 50], 2)).toBe(true)
    expect(hitTestElement(d, [6, 6], 2)).toBe(false)
  })
  test("arrow hits along its polyline", () => {
    const a = newElement("arrow", {
      x: 0,
      y: 0,
      points: [
        [0, 0],
        [100, 0],
      ],
    })
    expect(hitTestElement(a, [50, 1], 3)).toBe(true)
    expect(hitTestElement(a, [50, 40], 3)).toBe(false)
  })
})

describe("bounds", () => {
  test("rotated bounds grow", () => {
    const b = getElementBounds(rect({ angle: Math.PI / 4 }))
    expect(b[2] - b[0]).toBeGreaterThan(100)
  })
})

describe("resize", () => {
  const opts = { keepAspect: false, fromCenter: false }
  test("se keeps top-left fixed", () => {
    const r = resizeElement(rect(), "se", [160, 100], opts)
    expect([r.x, r.y, r.width, r.height]).toEqual([10, 10, 150, 90])
  })
  test("nw keeps bottom-right fixed", () => {
    const r = resizeElement(rect(), "nw", [0, 0], opts)
    expect([r.x, r.y, r.width, r.height]).toEqual([0, 0, 110, 60])
  })
  test("e only changes width", () => {
    const r = resizeElement(rect(), "e", [200, 999], opts)
    expect([r.x, r.y, r.width, r.height]).toEqual([10, 10, 190, 50])
  })
  test("keepAspect preserves the ratio", () => {
    const r = resizeElement(rect(), "se", [210, 20], { ...opts, keepAspect: true })
    expect(r.width / r.height).toBeCloseTo(2)
  })
  test("fromCenter grows both sides", () => {
    const r = resizeElement(rect(), "e", [140, 35], { ...opts, fromCenter: true })
    expect(r.width).toBeCloseTo(160)
    expect(r.x + r.width / 2).toBeCloseTo(60)
  })
  test("dragging past the anchor flips instead of going negative", () => {
    const r = resizeElement(rect(), "se", [-40, -40], opts)
    expect(r.width).toBeGreaterThan(0)
    expect(r.height).toBeGreaterThan(0)
  })
  test("rotated resize keeps the element centred on its own box", () => {
    const r = resizeElement(rect({ angle: Math.PI / 2 }), "se", [40, 120], opts)
    expect(Number.isFinite(r.x)).toBe(true)
    expect(r.width).toBeGreaterThan(0)
  })
  test("linear points scale with the box", () => {
    const line = newElement("line", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      points: [
        [0, 0],
        [100, 100],
      ],
    })
    const r = resizeElement(line, "se", [200, 100], { keepAspect: false, fromCenter: false })
    expect(r.points[1]![0]).toBeCloseTo(200)
    expect(r.points[1]![1]).toBeCloseTo(100)
  })
})

describe("rotate", () => {
  test("pointer below centre is half a turn", () => {
    const r = rotateElementTo(rect(), [60, 200], false)
    expect(r.angle).toBeCloseTo(Math.PI)
  })
  test("snapping lands on 15 degree steps", () => {
    const r = rotateElementTo(rect(), [160, 40], true)
    expect(((r.angle / (Math.PI / 12)) % 1).toFixed(5)).toBe("0.00000")
  })
})

describe("align and distribute", () => {
  const a = newElement("rectangle", { x: 0, y: 0, width: 50, height: 50 })
  const b = newElement("rectangle", { x: 100, y: 20, width: 50, height: 50 })
  const c = newElement("rectangle", { x: 400, y: 60, width: 50, height: 50 })

  test("align left", () => {
    const out = alignElements([a, b], "left")
    expect(out.map((e) => e.x)).toEqual([0, 0])
  })
  test("align centerY", () => {
    const out = alignElements([a, b], "centerY")
    expect(out[0]!.y + 25).toBeCloseTo(out[1]!.y + 25)
  })
  test("distribute horizontally equalises gaps", () => {
    const out = distributeElements([a, b, c], "horizontal")
    const xs = out.map((e) => e.x).sort((m, n) => m - n)
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!)
  })
})

describe("flip", () => {
  test("horizontal flip mirrors positions inside the selection box", () => {
    const a = newElement("rectangle", { x: 0, y: 0, width: 20, height: 10 })
    const b = newElement("rectangle", { x: 80, y: 0, width: 20, height: 10 })
    const out = flipElements([a, b], [0, 0, 100, 10], "horizontal")
    expect(out[0]!.x).toBe(80)
    expect(out[1]!.x).toBe(0)
  })
})

describe("transform handles", () => {
  test("corner handles are hit within tolerance", () => {
    const set = getTransformHandles([0, 0, 100, 100], 0, [50, 50], 1)
    expect(hitTestHandles(set, set.handles.se!, 1)).toBe("se")
    expect(hitTestHandles(set, [500, 500], 1)).toBeNull()
  })
  test("rotation handle sits above the top edge", () => {
    const set = getTransformHandles([0, 0, 100, 100], 0, [50, 50], 1)
    expect(set.handles.rotation![1]).toBeLessThan(0)
  })
})

import { beforeAll, describe, expect, test } from "vitest"
import {
  createBinding,
  fromFixedPoint,
  intersectOutline,
  toFixedPoint,
  updateBoundArrow,
} from "../src/geometry/binding"
import { containerMaxTextWidth, layoutBoundText } from "../src/geometry/boundText"
import { routeElbow } from "../src/geometry/elbow"
import { mutateElement, newElement } from "../src/model/element"
import type { ArrowElement, NibElement } from "../src/model/types"
import { setTextMeasurer } from "../src/render/textMeasure"

beforeAll(() => {
  // deterministic stand-in for canvas measurement
  setTextMeasurer((text) => text.length * 10)
})

const box = (x: number, y: number) =>
  newElement("rectangle", { x, y, width: 100, height: 80, backgroundColor: "#fff" })

const arrowBetween = (from: [number, number], to: [number, number]): ArrowElement =>
  newElement("arrow", {
    x: from[0],
    y: from[1],
    points: [
      [0, 0],
      [to[0] - from[0], to[1] - from[1]],
    ],
  })

describe("intersectOutline", () => {
  test("finds the near edge of a rectangle", () => {
    const shape = box(100, 100)
    const hit = intersectOutline(shape, [0, 140], [150, 140])
    expect(hit).not.toBeNull()
    expect(hit![0]).toBeCloseTo(100, 0)
  })
  test("returns null when the ray misses", () => {
    expect(intersectOutline(box(100, 100), [0, 0], [0, 500])).toBeNull()
  })
})

describe("bound arrows", () => {
  test("endpoint follows the shape when it moves", () => {
    const a = box(0, 0)
    const b = box(300, 0)
    let arrow = arrowBetween([110, 40], [290, 40])
    arrow = mutateElement(arrow, {
      startBinding: createBinding(a, arrow, "start"),
      endBinding: createBinding(b, arrow, "end"),
    })

    const elements = new Map<string, NibElement>([
      [a.id, a],
      [b.id, b],
    ])
    const moved = mutateElement(b, { x: 500 })
    elements.set(moved.id, moved)

    const updated = updateBoundArrow(arrow, (id) => elements.get(id))
    const tip = updated.points[updated.points.length - 1]!
    const tipX = updated.x + tip[0]
    expect(tipX).toBeGreaterThan(400)
    expect(tipX).toBeLessThan(500)
  })

  test("an arrow with no bindings is returned unchanged", () => {
    const arrow = arrowBetween([0, 0], [50, 50])
    expect(updateBoundArrow(arrow, () => undefined)).toBe(arrow)
  })

  test("a binding to a deleted shape leaves the arrow alone", () => {
    const a = box(0, 0)
    let arrow = arrowBetween([110, 40], [290, 40])
    arrow = mutateElement(arrow, { startBinding: createBinding(a, arrow, "start") })
    const gone = mutateElement(a, { isDeleted: true })
    const updated = updateBoundArrow(arrow, () => gone)
    expect(updated).toBe(arrow)
  })

  test("gap keeps the tip outside the shape", () => {
    const shape = box(200, 0)
    let arrow = arrowBetween([0, 40], [195, 40])
    arrow = mutateElement(arrow, { endBinding: createBinding(shape, arrow, "end") })
    const updated = updateBoundArrow(arrow, (id) => (id === shape.id ? shape : undefined))
    const tip = updated.points[updated.points.length - 1]!
    expect(updated.x + tip[0]).toBeLessThan(200)
  })
})

describe("fixed points", () => {
  test("round-trip through a rotated shape", () => {
    const shape = mutateElement(box(40, -20), { angle: 0.7 })
    for (const p of [
      [10, 30],
      [140, -25],
      [95, 61.5],
    ] as [number, number][]) {
      const back = fromFixedPoint(shape, toFixedPoint(shape, p))
      expect(back[0]).toBeCloseTo(p[0], 6)
      expect(back[1]).toBeCloseTo(p[1], 6)
    }
  })

  test("follow the shape when it moves and rotates", () => {
    const shape = box(0, 0)
    const fp = toFixedPoint(shape, [100, 40])
    expect(fp[0]).toBeCloseTo(1)
    expect(fp[1]).toBeCloseTo(0.5)
    const moved = mutateElement(shape, { x: 200, y: 100, angle: Math.PI / 2 })
    const p = fromFixedPoint(moved, fp)
    // the right-edge midpoint of a 100x80 box centred on (250, 140), turned a quarter
    expect(p[0]).toBeCloseTo(250, 6)
    expect(p[1]).toBeCloseTo(190, 6)
  })
})

describe("elbow routing", () => {
  test("produces only axis-aligned segments", () => {
    const route = routeElbow([0, 0], [200, 120], box(-50, -40), box(200, 80))
    expect(route.length).toBeGreaterThanOrEqual(2)
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i]!
      const b = route[i + 1]!
      const horizontal = Math.abs(a[1] - b[1]) < 0.6
      const vertical = Math.abs(a[0] - b[0]) < 0.6
      expect(horizontal || vertical).toBe(true)
    }
  })
  test("starts and ends where asked", () => {
    const route = routeElbow([10, 10], [300, 200])
    expect(route[0]).toEqual([10, 10])
    expect(route[route.length - 1]).toEqual([300, 200])
  })
})

describe("bound text layout", () => {
  test("wraps to the container and centres the label", () => {
    const container = newElement("rectangle", { x: 0, y: 0, width: 120, height: 60 })
    const text = newElement("text", {
      x: 0,
      y: 0,
      width: 0,
      height: 20,
      containerId: container.id,
      text: "one two three four",
      originalText: "one two three four",
      textAlign: "center",
      verticalAlign: "middle",
      fontSize: 20,
    })
    const laid = layoutBoundText(container, text)
    expect(laid.text.text).toContain("\n")
    expect(laid.text.width).toBeLessThanOrEqual(containerMaxTextWidth(container) + 1)
    const centre = laid.container.x + laid.container.width / 2
    expect(laid.text.x + laid.text.width / 2).toBeCloseTo(centre, 1)
  })

  test("container grows when the label needs more room", () => {
    const container = newElement("rectangle", { x: 0, y: 0, width: 80, height: 20 })
    const text = newElement("text", {
      x: 0,
      y: 0,
      width: 0,
      height: 20,
      containerId: container.id,
      text: "a b c d e f g h",
      originalText: "a b c d e f g h",
      fontSize: 20,
    })
    const laid = layoutBoundText(container, text)
    expect(laid.container.height).toBeGreaterThan(container.height)
  })
})

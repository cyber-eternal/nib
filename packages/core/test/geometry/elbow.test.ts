import { describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { routeElbow } from "../../src/geometry/elbow"
import { mulberry32 } from "../../src/math/random"
import type { Point } from "../../src/math/vector"
import { newElement } from "../../src/model/element"
import type { ArrowElement } from "../../src/model/types"
import { absPoints, distToOutline, draw, isOrthogonal, segmentCrossesBox } from "./helpers"

const elbowArrow = (ed: EditorCore, a: Point, b: Point): ArrowElement => {
  ed.setAppState({ currentItemArrowType: "elbow" })
  return draw(ed, "arrow", a, b) as ArrowElement
}

describe("a freshly drawn elbow arrow is orthogonal", () => {
  test("elbow arrows drawn out of a shape have only horizontal/vertical segments", () => {
    const rng = mulberry32(7)
    for (let i = 0; i < 40; i++) {
      const ed = new EditorCore()
      draw(ed, "rectangle", [0, 0], [100, 100])
      const start: Point = [10 + rng() * 80, 10 + rng() * 80]
      let end: Point = [-400 + rng() * 800, -400 + rng() * 800]
      if (end[0] > -40 && end[0] < 140 && end[1] > -40 && end[1] < 140) end = [end[0] + 400, end[1]]
      const arrow = elbowArrow(ed, start, end)
      const pts = absPoints(ed.scene.get(arrow.id) as ArrowElement)
      expect(isOrthogonal(pts), JSON.stringify({ start, end, pts })).toBe(true)
    }
  })
})

describe("an elbow arrow bound at one end follows its shape", () => {
  test("moving the shape keeps the bound end on its border", () => {
    const ed = new EditorCore()
    const rect = draw(ed, "rectangle", [0, 0], [100, 100])
    const arrow = elbowArrow(ed, [50, 50], [400, 300])
    expect(arrow.startBinding?.elementId).toBe(rect.id)
    ed.selectElements([rect.id])
    ed.nudge(0, 150)
    let pts = absPoints(ed.scene.get(arrow.id) as ArrowElement)
    expect(distToOutline(pts[0]!, ed.scene.get(rect.id)!)).toBeLessThan(34)
    ed.nudge(-300, 0)
    pts = absPoints(ed.scene.get(arrow.id) as ArrowElement)
    expect(distToOutline(pts[0]!, ed.scene.get(rect.id)!)).toBeLessThan(34)
    expect(isOrthogonal(pts)).toBe(true)
  })
})

describe("elbow routes never cut through their own start shape", () => {
  test("free end behind the shape routes around it", () => {
    const shape = newElement("rectangle", { x: -150, y: 229, width: 154, height: 75 })
    const start: Point = [8, 266]
    const end: Point = [-496, -29]
    const route = routeElbow(start, end, shape, null)
    expect(isOrthogonal(route)).toBe(true)
    for (let i = 0; i < route.length - 1; i++)
      expect(segmentCrossesBox(route[i]!, route[i + 1]!, shape), JSON.stringify(route)).toBe(false)
  })
})

describe("U-turn routes stay outside both boxes", () => {
  test("bottom-to-top self connection does not run through the shape", () => {
    const shape = newElement("rectangle", { x: 0, y: 0, width: 100, height: 100 })
    const route = routeElbow([50, 104], [50, -4], shape, shape)
    expect(isOrthogonal(route)).toBe(true)
    for (let i = 0; i < route.length - 1; i++)
      expect(segmentCrossesBox(route[i]!, route[i + 1]!, shape), JSON.stringify(route)).toBe(false)
  })

  test("leaving the bottom of A to enter the top of B above it avoids both", () => {
    const a = newElement("rectangle", { x: -150, y: 229, width: 154, height: 75 })
    const b = newElement("rectangle", { x: -181, y: 0, width: 143, height: 130 })
    const route = routeElbow([-73, 308], [-110, -4], a, b)
    expect(isOrthogonal(route)).toBe(true)
    for (let i = 0; i < route.length - 1; i++) {
      expect(segmentCrossesBox(route[i]!, route[i + 1]!, a), JSON.stringify(route)).toBe(false)
      expect(segmentCrossesBox(route[i]!, route[i + 1]!, b), JSON.stringify(route)).toBe(false)
    }
  })
})

describe("elbow routing avoids other shapes", () => {
  test("an elbow arrow between two shapes detours around a shape in the way", () => {
    const ed = new EditorCore()
    draw(ed, "rectangle", [0, 0], [100, 100])
    draw(ed, "rectangle", [600, 0], [700, 100])
    const blocker = draw(ed, "rectangle", [300, -50], [400, 150])
    const arrow = elbowArrow(ed, [50, 50], [650, 50])
    expect(arrow.startBinding).not.toBeNull()
    expect(arrow.endBinding).not.toBeNull()
    const pts = absPoints(ed.scene.get(arrow.id) as ArrowElement)
    expect(isOrthogonal(pts)).toBe(true)
    for (let i = 0; i < pts.length - 1; i++)
      expect(segmentCrossesBox(pts[i]!, pts[i + 1]!, blocker), JSON.stringify(pts)).toBe(false)
  })
})

import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { routeCrossesBoxes } from "../../src/geometry/elbow"
import { getElementBounds } from "../../src/geometry/elementBounds"
import { absolutePointsOf } from "../../src/geometry/linear"
import { tidyLinearElements } from "../../src/geometry/tidy"
import { newElement } from "../../src/model/element"
import type { ArrowElement } from "../../src/model/types"
import { drawArrow, drawShape, key, setupMeasurer } from "../editor/helpers"

beforeAll(setupMeasurer)

describe("tidy up routes around the shapes in the way", () => {
  test("a bound connector is not re-routed through the shape between its ends", () => {
    const ed = new EditorCore()
    const s1 = drawShape(ed, "rectangle", [200, 300], [320, 380])
    const s2 = drawShape(ed, "rectangle", [800, 300], [920, 380])
    const middle = drawShape(ed, "rectangle", [480, 250], [640, 430])
    ed.clearSelection()
    ed.updateSelectedStyle({ arrowType: "elbow" })
    const arrow = drawArrow(ed, [260, 340], [860, 340])
    expect(arrow.startBinding?.elementId).toBe(s1.id)
    expect(arrow.endBinding?.elementId).toBe(s2.id)
    const blocker = getElementBounds(ed.scene.get(middle.id)!)
    expect(routeCrossesBoxes(absolutePointsOf(ed.scene.get(arrow.id) as ArrowElement), [blocker])).toBe(false)

    ed.setElementGeometry(s2.id, { y: 500 })
    ed.keyDown(key("Escape"))
    ed.tidyUp()
    const tidied = ed.scene.get(arrow.id) as ArrowElement
    expect(routeCrossesBoxes(absolutePointsOf(tidied), [blocker])).toBe(false)
    expect(tidied.startBinding?.elementId).toBe(s1.id)
    expect(tidied.endBinding?.elementId).toBe(s2.id)
  })

  test("a straight run that would cross a shape is not taken", () => {
    const a = newElement("rectangle", { id: "a", x: 0, y: 0, width: 100, height: 100 })
    const b = newElement("rectangle", { id: "b", x: 400, y: 0, width: 100, height: 100 })
    const wall = newElement("rectangle", { id: "w", x: 200, y: -50, width: 60, height: 200 })
    const arrow = newElement("arrow", {
      id: "arr",
      x: 100,
      y: 50,
      points: [
        [0, 0],
        [300, 10],
      ],
      startBinding: { elementId: "a", focus: 0, gap: 4 },
      endBinding: { elementId: "b", focus: 0, gap: 4 },
    }) as ArrowElement
    const out = tidyLinearElements([arrow], { all: [a, b, wall, arrow], zoom: 1 })
    const tidied = out.elements[0] as ArrowElement
    const pts = absolutePointsOf(tidied)
    expect(routeCrossesBoxes(pts, [getElementBounds(wall)])).toBe(false)
    expect(tidied.elbowed).toBe(true)
  })

  test("with nothing in the way the run stays straight", () => {
    const a = newElement("rectangle", { id: "a", x: 0, y: 0, width: 100, height: 100 })
    const b = newElement("rectangle", { id: "b", x: 400, y: 0, width: 100, height: 100 })
    const arrow = newElement("arrow", {
      id: "arr",
      x: 100,
      y: 50,
      points: [
        [0, 0],
        [300, 10],
      ],
      startBinding: { elementId: "a", focus: 0, gap: 4 },
      endBinding: { elementId: "b", focus: 0, gap: 4 },
    }) as ArrowElement
    const tidied = tidyLinearElements([arrow], { all: [a, b, arrow], zoom: 1 }).elements[0] as ArrowElement
    const pts = absolutePointsOf(tidied)
    expect(pts).toHaveLength(2)
    expect(pts[0]![1]).toBeCloseTo(pts[1]![1], 6)
    expect(tidied.elbowed).toBe(false)
  })
})

describe("tidying selected shapes tidies their connectors", () => {
  test("a sloped arrow between two selected boxes is straightened", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [400, 20], [500, 120])
    const arrow = drawArrow(ed, [50, 40], [450, 80])
    expect(arrow.startBinding?.elementId).toBe(a.id)
    expect(arrow.endBinding?.elementId).toBe(b.id)
    ed.selectElements([a.id, b.id])
    expect(ed.tidyUp()).toBeGreaterThan(0)
    const pts = absolutePointsOf(ed.scene.get(arrow.id) as ArrowElement)
    expect(pts[0]![1]).toBeCloseTo(pts[pts.length - 1]![1], 6)
  })

  test("an unrelated arrow is left alone", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    drawShape(ed, "rectangle", [400, 20], [500, 120])
    const loose = drawArrow(ed, [0, 400], [300, 440])
    const before = absolutePointsOf(ed.scene.get(loose.id) as ArrowElement)
    ed.selectElements([a.id])
    ed.tidyUp()
    expect(absolutePointsOf(ed.scene.get(loose.id) as ArrowElement)).toEqual(before)
  })
})

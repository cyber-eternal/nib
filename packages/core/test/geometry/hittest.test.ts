import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { elementsInBounds, elementsInLasso, labelContainerAtPoint } from "../../src/geometry/hitTest"
import type { Point } from "../../src/math/vector"
import { newElement } from "../../src/model/element"
import { canHaveLabel } from "../../src/model/types"
import { setTextMeasurer } from "../../src/render/textMeasure"
import { drag, draw } from "./helpers"

beforeAll(() => setTextMeasurer((t) => t.length * 9))

const lasso: Point[] = [
  [150, -50],
  [250, -50],
  [250, 50],
  [150, 50],
]

describe("lasso catches strokes, not just vertices", () => {
  test("a lasso around the middle of a straight line selects it", () => {
    const line = newElement("line", {
      x: 0,
      y: 0,
      width: 400,
      height: 0,
      points: [
        [0, 0],
        [400, 0],
      ],
    })
    expect(elementsInLasso([line], lasso)).toHaveLength(1)
  })

  test("a lasso across a rectangle's edge selects it", () => {
    const rect = newElement("rectangle", { x: 0, y: 0, width: 400, height: 400 })
    expect(elementsInLasso([rect], lasso)).toHaveLength(1)
  })
})

describe("marquee selection skips labels", () => {
  test("elementsInBounds does not return bound text", () => {
    const rect = newElement("rectangle", { x: 0, y: 0, width: 200, height: 100 })
    const text = newElement("text", { x: 80, y: 40, width: 40, height: 20, containerId: rect.id, text: "hi" })
    const hits = elementsInBounds([rect, text], [-10, -10, 300, 300])
    expect(hits.map((e) => e.id)).toEqual([rect.id])
  })

  test("a marquee-selected labelled shape is a single selection that Enter can edit", () => {
    const ed = new EditorCore()
    const rect = draw(ed, "rectangle", [0, 0], [200, 100])
    ed.startEditingLabel(rect)
    const label = ed.scene.getNonDeleted().find((e) => e.type === "text")!
    ed.commitText(label.id, "hello")
    ed.clearSelection()
    ed.setTool("selection")
    drag(ed, [-20, -20], [250, 150])
    expect(ed.selectedElements().map((e) => e.id)).toEqual([rect.id])
  })
})

describe("label container lookup for arrows", () => {
  test("double-clicking empty canvas inside a diagonal arrow's box does not target the arrow", () => {
    const arrow = newElement("arrow", {
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      points: [
        [0, 0],
        [500, 500],
      ],
    })
    expect(labelContainerAtPoint([arrow], [450, 50], canHaveLabel)).toBeNull()
  })
})

describe("thin and tiny selected elements can still be dragged", () => {
  test("dragging a selected straight line from its middle moves it", () => {
    const ed = new EditorCore()
    const line = draw(ed, "line", [0, 100], [300, 100])
    expect(ed.appState.selectedElementIds[line.id]).toBe(true)
    drag(ed, [150, 100], [150, 200])
    const moved = ed.scene.get(line.id)!
    expect(moved.y).toBeCloseTo(200, 5)
    expect(moved.height).toBeCloseTo(0, 5)
  })

  test("dragging the centre of a tiny selected shape moves it", () => {
    const ed = new EditorCore()
    const r = draw(ed, "rectangle", [100, 100], [104, 104])
    ed.updateSelectedStyle({ backgroundColor: "#ff0000" })
    ed.selectElements([r.id])
    drag(ed, [102, 102], [202, 202])
    const moved = ed.scene.get(r.id)!
    expect(moved.width).toBeCloseTo(4, 5)
    expect(moved.x).toBeCloseTo(200, 5)
  })
})

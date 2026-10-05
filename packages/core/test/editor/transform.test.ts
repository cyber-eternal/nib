import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { getCommonBounds } from "../../src/geometry/elementBounds"
import { absolutePointsOf } from "../../src/geometry/linear"
import { ROTATION_GAP, SELECTION_PAD } from "../../src/geometry/transformHandles"
import { addLabel, drag, drawArrow, drawShape, ptr, setupMeasurer, undoDepth } from "./helpers"

beforeAll(setupMeasurer)

const centre = (el: { x: number; y: number; width: number; height: number }) => [
  el.x + el.width / 2,
  el.y + el.height / 2,
]

describe("rotation", () => {
  test("rotating several labelled shapes carries each label with its container", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const labelA = addLabel(ed, a, "A")
    const b = drawShape(ed, "rectangle", [300, 0], [400, 100])
    addLabel(ed, b, "B")
    ed.setTool("selection")
    ed.selectElements([a.id, b.id])
    const bb = getCommonBounds(ed.selectedElements())
    const handle: [number, number] = [(bb[0] + bb[2]) / 2, bb[1] - SELECTION_PAD - ROTATION_GAP]
    drag(ed, handle, [400, 300])

    const container = ed.scene.get(a.id)!
    const label = ed.scene.get(labelA)!
    expect(container.angle).not.toBe(0)
    const [cx, cy] = centre(container)
    const [lx, ly] = centre(label)
    expect(lx).toBeCloseTo(cx, 0)
    expect(ly).toBeCloseTo(cy, 0)
    expect(label.angle).toBeCloseTo(container.angle)
  })

  test("rotating one labelled shape rotates its label too", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const labelId = addLabel(ed, rect, "hi")
    ed.setTool("selection")
    ed.selectElements([rect.id])
    drag(ed, [50, -SELECTION_PAD - ROTATION_GAP], [150, 50])
    const container = ed.scene.get(rect.id)!
    expect(container.angle).toBeCloseTo(Math.PI / 2)
    expect(ed.scene.get(labelId)!.angle).toBeCloseTo(container.angle)
  })
})

describe("resize", () => {
  test("resizing back to the original size still produces a new version", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.setTool("selection")
    ed.pointerDown(ptr(100 + SELECTION_PAD, 50))
    ed.pointerMove(ptr(160, 50))
    const wide = ed.scene.get(rect.id)!
    ed.pointerMove(ptr(100, 50))
    const back = ed.scene.get(rect.id)!
    ed.pointerUp(ptr(100, 50))
    // the shape cache is keyed by version: same version + different size draws a stale shape
    expect(back.width).not.toBe(wide.width)
    expect(back.version).not.toBe(wide.version)
  })

  test("grabbing a handle does not jump the edge to the pointer", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.setTool("selection")
    ed.pointerDown(ptr(100 + SELECTION_PAD, 50)) // centre of the east handle
    ed.pointerMove(ptr(101 + SELECTION_PAD, 50))
    expect(ed.scene.get(rect.id)!.width).toBeCloseTo(101)
    ed.pointerUp(ptr(101 + SELECTION_PAD, 50))
  })
})

describe("dragging straight arrows", () => {
  test("a selected horizontal arrow can be dragged by its middle", () => {
    const ed = new EditorCore()
    const arrow = drawArrow(ed, [0, 0], [200, 0])
    expect(ed.appState.selectedElementIds[arrow.id]).toBe(true)
    const depth = undoDepth(ed)
    drag(ed, [100, 0], [100, 200])
    const pts = absolutePointsOf(ed.scene.get(arrow.id) as never)
    expect(pts[0]![1]).toBeCloseTo(200)
    expect(pts[1]![1]).toBeCloseTo(200)
    expect(undoDepth(ed)).toBe(depth + 1)
  })
})

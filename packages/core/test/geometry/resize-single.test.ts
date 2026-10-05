import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { getElementBounds } from "../../src/geometry/elementBounds"
import { resizeElement } from "../../src/geometry/resize"
import { boundsFromPoints } from "../../src/math/bounds"
import { newElement } from "../../src/model/element"
import type { TextElement } from "../../src/model/types"
import { selectionHandleSet } from "../../src/render/interactiveScene"
import { setTextMeasurer } from "../../src/render/textMeasure"
import { absPoints, drag, ptr } from "./helpers"

beforeAll(() => setTextMeasurer((t, font) => t.length * Number.parseFloat(font) * 0.5))

const plain = { keepAspect: false, fromCenter: false }

describe("resizing zero-width / zero-height lines keeps box and points in sync", () => {
  test("east-resizing a horizontal line leaves its height at 0", () => {
    const h = newElement("line", {
      x: 0,
      y: 0,
      width: 100,
      height: 0,
      points: [
        [0, 0],
        [100, 0],
      ],
    })
    const r = resizeElement(h, "e", [150, 0], plain)
    expect(getElementBounds(r)).toEqual(boundsFromPoints(absPoints(r)))
  })

  test("corner-resizing a vertical line does not invent a width its points lack", () => {
    const v = newElement("line", {
      x: 0,
      y: 0,
      width: 0,
      height: 100,
      points: [
        [0, 0],
        [0, 100],
      ],
    })
    const r = resizeElement(v, "se", [80, 150], plain)
    expect(getElementBounds(r)).toEqual(boundsFromPoints(absPoints(r)))
  })
})

describe("resizing a linear element through zero mirrors it", () => {
  test("dragging the e handle past the west edge mirrors an arrow", () => {
    const arrow = newElement("arrow", {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      points: [
        [0, 0],
        [100, 50],
      ],
    })
    const r = resizeElement(arrow, "e", [-100, 25], plain)
    const pts = absPoints(r)
    // the start stays on the anchored (original west) edge at x = 0, the head points left
    expect(pts[0]![0]).toBeCloseTo(0, 5)
    expect(pts[1]![0]).toBeCloseTo(-100, 5)
  })
})

describe("resizing text from a corner scales it", () => {
  test("dragging the se handle to double the box doubles the font size", () => {
    const ed = new EditorCore()
    ed.setTool("text")
    ed.pointerDown(ptr(100, 100))
    ed.pointerUp(ptr(100, 100))
    const t = ed.scene.getNonDeleted().find((e) => e.type === "text")!
    ed.commitText(t.id, "hello world")
    const before = ed.scene.get(t.id) as TextElement
    ed.selectElements([t.id])
    const se = selectionHandleSet(ed.selectedElements(), 1)!.handles.se!
    ed.setTool("selection")
    drag(ed, [se[0], se[1]], [se[0] + before.width, se[1] + before.height])
    const after = ed.scene.get(t.id) as TextElement
    expect(after.fontSize).toBeCloseTo(before.fontSize * 2, 0)
    expect(after.width).toBeCloseTo(before.width * 2, 0)
  })
})

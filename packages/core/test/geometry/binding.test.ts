import { describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { createBinding, updateBoundArrow } from "../../src/geometry/binding"
import { mutateElement, newElement } from "../../src/model/element"
import type { ArrowElement } from "../../src/model/types"
import { absPoints, distToOutline, draw, ptr } from "./helpers"

describe("arrows bound near a diamond corner follow the diamond", () => {
  test("moving the diamond drags the endpoint along", () => {
    const shape = newElement("diamond", { x: 0, y: 0, width: 112, height: 268 })
    const from: [number, number] = [-49, -456]
    const tip: [number, number] = [-1.12, 134.3] // just outside the left vertex
    let arrow = newElement("arrow", {
      x: from[0],
      y: from[1],
      points: [
        [0, 0],
        [tip[0] - from[0], tip[1] - from[1]],
      ],
    }) as ArrowElement
    arrow = { ...arrow, endBinding: createBinding(shape, arrow, "end") }
    arrow = updateBoundArrow(arrow, () => shape)
    const moved = mutateElement(shape, { x: 50, y: 30 })
    const solved = updateBoundArrow(arrow, () => moved)
    const pts = absPoints(solved)
    expect(distToOutline(pts[pts.length - 1]!, moved)).toBeLessThan(34)
  })
})

describe("the connection dot shows where the arrow will attach", () => {
  test("preview dot and committed endpoint agree", () => {
    const ed = new EditorCore()
    draw(ed, "rectangle", [0, 0], [200, 100])
    ed.setTool("arrow")
    ed.pointerDown(ptr(-300, 0))
    ed.pointerMove(ptr(-150, 5))
    ed.pointerMove(ptr(5, 10))
    const dot = ed.bindingHints[ed.bindingHints.length - 1]!
    ed.pointerUp(ptr(5, 10))
    const arrow = ed.scene.getNonDeleted().find((e) => e.type === "arrow") as ArrowElement
    const pts = absPoints(arrow)
    const end = pts[pts.length - 1]!
    expect(Math.hypot(dot[0] - end[0], dot[1] - end[1])).toBeLessThan(3)
  })
})

describe("drawing an arrow across a shape does not silently vanish", () => {
  test("dragging from below a shape to just above it leaves an arrow", () => {
    const ed = new EditorCore()
    draw(ed, "rectangle", [0, 0], [100, 100])
    ed.setTool("arrow")
    ed.pointerDown(ptr(50, 104))
    ed.pointerMove(ptr(50, 50))
    ed.pointerMove(ptr(50, -4))
    ed.pointerUp(ptr(50, -4))
    expect(ed.scene.getNonDeleted().some((e) => e.type === "arrow")).toBe(true)
  })
})

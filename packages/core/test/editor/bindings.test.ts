import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { absolutePointsOf } from "../../src/geometry/linear"
import type { ArrowElement } from "../../src/model/types"
import { drag, drawArrow, drawShape, setupMeasurer } from "./helpers"

beforeAll(setupMeasurer)

const arrowOf = (ed: EditorCore, id: string) => ed.scene.get(id) as ArrowElement

describe("bound arrows follow bulk geometry commands", () => {
  test("align re-attaches arrows bound to the aligned shapes", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [300, 200], [400, 300])
    const arrow = drawArrow(ed, [50, 50], [350, 250])
    expect(arrow.endBinding?.elementId).toBe(b.id)

    ed.selectElements([a.id, b.id])
    ed.align("top")
    expect(ed.scene.get(b.id)!.y).toBe(0)
    const tip = absolutePointsOf(arrowOf(ed, arrow.id)).at(-1)!
    // the head must sit on b's border again, not where b used to be
    expect(tip[1]).toBeLessThan(140)
  })

  test("flip re-attaches arrows bound to the flipped shapes", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [300, 0], [400, 100])
    const arrow = drawArrow(ed, [50, 50], [350, 50])
    ed.selectElements([a.id, b.id])
    ed.flip("horizontal")
    // the shapes swapped sides, so the tail now leaves a's left border (x = 300)
    expect(ed.scene.get(a.id)!.x).toBe(300)
    const pts = absolutePointsOf(arrowOf(ed, arrow.id))
    expect(Math.abs(pts[0]![0] - 300)).toBeLessThan(10)
  })
})

describe("arrows moved away from their shapes", () => {
  test("dragging an arrow alone away from its shapes unbinds it, so moving a shape later does not yank it back", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    drawShape(ed, "rectangle", [300, 0], [400, 100])
    const arrow = drawArrow(ed, [50, 50], [350, 50])
    ed.setTool("selection")
    drag(ed, [150, 50], [150, 450]) // grab the shaft, clear of the handles

    const moved = arrowOf(ed, arrow.id)
    expect(absolutePointsOf(moved)[0]![1]).toBeCloseTo(450)
    expect(moved.startBinding).toBeNull()
    expect(moved.endBinding).toBeNull()

    ed.selectElements([a.id])
    ed.nudge(1, 0)
    expect(absolutePointsOf(arrowOf(ed, arrow.id))[0]![1]).toBeCloseTo(450)
  })
})

describe("delete cascades", () => {
  test("deleting a shape detaches arrows bound to it, and undo reattaches them", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    drawShape(ed, "rectangle", [300, 0], [400, 100])
    const arrow = drawArrow(ed, [50, 50], [350, 50])
    ed.selectElements([a.id])
    ed.deleteSelected()
    expect(arrowOf(ed, arrow.id).startBinding).toBeNull()
    ed.undo()
    expect(arrowOf(ed, arrow.id).startBinding?.elementId).toBe(a.id)
  })

  test("deleting a frame does not leave children pointing at the deleted frame", () => {
    const ed = new EditorCore()
    const child = drawShape(ed, "rectangle", [50, 50], [100, 100])
    const frame = drawShape(ed, "frame", [0, 0], [300, 300])
    expect(ed.scene.get(child.id)!.frameId).toBe(frame.id)
    ed.selectElements([frame.id])
    ed.deleteSelected()
    const after = ed.scene.get(child.id)!
    expect(after.isDeleted || after.frameId === null).toBe(true)
  })
})

import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { addLabel, click, drag, drawArrow, drawShape, ptr, setupMeasurer } from "./helpers"

beforeAll(setupMeasurer)

describe("frames", () => {
  test("arrow-key nudge moves a selected frame child exactly once", () => {
    const ed = new EditorCore()
    const child = drawShape(ed, "rectangle", [50, 50], [100, 100])
    const frame = drawShape(ed, "frame", [0, 0], [300, 300])
    expect(ed.scene.get(child.id)!.frameId).toBe(frame.id)
    ed.selectAll()
    ed.nudge(10, 0)
    expect(ed.scene.get(frame.id)!.x).toBe(10)
    expect(ed.scene.get(child.id)!.x).toBe(60)
  })

  test("freehand, arrows and text created inside a frame join it", () => {
    const ed = new EditorCore()
    const frame = drawShape(ed, "frame", [0, 0], [400, 400])
    ed.setTool("freedraw")
    ed.pointerDown(ptr(100, 100))
    ed.pointerMove(ptr(120, 110))
    ed.pointerMove(ptr(140, 130))
    ed.pointerUp(ptr(140, 130))
    const stroke = ed.scene.getNonDeleted().find((e) => e.type === "freedraw")!
    const arrow = drawArrow(ed, [100, 200], [200, 200])
    ed.setTool("text")
    click(ed, 150, 300)
    ed.commitText(ed.appState.editingTextId!, "x")
    const text = ed.scene.getNonDeleted().find((e) => e.type === "text")!

    expect(stroke.frameId).toBe(frame.id)
    expect(ed.scene.get(arrow.id)!.frameId).toBe(frame.id)
    expect(text.frameId).toBe(frame.id)
  })

  test("a label leaves the frame together with its container", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [50, 50], [150, 150])
    const label = addLabel(ed, rect, "hi")
    const frame = drawShape(ed, "frame", [0, 0], [300, 300])
    expect(ed.scene.get(label)!.frameId).toBe(frame.id)

    ed.setTool("selection")
    ed.selectElements([rect.id])
    drag(ed, [50, 75], [550, 75])
    expect(ed.scene.get(rect.id)!.frameId).toBeNull()
    expect(ed.scene.get(label)!.frameId).toBeNull()

    ed.selectElements([frame.id])
    ed.nudge(0, 100)
    const r = ed.scene.get(rect.id)!
    const t = ed.scene.get(label)!
    expect(t.y + t.height / 2).toBeCloseTo(r.y + r.height / 2)
  })
})

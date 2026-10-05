import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { addLabel, drawShape, ptr, setupMeasurer } from "./helpers"

beforeAll(setupMeasurer)

const altDrag = (ed: EditorCore, from: [number, number], to: [number, number]) => {
  ed.pointerDown(ptr(from[0], from[1]))
  ed.pointerMove(ptr((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { altKey: true }))
  ed.pointerMove(ptr(to[0], to[1], { altKey: true }))
  ed.pointerUp(ptr(to[0], to[1], { altKey: true }))
}

describe("alt-drag duplicate", () => {
  test("the copy left behind keeps its label", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    addLabel(ed, rect, "hi")
    ed.setTool("selection")
    ed.selectElements([rect.id])
    altDrag(ed, [0, 25], [200, 25])

    const rects = ed.scene.getNonDeleted().filter((e) => e.type === "rectangle")
    const texts = ed.scene.getNonDeleted().filter((e) => e.type === "text")
    expect(rects).toHaveLength(2)
    expect(texts).toHaveLength(2)
    for (const r of rects) {
      const ref = r.boundElements?.find((b) => b.type === "text")
      expect(ref).toBeDefined()
      const label = ed.scene.get(ref!.id)!
      expect(label.type === "text" && label.containerId).toBe(r.id)
    }
  })

  test("the dragged elements stay above the copy they leave behind", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.setTool("selection")
    ed.selectElements([rect.id])
    altDrag(ed, [0, 25], [30, 25])
    const els = ed.scene.getNonDeleted()
    expect(els).toHaveLength(2)
    // whichever object moved, the one under the pointer at x = 30 must be on top
    expect(els[els.length - 1]!.x).toBe(30)
    expect(els[0]!.x).toBe(0)
  })
})

describe("duplicate and paste relations", () => {
  test("a copy placed far outside its source frame does not stay a member of it", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [50, 50], [100, 100])
    const frame = drawShape(ed, "frame", [0, 0], [300, 300])
    expect(ed.scene.get(rect.id)!.frameId).toBe(frame.id)

    const copies = ed.cloneWithRelations([ed.scene.get(rect.id)!], 1000, 1000)
    ed.addElements(copies)
    const copy = ed.scene.get(copies[0]!.id)!
    expect(copy.frameId).toBeNull()

    ed.selectElements([frame.id])
    ed.nudge(0, 50)
    expect(ed.scene.get(copy.id)!.y).toBe(copy.y)
  })

  test("duplicating inside an entered group keeps the copy in that group", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [300, 0], [400, 100])
    ed.selectElements([a.id, b.id])
    ed.group()
    const group = ed.scene.get(a.id)!.groupIds[0]!
    ed.setTool("selection")
    ed.clearSelection()
    ed.doubleClick(ptr(0, 50))
    expect(ed.appState.editingGroupId).toBe(group)

    ed.duplicateSelected()
    const copyId = Object.keys(ed.appState.selectedElementIds)[0]!
    expect(copyId).not.toBe(a.id)
    expect(ed.scene.get(copyId)!.groupIds).toContain(group)
  })
})

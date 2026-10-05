import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { click, drawShape, key, ptr, setupMeasurer } from "./helpers"

beforeAll(setupMeasurer)

describe("groups", () => {
  test("ungroup inside an entered group removes the selected inner group, not the outer one", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [50, 50])
    const b = drawShape(ed, "rectangle", [100, 0], [150, 50])
    const c = drawShape(ed, "rectangle", [200, 0], [250, 50])
    ed.selectElements([a.id, b.id])
    ed.group()
    const inner = ed.scene.get(a.id)!.groupIds[0]!
    ed.selectElements([a.id, c.id])
    ed.group()
    const outer = ed.scene.get(c.id)!.groupIds[0]!

    ed.setTool("selection")
    ed.clearSelection()
    ed.doubleClick(ptr(0, 25)) // enters the outer group and selects the inner one
    expect(ed.appState.editingGroupId).toBe(outer)
    expect(Object.keys(ed.appState.selectedElementIds).sort()).toEqual([a.id, b.id].sort())

    ed.ungroup()
    expect(ed.scene.get(a.id)!.groupIds).toEqual([outer])
    expect(ed.scene.get(b.id)!.groupIds).toEqual([outer])
    expect(ed.scene.get(c.id)!.groupIds).toEqual([outer])
    expect(ed.scene.get(a.id)!.groupIds).not.toContain(inner)
  })

  test("a locked group member does not move with its group", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [300, 0], [400, 100])
    ed.selectElements([a.id, b.id])
    ed.group()
    ed.setTool("selection")
    ed.clearSelection()
    ed.doubleClick(ptr(300, 50)) // enter the group, select b
    ed.toggleLock()
    ed.keyDown(key("Escape"))
    expect(ed.scene.get(b.id)!.locked).toBe(true)

    click(ed, 0, 50)
    ed.nudge(50, 0)
    expect(ed.scene.get(a.id)!.x).toBe(50)
    expect(ed.scene.get(b.id)!.x).toBe(300)
  })
})

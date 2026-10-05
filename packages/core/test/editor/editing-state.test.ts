import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { addLabel, click, drag, drawArrow, drawShape, key, ptr, setupMeasurer } from "./helpers"

beforeAll(setupMeasurer)

describe("stale editing state", () => {
  test("deleting an arrow in point-edit mode leaves point-edit mode", () => {
    const ed = new EditorCore()
    const arrow = drawArrow(ed, [0, 0], [200, 0])
    // plain Enter labels an arrow; Cmd/Ctrl+Enter opens point editing
    ed.keyDown(key("Enter", { metaKey: true }))
    expect(ed.appState.editingLinearElementId).toBe(arrow.id)
    ed.keyDown(key("Delete"))
    expect(ed.appState.editingLinearElementId).toBeNull()

    // its vertices must not be draggable any more
    const before = ed.scene.get(arrow.id)
    ed.pointerDown(ptr(200, 0))
    ed.pointerMove(ptr(250, 50))
    ed.pointerUp(ptr(250, 50))
    expect(ed.scene.get(arrow.id)).toBe(before)
  })

  test("undoing a group while inside it leaves the group, so clicks select again", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [300, 0], [400, 100])
    ed.selectElements([a.id, b.id])
    ed.group()
    ed.setTool("selection")
    ed.doubleClick(ptr(0, 50))
    expect(ed.appState.editingGroupId).not.toBeNull()
    ed.undo()
    expect(ed.appState.editingGroupId).toBeNull()
    click(ed, 300, 50)
    expect(Object.keys(ed.appState.selectedElementIds)).toEqual([b.id])
  })

  test("a marquee inside a container does not select its label on its own", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [400, 300])
    addLabel(ed, rect, "hi")
    ed.setTool("selection")
    ed.clearSelection()
    drag(ed, [150, 100], [260, 200])
    const picked = ed.selectedElements()
    expect(picked.some((e) => e.type === "text" && e.containerId)).toBe(false)
  })

  test("after a label is deleted on its own, adding a new label makes a visible one", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [400, 300])
    const labelId = addLabel(ed, rect, "hi")
    ed.setAppState({ selectedElementIds: { [labelId]: true } })
    ed.deleteSelected()
    expect((ed.scene.get(rect.id)!.boundElements ?? []).some((r) => r.id === labelId)).toBe(false)

    ed.startEditingLabel(ed.scene.get(rect.id)!)
    const editId = ed.appState.editingTextId!
    ed.commitText(editId, "again")
    expect(ed.scene.get(editId)!.isDeleted).toBe(false)
  })

  test("an additive marquee drops elements that leave the box during the same drag", () => {
    const ed = new EditorCore()
    drawShape(ed, "rectangle", [0, 0], [50, 50])
    drawShape(ed, "rectangle", [200, 0], [250, 50])
    ed.setTool("selection")
    ed.clearSelection()
    ed.pointerDown(ptr(-10, -10, { shiftKey: true }))
    ed.pointerMove(ptr(100, 100, { shiftKey: true }))
    ed.pointerMove(ptr(20, 20, { shiftKey: true }))
    ed.pointerUp(ptr(20, 20, { shiftKey: true }))
    expect(Object.keys(ed.appState.selectedElementIds)).toHaveLength(0)
  })

  test("undoing a delete reselects what came back", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.deleteSelected()
    ed.undo()
    expect(ed.appState.selectedElementIds[rect.id]).toBe(true)
  })
})

describe("space to pan", () => {
  test("holding space keeps the selection", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.setTool("selection")
    ed.selectElements([rect.id])
    ed.keyDown(key(" "))
    ed.keyUp(key(" "))
    expect(ed.appState.selectedElementIds[rect.id]).toBe(true)
  })

  test("holding space mid-polyline does not throw the polyline away", () => {
    const ed = new EditorCore()
    ed.setTool("line")
    click(ed, 300, 300)
    ed.pointerMove(ptr(400, 300, { buttons: 0 }))
    click(ed, 400, 300)
    ed.keyDown(key(" "))
    ed.keyUp(key(" "))
    expect(ed.appState.activeTool).toBe("line")
    expect(ed.scene.getNonDeleted().filter((e) => e.type === "line")).toHaveLength(1)
  })
})

describe("view mode", () => {
  test("keyboard edits are ignored in view mode", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.toggleViewMode()
    ed.selectElements([rect.id])
    ed.keyDown(key("Delete"))
    ed.keyDown(key("d", { metaKey: true }))
    ed.keyDown(key("ArrowRight"))
    expect(ed.scene.getNonDeleted()).toHaveLength(1)
    expect(ed.scene.get(rect.id)!.x).toBe(0)
    ed.keyDown(key("r"))
    expect(ed.appState.activeTool).not.toBe("rectangle")
  })

  test("double click does not start text editing in view mode", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.toggleViewMode()
    ed.setTool("selection")
    ed.doubleClick(ptr(500, 500))
    ed.doubleClick(ptr(50, 50))
    expect(ed.appState.editingTextId).toBeNull()
    expect(ed.scene.get(rect.id)!.boundElements ?? []).toHaveLength(0)
  })
})

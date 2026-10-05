import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { newElement } from "../../src/model/element"
import { addLabel, click, drawShape, ptr, setupMeasurer, undoDepth } from "./helpers"

beforeAll(setupMeasurer)

describe("text creation and history", () => {
  test("undoing a new text removes it entirely", () => {
    const ed = new EditorCore()
    ed.setTool("text")
    click(ed, 100, 100)
    ed.commitText(ed.appState.editingTextId!, "hello")
    expect(ed.scene.getNonDeleted()).toHaveLength(1)
    ed.undo()
    expect(ed.scene.getNonDeleted()).toHaveLength(0)
    ed.redo()
    expect(ed.scene.getNonDeleted()).toHaveLength(1)
  })

  test("committing an empty new text records no history and leaves nothing to resurrect", () => {
    const ed = new EditorCore()
    drawShape(ed, "rectangle", [0, 0], [50, 50])
    const depth = undoDepth(ed)
    ed.setTool("text")
    click(ed, 300, 300)
    ed.commitText(ed.appState.editingTextId!, "   ")
    expect(undoDepth(ed)).toBe(depth)
    ed.undo() // undoes the rectangle
    expect(ed.scene.getNonDeleted().filter((e) => e.type === "text")).toHaveLength(0)
  })

  test("undoing a new label removes the label and the container's reference", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [200, 100])
    addLabel(ed, rect, "hello")
    ed.undo()
    expect(ed.scene.getNonDeleted().filter((e) => e.type === "text")).toHaveLength(0)
    expect(ed.scene.get(rect.id)!.boundElements ?? []).toHaveLength(0)
  })

  test("undoing a paste-as-text removes the pasted text", () => {
    const ed = new EditorCore()
    const pasted = newElement("text", {
      x: 0,
      y: 0,
      width: 0,
      height: 25,
      index: ed.scene.nextIndex(),
      text: "pasted",
      originalText: "pasted",
    })
    ed.startEditingText(pasted)
    ed.commitText(pasted.id, "pasted")
    ed.undo()
    expect(ed.scene.getNonDeleted()).toHaveLength(0)
  })
})

describe("no-op history entries", () => {
  test("reopening a wrapped label and closing it unchanged records nothing", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    addLabel(ed, rect, "hello world wide")
    const depth = undoDepth(ed)
    ed.startEditingLabel(ed.scene.get(rect.id)!)
    const id = ed.appState.editingTextId!
    const el = ed.scene.get(id)!
    ed.commitText(id, el.type === "text" ? el.originalText : "")
    expect(undoDepth(ed)).toBe(depth)
  })

  test("an eraser stroke that restores everything it erased records nothing", () => {
    const ed = new EditorCore()
    drawShape(ed, "rectangle", [0, 0], [100, 100])
    const depth = undoDepth(ed)
    ed.setTool("eraser")
    ed.pointerDown(ptr(0, 50))
    ed.pointerMove(ptr(0, 60, { altKey: true }))
    ed.pointerUp(ptr(0, 60, { altKey: true }))
    expect(ed.scene.getNonDeleted()).toHaveLength(1)
    expect(undoDepth(ed)).toBe(depth)
  })
})

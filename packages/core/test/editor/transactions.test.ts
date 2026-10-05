import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { click, drawShape, key, ptr, setupMeasurer, undoDepth } from "./helpers"

beforeAll(setupMeasurer)

describe("cancelling a gesture", () => {
  test("Escape mid-move restores the element and records nothing", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const depth = undoDepth(ed)
    ed.setTool("selection")
    ed.pointerDown(ptr(0, 25))
    ed.pointerMove(ptr(50, 25))
    ed.pointerMove(ptr(100, 25))
    ed.keyDown(key("Escape"))
    ed.pointerUp(ptr(100, 25))

    expect(ed.scene.get(rect.id)!.x).toBe(0)
    expect(undoDepth(ed)).toBe(depth)
  })

  test("switching tools mid-erase does not silently delete elements", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.setTool("eraser")
    ed.pointerDown(ptr(0, 50))
    ed.keyDown(key("r")) // tool shortcut while the stroke is live
    ed.pointerUp(ptr(0, 50))

    // either the erase is reverted, or it is undoable; it must not be both applied and unrecorded
    if (ed.scene.get(rect.id)!.isDeleted) ed.undo()
    expect(ed.scene.get(rect.id)?.isDeleted).toBe(false)
  })

  test("cancelling an alt-drag removes the copies it left behind", () => {
    const ed = new EditorCore()
    drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.setTool("selection")
    ed.pointerDown(ptr(0, 25))
    ed.pointerMove(ptr(60, 25, { altKey: true }))
    ed.keyDown(key("Escape"))
    ed.pointerUp(ptr(60, 25))
    expect(ed.scene.getNonDeleted()).toHaveLength(1)
    expect(ed.scene.getNonDeleted()[0]!.x).toBe(0)
  })
})

describe("transactions across tool and document changes", () => {
  test("starting a new document mid-gesture does not let undo resurrect the old document", () => {
    const ed = new EditorCore()
    const old = drawShape(ed, "rectangle", [0, 0], [50, 50])
    ed.setTool("arrow")
    click(ed, 300, 300) // polyline in progress keeps a transaction open
    ed.pointerMove(ptr(400, 300, { buttons: 0 }))
    ed.resetScene()

    drawShape(ed, "rectangle", [500, 500], [600, 600])
    ed.undo()
    expect(ed.scene.get(old.id)).toBeUndefined()
    expect(ed.scene.getNonDeleted()).toHaveLength(0)
  })

  test("select-all mid-gesture cancels the in-progress arrow like any tool switch", () => {
    const ed = new EditorCore()
    ed.setTool("arrow")
    click(ed, 0, 0)
    ed.pointerMove(ptr(100, 0, { buttons: 0 }))
    ed.keyDown(key("a", { metaKey: true }))
    expect(ed.appState.activeTool).toBe("selection")
    expect(ed.scene.getNonDeleted().filter((e) => e.type === "arrow")).toHaveLength(0)
  })
})

describe("commands inside an open transaction", () => {
  test("a nudge during a drag folds into the drag's single undo step", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const depth = undoDepth(ed)
    ed.setTool("selection")
    ed.pointerDown(ptr(0, 25))
    ed.pointerMove(ptr(25, 25))
    ed.pointerMove(ptr(50, 25))
    ed.keyDown(key("ArrowRight"))
    ed.pointerMove(ptr(60, 25))
    ed.pointerUp(ptr(60, 25))

    expect(undoDepth(ed)).toBe(depth + 1)
    ed.undo()
    expect(ed.scene.get(rect.id)!.x).toBe(0)
  })

  test("continuous style edits inside a transaction make one undo step", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const depth = undoDepth(ed)
    ed.beginTransaction()
    for (let o = 90; o >= 0; o -= 10) ed.updateSelectedStyle({ opacity: o })
    ed.commitTransaction()

    expect(ed.scene.get(rect.id)!.opacity).toBe(0)
    expect(undoDepth(ed)).toBe(depth + 1)
    ed.undo()
    expect(ed.scene.get(rect.id)!.opacity).toBe(100)
  })
})

import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { ShapeCache } from "../../src/render/shapes"
import { click, drawShape, setupMeasurer } from "./helpers"

beforeAll(setupMeasurer)

describe("versions across undo", () => {
  test("undo and redo move element versions forward, never back", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.updateSelectedStyle({ strokeColor: "#e03131" })
    const edited = ed.scene.get(rect.id)!
    ed.undo()
    const undone = ed.scene.get(rect.id)!
    expect(undone.strokeColor).toBe("#1e1e1e")
    expect(undone.version).toBeGreaterThan(edited.version)
    ed.redo()
    expect(ed.scene.get(rect.id)!.version).toBeGreaterThan(undone.version)
  })

  test("an edit after an unrendered undo is not served from the shape cache", () => {
    const ed = new EditorCore()
    const cache = new ShapeCache()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.updateSelectedStyle({ strokeColor: "#e03131" })
    const red = cache.get(ed.scene.get(rect.id)!, "light")
    ed.undo() // element is off screen, so nothing draws it here
    ed.selectElements([rect.id])
    ed.updateSelectedStyle({ strokeColor: "#2f9e44" })
    const green = cache.get(ed.scene.get(rect.id)!, "light")
    expect(green).not.toBe(red)
  })
})

describe("group selection", () => {
  test("shift-clicking a selected group deselects it", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [300, 0], [400, 100])
    const c = drawShape(ed, "rectangle", [600, 0], [700, 100])
    ed.selectElements([a.id, b.id])
    ed.group()
    ed.setTool("selection")
    click(ed, 0, 50)
    click(ed, 600, 50, { shiftKey: true })
    expect(Object.keys(ed.appState.selectedElementIds).sort()).toEqual([a.id, b.id, c.id].sort())
    click(ed, 0, 50, { shiftKey: true })
    expect(Object.keys(ed.appState.selectedElementIds)).toEqual([c.id])
  })
})

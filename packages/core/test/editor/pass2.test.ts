import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { SHORTCUTS, SHORTCUT_TOOLS, matchShortcut } from "../../src/editor/shortcuts"
import { absolutePointsOf } from "../../src/geometry/linear"
import type { ArrowElement, LineElement } from "../../src/model/types"
import { createTextAt } from "../../src/tools/textTool"
import { click, drag, drawArrow, drawShape, key, ptr, setupMeasurer, undoDepth } from "./helpers"

beforeAll(setupMeasurer)

const drawPolyline = (ed: EditorCore, pts: readonly [number, number][]): LineElement => {
  ed.setTool("line")
  for (const [x, y] of pts) {
    ed.pointerMove(ptr(x, y, { buttons: 0 }))
    click(ed, x, y)
  }
  ed.keyDown(key("Enter"))
  const line = ed.scene.getNonDeleted().find((e) => e.type === "line")
  if (line?.type !== "line") throw new Error("expected a line")
  return line
}

describe("Enter on lines and arrows", () => {
  test("Enter on a selected arrow opens its label; Cmd/Ctrl+Enter opens point editing", () => {
    const ed = new EditorCore()
    const arrow = drawArrow(ed, [0, 0], [200, 0])
    expect(ed.keyDown(key("Enter"))).toBe(true)
    const labelId = ed.appState.editingTextId
    expect(labelId).not.toBeNull()
    const label = ed.scene.get(labelId!)!
    expect(label.type === "text" && label.containerId).toBe(arrow.id)
    expect(ed.appState.editingLinearElementId).toBeNull()
    ed.cancelText(labelId!)

    ed.selectElements([arrow.id])
    expect(ed.keyDown(key("Enter", { ctrlKey: true }))).toBe(true)
    expect(ed.appState.editingLinearElementId).toBe(arrow.id)
    expect(ed.appState.editingTextId).toBeNull()
  })

  test("Enter on a line still opens point editing, since lines take no label", () => {
    const ed = new EditorCore()
    const line = drawPolyline(ed, [
      [0, 0],
      [100, 0],
      [100, 100],
    ])
    ed.setTool("selection")
    ed.selectElements([line.id])
    ed.keyDown(key("Enter"))
    expect(ed.appState.editingLinearElementId).toBe(line.id)
  })

  test("Cmd+Enter on a shape is not a point edit and does not open its label", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.setTool("selection")
    ed.selectElements([rect.id])
    expect(ed.keyDown(key("Enter", { metaKey: true }))).toBe(false)
    expect(ed.appState.editingTextId).toBeNull()
  })

  test("the table names both chords", () => {
    expect(matchShortcut(key("Enter"))).toBe("edit.enter")
    expect(matchShortcut(key("Enter", { metaKey: true }))).toBe("edit.points")
  })
})

describe("the edited element stays selected", () => {
  test("a label's container and a standalone text stay selected while being edited", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [200, 100])
    ed.startEditingLabel(rect)
    expect(ed.appState.selectedElementIds).toEqual({ [rect.id]: true })

    const t = createTextAt(ed, [500, 500])
    ed.startEditingText(t)
    expect(ed.appState.selectedElementIds).toEqual({ [t.id]: true })
  })

  test("a style change while typing lands in the same undo step as the text", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [200, 100])
    const before = undoDepth(ed)
    ed.startEditingLabel(rect)
    const id = ed.appState.editingTextId!
    ed.previewText("hello")
    ed.updateSelectedStyle({ fontSize: 36, strokeColor: "#e03131" })
    expect(ed.appState.editingTextId).toBe(id)
    ed.commitText(id, "hello")
    const label = ed.scene.get(id)!
    expect(label.type === "text" && label.fontSize).toBe(36)
    expect(ed.scene.get(rect.id)!.strokeColor).toBe("#e03131")
    expect(undoDepth(ed)).toBe(before + 1)

    ed.undo()
    expect(ed.scene.get(id)?.isDeleted ?? true).toBe(true)
    expect(ed.scene.get(rect.id)!.strokeColor).not.toBe("#e03131")
  })

  test("cancelling an edit gives back the selection from before it", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [200, 100])
    ed.setTool("selection")
    ed.selectElements([rect.id])
    const t = createTextAt(ed, [500, 500])
    ed.startEditingText(t)
    ed.cancelText(t.id)
    expect(ed.appState.selectedElementIds).toEqual({ [rect.id]: true })
    expect(ed.scene.get(t.id)).toBeUndefined()
  })

  test("a canvas press while the host has not reported the draft does not grab the edited shape", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [200, 200])
    ed.setTool("selection")
    ed.startEditingLabel(ed.scene.get(rect.id)!)
    drag(ed, [60, 60], [160, 160])
    expect(ed.scene.get(rect.id)!.x).toBe(0)
  })

  test("a command run while typing commits the text first", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [200, 100])
    ed.startEditingLabel(rect)
    const id = ed.appState.editingTextId!
    ed.previewText("hi")
    ed.duplicateSelected()
    expect(ed.appState.editingTextId).toBeNull()
    const labels = ed.scene.getNonDeleted().filter((e) => e.type === "text")
    expect(labels).toHaveLength(2)
    expect(labels.every((l) => l.type === "text" && l.text === "hi")).toBe(true)
    expect(ed.scene.get(id)!.isDeleted).toBe(false)
  })
})

describe("core shortcuts", () => {
  test("Cmd+Shift+Arrow aligns the selection", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [300, 200], [400, 300])
    ed.setTool("selection")
    ed.selectElements([a.id, b.id])
    ed.keyDown({ ...key("ArrowLeft", { metaKey: true, shiftKey: true }), code: "ArrowLeft" })
    expect(ed.scene.get(b.id)!.x).toBe(0)
    ed.keyDown({ ...key("ArrowDown", { ctrlKey: true, shiftKey: true }), code: "ArrowDown" })
    expect(ed.scene.get(a.id)!.y).toBe(200)
    expect(ed.scene.get(b.id)!.y).toBe(200)
  })

  test("PageDown scrolls a page down, Shift+PageDown a page right", () => {
    const ed = new EditorCore()
    ed.setViewportSize(1000, 700)
    ed.keyDown({ ...key("PageDown"), code: "PageDown" })
    expect(ed.appState.viewport.scrollY).toBe(-700)
    ed.keyDown({ ...key("PageDown", { shiftKey: true }), code: "PageDown" })
    expect(ed.appState.viewport.scrollX).toBe(-1000)
    ed.keyDown({ ...key("PageUp"), code: "PageUp" })
    expect(ed.appState.viewport.scrollY).toBe(0)
  })

  test("holding Cmd or Ctrl during a move turns grid snapping off", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.setAppState({ gridSize: 20 })
    ed.setTool("selection")
    ed.selectElements([rect.id])
    drag(ed, [50, 50], [57, 53])
    expect(ed.scene.get(rect.id)!.x).toBe(0)
    drag(ed, [50, 50], [57, 53], { metaKey: true })
    expect(ed.scene.get(rect.id)!.x).toBe(7)
  })

  test("holding Cmd or Ctrl during a move inverts object snapping", () => {
    const ed = new EditorCore()
    drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [300, 0], [400, 100])
    ed.setTool("selection")
    ed.selectElements([b.id])
    // object snapping is off, so Ctrl turns it on and the left edge snaps onto the other's right edge
    drag(ed, [350, 50], [153, 50], { ctrlKey: true })
    expect(ed.scene.get(b.id)!.x).toBe(100)
  })

  test("UI-run rows are in the table and match on the physical key", () => {
    const ids = SHORTCUTS.map((s) => s.id)
    for (const id of ["edit.copyPng", "style.stroke", "style.background", "style.eyedropper"])
      expect(ids).toContain(id)
    expect(matchShortcut({ ...key("Ç", { shiftKey: true, altKey: true }), code: "KeyC" })).toBe(
      "edit.copyPng",
    )
    expect(matchShortcut({ ...key("S", { shiftKey: true }), code: "KeyS" })).toBe("style.stroke")
    expect(matchShortcut({ ...key("i"), code: "KeyI" })).toBe("style.eyedropper")
    expect(SHORTCUT_TOOLS["tool.pencil"]).toBe("pencil")
    expect(SHORTCUT_TOOLS["tool.pen"]).toBe("freedraw")
  })
})

describe("line editor point selection", () => {
  const editLine = () => {
    const ed = new EditorCore()
    const line = drawPolyline(ed, [
      [0, 0],
      [100, 0],
      [200, 0],
      [300, 0],
    ])
    ed.setTool("selection")
    ed.selectElements([line.id])
    ed.keyDown(key("Enter"))
    expect(ed.appState.editingLinearElementId).toBe(line.id)
    return { ed, line }
  }

  test("clicking a vertex picks it, Shift-click adds one, and dragging moves the pick together", () => {
    const { ed, line } = editLine()
    click(ed, 100, 0)
    expect(ed.appState.selectedPointIndices).toEqual([1])
    click(ed, 200, 0, { shiftKey: true })
    expect(ed.appState.selectedPointIndices).toEqual([1, 2])
    drag(ed, [100, 0], [100, 50])
    expect(absolutePointsOf(ed.scene.get(line.id) as LineElement)).toEqual([
      [0, 0],
      [100, 50],
      [200, 50],
      [300, 0],
    ])
    // Shift-click on a picked vertex drops it again
    click(ed, 200, 50, { shiftKey: true })
    expect(ed.appState.selectedPointIndices).toEqual([1])
  })

  test("a box drag on empty canvas picks the vertices inside; a plain click leaves the editor", () => {
    const { ed } = editLine()
    drag(ed, [50, -50], [250, 50])
    expect(ed.appState.selectedPointIndices).toEqual([1, 2])
    expect(ed.appState.editingLinearElementId).not.toBeNull()
    click(ed, 500, 500)
    expect(ed.appState.editingLinearElementId).toBeNull()
    expect(ed.appState.selectedPointIndices).toEqual([])
  })

  test("Delete removes the picked vertices in one undoable step", () => {
    const { ed, line } = editLine()
    drag(ed, [50, -50], [250, 50])
    const depth = undoDepth(ed)
    ed.keyDown(key("Delete"))
    expect(absolutePointsOf(ed.scene.get(line.id) as LineElement)).toEqual([
      [0, 0],
      [300, 0],
    ])
    expect(ed.scene.get(line.id)!.isDeleted).toBe(false)
    expect(undoDepth(ed)).toBe(depth + 1)
    ed.undo()
    expect(
      ed.scene.get(line.id)!.type === "line" && (ed.scene.get(line.id) as LineElement).points,
    ).toHaveLength(4)
  })

  test("deleting all but one vertex deletes the line", () => {
    const { ed, line } = editLine()
    drag(ed, [-50, -50], [250, 50])
    ed.keyDown(key("Backspace"))
    expect(ed.scene.get(line.id)!.isDeleted).toBe(true)
    expect(ed.appState.editingLinearElementId).toBeNull()
  })

  test("Cmd+D duplicates the picked vertices halfway to the next one and picks the copies", () => {
    const { ed, line } = editLine()
    click(ed, 100, 0)
    ed.keyDown({ ...key("d", { metaKey: true }), code: "KeyD" })
    expect(absolutePointsOf(ed.scene.get(line.id) as LineElement)).toEqual([
      [0, 0],
      [100, 0],
      [150, 0],
      [200, 0],
      [300, 0],
    ])
    expect(ed.appState.selectedPointIndices).toEqual([2])
    expect(ed.scene.getNonDeleted().filter((e) => e.type === "line")).toHaveLength(1)
  })

  test("removing a bound arrow end lets go of its shape", () => {
    const ed = new EditorCore()
    drawShape(ed, "rectangle", [0, 0], [100, 100])
    const target = drawShape(ed, "rectangle", [400, 0], [500, 100])
    ed.setTool("arrow")
    ed.pointerMove(ptr(200, 50, { buttons: 0 }))
    click(ed, 200, 50)
    ed.pointerMove(ptr(300, 50, { buttons: 0 }))
    click(ed, 300, 50)
    ed.pointerMove(ptr(450, 50, { buttons: 0 }))
    click(ed, 450, 50)
    const arrow = ed.scene.getNonDeleted().find((e): e is ArrowElement => e.type === "arrow")!
    expect(arrow.endBinding?.elementId).toBe(target.id)
    ed.setTool("selection")
    ed.selectElements([arrow.id])
    ed.keyDown(key("Enter", { metaKey: true }))
    const tip = absolutePointsOf(ed.scene.get(arrow.id) as ArrowElement).at(-1)!
    click(ed, tip[0], tip[1])
    expect(ed.appState.selectedPointIndices).toEqual([2])
    ed.keyDown(key("Delete"))
    const after = ed.scene.get(arrow.id) as ArrowElement
    expect(after.points).toHaveLength(2)
    expect(after.endBinding).toBeNull()
    expect(ed.scene.get(target.id)!.boundElements?.some((b) => b.id === arrow.id) ?? false).toBe(false)
  })

  test("a closed line stays closed when a corner is removed or its first corner is dragged", () => {
    const ed = new EditorCore()
    ed.setTool("line")
    for (const [x, y] of [
      [0, 0],
      [200, 0],
      [200, 200],
      [0, 200],
      [0, 0],
    ] as const) {
      ed.pointerMove(ptr(x, y, { buttons: 0 }))
      click(ed, x, y)
    }
    const line = ed.scene.getNonDeleted().find((e): e is LineElement => e.type === "line")!
    expect(line.polygon).toBe(true)
    ed.setTool("selection")
    ed.selectElements([line.id])
    // a closed line carries a label like a shape, so Enter labels it and Cmd+Enter edits its points
    ed.keyDown(key("Enter", { metaKey: true }))
    drag(ed, [0, 0], [-20, -20])
    let pts = absolutePointsOf(ed.scene.get(line.id) as LineElement)
    expect(pts[0]).toEqual([-20, -20])
    expect(pts.at(-1)).toEqual([-20, -20])
    click(ed, 0, 200)
    ed.keyDown(key("Delete"))
    const closed = ed.scene.get(line.id) as LineElement
    pts = absolutePointsOf(closed)
    expect(closed.polygon).toBe(true)
    expect(pts).toHaveLength(4)
    expect(pts[0]).toEqual(pts[3])
  })
})

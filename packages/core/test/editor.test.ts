import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../src/editor/editorCore"
import { setTextMeasurer } from "../src/render/textMeasure"
import type { PointerInput } from "../src/tools/types"

beforeAll(() => setTextMeasurer((t) => t.length * 10))

const ptr = (x: number, y: number, extra: Partial<PointerInput> = {}): PointerInput => ({
  scene: [x, y],
  screen: [x, y],
  buttons: 1,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  pressure: 0.5,
  detail: 1,
  ...extra,
})

const drag = (ed: EditorCore, from: [number, number], to: [number, number], mods = {}) => {
  ed.pointerDown(ptr(from[0], from[1], mods))
  ed.pointerMove(ptr((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, mods))
  ed.pointerMove(ptr(to[0], to[1], mods))
  ed.pointerUp(ptr(to[0], to[1], mods))
}

const drawRect = (ed: EditorCore, from: [number, number], to: [number, number]) => {
  ed.setTool("rectangle")
  drag(ed, from, to)
  return ed.scene.getNonDeleted()[ed.scene.getNonDeleted().length - 1]!
}

describe("drawing", () => {
  test("a drag creates one selected element and one undo step", () => {
    const ed = new EditorCore()
    ed.setTool("rectangle")
    drag(ed, [10, 10], [110, 60])

    const els = ed.scene.getNonDeleted()
    expect(els).toHaveLength(1)
    expect([els[0]!.x, els[0]!.y, els[0]!.width, els[0]!.height]).toEqual([10, 10, 100, 50])
    expect(ed.appState.activeTool).toBe("selection")
    expect(Object.keys(ed.appState.selectedElementIds)).toEqual([els[0]!.id])

    ed.undo()
    expect(ed.scene.getNonDeleted()).toHaveLength(0)
    ed.redo()
    expect(ed.scene.getNonDeleted()).toHaveLength(1)
  })

  test("a click without dragging still places a usable shape", () => {
    const ed = new EditorCore()
    ed.setTool("ellipse")
    ed.pointerDown(ptr(50, 50))
    ed.pointerUp(ptr(50, 50))
    const el = ed.scene.getNonDeleted()[0]
    expect(el).toBeDefined()
    expect(el!.width).toBeGreaterThan(10)
  })

  test("shift constrains a shape to a square", () => {
    const ed = new EditorCore()
    ed.setTool("rectangle")
    drag(ed, [0, 0], [200, 50], { shiftKey: true })
    const el = ed.scene.getNonDeleted()[0]!
    expect(el.width).toBeCloseTo(el.height)
  })

  test("the tool stays active when tool lock is on", () => {
    const ed = new EditorCore()
    ed.toggleToolLock()
    ed.setTool("diamond")
    drag(ed, [0, 0], [50, 50])
    expect(ed.appState.activeTool).toBe("diamond")
  })
})

describe("selection", () => {
  test("dragging moves the selection and records one step", () => {
    const ed = new EditorCore()
    const rect = drawRect(ed, [0, 0], [100, 100])
    ed.setTool("selection")
    // grabbed on the edge but clear of the side handle at the midpoint
    drag(ed, [0, 25], [40, 65])

    const moved = ed.scene.get(rect.id)!
    expect(moved.x).toBeCloseTo(40)
    expect(moved.y).toBeCloseTo(40)
    expect(moved.width).toBeCloseTo(100)
    ed.undo()
    expect(ed.scene.get(rect.id)!.x).toBeCloseTo(0)
  })

  test("a side handle resizes instead of moving", () => {
    const ed = new EditorCore()
    const rect = drawRect(ed, [0, 0], [100, 100])
    ed.setTool("selection")
    drag(ed, [100, 50], [160, 50])

    const resized = ed.scene.get(rect.id)!
    expect(resized.width).toBeCloseTo(160)
    expect(resized.height).toBeCloseTo(100)
    expect(resized.x).toBeCloseTo(0)
  })

  test("a marquee selects fully enclosed elements and a click on empty space clears", () => {
    const ed = new EditorCore()
    drawRect(ed, [0, 0], [50, 50])
    drawRect(ed, [300, 300], [350, 350])
    ed.setTool("selection")

    drag(ed, [-20, -20], [100, 100])
    expect(Object.keys(ed.appState.selectedElementIds)).toHaveLength(1)

    ed.pointerDown(ptr(200, 200))
    ed.pointerUp(ptr(200, 200))
    expect(Object.keys(ed.appState.selectedElementIds)).toHaveLength(0)
  })

  test("shift-click adds and removes from the selection", () => {
    const ed = new EditorCore()
    const a = drawRect(ed, [0, 0], [50, 50])
    const b = drawRect(ed, [100, 0], [150, 50])
    ed.setTool("selection")

    ed.pointerDown(ptr(0, 25))
    ed.pointerUp(ptr(0, 25))
    ed.pointerDown(ptr(100, 25, { shiftKey: true }))
    ed.pointerUp(ptr(100, 25, { shiftKey: true }))
    expect(Object.keys(ed.appState.selectedElementIds).sort()).toEqual([a.id, b.id].sort())

    ed.pointerDown(ptr(100, 25, { shiftKey: true }))
    ed.pointerUp(ptr(100, 25, { shiftKey: true }))
    expect(Object.keys(ed.appState.selectedElementIds)).toEqual([a.id])
  })

  test("selecting a grouped element selects the whole group", () => {
    const ed = new EditorCore()
    const a = drawRect(ed, [0, 0], [50, 50])
    const b = drawRect(ed, [100, 0], [150, 50])
    ed.selectElements([a.id, b.id])
    ed.group()

    ed.clearSelection()
    ed.setTool("selection")
    ed.pointerDown(ptr(0, 25))
    ed.pointerUp(ptr(0, 25))
    expect(Object.keys(ed.appState.selectedElementIds)).toHaveLength(2)

    ed.ungroup()
    expect(ed.scene.get(a.id)!.groupIds).toHaveLength(0)
  })
})

describe("element commands", () => {
  test("delete is undoable and leaves nothing selected", () => {
    const ed = new EditorCore()
    drawRect(ed, [0, 0], [50, 50])
    ed.deleteSelected()
    expect(ed.scene.getNonDeleted()).toHaveLength(0)
    expect(Object.keys(ed.appState.selectedElementIds)).toHaveLength(0)
    ed.undo()
    expect(ed.scene.getNonDeleted()).toHaveLength(1)
  })

  test("duplicate offsets the copy and selects it", () => {
    const ed = new EditorCore()
    const rect = drawRect(ed, [0, 0], [50, 50])
    ed.duplicateSelected()
    const all = ed.scene.getNonDeleted()
    expect(all).toHaveLength(2)
    const copy = all.find((e) => e.id !== rect.id)!
    expect(copy.x).toBe(rect.x + 10)
    expect(ed.appState.selectedElementIds[copy.id]).toBe(true)
  })

  test("z-order commands reorder the scene", () => {
    const ed = new EditorCore()
    const a = drawRect(ed, [0, 0], [50, 50])
    const b = drawRect(ed, [60, 0], [110, 50])
    ed.selectElements([a.id])
    ed.moveZ("front")
    expect(ed.scene.getNonDeleted()[1]!.id).toBe(a.id)
    ed.moveZ("back")
    expect(ed.scene.getNonDeleted()[0]!.id).toBe(a.id)
    expect(ed.scene.getNonDeleted()[1]!.id).toBe(b.id)
  })

  test("locked elements cannot be picked up", () => {
    const ed = new EditorCore()
    const rect = drawRect(ed, [0, 0], [100, 100])
    ed.toggleLock()
    ed.setTool("selection")
    ed.pointerDown(ptr(0, 50))
    ed.pointerUp(ptr(0, 50))
    expect(Object.keys(ed.appState.selectedElementIds)).toHaveLength(0)
    expect(ed.scene.get(rect.id)!.locked).toBe(true)
    ed.unlockAll()
    expect(ed.scene.get(rect.id)!.locked).toBe(false)
  })

  test("nudging moves by the requested amount", () => {
    const ed = new EditorCore()
    const rect = drawRect(ed, [0, 0], [50, 50])
    ed.nudge(5, -3)
    expect(ed.scene.get(rect.id)!.x).toBe(5)
    expect(ed.scene.get(rect.id)!.y).toBe(-3)
  })

  test("style changes apply to the selection and stick as the default", () => {
    const ed = new EditorCore()
    const rect = drawRect(ed, [0, 0], [50, 50])
    ed.updateSelectedStyle({ strokeColor: "#e03131", strokeWidth: 4 })
    expect(ed.scene.get(rect.id)!.strokeColor).toBe("#e03131")
    expect(ed.appState.currentItemStrokeColor).toBe("#e03131")
    expect(ed.appState.currentItemStrokeWidth).toBe(4)
  })
})

describe("viewport", () => {
  test("wheel pans, and with the modifier it zooms about the pointer", () => {
    const ed = new EditorCore()
    ed.wheel(30, 0, false, [0, 0])
    expect(ed.appState.viewport.scrollX).toBeLessThan(0)
    expect(ed.appState.viewport.zoom).toBe(1)

    ed.wheel(0, -100, true, [400, 300])
    expect(ed.appState.viewport.zoom).toBeGreaterThan(1)
  })

  test("zoom to fit frames the content", () => {
    const ed = new EditorCore()
    drawRect(ed, [0, 0], [100, 100])
    drawRect(ed, [900, 700], [1000, 800])
    ed.zoomToFit(800, 600)
    expect(ed.appState.viewport.zoom).toBeLessThan(1)
  })
})

describe("text", () => {
  test("committing a label attaches it to its container and sizes it", () => {
    const ed = new EditorCore()
    const rect = drawRect(ed, [0, 0], [200, 100])
    ed.startEditingLabel(ed.scene.get(rect.id)!)
    const textId = ed.appState.editingTextId!
    expect(textId).toBeTruthy()

    ed.commitText(textId, "hello")
    const text = ed.scene.get(textId)!
    expect(text.type).toBe("text")
    expect((text as { containerId: string | null }).containerId).toBe(rect.id)
    expect(text.width).toBeGreaterThan(0)
    expect(ed.scene.get(rect.id)!.boundElements).toHaveLength(1)
  })

  test("committing an empty label removes it again", () => {
    const ed = new EditorCore()
    const rect = drawRect(ed, [0, 0], [200, 100])
    ed.startEditingLabel(ed.scene.get(rect.id)!)
    const textId = ed.appState.editingTextId!
    ed.commitText(textId, "   ")
    // a new label committed empty is discarded outright rather than left as a tombstone
    expect(ed.scene.getNonDeleted().some((e) => e.id === textId)).toBe(false)
    expect(ed.scene.get(rect.id)!.boundElements ?? []).toHaveLength(0)
  })
})

describe("erasing", () => {
  test("the eraser removes what it touches and undo brings it back", () => {
    const ed = new EditorCore()
    const rect = drawRect(ed, [0, 0], [100, 100])
    ed.setTool("eraser")
    ed.pointerDown(ptr(0, 50))
    ed.pointerUp(ptr(0, 50))
    expect(ed.scene.get(rect.id)!.isDeleted).toBe(true)
    ed.undo()
    expect(ed.scene.get(rect.id)!.isDeleted).toBe(false)
  })
})

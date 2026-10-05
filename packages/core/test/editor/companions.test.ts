import { beforeAll, describe, expect, test, vi } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { SHORTCUTS, SHORTCUT_TOOLS, formatChord, matchShortcut } from "../../src/editor/shortcuts"
import { getCommonBounds } from "../../src/geometry/elementBounds"
import { absolutePointsOf } from "../../src/geometry/linear"
import { newElement } from "../../src/model/element"
import type { ArrowElement, TextElement } from "../../src/model/types"
import { frameLabelLayout } from "../../src/render/drawElement"
import { selectionHandleSet } from "../../src/render/interactiveScene"
import { addLabel, click, drag, drawArrow, drawShape, key, ptr, setupMeasurer, undoDepth } from "./helpers"

beforeAll(setupMeasurer)

describe("selection tool gestures", () => {
  test("dragging inside a selected shape without a fill moves it", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [200, 200])
    expect(ed.scene.get(rect.id)!.backgroundColor).toBe("transparent")
    ed.setTool("selection")
    ed.selectElements([rect.id])
    drag(ed, [100, 100], [150, 130])
    expect(ed.scene.get(rect.id)!.x).toBe(50)
    expect(ed.scene.get(rect.id)!.y).toBe(30)
    expect(ed.appState.selectedElementIds[rect.id]).toBe(true)
    // a plain click there, without a drag, still deselects
    click(ed, 100, 100)
    expect(ed.appState.selectedElementIds[rect.id]).toBeUndefined()
  })

  test("shift-dragging a selected element axis-locks the move and keeps it selected", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.setTool("selection")
    drag(ed, [0, 25], [80, 35], { shiftKey: true })
    const moved = ed.scene.get(rect.id)!
    expect(moved.x).toBe(80)
    expect(moved.y).toBe(0)
    expect(ed.appState.selectedElementIds[rect.id]).toBe(true)
  })

  test("a click without drag on one member of a multi-selection narrows to it", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [300, 0], [400, 100])
    ed.setTool("selection")
    ed.selectElements([a.id, b.id])
    click(ed, 0, 50)
    expect(Object.keys(ed.appState.selectedElementIds)).toEqual([a.id])
  })

  test("Escape out of an entered group selects the whole group", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [300, 0], [400, 100])
    ed.selectElements([a.id, b.id])
    ed.group()
    ed.setTool("selection")
    ed.clearSelection()
    ed.doubleClick(ptr(0, 50))
    expect(Object.keys(ed.appState.selectedElementIds)).toEqual([a.id])
    ed.keyDown(key("Escape"))
    expect(ed.appState.editingGroupId).toBeNull()
    expect(Object.keys(ed.appState.selectedElementIds).sort()).toEqual([a.id, b.id].sort())
  })

  test("dragging the head of a selected arrow rebinds it to the shape it lands on", () => {
    const ed = new EditorCore()
    drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [300, 0], [400, 100])
    const c = drawShape(ed, "rectangle", [300, 300], [400, 400])
    const arrow = drawArrow(ed, [50, 50], [350, 50])
    expect(arrow.endBinding?.elementId).toBe(b.id)
    const head = absolutePointsOf(arrow).at(-1)!
    ed.setTool("selection")
    ed.selectElements([arrow.id])
    drag(ed, [head[0], head[1]], [350, 350])
    const after = ed.scene.get(arrow.id) as ArrowElement
    expect(after.endBinding?.elementId).toBe(c.id)
    expect(after.points).toHaveLength(2)
    expect(ed.scene.get(b.id)!.boundElements?.some((r) => r.id === arrow.id) ?? false).toBe(false)
  })

  test("alt-drag leaves the original connected and its arrow in place", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    drawShape(ed, "rectangle", [300, 0], [400, 100])
    const arrow = drawArrow(ed, [50, 50], [350, 50])
    const before = absolutePointsOf(arrow)
    ed.setTool("selection")
    ed.selectElements([a.id])
    ed.pointerDown(ptr(0, 25))
    ed.pointerMove(ptr(0, 200, { altKey: true }))
    ed.pointerUp(ptr(0, 400, { altKey: true }))
    const after = ed.scene.get(arrow.id) as ArrowElement
    expect(after.startBinding?.elementId).toBe(a.id)
    expect(absolutePointsOf(after)).toEqual(before)
    expect(ed.scene.get(a.id)!.y).toBe(0)
  })

  test("alt-dragging several labelled shapes gives every copy its own label", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [300, 0], [400, 100])
    addLabel(ed, a, "A")
    addLabel(ed, b, "B")
    ed.setTool("selection")
    ed.selectElements([a.id, b.id])
    ed.pointerDown(ptr(0, 25))
    ed.pointerMove(ptr(0, 200, { altKey: true }))
    ed.pointerUp(ptr(0, 300, { altKey: true }))
    const rects = ed.scene.getNonDeleted().filter((e) => e.type === "rectangle")
    expect(rects).toHaveLength(4)
    const textOf = (id: string) => {
      const ref = ed.scene.get(id)!.boundElements?.find((r) => r.type === "text")
      const label = ref ? ed.scene.get(ref.id) : undefined
      return label && label.type === "text" && label.containerId === id ? label.originalText : null
    }
    const labels = rects.map((r) => textOf(r.id)).sort()
    expect(labels).toEqual(["A", "A", "B", "B"])
    const moved = rects.filter((r) => r.y === 175)
    expect(moved).toHaveLength(2)
  })

  test("grouping puts a container's label in the group too", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [300, 0], [400, 100])
    const label = addLabel(ed, a, "A")
    ed.selectElements([a.id, b.id])
    ed.group()
    const gid = ed.scene.get(a.id)!.groupIds[0]!
    expect(ed.scene.get(label)!.groupIds).toContain(gid)
    expect(ed.selectedElements().some((e) => e.id === label)).toBe(false)
  })
})

describe("linear tool settings", () => {
  test("the line tool follows the Edges setting", () => {
    const ed = new EditorCore()
    ed.setAppState({ currentItemRoundness: "sharp", currentItemArrowType: "round" })
    ed.setTool("line")
    click(ed, 0, 0)
    ed.pointerMove(ptr(100, 0, { buttons: 0 }))
    click(ed, 100, 0)
    ed.pointerMove(ptr(100, 100, { buttons: 0 }))
    click(ed, 100, 100)
    ed.keyDown(key("Enter"))
    const line = ed.scene.getNonDeleted().find((e) => e.type === "line")!
    expect(line.roundness).toBeNull()
  })

  test("clicking back on the first point closes a line into a polygon", () => {
    const ed = new EditorCore()
    ed.setTool("line")
    for (const [x, y] of [
      [100, 500],
      [300, 500],
      [300, 700],
    ] as const) {
      ed.pointerMove(ptr(x, y, { buttons: 0 }))
      click(ed, x, y)
    }
    ed.pointerMove(ptr(101, 501, { buttons: 0 }))
    click(ed, 101, 501)
    const line = ed.scene.getNonDeleted().find((e) => e.type === "line")!
    if (line.type !== "line") throw new Error("expected a line")
    expect(line.polygon).toBe(true)
    const pts = absolutePointsOf(line)
    expect(pts[0]).toEqual(pts[pts.length - 1])
    expect(pts).toHaveLength(4)
  })

  test("the elbow preview is already orthogonal while dragging", () => {
    const ed = new EditorCore()
    ed.setAppState({ currentItemArrowType: "elbow" })
    ed.setTool("arrow")
    ed.pointerDown(ptr(0, 0))
    ed.pointerMove(ptr(120, 80))
    const draft = ed.scene.getNonDeleted().find((e) => e.type === "arrow")!
    const pts = absolutePointsOf(draft as ArrowElement)
    expect(pts.length).toBeGreaterThan(2)
    for (let i = 1; i < pts.length; i++)
      expect(
        Math.min(Math.abs(pts[i]![0] - pts[i - 1]![0]), Math.abs(pts[i]![1] - pts[i - 1]![1])),
      ).toBeLessThan(0.01)
    ed.pointerUp(ptr(120, 80))
  })
})

describe("freehand", () => {
  test("a pencil tap leaves a dot", () => {
    const ed = new EditorCore()
    ed.setTool("freedraw")
    click(ed, 40, 40)
    const dot = ed.scene.getNonDeleted().find((e) => e.type === "freedraw")
    expect(dot).toBeDefined()
    if (dot?.type !== "freedraw") throw new Error("expected a stroke")
    expect(dot.points.length).toBe(2)
    expect(Math.abs(dot.x - 40)).toBeLessThan(0.1)
    expect(Object.keys(ed.appState.selectedElementIds)).toHaveLength(0)
  })
})

describe("text", () => {
  test("the text tool opens its editor on release, not on press", () => {
    const ed = new EditorCore()
    const onEditText = vi.fn()
    ed.host = { onEditText }
    ed.setTool("text")
    ed.pointerDown(ptr(100, 100))
    expect(ed.appState.editingTextId).toBeNull()
    ed.pointerUp(ptr(100, 100))
    expect(ed.appState.editingTextId).not.toBeNull()
    expect(onEditText).toHaveBeenCalledTimes(1)
  })

  test("the text tool stays armed after a commit when the tool is locked", () => {
    const ed = new EditorCore()
    ed.toggleToolLock()
    ed.setTool("text")
    click(ed, 100, 100)
    ed.commitText(ed.appState.editingTextId!, "hi")
    expect(ed.appState.activeTool).toBe("text")
  })

  test("previewText lays the label out live without history, and cancel restores the container", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 40])
    const depth = undoDepth(ed)
    ed.startEditingLabel(ed.scene.get(rect.id)!)
    const id = ed.appState.editingTextId!
    ed.previewText("one two three four five six seven")
    expect(ed.scene.get(rect.id)!.height).toBeGreaterThan(40)
    expect(undoDepth(ed)).toBe(depth)
    ed.cancelText(id)
    expect(ed.scene.get(rect.id)!.height).toBe(40)
    expect(ed.scene.get(id)).toBeUndefined()
    expect(ed.scene.get(rect.id)!.boundElements ?? []).toHaveLength(0)
    expect(undoDepth(ed)).toBe(depth)
  })

  test("a canvas press commits the open editor's previewed text", () => {
    const ed = new EditorCore()
    ed.setTool("text")
    click(ed, 100, 100)
    const id = ed.appState.editingTextId!
    ed.previewText("typed")
    ed.pointerDown(ptr(500, 500))
    ed.pointerUp(ptr(500, 500))
    expect(ed.appState.editingTextId).toBeNull()
    const text = ed.scene.get(id)!
    expect(text.type === "text" && text.originalText).toBe("typed")
    ed.undo()
    expect(ed.scene.getNonDeleted()).toHaveLength(0)
  })

  test("a late commit for an editor that was replaced still lands", () => {
    const ed = new EditorCore()
    ed.setTool("text")
    click(ed, 100, 100)
    const first = ed.appState.editingTextId!
    ed.setTool("text")
    click(ed, 400, 400)
    const second = ed.appState.editingTextId!
    expect(second).not.toBe(first)
    ed.commitText(first, "first")
    ed.commitText(second, "second")
    const texts = ed.scene.getNonDeleted().filter((e) => e.type === "text")
    expect(texts.map((t) => (t.type === "text" ? t.originalText : "")).sort()).toEqual(["first", "second"])
  })
})

describe("text with the current overlay", () => {
  test("a canvas click while editing lets the overlay's blur commit, without opening another editor", () => {
    const ed = new EditorCore()
    ed.setTool("text")
    click(ed, 100, 100)
    const id = ed.appState.editingTextId!
    // the press reaches the canvas before the textarea blurs and commits
    ed.pointerDown(ptr(400, 400))
    ed.commitText(id, "typed")
    ed.pointerUp(ptr(400, 400))
    expect(ed.appState.editingTextId).toBeNull()
    const texts = ed.scene.getNonDeleted().filter((e) => e.type === "text")
    expect(texts).toHaveLength(1)
    expect(texts[0]!.type === "text" && texts[0]!.originalText).toBe("typed")
  })
})

describe("keyboard", () => {
  test("with the grid on an arrow moves one cell and Shift+arrow five", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.toggleGrid()
    ed.keyDown(key("ArrowRight"))
    expect(ed.scene.get(rect.id)!.x).toBe(20)
    ed.keyDown(key("ArrowRight", { shiftKey: true }))
    expect(ed.scene.get(rect.id)!.x).toBe(120)
  })

  test("Option chords match on the physical key", () => {
    const ed = new EditorCore()
    expect(ed.keyDown({ ...key("ß", { altKey: true }), code: "KeyS" })).toBe(true)
    expect(ed.appState.objectsSnapMode).toBe(true)
  })

  test("tool letters work on non-Latin layouts", () => {
    const ed = new EditorCore()
    ed.keyDown({ ...key("к"), code: "KeyR" })
    expect(ed.appState.activeTool).toBe("rectangle")
  })

  test("the shortcut table covers the pinned tool keys", () => {
    const tools = Object.fromEntries(SHORTCUTS.filter((s) => s.group === "tools").map((s) => [s.id, s.keys]))
    expect(tools["tool.selection"]).toEqual(["V", "1"])
    expect(tools["tool.pen"]).toEqual(["7"])
    expect(tools["tool.pencil"]).toEqual(["P"])
    expect(tools["tool.lasso"]).toEqual(["Q"])
    expect(SHORTCUT_TOOLS["tool.eraser"]).toBe("eraser")
    expect(matchShortcut({ ...key("!", { shiftKey: true }), code: "Digit1" })).toBe("view.zoomFit")
    expect(matchShortcut({ ...key("Z", { metaKey: true, shiftKey: true }), code: "KeyZ" })).toBe(
      "history.redo",
    )
    expect(matchShortcut({ ...key("?", { shiftKey: true }), code: "Slash" })).toBe("app.help")
    expect(formatChord("Mod+Shift+Z", true)).toBe("⇧⌘Z")
    expect(formatChord("Mod+Shift+Z", false)).toBe("Ctrl+Shift+Z")
  })

  test("Mod means Cmd on a Mac and Ctrl elsewhere once the host says which", () => {
    const cmdZ = { ...key("z", { metaKey: true }), code: "KeyZ" }
    const ctrlZ = { ...key("z", { ctrlKey: true }), code: "KeyZ" }
    expect(matchShortcut(cmdZ)).toBe("history.undo")
    expect(matchShortcut(ctrlZ)).toBe("history.undo")
    expect(matchShortcut(cmdZ, undefined, true)).toBe("history.undo")
    expect(matchShortcut(ctrlZ, undefined, true)).toBeNull()
    expect(matchShortcut(ctrlZ, undefined, false)).toBe("history.undo")
    expect(matchShortcut(cmdZ, undefined, false)).toBeNull()

    const ed = new EditorCore()
    ed.macKeys = true
    drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.keyDown(ctrlZ)
    expect(ed.scene.getNonDeleted()).toHaveLength(1)
    ed.keyDown(cmdZ)
    expect(ed.scene.getNonDeleted()).toHaveLength(0)
  })

  test("edits are ignored while a pointer gesture is under way", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.setTool("selection")
    ed.pointerDown(ptr(0, 25))
    ed.pointerMove(ptr(40, 25))
    ed.keyDown(key("Delete"))
    ed.keyDown(key("d", { metaKey: true }))
    ed.pointerUp(ptr(40, 25))
    expect(ed.scene.getNonDeleted()).toHaveLength(1)
    expect(ed.scene.get(rect.id)!.x).toBe(40)
  })
})

describe("view mode and panning", () => {
  test("in view mode a left drag pans and nothing can be drawn", () => {
    const ed = new EditorCore()
    drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.toggleViewMode()
    ed.setTool("rectangle")
    expect(ed.appState.activeTool).toBe("selection")
    const before = ed.appState.viewport.scrollX
    ed.pointerDown(ptr(50, 50))
    ed.pointerMove({ ...ptr(50, 50), screen: [150, 50] })
    ed.pointerUp({ ...ptr(50, 50), screen: [150, 50] })
    expect(ed.appState.viewport.scrollX).toBeGreaterThan(before)
    expect(ed.scene.getNonDeleted()).toHaveLength(1)
    expect(ed.scene.getNonDeleted()[0]!.x).toBe(0)
    ed.setTool("laser")
    expect(ed.appState.activeTool).toBe("laser")
  })

  test("space-drag pans without touching the tool, and the polyline carries on", () => {
    const ed = new EditorCore()
    ed.setTool("line")
    click(ed, 0, 0)
    ed.pointerMove(ptr(100, 0, { buttons: 0 }))
    click(ed, 100, 0)
    ed.keyDown(key(" "))
    expect(ed.cursor(ptr(0, 0, { buttons: 0 }))).toBe("grab")
    ed.pointerDown({ ...ptr(300, 300), screen: [300, 300] })
    ed.pointerMove({ ...ptr(300, 300), screen: [350, 300] })
    ed.pointerUp({ ...ptr(300, 300), screen: [350, 300] })
    ed.keyUp(key(" "))
    expect(ed.appState.viewport.scrollX).toBe(50)
    expect(ed.appState.activeTool).toBe("line")
    ed.pointerMove(ptr(100, 100, { buttons: 0 }))
    click(ed, 100, 100)
    ed.keyDown(key("Enter"))
    const line = ed.scene.getNonDeleted().find((e) => e.type === "line")!
    expect(absolutePointsOf(line as never)).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
    ])
  })

  test("a pointerdown without the previous pointerup finishes that gesture first", () => {
    const ed = new EditorCore()
    ed.setTool("rectangle")
    ed.pointerDown(ptr(0, 0))
    ed.pointerMove(ptr(100, 100))
    // the host never delivered this gesture's pointerup
    ed.pointerDown(ptr(300, 300))
    ed.pointerUp(ptr(300, 300))
    expect(ed.scene.getNonDeleted()).toHaveLength(1)
    expect(undoDepth(ed)).toBe(1)
    ed.undo()
    expect(ed.scene.getNonDeleted()).toHaveLength(0)
    drawShape(ed, "rectangle", [0, 0], [50, 50])
    expect(undoDepth(ed)).toBe(1)
  })
})

describe("wheel and labels", () => {
  test("one wheel notch zooms about 10%, line deltas are scaled and Shift pans sideways", () => {
    const ed = new EditorCore()
    ed.wheel(0, 100, true, [0, 0])
    expect(ed.appState.viewport.zoom).toBeGreaterThan(0.85)
    expect(ed.appState.viewport.zoom).toBeLessThan(0.95)
    const y = ed.appState.viewport.scrollY
    ed.wheel(0, 3, false, [0, 0], { deltaMode: 1 })
    expect((y - ed.appState.viewport.scrollY) * ed.appState.viewport.zoom).toBeCloseTo(48)
    const x = ed.appState.viewport.scrollX
    ed.wheel(0, 40, false, [0, 0], { shiftKey: true })
    expect(ed.appState.viewport.scrollX).toBeLessThan(x)
  })

  test("double-clicking an arrow's body opens a label editor; its vertices open point editing", () => {
    const ed = new EditorCore()
    const arrow = drawArrow(ed, [0, 0], [200, 0])
    ed.setTool("selection")
    ed.doubleClick(ptr(100, 0))
    const id = ed.appState.editingTextId
    expect(id).not.toBeNull()
    const label = ed.scene.get(id!)!
    expect(label.type === "text" && label.containerId).toBe(arrow.id)
    ed.commitText(id!, "go")
    ed.doubleClick(ptr(200, 0))
    expect(ed.appState.editingLinearElementId).toBe(arrow.id)
  })
})

describe("style commands", () => {
  test("the arrow-type control changes only arrows and never the Edges default", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const arrow = drawArrow(ed, [300, 300], [500, 300])
    expect(ed.scene.get(rect.id)!.roundness).not.toBeNull()
    ed.selectElements([rect.id, arrow.id])
    ed.updateSelectedStyle({ arrowType: "sharp" })
    expect(ed.scene.get(rect.id)!.roundness).not.toBeNull()
    expect(ed.scene.get(arrow.id)!.roundness).toBeNull()
    expect(ed.appState.currentItemRoundness).toBe("round")
    expect(ed.appState.currentItemArrowType).toBe("sharp")
    // the older patch shape sent by the panel behaves the same
    ed.updateSelectedStyle({ elbowed: false, roundness: null })
    expect(ed.scene.get(rect.id)!.roundness).not.toBeNull()
    expect(ed.appState.currentItemRoundness).toBe("round")
  })

  test("toggling a line closed makes it end where it starts; shapes ignore the flag", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [400, 0], [500, 100])
    ed.setTool("line")
    for (const [x, y] of [
      [0, 0],
      [200, 0],
      [200, 200],
    ] as const) {
      ed.pointerMove(ptr(x, y, { buttons: 0 }))
      click(ed, x, y)
    }
    ed.keyDown(key("Enter"))
    const line = ed.scene.getNonDeleted().find((e) => e.type === "line")!
    ed.selectElements([line.id, rect.id])
    ed.updateSelectedStyle({ polygon: true })
    const closed = ed.scene.get(line.id)!
    if (closed.type !== "line") throw new Error("expected a line")
    expect(closed.polygon).toBe(true)
    expect(closed.points[0]).toEqual(closed.points[closed.points.length - 1])
    expect("polygon" in ed.scene.get(rect.id)!).toBe(false)
  })

  test("a background colour never lands on a freehand stroke", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.setTool("freedraw")
    drag(ed, [200, 200], [260, 240])
    const stroke = ed.scene.getNonDeleted().find((e) => e.type === "freedraw")!
    ed.selectElements([rect.id, stroke.id])
    ed.updateSelectedStyle({ backgroundColor: "#ffc9c9" })
    expect(ed.scene.get(rect.id)!.backgroundColor).toBe("#ffc9c9")
    expect(ed.scene.get(stroke.id)!.backgroundColor).toBe("transparent")
  })
})

describe("editor APIs for the UI", () => {
  test("staticVersion bumps for scene, viewport, theme and grid changes, not for selection or overlays", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    let v = ed.staticVersion
    ed.clearSelection()
    ed.setMarquee([0, 0, 10, 10])
    ed.setBindingHighlight(rect)
    ed.selectElements([rect.id])
    expect(ed.staticVersion).toBe(v)
    ed.nudge(1, 0)
    expect(ed.staticVersion).toBeGreaterThan(v)
    for (const change of [
      () => ed.wheel(10, 0, false, [0, 0]),
      () => ed.toggleTheme(),
      () => ed.toggleGrid(),
      () => ed.startEditingLabel(ed.scene.get(rect.id)!),
    ]) {
      v = ed.staticVersion
      change()
      expect(ed.staticVersion).toBeGreaterThan(v)
    }
  })

  test("unlockElement unlocks one element as an undoable step", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [300, 0], [400, 100])
    ed.selectElements([a.id, b.id])
    ed.toggleLock()
    ed.unlockElement(a.id)
    expect(ed.scene.get(a.id)!.locked).toBe(false)
    expect(ed.scene.get(b.id)!.locked).toBe(true)
    ed.undo()
    expect(ed.scene.get(a.id)!.locked).toBe(true)
  })

  test("insertScene adds a copy with fresh ids, remapped links and keys above the scene, as one step", () => {
    const ed = new EditorCore()
    drawShape(ed, "rectangle", [0, 0], [50, 50])
    const depth = undoDepth(ed)
    const other = new EditorCore()
    const a = drawShape(other, "rectangle", [0, 0], [100, 100])
    drawShape(other, "rectangle", [300, 0], [400, 100])
    const arrow = drawArrow(other, [50, 50], [350, 50])
    const label = addLabel(other, a, "A")

    const inserted = ed.insertScene(other.scene.getNonDeleted(), {}, [1000, 1000])
    expect(undoDepth(ed)).toBe(depth + 1)
    expect(inserted).toHaveLength(4)
    for (const el of inserted) expect([a.id, arrow.id, label].includes(el.id)).toBe(false)
    const copyArrow = inserted.find((e) => e.type === "arrow") as ArrowElement
    const ids = new Set(inserted.map((e) => e.id))
    expect(ids.has(copyArrow.startBinding!.elementId)).toBe(true)
    expect(ids.has(copyArrow.endBinding!.elementId)).toBe(true)
    const indices = ed.scene.getElements().map((e) => e.index)
    expect(new Set(indices).size).toBe(indices.length)
    const order = ed.scene.getNonDeleted().map((e) => e.id)
    for (const el of inserted) expect(order.indexOf(el.id)).toBeGreaterThan(0)
    const xs = inserted.filter((e) => e.type === "rectangle").map((e) => e.x)
    expect(Math.min(...xs)).toBeGreaterThan(700)
    ed.undo()
    expect(ed.scene.getNonDeleted()).toHaveLength(1)
  })

  test("choosing the image tool asks for a file at the viewport centre, and a cancelled picker disarms it", () => {
    const ed = new EditorCore()
    const onRequestImage = vi.fn()
    ed.host = { onRequestImage }
    ed.setViewportSize(1000, 600)
    ed.setTool("image")
    expect(onRequestImage).toHaveBeenCalledWith([500, 300])
    ed.cancelImageInsert()
    expect(ed.appState.activeTool).toBe("selection")
  })

  test("a width typed for a text becomes its wrap width, and a height scales its font", () => {
    const ed = new EditorCore()
    ed.setTool("text")
    click(ed, 0, 0)
    const id = ed.appState.editingTextId!
    ed.commitText(id, "hello world wide")
    ed.setElementGeometry(id, { width: 60 })
    const wrapped = ed.scene.get(id)!
    expect(wrapped.width).toBe(60)
    expect(wrapped.type === "text" && wrapped.autoResize).toBe(false)
    const h = wrapped.height
    ed.setElementGeometry(id, { height: h * 2 })
    const scaled = ed.scene.get(id)!
    expect(scaled.type === "text" && scaled.fontSize).toBe(40)
  })

  test("resizing several labelled shapes scales their labels' fonts with them", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 60])
    const b = drawShape(ed, "rectangle", [200, 0], [300, 60])
    const la = addLabel(ed, a, "A")
    const lb = addLabel(ed, b, "B")
    const before = (ed.scene.get(la) as TextElement).fontSize
    ed.selectElements([a.id, b.id])
    const se = selectionHandleSet(ed.selectedElements(), 1)!.handles.se!
    const bounds = getCommonBounds([ed.scene.get(a.id)!, ed.scene.get(b.id)!])
    // doubling the box: the grab offset keeps the edge where it was relative to the pointer
    drag(ed, se, [se[0] + (bounds[2] - bounds[0]), se[1] + (bounds[3] - bounds[1])], { shiftKey: true })
    for (const id of [la, lb]) {
      const label = ed.scene.get(id) as TextElement
      expect(label.fontSize).toBeCloseTo(before * 2, 5)
      const box = ed.scene.get(label.containerId!)!
      expect(label.x + label.width / 2).toBeCloseTo(box.x + box.width / 2, 5)
    }
    ed.undo()
    expect((ed.scene.get(la) as TextElement).fontSize).toBe(before)
  })

  test("crop brackets are grabbed where they are drawn, even on a tiny crop", () => {
    const ed = new EditorCore()
    const img = newElement("image", { x: 0, y: 0, width: 20, height: 20, fileId: "f", status: "saved" })
    ed.loadScene([img])
    ed.startCropping(img.id, 200, 200)
    const se = selectionHandleSet([ed.scene.get(img.id)!], 1, { croppingElementId: img.id })!.handles.se!
    expect(se).toEqual([20, 20])
    drag(ed, se, [18, 18])
    const cropped = ed.scene.get(img.id)!
    expect(cropped.width).toBeCloseTo(18)
    expect(cropped.x).toBe(0)
  })

  test("the frame name is grabbed where it is drawn, at any zoom", () => {
    const ed = new EditorCore()
    const frame = newElement("frame", { x: 0, y: 0, width: 400, height: 300, name: "Board" })
    ed.loadScene([frame])
    const onRenameFrame = vi.fn()
    ed.host = { onRenameFrame }
    ed.setAppState({ viewport: { zoom: 0.25, scrollX: 0, scrollY: 0 } })
    const label = frameLabelLayout(frame, 0.25)!
    const onName: [number, number] = [label.x + label.width / 2, label.y + label.height / 2]
    // well above the old fixed 26-unit header strip
    expect(onName[1]).toBeLessThan(-26)
    click(ed, ...onName)
    expect(Object.keys(ed.appState.selectedElementIds)).toEqual([frame.id])
    ed.doubleClick(ptr(...onName))
    expect(onRenameFrame).toHaveBeenCalledTimes(1)
    ed.clearSelection()
    // level with the name but past its end, and clear of the border's tolerance
    click(ed, label.x + label.width + 90, label.y + 4)
    expect(Object.keys(ed.appState.selectedElementIds)).toEqual([])
  })

  test("opening a document keeps the user's tool defaults", () => {
    const ed = new EditorCore()
    ed.updateSelectedStyle({ strokeColor: "#e03131", strokeWidth: 4 })
    ed.setAppState({ currentItemArrowType: "elbow" })
    ed.loadScene([newElement("rectangle", { x: 0, y: 0, width: 10, height: 10 })], { gridSize: 20 })
    expect(ed.appState.currentItemStrokeColor).toBe("#e03131")
    expect(ed.appState.currentItemStrokeWidth).toBe(4)
    expect(ed.appState.currentItemArrowType).toBe("elbow")
    expect(ed.appState.gridSize).toBe(20)
    ed.loadScene([], { currentItemStrokeColor: "#1971c2" })
    expect(ed.appState.currentItemStrokeColor).toBe("#1971c2")
  })

  test("pasted text joins the frame it lands in", () => {
    const ed = new EditorCore()
    const frame = drawShape(ed, "frame", [0, 0], [400, 400])
    const pasted = newElement("text", { x: 100, y: 100, width: 0, height: 25, index: ed.scene.nextIndex() })
    ed.startEditingText(pasted)
    ed.commitText(pasted.id, "pasted")
    expect(ed.scene.get(pasted.id)!.frameId).toBe(frame.id)
  })
})

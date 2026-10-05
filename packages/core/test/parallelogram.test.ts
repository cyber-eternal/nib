import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../src/editor/editorCore"
import { SHORTCUTS, matchShortcut } from "../src/editor/shortcuts"
import { absolutePointsOf } from "../src/geometry/linear"
import { SELECTION_PAD } from "../src/geometry/transformHandles"
import { parseExcalidraw, toExcalidraw } from "../src/io/excalidraw"
import { parseNib, serializeNib } from "../src/io/nibFile"
import type { Point } from "../src/math/vector"
import { DEFAULT_APP_STATE, type LineElement, type NibElement } from "../src/model/types"
import { selectionHandleSet } from "../src/render/interactiveScene"
import { parallelogramVertices } from "../src/tools/parallelogramTool"
import type { PointerInput } from "../src/tools/types"
import { click, drag, drawArrow, key, ptr, setupMeasurer, undoDepth } from "./editor/helpers"

beforeAll(setupMeasurer)

const asLine = (el: NibElement | undefined): LineElement => {
  if (el?.type !== "line") throw new Error(`expected a line, got ${el?.type}`)
  return el
}

const drawParallelogram = (
  ed: EditorCore,
  from: [number, number],
  to: [number, number],
  mods: Partial<PointerInput> = {},
): LineElement => {
  ed.setTool("parallelogram")
  drag(ed, from, to, mods)
  return asLine(ed.scene.get(Object.keys(ed.appState.selectedElementIds)[0]!))
}

const corners = (el: LineElement): Point[] => absolutePointsOf(el)

const live = (ed: EditorCore) => ed.scene.getNonDeleted()

/** The parallelogram filling 100,100 to 300,200: a 40px shift, top edge to the right. */
const BOX_SHAPE: Point[] = [
  [140, 100],
  [300, 100],
  [260, 200],
  [100, 200],
  [140, 100],
]

describe("parallelogram tool", () => {
  test("G arms it; Shift+G and Mod+G keep their own rows", () => {
    const ed = new EditorCore()
    ed.keyDown(key("g", { code: "KeyG" }))
    expect(ed.appState.activeTool).toBe("parallelogram")
    expect(SHORTCUTS.filter((s) => s.keys.includes("G")).map((s) => s.id)).toEqual(["tool.parallelogram"])
    expect(SHORTCUTS.find((s) => s.id === "tool.parallelogram")?.label).toBe("Parallelogram")
    expect(matchShortcut(key("G", { code: "KeyG", shiftKey: true }))).toBe("style.background")
    expect(matchShortcut(key("g", { code: "KeyG", metaKey: true }), undefined, true)).toBe("arrange.group")
  })

  test("a drag draws a closed line whose top edge is shifted right by a fifth of the width", () => {
    const ed = new EditorCore()
    const el = drawParallelogram(ed, [100, 100], [300, 200])
    expect(el.polygon).toBe(true)
    expect(el.points).toHaveLength(5)
    expect(el.points[0]).toEqual(el.points[4])
    expect([el.x, el.y, el.width, el.height]).toEqual([100, 100, 200, 100])
    expect(corners(el)).toEqual(BOX_SHAPE)
    expect(live(ed)).toHaveLength(1)
  })

  test("dragging left, up or both gives the same right-leaning shape", () => {
    const drags: [[number, number], [number, number]][] = [
      [
        [300, 200],
        [100, 100],
      ],
      [
        [300, 100],
        [100, 200],
      ],
      [
        [100, 200],
        [300, 100],
      ],
    ]
    for (const [from, to] of drags) {
      const el = drawParallelogram(new EditorCore(), from, to)
      expect(corners(el)).toEqual(BOX_SHAPE)
    }
  })

  test("the shift is at most half the height, so a flat box never leans flat or inverts", () => {
    const flat = parallelogramVertices({ x: 0, y: 0, width: 400, height: 40 })
    expect(flat[0]).toEqual([20, 0])
    expect(flat[2]).toEqual([380, 40])
    const tall = parallelogramVertices({ x: 0, y: 0, width: 10, height: 1000 })
    expect(tall[0][0]).toBeCloseTo(2)
    expect(tall[1][0] - tall[0][0]).toBeGreaterThan(0)
    expect(parallelogramVertices({ x: 5, y: 5, width: 100, height: 0 })[0]).toEqual([5, 5])
  })

  test("Shift keeps the box square and Alt draws it from the centre", () => {
    const square = drawParallelogram(new EditorCore(), [100, 100], [300, 160], { shiftKey: true })
    expect([square.x, square.y, square.width, square.height]).toEqual([100, 100, 200, 200])
    const centred = drawParallelogram(new EditorCore(), [200, 150], [300, 200], { altKey: true })
    expect(corners(centred)).toEqual(BOX_SHAPE)
  })

  test("a click drops an input/output box centred on it", () => {
    const ed = new EditorCore()
    ed.setTool("parallelogram")
    click(ed, 400, 300)
    const el = asLine(live(ed)[0])
    expect([el.x, el.y, el.width, el.height]).toEqual([320, 260, 160, 80])
    expect(el.polygon).toBe(true)
  })

  test("it takes the current style, with sharp corners unless the edges are round", () => {
    const ed = new EditorCore()
    ed.setAppState({
      currentItemStrokeColor: "#e03131",
      currentItemBackgroundColor: "#ffc9c9",
      currentItemFillStyle: "hachure",
      currentItemStrokeWidth: 4,
      currentItemStrokeStyle: "dashed",
      currentItemRoughness: 2,
      currentItemOpacity: 60,
      currentItemRoundness: "sharp",
    })
    const sharp = drawParallelogram(ed, [100, 100], [300, 200])
    expect(sharp).toMatchObject({
      strokeColor: "#e03131",
      backgroundColor: "#ffc9c9",
      fillStyle: "hachure",
      strokeWidth: 4,
      strokeStyle: "dashed",
      roughness: 2,
      opacity: 60,
      roundness: null,
    })
    ed.setAppState({ currentItemRoundness: "round" })
    expect(drawParallelogram(ed, [400, 100], [600, 200]).roundness).toEqual({ type: 2 })
  })

  test("it goes back to Select after drawing unless the tool is kept", () => {
    const ed = new EditorCore()
    const el = drawParallelogram(ed, [100, 100], [300, 200])
    expect(ed.appState.activeTool).toBe("selection")
    expect(ed.appState.selectedElementIds).toEqual({ [el.id]: true })
    ed.toggleToolLock()
    drawParallelogram(ed, [400, 100], [600, 200])
    expect(ed.appState.activeTool).toBe("parallelogram")
  })

  test("one undo removes it and redo brings it back", () => {
    const ed = new EditorCore()
    const el = drawParallelogram(ed, [100, 100], [300, 200])
    expect(undoDepth(ed)).toBe(1)
    ed.undo()
    expect(live(ed)).toHaveLength(0)
    ed.redo()
    expect(corners(asLine(ed.scene.get(el.id)))).toEqual(BOX_SHAPE)
  })

  test("Escape mid-drag leaves nothing behind", () => {
    const ed = new EditorCore()
    ed.setTool("parallelogram")
    ed.pointerDown(ptr(100, 100))
    ed.pointerMove(ptr(300, 200))
    ed.keyDown(key("Escape"))
    expect(live(ed)).toHaveLength(0)
    expect(undoDepth(ed)).toBe(0)
  })

  test("double-clicking inside adds a label centred in it", () => {
    const ed = new EditorCore()
    const el = drawParallelogram(ed, [100, 100], [300, 200])
    ed.doubleClick(ptr(200, 150))
    const textId = ed.appState.editingTextId
    expect(textId).not.toBeNull()
    ed.commitText(textId!, "Read input")
    const text = ed.scene.get(textId!)!
    expect(text.type === "text" && text.containerId).toBe(el.id)
    expect(ed.scene.get(el.id)!.boundElements).toContainEqual({ id: textId, type: "text" })
    expect(text.x + text.width / 2).toBeCloseTo(200, 0)
    expect(text.y + text.height / 2).toBeCloseTo(150, 0)
  })

  test("an arrow drawn into it binds to its slanted outline and follows it", () => {
    const ed = new EditorCore()
    const el = drawParallelogram(ed, [100, 100], [300, 200])
    const arrow = drawArrow(ed, [0, 150], [200, 150])
    expect(arrow.endBinding?.elementId).toBe(el.id)
    expect(ed.scene.get(el.id)!.boundElements).toContainEqual({ id: arrow.id, type: "arrow" })
    // the left side runs from (100,200) to (140,100), crossing y=150 at x=120
    const tip = absolutePointsOf(ed.scene.get(arrow.id) as LineElement).at(-1)!
    expect(tip[0]).toBeLessThan(120)
    expect(tip[0]).toBeGreaterThan(100)

    ed.setTool("selection")
    drag(ed, [300, 120], [400, 120])
    const moved = absolutePointsOf(ed.scene.get(arrow.id) as LineElement).at(-1)!
    expect(moved[0]).toBeGreaterThan(200)
  })

  test("resizing from a corner or a side keeps it closed and in proportion", () => {
    const ed = new EditorCore()
    const el = drawParallelogram(ed, [100, 100], [300, 200])
    const handles = selectionHandleSet([el], 1)!.handles
    expect(Object.keys(handles).sort()).toEqual(["e", "n", "ne", "nw", "rotation", "s", "se", "sw", "w"])

    drag(ed, [300 + SELECTION_PAD, 200 + SELECTION_PAD], [500 + SELECTION_PAD, 300 + SELECTION_PAD])
    const big = asLine(ed.scene.get(el.id))
    expect(big.polygon).toBe(true)
    expect(corners(big)).toEqual(BOX_SHAPE.map(([x, y]) => [100 + (x - 100) * 2, 100 + (y - 100) * 2]))

    drag(ed, [500 + SELECTION_PAD, 200], [300 + SELECTION_PAD, 200])
    const narrow = asLine(ed.scene.get(el.id))
    const pts = corners(narrow)
    expect(pts[0]).toEqual(pts[4])
    expect([narrow.x, narrow.y, narrow.width, narrow.height]).toEqual([100, 100, 200, 200])
    // the slant scales with the width: still a fifth of it
    expect(pts[0]![0] - pts[3]![0]).toBeCloseTo(40)
    expect(pts[1]![0] - pts[2]![0]).toBeCloseTo(40)
  })

  test("a kept label stays centred when the shape is resized", () => {
    const ed = new EditorCore()
    const el = drawParallelogram(ed, [100, 100], [300, 200])
    ed.doubleClick(ptr(200, 150))
    const textId = ed.appState.editingTextId!
    ed.commitText(textId, "Hi")
    ed.selectElements([el.id])
    drag(ed, [300 + SELECTION_PAD, 200 + SELECTION_PAD], [500 + SELECTION_PAD, 400 + SELECTION_PAD])
    const text = ed.scene.get(textId)!
    expect(text.x + text.width / 2).toBeCloseTo(300, 0)
    expect(text.y + text.height / 2).toBeCloseTo(250, 0)
  })
})

describe("parallelogram files", () => {
  const scene = () => {
    const ed = new EditorCore()
    ed.setAppState({ currentItemRoundness: "round", currentItemBackgroundColor: "#a5d8ff" })
    const el = drawParallelogram(ed, [100, 100], [300, 200])
    return { ed, el }
  }

  test(".nibd keeps it a closed polygon line, label and arrow included", () => {
    const { ed, el } = scene()
    ed.doubleClick(ptr(200, 150))
    ed.commitText(ed.appState.editingTextId!, "Input")
    const arrow = drawArrow(ed, [0, 150], [200, 150])
    const parsed = parseNib(serializeNib(ed.scene.getElements(), ed.appState))
    if (!parsed.ok) throw new Error(parsed.error)
    const back = asLine(parsed.elements.find((e) => e.id === el.id))
    expect(back.polygon).toBe(true)
    expect(back.roundness).toEqual({ type: 2 })
    expect(back.backgroundColor).toBe("#a5d8ff")
    expect(corners(back)).toEqual(BOX_SHAPE)
    expect(back.boundElements?.map((b) => b.type).sort()).toEqual(["arrow", "text"])
    const boundArrow = parsed.elements.find((e) => e.id === arrow.id)
    expect(boundArrow?.type === "arrow" && boundArrow.endBinding?.elementId).toBe(el.id)
  })

  test("Excalidraw export and import keep it a closed polygon line with straight edges", () => {
    const { ed, el } = scene()
    const text = toExcalidraw(ed.scene.getElements(), DEFAULT_APP_STATE)
    const raw = (JSON.parse(text).elements as Record<string, unknown>[]).find((e) => e.id === el.id)!
    expect(raw).toMatchObject({ type: "line", polygon: true, roundness: null })
    const parsed = parseExcalidraw(text)
    if (!parsed.ok) throw new Error(parsed.error)
    const back = asLine(parsed.elements.find((e) => e.id === el.id))
    expect(back.polygon).toBe(true)
    expect(back.points).toHaveLength(5)
    expect(corners(back)).toEqual(BOX_SHAPE)
    expect(back.backgroundColor).toBe("#a5d8ff")
  })
})

import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { elementIdFromLink, elementLink, isElementLink } from "../../src/editor/elementLinks"
import { EMBED_FRAME_ORIGINS, embedSource } from "../../src/editor/embeds"
import { formatChord, matchShortcut } from "../../src/editor/shortcuts"
import { elbowSegments } from "../../src/geometry/elbow"
import { getElementBounds } from "../../src/geometry/elementBounds"
import { absolutePointsOf } from "../../src/geometry/linear"
import { copyStyleFrom } from "../../src/io/clipboard"
import { boundsIntersect } from "../../src/math/bounds"
import type { Point } from "../../src/math/vector"
import { newElement } from "../../src/model/element"
import {
  type ArrowElement,
  type LineElement,
  type NibElement,
  type TextElement,
  canHaveLabel,
  isBindableElement,
} from "../../src/model/types"
import { sceneToScreen } from "../../src/render/viewport"
import { addLabel, click, drag, drawArrow, drawShape, key, ptr, setupMeasurer, undoDepth } from "./helpers"

beforeAll(setupMeasurer)

const live = (ed: EditorCore) => ed.scene.getNonDeleted()
const get = <T extends NibElement = NibElement>(ed: EditorCore, id: string) => ed.scene.get(id) as T
const selectedIds = (ed: EditorCore) => Object.keys(ed.appState.selectedElementIds)
const centre = (el: NibElement): Point => {
  const b = getElementBounds(el)
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
}
const mod = (k: string, extra = {}) => key(k, { metaKey: true, ...extra })
const alt = (k: string) => key(k, { altKey: true })

const freeText = (ed: EditorCore, x: number, y: number, value: string): TextElement => {
  ed.setTool("text")
  click(ed, x, y)
  const id = ed.appState.editingTextId!
  ed.commitText(id, value)
  return get<TextElement>(ed, id)
}

const triangle = (ed: EditorCore): LineElement => {
  const tri = newElement("line", {
    x: 0,
    y: 0,
    width: 300,
    height: 240,
    polygon: true,
    points: [
      [150, 0],
      [300, 240],
      [0, 240],
      [150, 0],
    ],
  })
  ed.addElements([tri])
  return get<LineElement>(ed, tri.id)
}

describe("flowcharts from the keyboard", () => {
  test("Cmd+Arrow adds a like shape beside the selected one, joined by a bound arrow, as one step", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 60])
    ed.updateSelectedStyle({ strokeColor: "#e03131", backgroundColor: "#ffc9c9" })
    const depth = undoDepth(ed)
    expect(ed.keyDown(mod("ArrowRight"))).toBe(true)

    const [nodeId] = selectedIds(ed)
    const node = get(ed, nodeId!)
    expect(node.type).toBe("rectangle")
    expect([node.x, node.y, node.width, node.height]).toEqual([200, 0, 100, 60])
    expect(node.strokeColor).toBe("#e03131")
    expect(node.backgroundColor).toBe("#ffc9c9")

    const arrow = live(ed).find((e): e is ArrowElement => e.type === "arrow")!
    expect(arrow.elbowed).toBe(true)
    expect(arrow.startBinding?.elementId).toBe(a.id)
    expect(arrow.endBinding?.elementId).toBe(node.id)
    expect(get(ed, a.id).boundElements?.some((b) => b.id === arrow.id)).toBe(true)
    expect(node.boundElements?.some((b) => b.id === arrow.id)).toBe(true)
    const pts = absolutePointsOf(arrow)
    expect(pts[0]![0]).toBeGreaterThanOrEqual(100)
    expect(pts.at(-1)![0]).toBeLessThanOrEqual(200)

    expect(undoDepth(ed)).toBe(depth + 1)
    ed.undo()
    expect(live(ed).map((e) => e.id)).toEqual([a.id])
    expect(get(ed, a.id).boundElements ?? []).toEqual([])
  })

  test("while Cmd is held, more presses fan out siblings that overlap nothing; after release they chain", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 60])
    ed.keyDown(mod("ArrowRight"))
    ed.keyDown(mod("ArrowRight"))
    ed.keyDown(mod("ArrowRight"))
    const nodes = live(ed).filter((e) => e.type === "rectangle" && e.id !== a.id)
    expect(nodes).toHaveLength(3)
    for (const n of nodes) {
      expect(n.x).toBe(200)
      const arrow = live(ed).find(
        (e) => e.type === "arrow" && e.endBinding?.elementId === n.id,
      ) as ArrowElement
      expect(arrow.startBinding?.elementId).toBe(a.id)
    }
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++)
        expect(boundsIntersect(getElementBounds(nodes[i]!), getElementBounds(nodes[j]!))).toBe(false)

    const lastId = selectedIds(ed)[0]!
    ed.keyUp(key("Meta"))
    ed.keyDown(mod("ArrowDown"))
    const chained = get(ed, selectedIds(ed)[0]!)
    const link = live(ed).find(
      (e) => e.type === "arrow" && e.endBinding?.elementId === chained.id,
    ) as ArrowElement
    expect(link.startBinding?.elementId).toBe(lastId)
    expect(chained.y).toBeGreaterThan(get(ed, lastId).y + 60)
  })

  test("a shape already sitting there is stepped round, not covered", () => {
    const ed = new EditorCore()
    const blocker = drawShape(ed, "ellipse", [200, 200], [300, 260])
    const a = drawShape(ed, "rectangle", [200, 0], [300, 60])
    ed.keyDown(mod("ArrowDown"))
    const node = get(ed, selectedIds(ed)[0]!)
    expect(node.type).toBe("rectangle")
    expect(boundsIntersect(getElementBounds(node), getElementBounds(blocker))).toBe(false)
    expect(node.y).toBeGreaterThan(get(ed, a.id).y + 60)
  })

  test("Alt+Arrow walks connected shapes, and repeated presses cycle through one level", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 60])
    ed.keyDown(mod("ArrowRight"))
    ed.keyDown(mod("ArrowRight"))
    ed.keyDown(mod("ArrowRight"))
    ed.keyUp(key("Meta"))
    const level = live(ed)
      .filter((e) => e.type === "rectangle" && e.id !== a.id)
      .map((e) => e.id)

    ed.selectElements([a.id])
    expect(ed.keyDown(alt("ArrowRight"))).toBe(true)
    const first = selectedIds(ed)[0]!
    expect(get(ed, first).y).toBe(0)
    ed.keyDown(alt("ArrowRight"))
    const second = selectedIds(ed)[0]!
    ed.keyDown(alt("ArrowRight"))
    const third = selectedIds(ed)[0]!
    expect(new Set([first, second, third])).toEqual(new Set(level))
    ed.keyDown(alt("ArrowRight"))
    expect(selectedIds(ed)).toEqual([first])

    ed.keyUp(key("Alt"))
    expect(ed.keyDown(alt("ArrowLeft"))).toBe(true)
    expect(selectedIds(ed)).toEqual([a.id])
    // nothing is connected above the start shape; the key is still swallowed (Alt+Left is Back)
    expect(ed.keyDown(alt("ArrowUp"))).toBe(true)
    expect(selectedIds(ed)).toEqual([a.id])
  })

  const parallelogram = (ed: EditorCore, from: [number, number], to: [number, number]): LineElement => {
    ed.setTool("parallelogram")
    drag(ed, from, to)
    return get<LineElement>(ed, selectedIds(ed)[0]!)
  }
  const arrowInto = (ed: EditorCore, id: string) =>
    live(ed).find((e): e is ArrowElement => e.type === "arrow" && e.endBinding?.elementId === id)!

  test("Cmd+Arrow from a parallelogram adds a like parallelogram, the arrow meeting its slanted sides", () => {
    const ed = new EditorCore()
    const a = parallelogram(ed, [0, 0], [200, 100])
    ed.updateSelectedStyle({ strokeColor: "#e03131", backgroundColor: "#ffc9c9" })
    const depth = undoDepth(ed)
    expect(ed.keyDown(mod("ArrowRight"))).toBe(true)

    const node = get<LineElement>(ed, selectedIds(ed)[0]!)
    expect(node.id).not.toBe(a.id)
    expect(node.type).toBe("line")
    expect(node.polygon).toBe(true)
    expect(node.points).toEqual(get<LineElement>(ed, a.id).points)
    expect([node.x, node.y, node.width, node.height]).toEqual([300, 0, 200, 100])
    expect(node).toMatchObject({ strokeColor: "#e03131", backgroundColor: "#ffc9c9", roundness: a.roundness })

    const arrow = arrowInto(ed, node.id)
    expect(arrow.elbowed).toBe(true)
    expect(arrow.startBinding).toMatchObject({ elementId: a.id, gap: 4 })
    expect(arrow.endBinding).toMatchObject({ elementId: node.id, gap: 4 })
    expect(get(ed, a.id).boundElements?.some((b) => b.id === arrow.id)).toBe(true)
    expect(node.boundElements?.some((b) => b.id === arrow.id)).toBe(true)
    // the sides lean in from the box: at mid-height the source's right side is at x=180, the copy's left at 320
    const pts = absolutePointsOf(arrow)
    expect(pts[0]![0]).toBeGreaterThan(180)
    expect(pts[0]![0]).toBeLessThan(186)
    expect(pts.at(-1)![0]).toBeGreaterThan(314)
    expect(pts.at(-1)![0]).toBeLessThan(320)

    expect(undoDepth(ed)).toBe(depth + 1)
    ed.undo()
    expect(live(ed).map((e) => e.id)).toEqual([a.id])
  })

  test("pencil triangles grow flowcharts too, and held-Cmd siblings stay clear of each other", () => {
    const ed = new EditorCore()
    const tri = triangle(ed)
    ed.selectElements([tri.id])
    ed.keyDown(mod("ArrowDown"))
    const node = get<LineElement>(ed, selectedIds(ed)[0]!)
    expect(node.polygon).toBe(true)
    expect(node.points).toEqual(tri.points)
    expect([node.x, node.y]).toEqual([0, 340])
    const pts = absolutePointsOf(arrowInto(ed, node.id))
    // out of the middle of the base, into the copy's apex
    expect(pts[0]).toEqual([150, 244])
    expect(pts.at(-1)![0]).toBeCloseTo(150)
    expect(pts.at(-1)![1]).toBeGreaterThan(330)
    expect(pts.at(-1)![1]).toBeLessThan(340)

    ed.keyDown(mod("ArrowDown"))
    const siblings = live(ed).filter((e) => e.type === "line" && e.id !== tri.id)
    expect(siblings).toHaveLength(2)
    expect(boundsIntersect(getElementBounds(siblings[0]!), getElementBounds(siblings[1]!))).toBe(false)
  })

  test("Alt+Arrow walks through closed-line nodes and the boxes joined to them", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [-400, 0], [-200, 100])
    const a = parallelogram(ed, [0, 0], [200, 100])
    const joined = drawArrow(ed, [-300, 50], [100, 50])
    expect([joined.startBinding?.elementId, joined.endBinding?.elementId]).toEqual([rect.id, a.id])
    ed.selectElements([a.id])
    ed.keyDown(mod("ArrowRight"))
    const b = selectedIds(ed)[0]!
    ed.keyUp(key("Meta"))
    ed.keyDown(mod("ArrowDown"))
    const c = selectedIds(ed)[0]!
    ed.keyUp(key("Meta"))

    ed.selectElements([a.id])
    ed.keyDown(alt("ArrowRight"))
    expect(selectedIds(ed)).toEqual([b])
    ed.keyDown(alt("ArrowDown"))
    expect(selectedIds(ed)).toEqual([c])
    ed.keyDown(alt("ArrowUp"))
    expect(selectedIds(ed)).toEqual([b])
    ed.keyDown(alt("ArrowLeft"))
    expect(selectedIds(ed)).toEqual([a.id])
    ed.keyDown(alt("ArrowLeft"))
    expect(selectedIds(ed)).toEqual([rect.id])
  })

  test("the shortcuts are in the one table", () => {
    expect(matchShortcut(mod("ArrowLeft"))).toBe("flow.addNode")
    expect(matchShortcut(alt("ArrowDown"))).toBe("flow.navigate")
    expect(matchShortcut(key("ArrowDown", { metaKey: true, shiftKey: true }))).toBe("arrange.alignBottom")
  })
})

describe("frames", () => {
  const framed = () => {
    const ed = new EditorCore()
    const child = drawShape(ed, "rectangle", [50, 50], [150, 150])
    const label = addLabel(ed, child, "inside")
    const frame = drawShape(ed, "frame", [0, 0], [400, 300])
    expect(get(ed, child.id).frameId).toBe(frame.id)
    return { ed, child, label, frame }
  }

  test("deleting a frame deletes its children, and undo brings them back", () => {
    const { ed, child, label, frame } = framed()
    ed.selectElements([frame.id])
    ed.deleteSelected()
    expect(get(ed, frame.id).isDeleted).toBe(true)
    expect(get(ed, child.id).isDeleted).toBe(true)
    expect(get(ed, label).isDeleted).toBe(true)
    ed.undo()
    expect(get(ed, child.id).isDeleted).toBe(false)
    expect(get(ed, child.id).frameId).toBe(frame.id)
    expect(get(ed, label).isDeleted).toBe(false)
  })

  test("deleting a frame with frameChildren: release keeps its children, out of the frame", () => {
    const { ed, child, frame } = framed()
    ed.selectElements([frame.id])
    ed.deleteSelected({ frameChildren: "release" })
    expect(get(ed, child.id).isDeleted).toBe(false)
    expect(get(ed, child.id).frameId).toBeNull()
  })

  test("select frame contents picks the unlocked children, not their labels", () => {
    const { ed, child, frame } = framed()
    const other = drawShape(ed, "ellipse", [200, 100], [300, 200])
    expect(get(ed, other.id).frameId).toBe(frame.id)
    ed.selectElements([other.id])
    ed.toggleLock()
    ed.selectElements([frame.id])
    expect(ed.selectFrameChildren()).toBe(1)
    expect(selectedIds(ed)).toEqual([child.id])
    expect(ed.selectFrameChildren("missing")).toBe(0)
  })

  test("wrap selection in frame draws a padded frame round it and moves the selection in", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const label = addLabel(ed, a, "a")
    const b = drawShape(ed, "rectangle", [200, 50], [300, 150])
    ed.selectElements([a.id, b.id])
    const id = ed.wrapSelectionInFrame()!
    const frame = get(ed, id)
    expect(frame.type).toBe("frame")
    expect([frame.x, frame.y, frame.width, frame.height]).toEqual([-16, -16, 332, 182])
    expect(get(ed, a.id).frameId).toBe(id)
    expect(get(ed, b.id).frameId).toBe(id)
    expect(get(ed, label).frameId).toBe(id)
    expect(selectedIds(ed)).toEqual([id])
    ed.undo()
    expect(get(ed, id)).toBeUndefined()
    expect(get(ed, a.id).frameId).toBeNull()
    // frames don't nest
    ed.selectElements([a.id])
    const outer = drawShape(ed, "frame", [-50, -50], [500, 400])
    ed.selectElements([outer.id, b.id])
    expect(ed.wrapSelectionInFrame()).toBeNull()
  })

  test("remove from frame takes the selection out of its frame where it is", () => {
    const { ed, child, label } = framed()
    ed.selectElements([child.id])
    expect(ed.removeSelectionFromFrame()).toBe(1)
    expect(get(ed, child.id).frameId).toBeNull()
    expect(get(ed, label).frameId).toBeNull()
    expect(get(ed, child.id).x).toBe(50)
  })

  test("setFrameName trims, clears on blank and is undoable", () => {
    const { ed, frame } = framed()
    ed.setFrameName(frame.id, "  Ideas  ")
    expect((get(ed, frame.id) as { name: string | null }).name).toBe("Ideas")
    ed.setFrameName(frame.id, "   ")
    expect((get(ed, frame.id) as { name: string | null }).name).toBeNull()
    ed.undo()
    expect((get(ed, frame.id) as { name: string | null }).name).toBe("Ideas")
    ed.renameFrame(frame.id, "Old API")
    expect((get(ed, frame.id) as { name: string | null }).name).toBe("Old API")
  })
})

describe("text and containers", () => {
  test("bind text to a container makes it the centred label, and undo splits them again", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [200, 100])
    const text = freeText(ed, 400, 300, "Hello")
    ed.selectElements([rect.id, text.id])
    expect([ed.canBindText(), ed.canUnbindText(), ed.canWrapText()]).toEqual([true, false, true])
    const depth = undoDepth(ed)
    expect(ed.bindTextToContainer()).toBe(true)
    expect([ed.canBindText(), ed.canUnbindText(), ed.canWrapText()]).toEqual([false, true, false])
    expect(undoDepth(ed)).toBe(depth + 1)
    const label = get<TextElement>(ed, text.id)
    expect(label.containerId).toBe(rect.id)
    expect(label.textAlign).toBe("center")
    expect(label.verticalAlign).toBe("middle")
    expect(centre(label)[0]).toBeCloseTo(100)
    expect(centre(label)[1]).toBeCloseTo(50)
    expect(get(ed, rect.id).boundElements).toEqual([{ id: text.id, type: "text" }])
    expect(label.index > get(ed, rect.id).index).toBe(true)
    expect(selectedIds(ed)).toEqual([rect.id])
    // a container with a label takes no second one
    const other = freeText(ed, 500, 500, "Again")
    ed.selectElements([rect.id, other.id])
    expect(ed.bindTextToContainer()).toBe(false)

    ed.undo()
    ed.undo()
    expect(get<TextElement>(ed, text.id).containerId).toBeNull()
    expect(get(ed, rect.id).boundElements ?? []).toEqual([])
  })

  test("unbind text leaves the label as free text where it was", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [200, 100])
    const labelId = addLabel(ed, rect, "Hi there")
    const before = centre(get(ed, labelId))
    ed.selectElements([rect.id])
    expect(ed.unbindText()).toEqual([labelId])
    const text = get<TextElement>(ed, labelId)
    expect(text.containerId).toBeNull()
    expect(text.text).toBe("Hi there")
    expect(centre(text)[0]).toBeCloseTo(before[0])
    expect(centre(text)[1]).toBeCloseTo(before[1])
    expect(get(ed, rect.id).boundElements ?? []).toEqual([])
    expect(selectedIds(ed)).toEqual([labelId])
  })

  test("wrap text in a container puts a shape round it and moves its arrows to the shape", () => {
    const ed = new EditorCore()
    const text = freeText(ed, 300, 100, "Wrap me")
    const arrow = drawArrow(ed, [0, 100], centre(text))
    expect(arrow.endBinding?.elementId).toBe(text.id)
    ed.selectElements([text.id])
    const [boxId] = ed.wrapTextInContainer()
    const box = get(ed, boxId!)
    const label = get<TextElement>(ed, text.id)
    expect(box.type).toBe("rectangle")
    expect(label.containerId).toBe(box.id)
    expect(label.text).toBe("Wrap me")
    expect(box.width).toBeGreaterThan(label.width)
    expect(box.height).toBeGreaterThan(label.height)
    expect(box.index < label.index).toBe(true)
    expect(get<ArrowElement>(ed, arrow.id).endBinding?.elementId).toBe(box.id)
    expect(box.boundElements?.map((b) => b.id).sort()).toEqual([arrow.id, text.id].sort())
    expect(label.boundElements ?? []).toEqual([])
    const ellipse = ed.wrapTextInContainer("ellipse")
    expect(ellipse).toEqual([])
  })

  test("vertical align, a typed font size and the zigzag fill reach labels and shapes", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [200, 200])
    const labelId = addLabel(ed, rect, "Top")
    ed.selectElements([rect.id])
    ed.updateSelectedStyle({ verticalAlign: "top" })
    const label = get<TextElement>(ed, labelId)
    expect(label.verticalAlign).toBe("top")
    expect(label.y).toBeLessThan(20)

    ed.updateSelectedStyle({ fontSize: 37 })
    expect(get<TextElement>(ed, labelId).fontSize).toBe(37)
    ed.updateSelectedStyle({ fontSize: Number.NaN })
    ed.updateSelectedStyle({ fontSize: -4 })
    expect(get<TextElement>(ed, labelId).fontSize).toBe(37)
    ed.updateSelectedStyle({ fontSize: 50_000 })
    expect(get<TextElement>(ed, labelId).fontSize).toBe(1000)

    ed.updateSelectedStyle({ fillStyle: "zigzag", backgroundColor: "#a5d8ff" })
    expect(get(ed, rect.id).fillStyle).toBe("zigzag")
    expect(ed.appState.currentItemFillStyle).toBe("zigzag")
  })

  test("Cmd+Shift+> and Cmd+Shift+< step the font size of text and labels", () => {
    const ed = new EditorCore()
    const text = freeText(ed, 0, 0, "Size")
    const rect = drawShape(ed, "rectangle", [100, 100], [300, 200])
    const labelId = addLabel(ed, rect, "Label")
    ed.selectElements([text.id, rect.id])
    const up = key(">", { metaKey: true, shiftKey: true, code: "Period" })
    const down = key("<", { metaKey: true, shiftKey: true, code: "Comma" })
    expect(matchShortcut(up)).toBe("style.fontSizeUp")
    expect(matchShortcut(down)).toBe("style.fontSizeDown")
    expect(ed.keyDown(up)).toBe(true)
    expect(get<TextElement>(ed, text.id).fontSize).toBe(22)
    expect(get<TextElement>(ed, labelId).fontSize).toBe(22)
    expect(get(ed, text.id).height).toBeGreaterThan(text.height)
    ed.keyDown(down)
    expect(get<TextElement>(ed, text.id).fontSize).toBe(20)
    expect(ed.appState.currentItemFontSize).toBe(20)
    // nothing selected: the default size steps
    ed.clearSelection()
    ed.keyDown(up)
    expect(ed.appState.currentItemFontSize).toBe(22)
    expect(formatChord("Mod+Shift+.", true)).toBe("⇧⌘>")
    expect(formatChord("Mod+Shift+,", false)).toBe("Ctrl+Shift+<")
  })
})

describe("binding modifiers", () => {
  const twoBoxes = () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [300, 0], [400, 100])
    return { ed, a, b }
  }

  test("Cmd held while the head is placed leaves that end unbound, and shows no binding", () => {
    const { ed, a, b } = twoBoxes()
    ed.setTool("arrow")
    ed.pointerDown(ptr(50, 50))
    ed.pointerMove(ptr(200, 50))
    ed.pointerMove(ptr(350, 50, { metaKey: true }))
    expect(ed.bindingHighlight).toBeNull()
    ed.pointerUp(ptr(350, 50, { metaKey: true }))
    const arrow = get<ArrowElement>(ed, selectedIds(ed)[0]!)
    expect(arrow.startBinding?.elementId).toBe(a.id)
    expect(arrow.endBinding).toBeNull()
    expect(get(ed, b.id).boundElements ?? []).toEqual([])
    expect(absolutePointsOf(arrow).at(-1)).toEqual([350, 50])
  })

  test("Cmd held at the press leaves the start unbound", () => {
    const { ed, b } = twoBoxes()
    ed.setTool("arrow")
    ed.pointerDown(ptr(50, 50, { ctrlKey: true }))
    ed.pointerMove(ptr(200, 50))
    ed.pointerMove(ptr(350, 50))
    ed.pointerUp(ptr(350, 50))
    const arrow = get<ArrowElement>(ed, selectedIds(ed)[0]!)
    expect(arrow.startBinding).toBeNull()
    expect(arrow.endBinding?.elementId).toBe(b.id)
  })

  test("a dragged end dropped deep inside a shape pins to that spot and follows the shape", () => {
    const { ed, b } = twoBoxes()
    const arrow = drawArrow(ed, [0, 250], [100, 250])
    drag(ed, [100, 250], [360, 60])
    const pinned = get<ArrowElement>(ed, arrow.id)
    expect(pinned.endBinding?.elementId).toBe(b.id)
    expect(pinned.endBinding?.fixedPoint?.[0]).toBeCloseTo(0.6)
    expect(pinned.endBinding?.fixedPoint?.[1]).toBeCloseTo(0.6)
    expect(absolutePointsOf(pinned).at(-1)).toEqual([360, 60])
    ed.selectElements([b.id])
    ed.nudge(10, 0)
    const end = absolutePointsOf(get<ArrowElement>(ed, arrow.id)).at(-1)!
    expect(end[0]).toBeCloseTo(370)
    expect(end[1]).toBeCloseTo(60)
  })

  test("a dragged end dropped near the outline binds to the outline; with Cmd it stays loose", () => {
    const { ed, b } = twoBoxes()
    const arrow = drawArrow(ed, [0, 250], [100, 250])
    drag(ed, [100, 250], [305, 50])
    const outline = get<ArrowElement>(ed, arrow.id)
    expect(outline.endBinding?.elementId).toBe(b.id)
    expect(outline.endBinding?.fixedPoint ?? null).toBeNull()
    expect(absolutePointsOf(outline).at(-1)![0]).toBeLessThan(300)

    const loose = drawArrow(ed, [0, 400], [100, 400])
    drag(ed, [100, 400], [350, 50], { metaKey: true })
    expect(get<ArrowElement>(ed, loose.id).endBinding).toBeNull()
  })

  test("dragging an elbow segment slides it sideways, keeps the route orthogonal and the ends bound", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [400, 300], [500, 400])
    ed.setAppState({ currentItemArrowType: "elbow" })
    const arrow = drawArrow(ed, [50, 50], [450, 350])
    expect(arrow.elbowed).toBe(true)
    const before = absolutePointsOf(arrow)
    const seg = [...elbowSegments(before)].sort((p, q) => q.length - p.length)[0]!
    expect(seg.length).toBeGreaterThan(100)
    const to: Point = seg.horizontal ? [seg.mid[0], seg.mid[1] + 40] : [seg.mid[0] + 40, seg.mid[1]]
    expect(ed.cursor(ptr(seg.mid[0], seg.mid[1], { buttons: 0 }))).toBe(
      seg.horizontal ? "ns-resize" : "ew-resize",
    )
    const depth = undoDepth(ed)
    drag(ed, seg.mid, to)
    const moved = get<ArrowElement>(ed, arrow.id)
    const after = absolutePointsOf(moved)
    expect(after[0]).toEqual(before[0])
    expect(after.at(-1)).toEqual(before.at(-1))
    for (let i = 0; i < after.length - 1; i++) {
      const p = after[i]!
      const q = after[i + 1]!
      expect(Math.abs(p[0] - q[0]) < 1e-6 || Math.abs(p[1] - q[1]) < 1e-6).toBe(true)
    }
    expect(after.some((p) => (seg.horizontal ? p[1] === to[1] : p[0] === to[0]))).toBe(true)
    expect(moved.startBinding?.elementId).toBe(a.id)
    expect(moved.endBinding?.elementId).toBe(b.id)
    expect(undoDepth(ed)).toBe(depth + 1)
    ed.undo()
    expect(absolutePointsOf(get<ArrowElement>(ed, arrow.id))).toEqual(before)
  })
})

describe("links between elements", () => {
  test("element links are written and read as #element=<id>", () => {
    expect(elementLink("abc_123")).toBe("#element=abc_123")
    expect(elementIdFromLink("#element=abc_123")).toBe("abc_123")
    expect(elementIdFromLink("  #element=xyz-9 ")).toBe("xyz-9")
    expect(elementIdFromLink("https://example.com/#element=abc")).toBeNull()
    expect(elementIdFromLink("#element=")).toBeNull()
    expect(elementIdFromLink("#element=a b")).toBeNull()
    expect(isElementLink(null)).toBe(false)
  })

  test("setLink keeps element links, normalises web links and refuses unsafe ones", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    expect(ed.setLink("#element=target1")).toBe(true)
    expect(get(ed, a.id).link).toBe("#element=target1")
    expect(ed.setLink("example.com/page")).toBe(true)
    expect(get(ed, a.id).link).toBe("https://example.com/page")
    expect(ed.setLink("javascript:alert(1)")).toBe(false)
    expect(get(ed, a.id).link).toBe("https://example.com/page")
    expect(ed.setLink("  ")).toBe(true)
    expect(get(ed, a.id).link).toBeNull()
  })

  test("following an element link brings the element to the middle of the view and selects it", () => {
    const ed = new EditorCore()
    ed.setViewportSize(800, 600)
    const source = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const target = drawShape(ed, "ellipse", [3000, 2000], [3100, 2060])
    ed.selectElements([source.id])
    ed.setLink(elementLink(target.id))
    ed.setTool("rectangle")
    expect(ed.followLink(get(ed, source.id).link!)).toBe(true)
    const screen = sceneToScreen(centre(get(ed, target.id)), ed.appState.viewport)
    expect(screen[0]).toBeCloseTo(400)
    expect(screen[1]).toBeCloseTo(300)
    expect(ed.appState.viewport.zoom).toBe(1)
    expect(ed.appState.activeTool).toBe("selection")
    expect(selectedIds(ed)).toEqual([target.id])

    // too big for the view: zoom out until it fits
    const big = drawShape(ed, "rectangle", [0, 5000], [4000, 8000])
    expect(ed.jumpToElement(big.id)).toBe(true)
    expect(ed.appState.viewport.zoom).toBeLessThan(0.25)

    ed.selectElements([target.id])
    ed.deleteSelected()
    expect(ed.followLink(elementLink(target.id))).toBe(false)
  })

  test("web links go to the host, unsafe links go nowhere", () => {
    const ed = new EditorCore()
    const opened: string[] = []
    ed.host = { onOpenLink: (url) => opened.push(url) }
    expect(ed.followLink(" https://example.com ")).toBe(true)
    expect(ed.followLink("javascript:alert(1)")).toBe(false)
    expect(ed.followLink("file:///etc/passwd")).toBe(false)
    expect(opened).toEqual(["https://example.com"])
  })
})

describe("paste styles", () => {
  test("a copied arrow style lands on everything selected in the form each element takes", () => {
    const ed = new EditorCore()
    const rect = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const boxed = drawShape(ed, "diamond", [200, 0], [300, 100])
    const labelId = addLabel(ed, boxed, "label")
    const ellipse = drawShape(ed, "ellipse", [400, 0], [500, 100])
    const target = drawArrow(ed, [0, 300], [200, 300])
    const sourceArrow = newElement("arrow", {
      strokeColor: "#e03131",
      backgroundColor: "#ffc9c9",
      fillStyle: "hachure",
      strokeWidth: 4,
      strokeStyle: "dashed",
      roughness: 2,
      opacity: 60,
      roundness: { type: 2 },
      startArrowhead: "dot",
      endArrowhead: "triangle",
    })
    const sourceText = newElement("text", { fontFamily: "code", fontSize: 28, textAlign: "left" })
    const style = { ...copyStyleFrom(sourceArrow, sourceText), x: 999, id: "nope" }
    const defaults = ed.appState
    ed.selectElements([rect.id, boxed.id, ellipse.id, target.id])
    const depth = undoDepth(ed)
    ed.pasteStyles(style)
    expect(undoDepth(ed)).toBe(depth + 1)

    const r = get(ed, rect.id)
    expect([r.strokeColor, r.backgroundColor, r.fillStyle, r.strokeWidth, r.strokeStyle]).toEqual([
      "#e03131",
      "#ffc9c9",
      "hachure",
      4,
      "dashed",
    ])
    expect([r.roughness, r.opacity, r.x]).toEqual([2, 60, 0])
    expect(r.roundness).toEqual({ type: 3 })
    expect("startArrowhead" in r).toBe(false)
    expect(get(ed, ellipse.id).roundness).toBeNull()
    expect(get(ed, boxed.id).roundness).toEqual({ type: 3 })

    const label = get<TextElement>(ed, labelId)
    expect([label.fontFamily, label.fontSize, label.textAlign]).toEqual(["code", 28, "left"])
    expect(label.strokeColor).toBe("#e03131")

    const arrow = get<ArrowElement>(ed, target.id)
    expect([arrow.startArrowhead, arrow.endArrowhead]).toEqual(["dot", "triangle"])
    expect(arrow.roundness).toEqual({ type: 2 })
    expect(ed.appState.currentItemStrokeColor).toBe(defaults.currentItemStrokeColor)
    expect(ed.appState.currentItemFontFamily).toBe(defaults.currentItemFontFamily)

    ed.undo()
    expect(get(ed, rect.id).strokeColor).toBe(rect.strokeColor)
    expect(get<TextElement>(ed, labelId).fontSize).toBe(20)
  })

  test("an elbow arrow's style turns a selected arrow into an elbow; frames keep their plain look", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [300, 200], [400, 300])
    const arrow = drawArrow(ed, [50, 50], [350, 250])
    const frame = drawShape(ed, "frame", [-100, -100], [600, 500])
    ed.selectElements([arrow.id, frame.id])
    ed.pasteStyles({ strokeColor: "#1971c2", elbowed: true, roundness: null, backgroundColor: "#a5d8ff" })
    const elbow = get<ArrowElement>(ed, arrow.id)
    expect(elbow.elbowed).toBe(true)
    expect(elbow.startBinding?.elementId).toBe(a.id)
    expect(elbow.endBinding?.elementId).toBe(b.id)
    const pts = absolutePointsOf(elbow)
    for (let i = 0; i < pts.length - 1; i++)
      expect(pts[i]![0] === pts[i + 1]![0] || pts[i]![1] === pts[i + 1]![1]).toBe(true)
    expect(get(ed, frame.id).strokeColor).toBe("#1971c2")
    expect(get(ed, frame.id).backgroundColor).toBe("transparent")
  })

  test("the corner control's roundness becomes each element's own kind", () => {
    const ed = new EditorCore()
    ed.setTool("line")
    drag(ed, [0, 0], [100, 50])
    const line = live(ed).find((e) => e.type === "line")!
    const rect = drawShape(ed, "rectangle", [200, 0], [300, 100])
    ed.selectElements([line.id, rect.id])
    ed.updateSelectedStyle({ roundness: { type: 3 } })
    expect(get(ed, line.id).roundness).toEqual({ type: 2 })
    expect(get(ed, rect.id).roundness).toEqual({ type: 3 })
  })
})

describe("embeddables", () => {
  test("embed links are checked against the allowlist and rewritten to the site's embed form", () => {
    expect(embedSource("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m2s")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=62",
    )
    expect(embedSource("youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")
    expect(embedSource("https://vimeo.com/123456")).toBe("https://player.vimeo.com/video/123456")
    expect(embedSource("https://www.loom.com/share/abc123")).toBe("https://www.loom.com/embed/abc123")
    expect(embedSource("https://codepen.io/me/pen/xyz")).toBe(
      "https://codepen.io/me/embed/xyz?default-tab=result",
    )
    expect(embedSource("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC")).toBe(
      "https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC",
    )
    expect(embedSource("https://www.figma.com/file/abc/Board")).toBe(
      `https://www.figma.com/embed?embed_host=nib&url=${encodeURIComponent("https://www.figma.com/file/abc/Board")}`,
    )
    expect(embedSource("https://evil.example/watch?v=dQw4w9WgXcQ")).toBeNull()
    expect(embedSource("https://notyoutube.com/watch?v=dQw4w9WgXcQ")).toBeNull()
    expect(embedSource("javascript:alert(1)")).toBeNull()
    expect(embedSource("https://www.youtube.com/watch?v=<script>")).toBeNull()
  })

  test("every embed address lands on an origin the CSPs let the app frame", () => {
    const allowed = (src: string) => {
      const origin = /^https:\/\/[^/?#]+/.exec(src)![0]
      return EMBED_FRAME_ORIGINS.some((o) =>
        o.includes("*.") ? origin.endsWith(o.slice(o.indexOf("*.") + 1)) : origin === o,
      )
    }
    for (const link of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube-nocookie.com/embed/dQw4w9WgXcQ",
      "https://vimeo.com/123456",
      "https://player.vimeo.com/video/123456",
      "https://www.figma.com/file/abc/Board",
      "https://embed.figma.com/embed?x=1",
      "https://www.loom.com/share/abc123",
      "https://gist.github.com/me/0123abcd",
      "https://codepen.io/me/pen/xyz",
      "https://codesandbox.io/s/abc",
      "https://stackblitz.com/edit/abc",
      "https://app.excalidraw.com/l/abc",
      "https://excalidraw.com/#json=abc",
      "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
    ]) {
      const src = embedSource(link)
      expect(src, link).not.toBeNull()
      expect(allowed(src!), `${link} -> ${src}`).toBe(true)
    }
  })

  test("a new embeddable asks the host for its address, and only allowlisted addresses are kept", () => {
    const ed = new EditorCore()
    const asked: string[] = []
    ed.host = { onEditEmbed: (el) => asked.push(el.id) }
    const embed = drawShape(ed, "embeddable" as never, [0, 0], [320, 180])
    expect(asked).toEqual([embed.id])
    expect(ed.setEmbeddableLink(embed.id, "javascript:alert(1)")).toBe(false)
    expect(ed.setEmbeddableLink(embed.id, "https://example.com")).toBe(false)
    expect(get(ed, embed.id).link).toBeNull()
    expect(ed.setEmbeddableLink(embed.id, "youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true)
    expect(get(ed, embed.id).link).toBe("https://youtube.com/watch?v=dQw4w9WgXcQ")
    const rect = drawShape(ed, "rectangle", [400, 0], [500, 100])
    expect(ed.setEmbeddableLink(rect.id, "https://youtu.be/dQw4w9WgXcQ")).toBe(false)
  })
})

describe("eraser", () => {
  test("the stroke marks what it passes over, which is deleted on release as one step", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [200, 0], [300, 100])
    ed.setTool("eraser")
    const v0 = ed.staticVersion
    ed.pointerDown(ptr(-50, 50))
    ed.pointerMove(ptr(150, 50))
    expect(ed.pendingEraseIds).toEqual([a.id])
    expect(get(ed, a.id).isDeleted).toBe(false)
    expect(ed.staticVersion).toBeGreaterThan(v0)
    ed.pointerMove(ptr(250, 50))
    expect(ed.pendingEraseIds).toEqual([a.id, b.id])
    const depth = undoDepth(ed)
    ed.pointerUp(ptr(250, 50))
    expect(ed.pendingEraseIds).toEqual([])
    expect(get(ed, a.id).isDeleted).toBe(true)
    expect(get(ed, b.id).isDeleted).toBe(true)
    expect(undoDepth(ed)).toBe(depth + 1)
    ed.undo()
    expect(
      live(ed)
        .map((e) => e.id)
        .sort(),
    ).toEqual([a.id, b.id].sort())
  })

  test("Alt over a marked element un-marks just that one", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [200, 0], [300, 100])
    ed.setTool("eraser")
    ed.pointerDown(ptr(-50, 50))
    ed.pointerMove(ptr(350, 50))
    expect(ed.pendingEraseIds).toHaveLength(2)
    ed.pointerMove(ptr(250, 150, { altKey: true }))
    ed.pointerMove(ptr(250, 50, { altKey: true }))
    expect(ed.pendingEraseIds).toEqual([a.id])
    ed.pointerUp(ptr(250, 50))
    expect(get(ed, a.id).isDeleted).toBe(true)
    expect(get(ed, b.id).isDeleted).toBe(false)
  })

  test("grouped elements are marked and erased together; Escape drops the marks", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "ellipse", [500, 500], [600, 600])
    ed.selectElements([a.id, b.id])
    ed.group()
    ed.setTool("eraser")
    ed.pointerDown(ptr(0, 50))
    expect(new Set(ed.pendingEraseIds)).toEqual(new Set([a.id, b.id]))
    ed.keyDown(key("Escape"))
    expect(ed.pendingEraseIds).toEqual([])
    expect(live(ed)).toHaveLength(2)

    ed.setTool("eraser")
    ed.pointerDown(ptr(0, 50))
    ed.pointerUp(ptr(0, 50))
    expect(live(ed)).toHaveLength(0)
  })
})

describe("snapping while resizing and drawing", () => {
  const withNeighbour = () => {
    const ed = new EditorCore()
    const other = drawShape(ed, "rectangle", [200, 0], [300, 100])
    ed.toggleSnap()
    return { ed, other }
  }

  test("a resize handle snaps to another shape's edge and shows the guide", () => {
    const { ed } = withNeighbour()
    ed.toggleSnap()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.toggleSnap()
    ed.pointerDown(ptr(106, 106))
    ed.pointerMove(ptr(150, 140))
    ed.pointerMove(ptr(203, 150))
    expect(get(ed, a.id).width).toBe(200)
    expect(ed.snapLines.some((l) => l.axis === "x" && l.at === 200)).toBe(true)
    ed.pointerUp(ptr(203, 150))
    expect(ed.snapLines).toEqual([])
    expect(get(ed, a.id).height).toBe(144)
  })

  test("Cmd held while resizing turns snapping off", () => {
    const { ed } = withNeighbour()
    ed.toggleSnap()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.toggleSnap()
    ed.pointerDown(ptr(106, 106, { metaKey: true }))
    ed.pointerMove(ptr(203, 150, { metaKey: true }))
    ed.pointerUp(ptr(203, 150, { metaKey: true }))
    expect(get(ed, a.id).width).toBe(197)
  })

  test("the corner of a shape being drawn and the end of a line snap to other shapes", () => {
    const { ed } = withNeighbour()
    const rect = drawShape(ed, "rectangle", [0, 200], [197, 300])
    expect(rect.x + rect.width).toBe(200)
    ed.setTool("line")
    drag(ed, [0, 400], [247, 500])
    const line = live(ed).find((e) => e.type === "line")!
    expect(absolutePointsOf(line as LineElement).at(-1)).toEqual([250, 500])
    expect(ed.snapLines).toEqual([])
  })

  test("a vertex dragged in the line editor snaps too", () => {
    const { ed } = withNeighbour()
    ed.setTool("line")
    drag(ed, [0, 300], [100, 400])
    const line = live(ed).find((e) => e.type === "line")!
    ed.keyDown(key("Enter"))
    expect(ed.appState.editingLinearElementId).toBe(line.id)
    drag(ed, [100, 400], [296, 380])
    expect(absolutePointsOf(get<LineElement>(ed, line.id)).at(-1)).toEqual([300, 380])
  })

  test("the grid size is configurable and the toggle remembers it", () => {
    const ed = new EditorCore()
    ed.setGridSize(32)
    expect(ed.appState.gridSize).toBe(32)
    ed.toggleGrid()
    expect(ed.appState.gridSize).toBeNull()
    ed.toggleGrid()
    expect(ed.appState.gridSize).toBe(32)
    ed.setGridSize(1)
    expect(ed.appState.gridSize).toBe(4)
    ed.setGridSize(null)
    expect(ed.appState.gridSize).toBeNull()
    const rect = drawShape(ed, "rectangle", [3, 3], [57, 57])
    expect([rect.x, rect.width]).toEqual([3, 54])
    ed.setGridSize(25)
    const snapped = drawShape(ed, "rectangle", [3, 3], [57, 57])
    expect([snapped.x, snapped.width]).toEqual([0, 50])
  })
})

describe("undoable reset and canvas colour", () => {
  test("Reset canvas clears everything as one step that undo restores", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const label = addLabel(ed, a, "a")
    const frame = drawShape(ed, "frame", [-50, -50], [300, 300])
    ed.setViewBackgroundColor("#fff3bf")
    const depth = undoDepth(ed)
    ed.resetCanvas()
    expect(live(ed)).toEqual([])
    expect(ed.appState.viewBackgroundColor).toBe("#ffffff")
    expect(undoDepth(ed)).toBe(depth + 1)
    ed.undo()
    expect(
      live(ed)
        .map((e) => e.id)
        .sort(),
    ).toEqual([a.id, label, frame.id].sort())
    expect(ed.appState.viewBackgroundColor).toBe("#fff3bf")
  })

  test("the canvas colour is an undo step, and a picker drag in one transaction is one step", () => {
    const ed = new EditorCore()
    expect(ed.history.canUndo()).toBe(false)
    ed.setViewBackgroundColor("#e7f5ff")
    expect(ed.history.canUndo()).toBe(true)
    ed.undo()
    expect(ed.appState.viewBackgroundColor).toBe("#ffffff")
    ed.redo()
    expect(ed.appState.viewBackgroundColor).toBe("#e7f5ff")

    const depth = undoDepth(ed)
    ed.beginTransaction()
    ed.setViewBackgroundColor("#ffe3e3")
    ed.setViewBackgroundColor("#fff3bf")
    ed.commitTransaction()
    expect(undoDepth(ed)).toBe(depth + 1)
    ed.undo()
    expect(ed.appState.viewBackgroundColor).toBe("#e7f5ff")

    ed.beginTransaction()
    ed.setViewBackgroundColor("#000000")
    ed.rollbackTransaction()
    expect(ed.appState.viewBackgroundColor).toBe("#e7f5ff")
    ed.setViewBackgroundColor("#e7f5ff")
    expect(undoDepth(ed)).toBe(depth)
  })
})

describe("closed lines bind and carry labels", () => {
  test("a closed line is bindable and labelable; an open one is neither", () => {
    const open = newElement("line", { polygon: false })
    const closed = newElement("line", { polygon: true })
    expect(isBindableElement(closed)).toBe(true)
    expect(canHaveLabel(closed)).toBe(true)
    expect(isBindableElement(open)).toBe(false)
    expect(canHaveLabel(open)).toBe(false)
  })

  test("a triangle takes a label at its centroid and an arrow on its outline, and both follow it", () => {
    const ed = new EditorCore()
    const tri = triangle(ed)
    expect(ed.keyDown(key("Enter"))).toBe(true)
    const labelId = ed.appState.editingTextId!
    ed.commitText(labelId, "Hi")
    const label = get<TextElement>(ed, labelId)
    expect(label.containerId).toBe(tri.id)
    expect(centre(label)[0]).toBeCloseTo(150)
    expect(centre(label)[1]).toBeCloseTo(160)

    const arrow = drawArrow(ed, [-200, 160], [150, 160])
    expect(arrow.endBinding?.elementId).toBe(tri.id)
    const tip = absolutePointsOf(arrow).at(-1)!
    // the left side crosses y=160 at x=50
    expect(tip[0]).toBeLessThan(50)
    expect(tip[0]).toBeGreaterThan(30)
    expect(
      get(ed, tri.id)
        .boundElements?.map((b) => b.id)
        .sort(),
    ).toEqual([arrow.id, labelId].sort())

    ed.selectElements([tri.id])
    ed.nudge(0, 20)
    expect(centre(get(ed, labelId))[1]).toBeCloseTo(180)
    const moved = get<ArrowElement>(ed, arrow.id)
    expect(moved.endBinding?.elementId).toBe(tri.id)
    // still just outside the (moved) left side, which runs from (150, 20) to (0, 260)
    const [x, y] = absolutePointsOf(moved).at(-1)!
    const sideX = 150 - (150 * (y - 20)) / 240
    expect(sideX - x).toBeGreaterThan(0)
    expect(sideX - x).toBeLessThan(20)
  })

  test("double-clicking a triangle's edge labels it; its corners still open point editing", () => {
    const ed = new EditorCore()
    const tri = triangle(ed)
    ed.doubleClick(ptr(75, 120))
    expect(ed.appState.editingTextId).not.toBeNull()
    ed.cancelText(ed.appState.editingTextId!)
    ed.doubleClick(ptr(300, 240))
    expect(ed.appState.editingLinearElementId).toBe(tri.id)
  })

  test("double-clicking or text-clicking inside an unfilled triangle labels it instead of adding free text", () => {
    const ed = new EditorCore()
    const tri = triangle(ed)
    ed.clearSelection()
    ed.doubleClick(ptr(150, 160))
    const viaDouble = get<TextElement>(ed, ed.appState.editingTextId!)
    expect(viaDouble.containerId).toBe(tri.id)
    ed.cancelText(viaDouble.id)

    ed.setTool("text")
    click(ed, 150, 160)
    expect(get<TextElement>(ed, ed.appState.editingTextId!).containerId).toBe(tri.id)
  })

  test("the label hit tolerance around an arrow is constant on screen", () => {
    const ed = new EditorCore()
    const arrow = newElement("arrow", {
      x: 0,
      y: 0,
      width: 200,
      height: 0,
      points: [
        [0, 0],
        [200, 0],
      ],
    })
    ed.loadScene([arrow])
    const labelsArrow = (zoom: number, dy: number): boolean => {
      ed.setAppState({ viewport: { zoom, scrollX: 0, scrollY: 0 } })
      ed.setTool("text")
      click(ed, 100, dy)
      const id = ed.appState.editingTextId!
      const labelled = get<TextElement>(ed, id).containerId === arrow.id
      ed.cancelText(id)
      return labelled
    }
    expect(labelsArrow(1, 6)).toBe(true)
    expect(labelsArrow(4, 6)).toBe(false)
    expect(labelsArrow(4, 2)).toBe(true)
  })

  test("reshaping a triangle moves its label; opening it frees the label and its arrows", () => {
    const ed = new EditorCore()
    const tri = triangle(ed)
    const labelId = addLabel(ed, tri, "Tri")
    const arrow = drawArrow(ed, [-200, 160], [150, 160])
    ed.selectElements([tri.id])
    ed.keyDown(key("Enter", { metaKey: true }))
    expect(ed.appState.editingLinearElementId).toBe(tri.id)
    drag(ed, [300, 240], [450, 240])
    expect(centre(get(ed, labelId))[0]).toBeCloseTo(200)

    click(ed, 0, 240)
    ed.keyDown(key("Delete"))
    const opened = get<LineElement>(ed, tri.id)
    expect(opened.polygon).toBe(false)
    expect(get<TextElement>(ed, labelId).containerId).toBeNull()
    expect(get<TextElement>(ed, labelId).isDeleted).toBe(false)
    expect(get<ArrowElement>(ed, arrow.id).endBinding).toBeNull()
    expect(opened.boundElements ?? []).toEqual([])
  })
})

describe("presenting frames as slides", () => {
  const board = () => {
    const ed = new EditorCore()
    ed.setViewportSize(1000, 600)
    const frames = [0, 1, 2].map((i) =>
      newElement("frame", { x: i * 1000, y: 0, width: 800, height: 450, name: `Slide ${i + 1}` }),
    )
    ed.loadScene([newElement("rectangle", { x: 5000, y: 5000, width: 10, height: 10 }), ...frames])
    ed.setAppState({ viewport: { zoom: 1, scrollX: 12, scrollY: 34 } })
    return { ed, frames }
  }
  const centreOnScreen = (ed: EditorCore, el: NibElement) =>
    sceneToScreen([el.x + el.width / 2, el.y + el.height / 2], ed.appState.viewport)

  test("frames play in order, each fitted to the canvas, in view mode", () => {
    const { ed, frames } = board()
    expect(ed.startPresentation()).toBe(true)
    expect(ed.appState.viewMode).toBe(true)
    expect(ed.presentation).toEqual({ frameIds: frames.map((f) => f.id), index: 0 })
    const [cx, cy] = centreOnScreen(ed, frames[0]!)
    expect(cx).toBeCloseTo(500)
    expect(cy).toBeCloseTo(300)
    // the slide fills the canvas less a margin, and may zoom past 100%
    expect(ed.appState.viewport.zoom).toBeCloseTo(Math.min(952 / 800, 552 / 450))

    expect(ed.keyDown(key("ArrowRight"))).toBe(true)
    expect(ed.presentation!.index).toBe(1)
    expect(centreOnScreen(ed, frames[1]!)[0]).toBeCloseTo(500)
    ed.keyDown(key(" "))
    ed.keyDown(key("PageDown"))
    expect(ed.presentation!.index).toBe(2)
    ed.keyDown(key("Home"))
    expect(ed.presentation!.index).toBe(0)
    ed.keyDown(key("End"))
    ed.keyDown(key("ArrowLeft"))
    expect(ed.presentation!.index).toBe(1)
  })

  test("each slide fits the space the host's slide controls leave free", () => {
    const { ed, frames } = board()
    ed.slideInsets = { top: 0, right: 0, bottom: 72, left: 0 }
    ed.startPresentation()
    const [cx, cy] = centreOnScreen(ed, frames[0]!)
    expect(cx).toBeCloseTo(500)
    expect(cy).toBeCloseTo((600 - 72) / 2)
    expect(ed.appState.viewport.zoom).toBeCloseTo(Math.min(952 / 800, (600 - 72 - 48) / 450))
  })

  test("Escape ends the show and puts the view back", () => {
    const { ed } = board()
    ed.startPresentation()
    ed.nextSlide()
    expect(ed.keyDown(key("Escape"))).toBe(true)
    expect(ed.presentation).toBeNull()
    expect(ed.appState.viewMode).toBe(false)
    expect(ed.appState.viewport).toEqual({ zoom: 1, scrollX: 12, scrollY: 34 })
  })

  test("it starts from the selected frame, refits when the canvas resizes, and needs a frame", () => {
    const { ed, frames } = board()
    ed.selectElements([frames[2]!.id])
    ed.startPresentation()
    expect(ed.presentation!.index).toBe(2)
    ed.setViewportSize(500, 300)
    expect(centreOnScreen(ed, frames[2]!)[0]).toBeCloseTo(250)
    ed.loadScene([])
    expect(ed.presentation).toBeNull()
    expect(ed.startPresentation()).toBe(false)
  })

  test("the laser stays available and leaving view mode by hand ends the show", () => {
    const { ed } = board()
    ed.startPresentation()
    ed.keyDown(key("k"))
    expect(ed.appState.activeTool).toBe("laser")
    ed.toggleViewMode()
    expect(ed.presentation).toBeNull()
  })
})

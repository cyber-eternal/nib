import { EditorCore, type NibElement, type ToolType, newElement } from "@nib/core"
import { describe, expect, it } from "vitest"
import {
  EMPTY_HINT,
  HINT_MAX_SHOWS,
  HINT_PREF_PREFIX,
  HintCounter,
  contextualHint,
  correctionKind,
  correctionMessage,
  showEmptyHint,
} from "../../src/ui/shell/hints"
import { styleModel } from "../../src/ui/style/model"
import { memoryPrefs } from "./helpers"

const ptr = (x: number, y: number) => ({
  scene: [x, y] as const,
  screen: [x, y] as const,
  buttons: 1,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  pressure: 0.5,
  detail: 1,
})

const fresh = { elementCount: 0, canUndo: false, viewMode: false, presenting: false, editingText: false }

describe("the empty-board hint", () => {
  it("shows on a fresh, empty board with the brief's words", () => {
    expect(showEmptyHint(fresh)).toBe(true)
    expect(EMPTY_HINT).toBe(
      "Pick a marker below, or press R for a box, A for an arrow, P for the pencil that tidies your shapes.",
    )
  })

  it("goes with the first element and never returns for that document", () => {
    expect(showEmptyHint({ ...fresh, elementCount: 1, canUndo: true })).toBe(false)
    // everything deleted again: the history still remembers there was work
    expect(showEmptyHint({ ...fresh, elementCount: 0, canUndo: true })).toBe(false)
  })

  it("stays out of view mode, slide shows and text editing", () => {
    expect(showEmptyHint({ ...fresh, viewMode: true })).toBe(false)
    expect(showEmptyHint({ ...fresh, presenting: true })).toBe(false)
    expect(showEmptyHint({ ...fresh, editingText: true })).toBe(false)
  })
})

const ctx = (over: Partial<Parameters<typeof contextualHint>[0]> = {}) => ({
  activeTool: "selection" as const,
  selection: [] as NibElement[],
  editingLinear: false,
  editingText: false,
  viewMode: false,
  mac: true,
  ...over,
})

describe("contextual hints", () => {
  it("the pencil explains its correction and the Alt escape hatch", () => {
    expect(contextualHint(ctx({ activeTool: "pencil" }))?.text).toContain("⌥")
    expect(contextualHint(ctx({ activeTool: "pencil", mac: false }))?.text).toContain("Alt")
  })

  it("a lone unlabelled shape offers Enter for a label; a labelled one does not", () => {
    const rect = newElement("rectangle", { x: 0, y: 0, width: 50, height: 40 })
    expect(contextualHint(ctx({ selection: [rect] }))?.id).toBe("label")
    const labelled = { ...rect, boundElements: [{ id: "t", type: "text" as const }] }
    expect(contextualHint(ctx({ selection: [labelled] }))).toBeNull()
    expect(contextualHint(ctx({ selection: [rect, rect] }))).toBeNull()
    const core = new EditorCore()
    core.setTool("parallelogram")
    core.pointerDown(ptr(0, 0))
    core.pointerMove(ptr(200, 100))
    core.pointerUp(ptr(200, 100))
    expect(contextualHint(ctx({ selection: core.selectedElements() }))?.id).toBe("label")
  })

  it("is quiet while typing, in view mode and for plain selection", () => {
    expect(contextualHint(ctx())).toBeNull()
    expect(contextualHint(ctx({ activeTool: "arrow", editingText: true }))).toBeNull()
    expect(contextualHint(ctx({ activeTool: "arrow", viewMode: true }))).toBeNull()
  })

  it("the line editor has its own hint", () => {
    expect(contextualHint(ctx({ editingLinear: true }))?.id).toBe("linePoints")
  })
})

describe("one-time hints are counted in prefs", () => {
  it("each hint shows at most HINT_MAX_SHOWS times, across sessions", () => {
    const prefs = memoryPrefs()
    const counter = new HintCounter(prefs)
    for (let i = 0; i < HINT_MAX_SHOWS; i++) expect(counter.use("pencilSnap")).toBe(true)
    expect(counter.use("pencilSnap")).toBe(false)
    expect(new HintCounter(prefs).canShow("pencilSnap")).toBe(false)
    expect(prefs.get(`${HINT_PREF_PREFIX}pencilSnap`)).toBe(String(HINT_MAX_SHOWS))
    expect(counter.canShow("arrow")).toBe(true)
  })

  it("a garbled count starts over rather than blocking the hint", () => {
    expect(new HintCounter(memoryPrefs({ [`${HINT_PREF_PREFIX}x`]: "lots" })).count("x")).toBe(0)
  })
})

describe("the pencil's correction toast", () => {
  it("names what the stroke became", () => {
    expect(correctionKind(newElement("ellipse", { x: 0, y: 0, width: 100, height: 96 }))).toBe("circle")
    expect(correctionKind(newElement("ellipse", { x: 0, y: 0, width: 100, height: 50 }))).toBe("ellipse")
    expect(correctionKind(newElement("rectangle", { x: 0, y: 0, width: 80, height: 80 }))).toBe("square")
    expect(correctionKind(newElement("diamond", { x: 0, y: 0, width: 80, height: 40 }))).toBe("diamond")
    expect(correctionKind(newElement("arrow", { x: 0, y: 0 }))).toBe("arrow")
    expect(correctionKind(newElement("line", { x: 0, y: 0 }))).toBe("line")
    const closed = (points: [number, number][]) =>
      newElement("line", { x: 0, y: 0, polygon: true, points: [...points, points[0]!] })
    expect(
      correctionKind(
        closed([
          [40, 0],
          [200, 0],
          [160, 100],
          [0, 100],
        ]),
      ),
    ).toBe("parallelogram")
    expect(
      correctionKind(
        closed([
          [40, 0],
          [200, 0],
          [200, 100],
          [0, 100],
        ]),
      ),
    ).toBe("shape")
    expect(
      correctionKind(
        closed([
          [50, 0],
          [100, 100],
          [0, 100],
        ]),
      ),
    ).toBe("triangle")
    expect(correctionKind(undefined)).toBeNull()
  })

  it("reads like the brief", () => {
    expect(correctionMessage("circle", true)).toBe("Snapped to circle · ⌘Z keeps your stroke")
    expect(correctionMessage("square", false)).toBe("Snapped to square · Ctrl+Z keeps your stroke")
  })
})

describe("the style bar's visibility, which lifts the bottom stack", () => {
  // the shell reads the bar's own rule, so the stack never rises over a bar that is not there
  const shown = (tool: ToolType, opts: { select?: boolean; view?: boolean } = {}): boolean => {
    const core = new EditorCore()
    core.setTool(tool)
    if (opts.select) {
      const rect = newElement("rectangle", { x: 0, y: 0, width: 40, height: 40 })
      core.scene.replaceAll([rect])
      core.selectElements([rect.id])
    }
    if (opts.view) core.toggleViewMode()
    return styleModel(core) !== null
  }

  it("shows for a drawing tool or a selection, never in view mode", () => {
    expect(shown("selection")).toBe(false)
    expect(shown("selection", { select: true })).toBe(true)
    expect(shown("rectangle")).toBe(true)
    expect(shown("pencil")).toBe(true)
    expect(shown("hand")).toBe(false)
    expect(shown("eraser")).toBe(false)
    expect(shown("laser")).toBe(false)
    expect(shown("frame")).toBe(false)
    expect(shown("selection", { select: true, view: true })).toBe(false)
  })
})

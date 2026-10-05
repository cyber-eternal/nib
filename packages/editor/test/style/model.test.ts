import { EditorCore, type NibElement, newElement } from "@nib/core"
import { describe, expect, it, vi } from "vitest"
import {
  MIXED,
  common,
  groupsForSelection,
  modelForSelection,
  selectionUnits,
  styleModel,
} from "../../src/ui/style/model"
import { readStyleModel } from "../../src/ui/style/useStyleModel"

const coreWith = (els: NibElement[], select: string[] = els.map((e) => e.id)): EditorCore => {
  const core = new EditorCore()
  for (const el of els) core.scene.insert({ ...el, index: core.scene.nextIndex() })
  core.selectElements(select)
  return core
}

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

const rect = (patch: Record<string, unknown> = {}) =>
  newElement("rectangle", { x: 0, y: 0, width: 50, height: 50, ...patch } as never)

const line = (patch: Record<string, unknown> = {}) =>
  newElement("line", {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    points: [
      [0, 0],
      [100, 0],
      [100, 100],
    ],
    ...patch,
  } as never)

const arrow = (patch: Record<string, unknown> = {}) =>
  newElement("arrow", {
    x: 0,
    y: 0,
    width: 100,
    height: 0,
    points: [
      [0, 0],
      [100, 0],
    ],
    ...patch,
  } as never)

/** A rectangle with a bound label, linked both ways as core stores it. */
const labelled = () => {
  const box = rect()
  const label = newElement("text", {
    x: 10,
    y: 10,
    width: 30,
    height: 20,
    text: "Hi",
    originalText: "Hi",
    containerId: box.id,
  } as never)
  return [{ ...box, boundElements: [{ id: label.id, type: "text" as const }] }, label] as const
}

const groups = (core: EditorCore) => styleModel(core)?.groups ?? []

describe("common (mixed state)", () => {
  it("returns the shared value, MIXED on disagreement, the fallback when empty", () => {
    expect(common([2, 2, 2], 9)).toBe(2)
    expect(common([1, 4], 9)).toBe(MIXED)
    expect(common([], 9)).toBe(9)
  })
})

describe("group visibility", () => {
  it("hides the bar for Select with nothing selected, and always for Hand, Eraser and Laser", () => {
    const core = new EditorCore()
    expect(styleModel(core)).toBeNull()
    for (const tool of ["hand", "eraser", "laser"] as const) {
      const c = coreWith([rect()])
      c.setAppState({ activeTool: tool })
      expect(styleModel(c)).toBeNull()
    }
  })

  it("shows the next element's defaults for a drawing tool", () => {
    const core = new EditorCore()
    core.setAppState({ activeTool: "rectangle" })
    const m = styleModel(core)!
    expect(m.source).toBe("tool")
    expect(m.groups).toEqual(["strokeColor", "fill", "stroke", "edges", "opacity"])
    core.setAppState({ activeTool: "freedraw" })
    expect(groups(core)).toEqual(["strokeColor", "stroke", "opacity"])
    expect(styleModel(core)!.showStrokeStyle).toBe(false)
    core.setAppState({ activeTool: "pencil" })
    expect(groups(core)).toContain("fill")
    core.setAppState({ activeTool: "arrow" })
    expect(groups(core)).toEqual(["strokeColor", "stroke", "arrow", "opacity"])
    core.setAppState({ activeTool: "text" })
    expect(groups(core)).toEqual(["strokeColor", "text", "opacity"])
  })

  it("shows nothing for image, frame and lasso tools without a selection", () => {
    for (const tool of ["image", "frame", "lasso"] as const) {
      const core = new EditorCore()
      core.setAppState({ activeTool: tool })
      expect(styleModel(core)).toBeNull()
    }
  })

  it("never offers Edges for arrows; Arrow type covers it", () => {
    expect(groups(coreWith([arrow()]))).not.toContain("edges")
    expect(groups(coreWith([arrow()]))).toContain("arrow")
    expect(groups(coreWith([rect(), arrow()]))).toContain("edges")
  })

  it("hides dead controls: frames, images and freehand ink", () => {
    const frame = newElement("frame", { x: 0, y: 0, width: 200, height: 200 } as never)
    expect(groups(coreWith([frame]))).toEqual(["opacity", "arrange", "more"])
    const image = newElement("image", { x: 0, y: 0, width: 20, height: 20 } as never)
    expect(groups(coreWith([image]))).toEqual(["opacity", "arrange", "more"])
    const ink = newElement("freedraw", {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      points: [
        [0, 0],
        [10, 10],
      ],
      pressures: [],
    } as never)
    const m = styleModel(coreWith([ink]))!
    expect(m.groups).not.toContain("fill")
    expect(m.groups).toContain("stroke")
    expect(m.showStrokeStyle).toBe(false)
  })

  it("offers background and fill only for closed lines", () => {
    expect(groups(coreWith([line()]))).not.toContain("fill")
    expect(groups(coreWith([line()]))).toContain("closed")
    expect(groups(coreWith([arrow()]))).not.toContain("fill")
    const closed = line({
      polygon: true,
      points: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 0],
      ],
    })
    expect(groups(coreWith([closed]))).toContain("fill")
    expect(styleModel(coreWith([closed]))!.closed).toBe(true)
  })

  it("disables Closed shape for a two-point line", () => {
    const two = line({
      points: [
        [0, 0],
        [100, 0],
      ],
    })
    expect(styleModel(coreWith([two]))!.canClose).toBe(false)
    expect(styleModel(coreWith([line()]))!.canClose).toBe(true)
  })

  it("shows Text for a labelled shape, and vertical align only for labels in a box", () => {
    const [box, label] = labelled()
    const core = coreWith([box, label], [box.id])
    const m = styleModel(core)!
    expect(m.groups).toContain("text")
    expect(m.showVerticalAlign).toBe(true)
    const free = newElement("text", {
      x: 0,
      y: 0,
      width: 30,
      height: 20,
      text: "a",
      originalText: "a",
    } as never)
    expect(styleModel(coreWith([free]))!.showVerticalAlign).toBe(false)
  })
})

describe("align, distribute and group ignore bound text", () => {
  it("a single labelled shape is one unit: no align, distribute or group", () => {
    const [box, label] = labelled()
    const core = coreWith([box, label], [box.id])
    const a = styleModel(core)!.arrange
    expect(a.units).toBe(1)
    expect(a.canAlign).toBe(false)
    expect(a.canDistribute).toBe(false)
    expect(a.canGroup).toBe(false)
  })

  it("counts a group as one unit and offers Ungroup for it", () => {
    const g = "g1"
    const a = rect({ groupIds: [g] })
    const b = rect({ x: 100, groupIds: [g] })
    const core = coreWith([a, b], [a.id])
    const arrange = styleModel(core)!.arrange
    expect(arrange.count).toBe(2)
    expect(arrange.units).toBe(1)
    expect(arrange.canGroup).toBe(false)
    expect(arrange.canUngroup).toBe(true)
    expect(arrange.canAlign).toBe(false)
  })

  it("two loose shapes can align and group; three can distribute", () => {
    const two = styleModel(coreWith([rect(), rect({ x: 100 })]))!.arrange
    expect(two.canAlign).toBe(true)
    expect(two.canGroup).toBe(true)
    expect(two.canDistribute).toBe(false)
    expect(two.canUngroup).toBe(false)
    const three = styleModel(coreWith([rect(), rect({ x: 100 }), rect({ x: 200 })]))!.arrange
    expect(three.canDistribute).toBe(true)
  })

  it("selectionUnits treats elements of one outer group as one", () => {
    const els = [rect({ groupIds: ["a", "outer"] }), rect({ groupIds: ["b", "outer"] }), rect()]
    expect(selectionUnits(els, null)).toBe(2)
    expect(selectionUnits(els, "outer")).toBe(3)
  })
})

describe("mixed state for mixed selections", () => {
  it("reports MIXED instead of the first element's value", () => {
    const m = styleModel(
      coreWith([
        rect({ strokeWidth: 1, roughness: 0, strokeColor: "#e03131", opacity: 40 }),
        rect({ x: 100, strokeWidth: 4, roughness: 2, strokeColor: "#1971c2", opacity: 100 }),
      ]),
    )!
    expect(m.strokeWidth).toBe(MIXED)
    expect(m.roughness).toBe(MIXED)
    expect(m.strokeColor).toBe(MIXED)
    expect(m.opacity).toBe(MIXED)
  })

  it("reads shared values, case-insensitively for colours", () => {
    const m = styleModel(
      coreWith([rect({ strokeColor: "#E03131" }), rect({ x: 100, strokeColor: "#e03131" })]),
    )!
    expect(m.strokeColor).toBe("#e03131")
  })

  it("reads stroke style only from elements that draw one", () => {
    const ink = newElement("freedraw", {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      points: [
        [0, 0],
        [10, 10],
      ],
      pressures: [],
      strokeStyle: "dotted",
    } as never)
    const m = styleModel(coreWith([rect({ strokeStyle: "dashed" }), ink]))!
    expect(m.strokeStyle).toBe("dashed")
  })

  it("mixes arrow types and arrowheads across arrows only", () => {
    const m = styleModel(
      coreWith([
        arrow({ roundness: null, endArrowhead: "arrow" }),
        arrow({ y: 50, roundness: { type: 2 }, endArrowhead: "triangle" }),
        rect({ roundness: { type: 3 } }),
      ]),
    )!
    expect(m.arrowType).toBe(MIXED)
    expect(m.endArrowhead).toBe(MIXED)
    expect(m.edges).toBe("round")
  })

  it("keeps the fill row present but disabled while every fill is transparent", () => {
    const m = styleModel(coreWith([rect({ backgroundColor: "transparent" })]))!
    expect(m.groups).toContain("fill")
    expect(m.fillEnabled).toBe(false)
    expect(styleModel(coreWith([rect({ backgroundColor: "#ffc9c9" })]))!.fillEnabled).toBe(true)
  })

  it("reports lock state for a selected locked element", () => {
    const locked = rect({ locked: true })
    const core = new EditorCore()
    core.scene.insert({ ...locked, index: core.scene.nextIndex() })
    core.setAppState({ selectedElementIds: { [locked.id]: true } })
    const a = styleModel(core)!.arrange
    expect(a.locked).toBe(true)
    expect(a.singleId).toBe(locked.id)
  })
})

describe("groupsForSelection is pure", () => {
  it("drives visibility from the selection without labels", () => {
    const [box, label] = labelled()
    const out = groupsForSelection({
      selected: [box],
      withText: [box, label],
      appState: new EditorCore().appState,
      getElement: (id) => (id === box.id ? box : undefined),
    })
    expect(out).toEqual(["strokeColor", "fill", "stroke", "edges", "text", "opacity", "arrange", "more"])
    const m = modelForSelection({
      selected: [box],
      withText: [box, label],
      appState: new EditorCore().appState,
      getElement: () => undefined,
    })
    expect(m.arrange.count).toBe(1)
  })
})

describe("Edges and closed lines", () => {
  const closedLine = () =>
    line({
      polygon: true,
      roundness: { type: 2 },
      points: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 0],
      ],
    })

  it("treats a drawn parallelogram as a closed shape: Fill, Closed on, no Edges", () => {
    const core = new EditorCore()
    core.setTool("parallelogram")
    expect(styleModel(core)!.groups).toEqual(["strokeColor", "fill", "stroke", "opacity"])
    core.pointerDown(ptr(0, 0))
    core.pointerMove(ptr(200, 100))
    core.pointerUp(ptr(200, 100))
    const m = styleModel(core)!
    expect(m.groups).toEqual(expect.arrayContaining(["fill", "closed"]))
    expect(m.groups).not.toContain("edges")
    expect(m.closed).toBe(true)
    expect(m.canClose).toBe(true)
  })

  it("offers no Edges for a closed line, which always draws straight", () => {
    expect(groups(coreWith([closedLine()]))).not.toContain("edges")
    expect(groups(coreWith([line()]))).toContain("edges")
  })

  it("reads a mixed selection's Edges from the shapes it can change", () => {
    const m = styleModel(coreWith([rect({ roundness: null }), closedLine()]))!
    expect(m.groups).toContain("edges")
    expect(m.edges).toBe("sharp")
  })
})

describe("readStyleModel", () => {
  it("computes the model once per change however many readers ask", () => {
    const core = coreWith([rect()])
    const spy = vi.spyOn(core, "selectedElements")
    const first = readStyleModel(core)
    const calls = spy.mock.calls.length
    expect(calls).toBeGreaterThan(0)
    expect(readStyleModel(core)).toBe(first)
    expect(readStyleModel(core)).toBe(first)
    expect(spy.mock.calls.length).toBe(calls)
  })

  it("keeps the same model object through changes the bar does not show", () => {
    const core = coreWith([rect()])
    const before = readStyleModel(core)
    core.setAppState({ viewport: { ...core.appState.viewport, scrollX: 40 } })
    expect(readStyleModel(core)).toBe(before)
    core.setAppState({ currentItemOpacity: 40, selectedElementIds: {} })
    expect(readStyleModel(core)).toBeNull()
  })
})

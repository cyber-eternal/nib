import { EditorCore, type NibElement, newElement } from "@nib/core"
import { describe, expect, it } from "vitest"
import { applyStyle } from "../../src/ui/style/apply"

const coreWith = (els: NibElement[]): EditorCore => {
  const core = new EditorCore()
  for (const el of els) core.scene.insert({ ...el, index: core.scene.nextIndex() })
  core.selectElements(els.map((e) => e.id))
  return core
}

const rect = (patch: Record<string, unknown> = {}) =>
  newElement("rectangle", { x: 0, y: 0, width: 50, height: 50, ...patch } as never)

const arrow = (patch: Record<string, unknown> = {}) =>
  newElement("arrow", {
    x: 0,
    y: 100,
    width: 100,
    height: 50,
    points: [
      [0, 0],
      [50, 50],
      [100, 0],
    ],
    roundness: { type: 2 },
    ...patch,
  } as never)

const openLine = () =>
  newElement("line", {
    x: 0,
    y: 200,
    width: 100,
    height: 0,
    points: [
      [0, 0],
      [100, 0],
    ],
  } as never)

const get = (core: EditorCore, id: string) => core.scene.get(id)!

describe("applyStyle touches only the elements a property means something for", () => {
  it("Edges leaves arrows alone and keeps the selection", () => {
    const r = rect({ roundness: { type: 3 } })
    const a = arrow()
    const core = coreWith([r, a])
    const before = core.appState.selectedElementIds
    applyStyle(core, { roundness: null })
    expect(get(core, r.id).roundness).toBeNull()
    expect(get(core, a.id).roundness).toEqual({ type: 2 })
    expect(core.appState.selectedElementIds).toEqual(before)
    expect(core.appState.currentItemRoundness).toBe("sharp")
  })

  it("is one undo step even when it narrows the selection", () => {
    const r = rect({ roundness: { type: 3 } })
    const a = arrow()
    const core = coreWith([r, a])
    applyStyle(core, { roundness: null })
    core.undo()
    expect(get(core, r.id).roundness).toEqual({ type: 3 })
    expect(core.history.canUndo()).toBe(false)
  })

  it("a fill colour never lands on open lines or arrows", () => {
    const r = rect()
    const a = arrow()
    const l = openLine()
    const core = coreWith([r, a, l])
    applyStyle(core, { backgroundColor: "#ffc9c9" })
    expect(get(core, r.id).backgroundColor).toBe("#ffc9c9")
    expect(get(core, a.id).backgroundColor).toBe("transparent")
    expect(get(core, l.id).backgroundColor).toBe("transparent")
  })

  it("a stroke colour skips frames and images", () => {
    const frame = newElement("frame", { x: 0, y: 0, width: 300, height: 300 } as never)
    const r = rect()
    const core = coreWith([frame, r])
    const before = get(core, frame.id).strokeColor
    applyStyle(core, { strokeColor: "#e03131" })
    expect(get(core, r.id).strokeColor).toBe("#e03131")
    expect(get(core, frame.id).strokeColor).toBe(before)
  })

  it("with nothing selected it only sets the next element's defaults", () => {
    const core = new EditorCore()
    applyStyle(core, { strokeWidth: 4 })
    expect(core.appState.currentItemStrokeWidth).toBe(4)
    expect(core.history.canUndo()).toBe(false)
  })

  it("arrow type changes arrows only and never the shape corner default", () => {
    const r = rect({ roundness: { type: 3 } })
    const a = arrow()
    const core = coreWith([r, a])
    core.updateSelectedStyle({ arrowType: "sharp" })
    expect(get(core, r.id).roundness).toEqual({ type: 3 })
    expect(get(core, a.id).roundness).toBeNull()
    expect(core.appState.currentItemRoundness).toBe("round")
  })

  it("Closed shape closes a line and makes it fillable", () => {
    const l = newElement("line", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      points: [
        [0, 0],
        [100, 0],
        [100, 100],
      ],
    } as never)
    const core = coreWith([l])
    applyStyle(core, { polygon: true })
    const closed = get(core, l.id)
    expect(closed.type === "line" && closed.polygon).toBe(true)
    expect(closed.type === "line" && closed.points.length).toBe(4)
  })
})

describe("a slider drag is one history step", () => {
  it("folds every live opacity change between begin and commit into one entry", () => {
    const r = rect({ opacity: 100 })
    const core = coreWith([r])
    core.beginTransaction()
    for (const v of [90, 75, 60, 50]) core.updateSelectedStyle({ opacity: v })
    core.commitTransaction()
    expect(get(core, r.id).opacity).toBe(50)
    core.undo()
    expect(get(core, r.id).opacity).toBe(100)
    expect(core.history.canUndo()).toBe(false)
  })
})

import { describe, expect, test } from "vitest"
import type { ElementsChange } from "../../src/change/elementsChange"
import { EditorCore } from "../../src/editor/editorCore"
import { HISTORY_BYTE_BUDGET, History, estimateChangeBytes } from "../../src/history/history"
import type { Point } from "../../src/math/vector"
import { newElement } from "../../src/model/element"
import type { NibElement } from "../../src/model/types"
import { indicesBetween } from "../../src/model/zindex"

const stroke = (i: number, points: number, index: string): NibElement =>
  newElement("freedraw", {
    id: `s${i}`,
    x: i,
    y: 0,
    index,
    points: Array.from({ length: points }, (_, k): Point => [k, Math.sin(k) * 10]),
    pressures: Array.from({ length: points }, () => 0.5),
  })

const change = (els: readonly NibElement[]): ElementsChange => ({
  before: new Map(els.map((el) => [el.id, { ...el, x: el.x - 1 }])),
  after: new Map(els.map((el) => [el.id, el])),
})

describe("history is capped by size as well as by count", () => {
  test("big entries drop the oldest ones before the budget is exceeded", () => {
    const keys = indicesBetween(null, null, 300)
    const strokes = keys.map((k, i) => stroke(i, 400, k))
    const entry = change(strokes)
    const size = estimateChangeBytes(entry)
    expect(size).toBeGreaterThan(4 * 1024 * 1024)
    const h = new History()
    for (let i = 0; i < 50; i++) h.record(change(strokes))
    expect(h.size).toBeLessThanOrEqual(HISTORY_BYTE_BUDGET)
    const kept = (h as unknown as { undoStack: unknown[] }).undoStack.length
    expect(kept).toBe(Math.floor(HISTORY_BYTE_BUDGET / size))
    expect(kept).toBeLessThan(50)
  })

  test("a single entry over the budget is still kept, so the last step can be undone", () => {
    const keys = indicesBetween(null, null, 2000)
    const h = new History()
    h.record(change(keys.map((k, i) => stroke(i, 1000, k))))
    expect(h.canUndo()).toBe(true)
  })

  test("small edits keep the 500-entry count cap and undo/redo keep the budget accounting", () => {
    const h = new History()
    const el = newElement("rectangle", { id: "r", index: "a0" })
    for (let i = 0; i < 600; i++) h.record(change([{ ...el, x: i }]))
    expect((h as unknown as { undoStack: unknown[] }).undoStack.length).toBe(500)
    const full = h.size
    const ed = new EditorCore()
    ed.loadScene([el])
    h.undo(ed.scene)
    h.undo(ed.scene)
    expect(h.size).toBe(full)
    h.record(change([{ ...el, x: -1 }]))
    // the two undone entries are gone with the redo stack
    expect(h.size).toBeLessThan(full)
    h.clear()
    expect(h.size).toBe(0)
  })

  test("the editor's own history stays inside the budget across many large flips", () => {
    const ed = new EditorCore()
    const keys = indicesBetween(null, null, 120)
    ed.loadScene(keys.map((k, i) => stroke(i, 400, k)))
    ed.selectAll()
    for (let i = 0; i < 60; i++) ed.flip("horizontal")
    expect(ed.history.size).toBeLessThanOrEqual(HISTORY_BYTE_BUDGET)
    expect(ed.history.canUndo()).toBe(true)
  })
})

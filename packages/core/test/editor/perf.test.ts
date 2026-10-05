import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { newElement } from "../../src/model/element"
import type { NibElement } from "../../src/model/types"
import { indicesBetween } from "../../src/model/zindex"
import { ptr, setupMeasurer } from "./helpers"

beforeAll(setupMeasurer)

const grid = (n: number, grouped: boolean): NibElement[] => {
  const keys = indicesBetween(null, null, n)
  return keys.map((index, i) =>
    newElement("rectangle", {
      x: (i % 100) * 30,
      y: Math.floor(i / 100) * 30,
      width: 20,
      height: 20,
      index,
      groupIds: grouped ? [`g${Math.floor(i / 2)}`] : [],
    }),
  )
}

describe("performance", () => {
  test("a marquee over many small groups stays interactive", () => {
    const ed = new EditorCore()
    ed.loadScene(grid(3000, true))
    ed.pointerDown(ptr(-10, -10))
    ed.pointerMove(ptr(1000, 300)) // warm up
    const t0 = performance.now()
    ed.pointerMove(ptr(3100, 1000))
    const elapsed = performance.now() - t0
    ed.pointerUp(ptr(3100, 1000))
    expect(Object.keys(ed.appState.selectedElementIds)).toHaveLength(3000)
    expect(elapsed).toBeLessThan(60)
  })

  test("duplicating many elements keeps fractional indices short", () => {
    const ed = new EditorCore()
    ed.loadScene(grid(300, false))
    ed.selectAll()
    ed.duplicateSelected()
    const longest = Math.max(...ed.scene.getElements().map((e) => e.index.length))
    expect(longest).toBeLessThan(20)
  })
})

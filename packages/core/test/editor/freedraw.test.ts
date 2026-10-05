import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { absolutePointsOf } from "../../src/geometry/linear"
import { ptr, setupMeasurer } from "./helpers"

beforeAll(setupMeasurer)

const stroke = (ed: EditorCore, pts: [number, number][]) => {
  ed.setTool("freedraw")
  ed.pointerDown(ptr(pts[0]![0], pts[0]![1]))
  for (const p of pts.slice(1)) ed.pointerMove(ptr(p[0], p[1]))
  const end = pts[pts.length - 1]!
  ed.pointerUp(ptr(end[0], end[1]))
  const el = ed.scene.getNonDeleted().find((e) => e.type === "freedraw")
  if (!el || el.type !== "freedraw") throw new Error("no stroke")
  return el
}

describe("freedraw tool", () => {
  test("a stroke drawn leftward ends under the pointer", () => {
    const ed = new EditorCore()
    const pts: [number, number][] = [[100, 100]]
    for (let x = 95; x >= 50; x -= 5) pts.push([x, 100])
    const el = stroke(ed, pts)
    const abs = absolutePointsOf(el)
    const tail = abs[abs.length - 1]!
    expect(tail[0]).toBeCloseTo(50)
    expect(tail[1]).toBeCloseTo(100)
    expect(el.x).toBeCloseTo(50)
    expect(el.width).toBeCloseTo(50)
  })

  test("a stroke drawn upward ends under the pointer", () => {
    const ed = new EditorCore()
    const pts: [number, number][] = [[100, 100]]
    for (let y = 90; y >= 20; y -= 10) pts.push([100, y])
    const el = stroke(ed, pts)
    const abs = absolutePointsOf(el)
    for (let i = 0; i < pts.length; i++) {
      expect(abs[i]![0]).toBeCloseTo(pts[i]![0])
      expect(abs[i]![1]).toBeCloseTo(pts[i]![1])
    }
    expect(el.height).toBeCloseTo(80)
  })

  test("the pencil stays active after a stroke, like Excalidraw", () => {
    const ed = new EditorCore()
    stroke(ed, [
      [0, 0],
      [20, 10],
      [40, 30],
    ])
    expect(ed.appState.activeTool).toBe("freedraw")
  })
})

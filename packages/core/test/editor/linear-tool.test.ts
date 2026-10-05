import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { absolutePointsOf } from "../../src/geometry/linear"
import { click, drawArrow, drawShape, key, ptr, setupMeasurer } from "./helpers"

beforeAll(setupMeasurer)

const hover = (ed: EditorCore, x: number, y: number, extra = {}) =>
  ed.pointerMove(ptr(x, y, { buttons: 0, ...extra }))

describe("linear tool", () => {
  test("an arrow discarded with Escape does not bind the next arrow to its start shape", () => {
    const ed = new EditorCore()
    const shape = drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.setTool("arrow")
    click(ed, 50, 50) // starts a connector on the shape
    ed.keyDown(key("Escape")) // nothing was drawn, so it is discarded

    const arrow = drawArrow(ed, [400, 400], [600, 400])
    expect(arrow.startBinding).toBeNull()
    expect(arrow.x).toBeCloseTo(400)
    expect(arrow.y).toBeCloseTo(400)
    expect(ed.scene.get(shape.id)!.boundElements ?? []).toHaveLength(0)
  })

  test("an arrow cancelled mid-drag does not bind the next arrow either", () => {
    const ed = new EditorCore()
    drawShape(ed, "rectangle", [0, 0], [100, 100])
    ed.setTool("arrow")
    ed.pointerDown(ptr(50, 50))
    ed.pointerMove(ptr(200, 60))
    ed.keyDown(key("Escape"))
    ed.pointerUp(ptr(200, 60))

    const arrow = drawArrow(ed, [400, 400], [600, 400])
    expect(arrow.startBinding).toBeNull()
  })

  test("an elbow arrow drawn on empty canvas is routed orthogonally", () => {
    const ed = new EditorCore()
    ed.setAppState({ currentItemArrowType: "elbow" })
    const arrow = drawArrow(ed, [0, 0], [200, 100])
    expect(arrow.elbowed).toBe(true)
    const pts = absolutePointsOf(arrow)
    expect(pts.length).toBeGreaterThan(2)
    for (let i = 1; i < pts.length; i++) {
      const dx = Math.abs(pts[i]![0] - pts[i - 1]![0])
      const dy = Math.abs(pts[i]![1] - pts[i - 1]![1])
      expect(Math.min(dx, dy)).toBeLessThan(0.01)
    }
  })

  test("finishing a polyline with a double click leaves no duplicate final vertex", () => {
    const ed = new EditorCore()
    ed.setTool("arrow")
    click(ed, 0, 0)
    hover(ed, 100, 0)
    click(ed, 100, 0)
    hover(ed, 100, 100)
    // a real double click delivers two clicks, then dblclick
    click(ed, 100, 100)
    click(ed, 100, 100)
    ed.doubleClick(ptr(100, 100))
    const el = ed.scene.getNonDeleted().find((e) => e.type === "arrow")!
    const pts = absolutePointsOf(el as never)
    expect(pts).toHaveLength(3)
    for (let i = 1; i < pts.length; i++) {
      expect(Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1])).toBeGreaterThan(1)
    }
  })

  test("Escape keeps the clicked vertices and drops the floating cursor point", () => {
    const ed = new EditorCore()
    ed.setTool("line")
    click(ed, 0, 0)
    hover(ed, 100, 0)
    click(ed, 100, 0)
    hover(ed, 150, 50)
    ed.keyDown(key("Escape"))
    const el = ed.scene.getNonDeleted().find((e) => e.type === "line")!
    expect(absolutePointsOf(el as never)).toEqual([
      [0, 0],
      [100, 0],
    ])
  })

  test("two clicks on one spot then Escape leaves no zero-size arrow", () => {
    const ed = new EditorCore()
    ed.setTool("arrow")
    click(ed, 100, 100)
    click(ed, 100, 100)
    ed.keyDown(key("Escape"))
    expect(ed.scene.getNonDeleted()).toHaveLength(0)
  })

  test("shift snaps a polyline segment's angle relative to the previous vertex", () => {
    const ed = new EditorCore()
    ed.setTool("line")
    click(ed, 0, 0)
    hover(ed, 100, 0)
    click(ed, 100, 0)
    hover(ed, 150, 52, { shiftKey: true })
    const el = ed.scene.getNonDeleted().find((e) => e.type === "line")!
    const pts = absolutePointsOf(el as never)
    const prev = pts[pts.length - 2]!
    const tip = pts[pts.length - 1]!
    const deg = (Math.atan2(tip[1] - prev[1], tip[0] - prev[0]) * 180) / Math.PI
    expect(Math.abs(deg - Math.round(deg / 15) * 15)).toBeLessThan(0.01)
    expect(prev).toEqual([100, 0])
  })

  test("after Enter finishes a polyline the selection tool's cursor applies", () => {
    const ed = new EditorCore()
    ed.setTool("line")
    click(ed, 0, 0)
    hover(ed, 100, 0)
    click(ed, 100, 0)
    ed.keyDown(key("Enter"))
    expect(ed.appState.activeTool).toBe("selection")
    expect(ed.cursor(ptr(500, 500, { buttons: 0 }))).toBe("default")
  })
})

import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../src/editor/editorCore"
import type { ArrowElement } from "../src/model/types"
import { setTextMeasurer } from "../src/render/textMeasure"
import type { PointerInput } from "../src/tools/types"

beforeAll(() => setTextMeasurer((t) => t.length * 9))

const ptr = (x: number, y: number): PointerInput => ({
  scene: [x, y],
  screen: [x, y],
  buttons: 1,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  pressure: 0.5,
  detail: 1,
})

const drag = (ed: EditorCore, a: [number, number], b: [number, number]) => {
  ed.pointerDown(ptr(a[0], a[1]))
  ed.pointerMove(ptr((a[0] + b[0]) / 2, (a[1] + b[1]) / 2))
  ed.pointerMove(ptr(b[0], b[1]))
  ed.pointerUp(ptr(b[0], b[1]))
}

const rect = (ed: EditorCore, a: [number, number], b: [number, number]) => {
  ed.setTool("rectangle")
  drag(ed, a, b)
  return ed.scene.getNonDeleted()[ed.scene.getNonDeleted().length - 1]!
}

const arrow = (ed: EditorCore, a: [number, number], b: [number, number]): ArrowElement => {
  ed.setTool("arrow")
  drag(ed, a, b)
  return ed.scene.getNonDeleted().find((e) => e.type === "arrow") as ArrowElement
}

const absolute = (a: ArrowElement): [number, number][] => a.points.map((p) => [a.x + p[0], a.y + p[1]])

describe("arrow binding", () => {
  test("dragging from inside a shape binds to it", () => {
    const ed = new EditorCore()
    const a = rect(ed, [0, 0], [200, 120])
    const b = rect(ed, [400, 300], [600, 420])
    const line = arrow(ed, [100, 60], [500, 360])

    expect(line.startBinding?.elementId).toBe(a.id)
    expect(line.endBinding?.elementId).toBe(b.id)
  })

  test("the endpoints sit outside both shapes, not inside them", () => {
    const ed = new EditorCore()
    rect(ed, [0, 0], [200, 120])
    rect(ed, [400, 300], [600, 420])
    const pts = absolute(arrow(ed, [100, 60], [500, 360]))
    const start = pts[0]!
    const end = pts[pts.length - 1]!

    const insideA = start[0] > 0 && start[0] < 200 && start[1] > 0 && start[1] < 120
    const insideB = end[0] > 400 && end[0] < 600 && end[1] > 300 && end[1] < 420
    expect(insideA).toBe(false)
    expect(insideB).toBe(false)
  })

  test("a tip dropped inside a shape connects flush rather than far away", () => {
    const ed = new EditorCore()
    rect(ed, [0, 0], [200, 120])
    rect(ed, [400, 300], [600, 420])
    const line = arrow(ed, [100, 60], [500, 360])
    expect(line.startBinding!.gap).toBeLessThanOrEqual(8)
    expect(line.endBinding!.gap).toBeLessThanOrEqual(8)
  })

  test("moving a bound shape drags the arrow endpoint with it", () => {
    const ed = new EditorCore()
    const a = rect(ed, [0, 0], [200, 120])
    rect(ed, [400, 300], [600, 420])
    const line = arrow(ed, [100, 60], [500, 360])
    const before = absolute(ed.scene.get(line.id) as ArrowElement)[0]!

    ed.selectElements([a.id])
    ed.nudge(-150, 0)
    const after = absolute(ed.scene.get(line.id) as ArrowElement)[0]!
    expect(after[0]).toBeLessThan(before[0])
  })
})

describe("tidy up", () => {
  test("shapes that face each other get a perfectly straight connector", () => {
    const ed = new EditorCore()
    rect(ed, [0, 0], [200, 120])
    rect(ed, [400, 10], [600, 130])
    const line = arrow(ed, [100, 60], [500, 70])

    expect(ed.tidyUp()).toBeGreaterThan(0)
    const pts = absolute(ed.scene.get(line.id) as ArrowElement)
    expect(pts).toHaveLength(2)
    expect(pts[0]![1]).toBeCloseTo(pts[1]![1], 5)
    expect(pts[0]![0]).toBeGreaterThanOrEqual(200)
    expect(pts[1]![0]).toBeLessThanOrEqual(400)
  })

  test("a vertical pair connects straight down", () => {
    const ed = new EditorCore()
    rect(ed, [0, 0], [200, 120])
    rect(ed, [10, 400], [210, 520])
    const line = arrow(ed, [100, 60], [110, 460])

    ed.tidyUp()
    const pts = absolute(ed.scene.get(line.id) as ArrowElement)
    expect(pts[0]![0]).toBeCloseTo(pts[1]![0], 5)
    expect(pts[0]![1]).toBeGreaterThanOrEqual(120)
    expect(pts[1]![1]).toBeLessThanOrEqual(400)
  })

  test("offset shapes get an orthogonal route instead", () => {
    const ed = new EditorCore()
    rect(ed, [0, 0], [120, 80])
    rect(ed, [400, 400], [520, 480])
    const line = arrow(ed, [60, 40], [460, 440])

    ed.tidyUp()
    const updated = ed.scene.get(line.id) as ArrowElement
    expect(updated.elbowed).toBe(true)
    const pts = absolute(updated)
    for (let i = 0; i < pts.length - 1; i++) {
      const horizontal = Math.abs(pts[i]![1] - pts[i + 1]![1]) < 0.6
      const vertical = Math.abs(pts[i]![0] - pts[i + 1]![0]) < 0.6
      expect(horizontal || vertical).toBe(true)
    }
  })

  test("a loose line that is nearly horizontal is squared up", () => {
    const ed = new EditorCore()
    ed.setTool("line")
    drag(ed, [0, 0], [300, 14])
    const line = ed.scene.getNonDeleted()[0]!

    ed.clearSelection()
    ed.tidyUp()
    const updated = ed.scene.get(line.id) as ArrowElement
    const pts = absolute(updated)
    expect(pts[1]![1]).toBeCloseTo(pts[0]![1], 5)
  })

  test("a line at a deliberate angle is left alone", () => {
    const ed = new EditorCore()
    ed.setTool("line")
    drag(ed, [0, 0], [300, 160])
    const line = ed.scene.getNonDeleted()[0]!
    const before = absolute(ed.scene.get(line.id) as ArrowElement)

    ed.clearSelection()
    ed.tidyUp()
    const after = absolute(ed.scene.get(line.id) as ArrowElement)
    expect(after[1]![1]).toBeCloseTo(before[1]![1], 5)
  })

  test("a loose arrow end adopts the shape it points at", () => {
    const ed = new EditorCore()
    const target = rect(ed, [400, 0], [600, 120])
    ed.setTool("arrow")
    drag(ed, [0, 60], [380, 60])
    const line = ed.scene.getNonDeleted().find((e) => e.type === "arrow") as ArrowElement
    expect(line.endBinding).toBeNull()

    ed.clearSelection()
    ed.tidyUp()
    const updated = ed.scene.get(line.id) as ArrowElement
    expect(updated.endBinding?.elementId).toBe(target.id)
    expect(ed.scene.get(target.id)!.boundElements?.some((b) => b.id === line.id)).toBe(true)
  })

  test("tidying is a single undoable step", () => {
    const ed = new EditorCore()
    rect(ed, [0, 0], [200, 120])
    rect(ed, [400, 10], [600, 130])
    const line = arrow(ed, [100, 60], [500, 70])
    const before = absolute(ed.scene.get(line.id) as ArrowElement)

    ed.clearSelection()
    ed.tidyUp()
    ed.undo()
    const after = absolute(ed.scene.get(line.id) as ArrowElement)
    expect(after[0]![0]).toBeCloseTo(before[0]![0], 3)
    expect(after[0]![1]).toBeCloseTo(before[0]![1], 3)
  })

  test("tidying only the selection leaves other arrows untouched", () => {
    const ed = new EditorCore()
    rect(ed, [0, 0], [200, 120])
    rect(ed, [400, 10], [600, 130])
    const first = arrow(ed, [100, 60], [500, 70])

    ed.setTool("line")
    drag(ed, [0, 600], [300, 614])
    const loose = ed.scene.getNonDeleted().find((e) => e.type === "line")!
    const looseBefore = absolute(ed.scene.get(loose.id) as ArrowElement)

    ed.selectElements([first.id])
    ed.tidyUp()

    const looseAfter = absolute(ed.scene.get(loose.id) as ArrowElement)
    expect(looseAfter[1]![1]).toBeCloseTo(looseBefore[1]![1], 5)
  })

  test("returns zero when there is nothing to straighten", () => {
    const ed = new EditorCore()
    rect(ed, [0, 0], [100, 100])
    expect(ed.tidyUp()).toBe(0)
  })

  test("tidying what is already tidy reports no change and records nothing", () => {
    const ed = new EditorCore()
    rect(ed, [0, 0], [200, 120])
    rect(ed, [400, 10], [600, 130])
    rect(ed, [0, 400], [120, 480])
    rect(ed, [400, 600], [520, 680])
    arrow(ed, [100, 60], [500, 70])
    ed.setTool("arrow")
    drag(ed, [60, 440], [460, 640])
    ed.setTool("line")
    drag(ed, [0, 900], [300, 914])
    ed.clearSelection()
    expect(ed.tidyUp()).toBe(3)
    const undoStack = () => (ed.history as unknown as { undoStack: unknown[] }).undoStack.length
    const depth = undoStack()
    const before = JSON.stringify(ed.scene.getNonDeleted())
    expect(ed.tidyUp()).toBe(0)
    expect(undoStack()).toBe(depth)
    expect(JSON.stringify(ed.scene.getNonDeleted())).toBe(before)
  })
})

describe("elbow arrows after the shapes move", () => {
  const points = (ed: EditorCore, id: string) => absolute(ed.scene.get(id) as ArrowElement)

  const allOrthogonal = (pts: [number, number][]) =>
    pts.every((p, i) => {
      if (i === 0) return true
      const prev = pts[i - 1]!
      return Math.abs(prev[0] - p[0]) < 0.6 || Math.abs(prev[1] - p[1]) < 0.6
    })

  test("the route stays orthogonal when a bound shape is dragged", () => {
    const ed = new EditorCore()
    const a = rect(ed, [0, 0], [120, 80])
    rect(ed, [400, 400], [520, 480])
    const line = arrow(ed, [60, 40], [460, 440])
    ed.clearSelection()
    ed.tidyUp()

    ed.selectElements([a.id])
    ed.nudge(0, 120)
    expect(allOrthogonal(points(ed, line.id))).toBe(true)
  })

  test("the arrow leaves on the side that faces the target", () => {
    const ed = new EditorCore()
    const a = rect(ed, [0, 0], [120, 80])
    rect(ed, [400, 400], [520, 480])
    const line = arrow(ed, [60, 40], [460, 440])
    ed.clearSelection()
    ed.tidyUp()

    const box = ed.scene.get(a.id)!
    const start = points(ed, line.id)[0]!
    // the target is down and to the right, so the arrow must leave from the
    // right edge or the bottom edge, never from the top or the left
    const leavesRight = start[0] >= box.x + box.width
    const leavesBottom = start[1] >= box.y + box.height
    expect(leavesRight || leavesBottom).toBe(true)
  })

  test("endpoints stay clear of both shapes after a move", () => {
    const ed = new EditorCore()
    const a = rect(ed, [0, 0], [120, 80])
    const b = rect(ed, [400, 400], [520, 480])
    const line = arrow(ed, [60, 40], [460, 440])
    ed.clearSelection()
    ed.tidyUp()
    ed.selectElements([a.id])
    ed.nudge(40, 60)

    const pts = points(ed, line.id)
    const start = pts[0]!
    const end = pts[pts.length - 1]!
    const av = ed.scene.get(a.id)!
    const bv = ed.scene.get(b.id)!
    const inside = (p: [number, number], el: typeof av) =>
      p[0] > el.x + 0.5 && p[0] < el.x + el.width - 0.5 && p[1] > el.y + 0.5 && p[1] < el.y + el.height - 0.5
    expect(inside(start, av)).toBe(false)
    expect(inside(end, bv)).toBe(false)
  })
})

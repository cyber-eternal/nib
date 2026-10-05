import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore } from "../src/editor/editorCore"
import { absolutePointsOf } from "../src/geometry/linear"
import { recognizeStroke } from "../src/geometry/recognize"
import type { Point } from "../src/math/vector"
import type { ArrowElement, FreedrawElement, NibElement } from "../src/model/types"
import type { PointerInput } from "../src/tools/types"
import { drawShape, key, ptr, setupMeasurer, undoDepth } from "./editor/helpers"

beforeAll(setupMeasurer)

const circle = (cx: number, cy: number, r: number, n = 72): Point[] =>
  Array.from({ length: n + 1 }, (_, i): Point => {
    const t = (i / n) * Math.PI * 2
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)]
  })

/** Evenly sampled path through `vertices`. */
const path = (vertices: readonly Point[], per = 20): Point[] => {
  const out: Point[] = []
  for (let i = 0; i < vertices.length - 1; i++) {
    const a = vertices[i]!
    const b = vertices[i + 1]!
    for (let k = 0; k < per; k++)
      out.push([a[0] + ((b[0] - a[0]) * k) / per, a[1] + ((b[1] - a[1]) * k) / per])
  }
  out.push(vertices[vertices.length - 1]!)
  return out
}

const stroke = (ed: EditorCore, pts: readonly Point[], release: Partial<PointerInput> = {}) => {
  const [first, ...rest] = pts
  ed.pointerDown(ptr(first![0], first![1]))
  for (const p of rest) ed.pointerMove(ptr(p[0], p[1]))
  const end = pts[pts.length - 1]!
  ed.pointerUp(ptr(end[0], end[1], release))
}

const pencil = () => {
  const ed = new EditorCore()
  ed.setTool("pencil")
  return ed
}

const live = (ed: EditorCore): readonly NibElement[] => ed.scene.getNonDeleted()
const freedraws = (ed: EditorCore) => live(ed).filter((e): e is FreedrawElement => e.type === "freedraw")

describe("pencil mode", () => {
  test("P arms the pencil and 7 the pen", () => {
    const ed = new EditorCore()
    ed.keyDown(key("p", { code: "KeyP" }))
    expect(ed.appState.activeTool).toBe("pencil")
    ed.keyDown(key("7", { code: "Digit7" }))
    expect(ed.appState.activeTool).toBe("freedraw")
  })

  test("a circle stroke becomes one ellipse, the pencil stays armed and nothing is selected", () => {
    const ed = pencil()
    stroke(ed, circle(300, 300, 80))
    const els = live(ed)
    expect(els).toHaveLength(1)
    const el = els[0]!
    expect(el.type).toBe("ellipse")
    expect(Math.abs(el.width - el.height)).toBeLessThan(2)
    expect(el.x + el.width / 2).toBeCloseTo(300, 0)
    expect(el.y + el.height / 2).toBeCloseTo(300, 0)
    expect(freedraws(ed)).toHaveLength(0)
    expect(ed.appState.activeTool).toBe("pencil")
    expect(ed.appState.selectedElementIds).toEqual({})
    expect(ed.lastCorrection?.elementId).toBe(el.id)

    stroke(ed, circle(700, 300, 60))
    expect(live(ed).filter((e) => e.type === "ellipse")).toHaveLength(2)
  })

  test("the correction is a second history entry: undo brings back the exact stroke, redo the shape", () => {
    const ed = pencil()
    stroke(ed, circle(300, 300, 80))
    expect(undoDepth(ed)).toBe(2)
    const tomb = ed.scene.getElements().find((e): e is FreedrawElement => e.type === "freedraw")!
    expect(tomb.isDeleted).toBe(true)

    ed.undo()
    const back = freedraws(ed)
    expect(back).toHaveLength(1)
    expect(back[0]!.id).toBe(tomb.id)
    expect(back[0]!.points).toEqual(tomb.points)
    expect(back[0]!.pressures).toEqual(tomb.pressures)
    expect(live(ed).some((e) => e.type === "ellipse")).toBe(false)

    ed.undo()
    expect(live(ed)).toHaveLength(0)

    ed.redo()
    ed.redo()
    expect(live(ed).map((e) => e.type)).toEqual(["ellipse"])
  })

  test("Alt at release keeps the stroke raw", () => {
    const ed = pencil()
    stroke(ed, circle(300, 300, 80), { altKey: true })
    expect(live(ed).map((e) => e.type)).toEqual(["freedraw"])
    expect(undoDepth(ed)).toBe(1)
  })

  test("the pen never converts", () => {
    const ed = new EditorCore()
    ed.setTool("freedraw")
    stroke(ed, circle(300, 300, 80))
    expect(live(ed).map((e) => e.type)).toEqual(["freedraw"])
    expect(ed.lastCorrection).toBeNull()
  })

  test("a scribble stays a scribble", () => {
    const ed = pencil()
    const zigzag = path(
      Array.from({ length: 12 }, (_, i): Point => [100 + i * 30, i % 2 === 0 ? 100 : 160]),
      8,
    )
    stroke(ed, zigzag)
    expect(live(ed).map((e) => e.type)).toEqual(["freedraw"])
  })

  test("a triangle is a closed polygon line with four points", () => {
    const ed = pencil()
    stroke(
      ed,
      path([
        [100, 300],
        [200, 120],
        [300, 300],
        [100, 300],
      ]),
    )
    const el = live(ed)[0]!
    if (el.type !== "line") throw new Error(`expected a line, got ${el.type}`)
    expect(el.polygon).toBe(true)
    expect(el.points).toHaveLength(4)
    expect(el.points[0]).toEqual(el.points[3])
  })

  test("shapes take the current style", () => {
    const ed = pencil()
    ed.setAppState({
      currentItemStrokeColor: "#e03131",
      currentItemBackgroundColor: "#ffc9c9",
      currentItemStrokeStyle: "dashed",
      currentItemRoundness: "sharp",
    })
    stroke(
      ed,
      path([
        [100, 100],
        [300, 100],
        [300, 220],
        [100, 220],
        [100, 100],
      ]),
    )
    const rect = live(ed)[0]!
    expect(rect.type).toBe("rectangle")
    expect(rect.strokeColor).toBe("#e03131")
    expect(rect.backgroundColor).toBe("#ffc9c9")
    expect(rect.strokeStyle).toBe("dashed")
    expect(rect.roundness).toBeNull()
    expect([rect.x, rect.y, rect.width, rect.height].map(Math.round)).toEqual([100, 100, 200, 120])

    ed.setAppState({ currentItemRoundness: "round" })
    stroke(
      ed,
      path([
        [600, 100],
        [700, 200],
        [600, 300],
        [500, 200],
        [600, 100],
      ]),
    )
    const diamond = live(ed)[1]!
    expect(diamond.type).toBe("diamond")
    expect(diamond.roundness).toEqual({ type: 3 })
  })

  test("an arrow stroke from one shape to another binds both ends, and one undo unlinks them", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [400, 0], [500, 100])
    ed.setTool("pencil")
    stroke(
      ed,
      path(
        [
          [50, 50],
          [450, 50],
          [420, 30],
          [450, 50],
          [420, 70],
        ],
        30,
      ),
    )
    const arrow = live(ed).find((e): e is ArrowElement => e.type === "arrow")
    expect(arrow).toBeDefined()
    expect(arrow!.startBinding?.elementId).toBe(a.id)
    expect(arrow!.endBinding?.elementId).toBe(b.id)
    expect(arrow!.endArrowhead).toBe("arrow")
    for (const id of [a.id, b.id])
      expect(ed.scene.get(id)!.boundElements?.some((r) => r.id === arrow!.id)).toBe(true)
    // the ends sit on the borders, as a tool-drawn arrow's do
    const pts = absolutePointsOf(arrow!)
    expect(pts[0]![0]).toBeGreaterThanOrEqual(100)
    expect(pts[pts.length - 1]![0]).toBeLessThanOrEqual(400)

    ed.undo()
    for (const id of [a.id, b.id])
      expect(ed.scene.get(id)!.boundElements?.some((r) => r.id === arrow!.id) ?? false).toBe(false)
    expect(freedraws(ed)).toHaveLength(1)
  })

  test("an arrow stroke released with Cmd held is corrected but not bound", () => {
    const ed = new EditorCore()
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [400, 0], [500, 100])
    ed.setTool("pencil")
    const pts = path(
      [
        [50, 50],
        [450, 50],
        [420, 30],
        [450, 50],
        [420, 70],
      ],
      30,
    )
    stroke(ed, pts, { metaKey: true })
    const arrow = live(ed).find((e): e is ArrowElement => e.type === "arrow")!
    expect(arrow).toBeDefined()
    expect(arrow.startBinding).toBeNull()
    expect(arrow.endBinding).toBeNull()
    for (const id of [a.id, b.id]) expect(ed.scene.get(id)!.boundElements ?? []).toEqual([])
  })

  test("a tilted box keeps its tilt as the rectangle's angle", () => {
    const ed = pencil()
    const turn = (30 * Math.PI) / 180
    const c: Point = [300, 300]
    const rot = (p: Point): Point => [
      c[0] + (p[0] - c[0]) * Math.cos(turn) - (p[1] - c[1]) * Math.sin(turn),
      c[1] + (p[0] - c[0]) * Math.sin(turn) + (p[1] - c[1]) * Math.cos(turn),
    ]
    const corners: Point[] = [
      [200, 250],
      [400, 250],
      [400, 350],
      [200, 350],
      [200, 250],
    ]
    stroke(ed, path(corners.map(rot)))
    const rect = live(ed)[0]!
    expect(rect.type).toBe("rectangle")
    expect(rect.angle).toBeCloseTo(turn, 2)
    expect(rect.x + rect.width / 2).toBeCloseTo(300, 0)
    expect(rect.y + rect.height / 2).toBeCloseTo(300, 0)
    expect(Math.round(rect.width)).toBe(200)
    expect(Math.round(rect.height)).toBe(100)
  })

  test("a curved arrow becomes a three-point round arrow", () => {
    const ed = pencil()
    const r = Math.hypot(200, 200)
    const arc = Array.from({ length: 61 }, (_, i): Point => {
      const t = Math.PI * 1.25 + (i / 60) * (Math.PI / 2)
      return [300 + r * Math.cos(t), 500 + r * Math.sin(t)]
    })
    const tip = arc[arc.length - 1]!
    const barbs = path([tip, [tip[0] - 35, tip[1] - 5], tip, [tip[0] - 5, tip[1] - 35]], 10)
    stroke(ed, [...arc, ...barbs.slice(1)])
    const arrow = live(ed)[0]!
    if (arrow.type !== "arrow") throw new Error(`expected an arrow, got ${arrow.type}`)
    expect(arrow.points).toHaveLength(3)
    expect(arrow.roundness).toEqual({ type: 2 })
    expect(arrow.endArrowhead).toBe("arrow")
  })

  test("the shape keeps the stroke's place in the z-order", () => {
    const ed = new EditorCore()
    ed.setTool("freedraw")
    stroke(ed, circle(300, 300, 80))
    const raw = freedraws(ed)[0]!
    const rect = drawShape(ed, "rectangle", [600, 0], [700, 100])
    const r = recognizeStroke(absolutePointsOf(raw), { zoom: 1 })
    expect(r?.kind).toBe("ellipse")
    const id = ed.replaceStrokeWithShape(raw.id, r!)!
    const shape = ed.scene.get(id)!
    expect(shape.index > raw.index).toBe(true)
    expect(shape.index < ed.scene.get(rect.id)!.index).toBe(true)
    expect(live(ed).map((e) => e.id)).toEqual([id, rect.id])
  })

  test("a shape drawn inside a frame joins it", () => {
    const ed = new EditorCore()
    const frame = drawShape(ed, "frame", [0, 0], [800, 600])
    ed.setTool("pencil")
    stroke(ed, circle(300, 300, 80))
    const ellipse = live(ed).find((e) => e.type === "ellipse")!
    expect(ellipse.frameId).toBe(frame.id)
  })

  test("a 5000-point stroke is recognised in under 5ms", () => {
    const pts = circle(400, 400, 300, 4999)
    recognizeStroke(pts, { zoom: 1 })
    let best = Number.POSITIVE_INFINITY
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now()
      const r = recognizeStroke(pts, { zoom: 1 })
      best = Math.min(best, performance.now() - t0)
      expect(r?.kind).toBe("ellipse")
    }
    expect(best).toBeLessThan(5)
  })
})

describe("recognised rounded rectangles, parallelograms and polygons", () => {
  /** A raw pen stroke to correct, so these tests never depend on how the recognizer is tuned. */
  const rawStroke = (ed: EditorCore, at: Point = [300, 300]): FreedrawElement => {
    ed.setTool("freedraw")
    stroke(ed, circle(at[0], at[1], 80))
    return freedraws(ed).at(-1)!
  }

  const asLine = (el: NibElement | undefined) => {
    if (el?.type !== "line") throw new Error(`expected a line, got ${el?.type}`)
    return el
  }

  const slanted: [Point, Point, Point, Point] = [
    [240, 240],
    [400, 240],
    [360, 340],
    [200, 340],
  ]

  test("a rounded rectangle takes the rectangle tool's round corners even while edges are sharp", () => {
    const ed = new EditorCore()
    ed.setAppState({ currentItemRoundness: "round" })
    const toolRect = drawShape(ed, "rectangle", [600, 0], [700, 100])
    ed.setAppState({ currentItemRoundness: "sharp" })
    const raw = rawStroke(ed)
    const id = ed.replaceStrokeWithShape(raw.id, {
      kind: "rectangle",
      cx: 300,
      cy: 300,
      w: 200,
      h: 120,
      angle: 0,
      rounded: true,
      score: 0.2,
    })!
    const rect = ed.scene.get(id)!
    expect(rect.type).toBe("rectangle")
    expect(rect.roundness).toEqual(toolRect.roundness)
    expect([rect.x, rect.y, rect.width, rect.height]).toEqual([200, 240, 200, 120])
    expect(ed.lastCorrection?.elementId).toBe(id)

    const plain = ed.replaceStrokeWithShape(rawStroke(ed, [300, 700]).id, {
      kind: "rectangle",
      cx: 300,
      cy: 700,
      w: 200,
      h: 120,
      angle: 0,
      rounded: false,
      score: 0.2,
    })!
    expect(ed.scene.get(plain)!.roundness).toBeNull()
  })

  test("a parallelogram becomes a closed polygon line through its corners, in the current style", () => {
    const ed = new EditorCore()
    ed.setAppState({
      currentItemStrokeColor: "#1971c2",
      currentItemBackgroundColor: "#ffc9c9",
      currentItemFillStyle: "hachure",
      currentItemStrokeStyle: "dashed",
      currentItemRoundness: "sharp",
    })
    const raw = rawStroke(ed)
    const id = ed.replaceStrokeWithShape(raw.id, { kind: "parallelogram", vertices: slanted, score: 0.3 })!
    const el = asLine(ed.scene.get(id))
    expect(el.polygon).toBe(true)
    expect(el.roundness).toBeNull()
    expect(absolutePointsOf(el)).toEqual([...slanted, slanted[0]])
    expect(el).toMatchObject({
      strokeColor: "#1971c2",
      backgroundColor: "#ffc9c9",
      fillStyle: "hachure",
      strokeStyle: "dashed",
      strokeWidth: raw.strokeWidth,
      roughness: raw.roughness,
    })
    expect(freedraws(ed)).toHaveLength(0)
    expect(ed.lastCorrection?.elementId).toBe(id)
    expect(ed.appState.activeTool).toBe("freedraw")

    ed.setAppState({ currentItemRoundness: "round" })
    const round = ed.replaceStrokeWithShape(rawStroke(ed, [700, 300]).id, {
      kind: "parallelogram",
      vertices: slanted.map(([x, y]): Point => [x + 400, y]) as typeof slanted,
      score: 0.3,
    })!
    expect(ed.scene.get(round)!.roundness).toEqual({ type: 2 })
  })

  test("one undo brings the raw stroke back from a parallelogram, redo the shape", () => {
    const ed = new EditorCore()
    const raw = rawStroke(ed)
    const id = ed.replaceStrokeWithShape(raw.id, { kind: "parallelogram", vertices: slanted, score: 0.3 })!
    expect(undoDepth(ed)).toBe(2)
    ed.undo()
    expect(freedraws(ed).map((e) => e.id)).toEqual([raw.id])
    expect(freedraws(ed)[0]!.points).toEqual(raw.points)
    expect(live(ed).some((e) => e.id === id)).toBe(false)
    ed.redo()
    expect(live(ed).map((e) => e.id)).toEqual([id])
  })

  test("a straightened polygon keeps every vertex, closes, and keeps the stroke's z-order and frame", () => {
    const ed = new EditorCore()
    const frame = drawShape(ed, "frame", [0, 0], [800, 600])
    const raw = rawStroke(ed)
    const above = drawShape(ed, "rectangle", [600, 400], [700, 500])
    const hexagon: Point[] = Array.from({ length: 6 }, (_, i): Point => {
      const t = (i / 6) * Math.PI * 2
      return [300 + 100 * Math.cos(t), 300 + 100 * Math.sin(t)]
    })
    const id = ed.replaceStrokeWithShape(raw.id, { kind: "polygon", vertices: hexagon, score: 0.4 })!
    const el = asLine(ed.scene.get(id))
    expect(el.polygon).toBe(true)
    expect(el.points).toHaveLength(7)
    expect(el.points[0]).toEqual(el.points[6])
    absolutePointsOf(el)
      .slice(0, 6)
      .forEach((p, i) => {
        expect(p[0]).toBeCloseTo(hexagon[i]![0], 6)
        expect(p[1]).toBeCloseTo(hexagon[i]![1], 6)
      })
    expect(el.index > raw.index).toBe(true)
    expect(el.index < ed.scene.get(above.id)!.index).toBe(true)
    expect(el.frameId).toBe(frame.id)
    expect(ed.lastCorrection?.elementId).toBe(id)
  })

  test("arrows attach to a corrected parallelogram, drawn or recognised, and it takes a label", () => {
    const ed = new EditorCore()
    const raw = rawStroke(ed)
    const id = ed.replaceStrokeWithShape(raw.id, { kind: "parallelogram", vertices: slanted, score: 0.3 })!
    const drawn = ed.replaceStrokeWithShape(rawStroke(ed, [0, 600]).id, {
      kind: "arrow",
      from: [0, 290],
      to: [300, 290],
      score: 0.1,
    })!
    const arrow = ed.scene.get(drawn) as ArrowElement
    expect(arrow.endBinding?.elementId).toBe(id)
    expect(ed.scene.get(id)!.boundElements?.some((b) => b.id === drawn)).toBe(true)

    ed.setTool("selection")
    ed.startEditingLabel(ed.scene.get(id)!)
    const textId = ed.appState.editingTextId!
    ed.commitText(textId, "Input")
    const text = ed.scene.get(textId)!
    expect(text.type === "text" && text.containerId).toBe(id)
  })
})

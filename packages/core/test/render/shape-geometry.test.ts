import { describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { cornerRadius, elementOutline } from "../../src/geometry/outline"
import { normalizeElements } from "../../src/io/nibFile"
import { newElement } from "../../src/model/element"
import { Scene } from "../../src/model/scene"
import { DEFAULT_APP_STATE } from "../../src/model/types"
import { drawElement } from "../../src/render/drawElement"
import { ShapeCache, generateShape } from "../../src/render/shapes"
import { renderStaticScene } from "../../src/render/staticScene"
import type { PointerInput } from "../../src/tools/types"
import { recordingCanvas } from "./mockCanvas"

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

describe("rounded corners never exceed the shape", () => {
  // Excalidraw writes {type: 2} (proportional/legacy) on diamonds and on older rectangles.
  test("an imported {type: 2} rounded rectangle keeps its radius within half the short side", () => {
    const [rect] = normalizeElements([
      { id: "r", type: "rectangle", x: 0, y: 0, width: 40, height: 20, roundness: { type: 2 }, roughness: 0 },
    ])
    expect(cornerRadius(rect!)).toBeLessThanOrEqual(10)
  })

  test("the drawn rounded rectangle stays inside its box", () => {
    const rect = newElement("rectangle", { width: 40, height: 20, roundness: { type: 2 }, roughness: 0 })
    const ops = generateShape(rect, "light").flatMap((d) => d.sets.flatMap((s) => s.ops))
    const ys = ops.flatMap((o) => o.data.filter((_, i) => i % 2 === 1))
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-0.5)
    expect(Math.max(...ys)).toBeLessThanOrEqual(20.5)
  })
})

describe("rounded diamond outline follows the drawn diamond", () => {
  // the binding highlight, hit-testing and arrow attachment all use this outline
  test("no outline point lies outside the sharp diamond", () => {
    const d = newElement("diamond", { x: 0, y: 0, width: 100, height: 100, roundness: { type: 3 } })
    const worst = Math.max(
      ...elementOutline(d).map(([x, y]) => Math.abs(x - 50) / 50 + Math.abs(y - 50) / 50),
    )
    expect(worst).toBeLessThanOrEqual(1.01)
  })
})

describe("culling keeps arrowheads that poke into the viewport", () => {
  test("a horizontal arrow just above the top edge still paints its head wings", () => {
    const arrow = newElement("arrow", {
      x: 100,
      y: -5,
      width: 200,
      height: 0,
      points: [
        [0, 0],
        [200, 0],
      ],
      endArrowhead: "triangle",
      index: "a0",
    })
    const r = recordingCanvas()
    renderStaticScene(r.ctx, {
      scene: new Scene([arrow]),
      appState: DEFAULT_APP_STATE,
      width: 800,
      height: 600,
      dpr: 1,
      theme: "light",
      cache: new ShapeCache(),
    })
    // the triangle spans y = -5 ± 7.2, so its lower wing is on screen
    expect(r.calls.some((c) => c.op === "fill")).toBe(true)
  })
})

describe("arrowheads survive a zero-length last segment", () => {
  test("the head is drawn along the last non-degenerate segment", () => {
    const arrow = newElement("arrow", {
      x: 0,
      y: 0,
      width: 200,
      height: 50,
      points: [
        [0, 0],
        [100, 0],
        [200, 50],
        [200, 50],
      ],
      endArrowhead: "arrow",
      roundness: null,
    })
    const r = recordingCanvas()
    drawElement(r.ctx, arrow, { theme: "light", cache: new ShapeCache() })
    // rough bodies only emit bezierCurveTo; lineTo comes from the arrowhead
    expect(r.calls.filter((c) => c.op === "lineTo").length).toBeGreaterThan(0)
  })

  test("finishing a multi-point arrow with a double click keeps a visible head", () => {
    const ed = new EditorCore()
    ed.setTool("arrow")
    ed.pointerDown(ptr(0, 0))
    ed.pointerUp(ptr(0, 0))
    ed.pointerMove(ptr(100, 0))
    ed.pointerDown(ptr(100, 0))
    ed.pointerUp(ptr(100, 0))
    ed.pointerMove(ptr(200, 50))
    // a double click delivers two clicks and then dblclick
    ed.pointerDown(ptr(200, 50))
    ed.pointerUp(ptr(200, 50))
    ed.pointerDown(ptr(200, 50))
    ed.pointerUp(ptr(200, 50))
    ed.doubleClick(ptr(200, 50))
    const el = ed.scene.getNonDeleted()[0]!
    if (el.type !== "arrow") throw new Error("expected an arrow")
    const n = el.points.length
    const [a, b] = [el.points[n - 2]!, el.points[n - 1]!]
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeGreaterThan(0)
  })
})

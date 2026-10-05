import { describe, expect, test } from "vitest"
import { rotatePoint } from "../../src/math/vector"
import { newElement } from "../../src/model/element"
import { DEFAULT_APP_STATE, type NibElement } from "../../src/model/types"
import { type InteractiveSceneInput, renderInteractiveScene } from "../../src/render/interactiveScene"
import { recordingCanvas } from "./mockCanvas"

const input = (over: Partial<InteractiveSceneInput>): InteractiveSceneInput => ({
  appState: DEFAULT_APP_STATE,
  selected: [],
  width: 800,
  height: 600,
  dpr: 1,
  marquee: null,
  lasso: null,
  snapLines: [],
  bindingHighlight: null,
  bindingHints: [],
  frameHighlight: null,
  editingLinear: null,
  laserTrail: [],
  ...over,
})

describe("point-edit handles follow a rotated line", () => {
  test("handles sit on the drawn endpoints of a rotated line", () => {
    const line = newElement("line", {
      x: 0,
      y: 0,
      width: 100,
      height: 0,
      angle: Math.PI / 2,
      points: [
        [0, 0],
        [100, 0],
      ],
    }) as NibElement
    const r = recordingCanvas()
    renderInteractiveScene(r.ctx, input({ selected: [line], editingLinear: line }))
    const centres = r.calls
      .filter((c) => c.op === "arc" && (c.args[2] as number) === 4)
      .map((c) => r.toPage(c, c.args[0] as number, c.args[1] as number))
    const expected = [rotatePoint([0, 0], [50, 0], Math.PI / 2), rotatePoint([100, 0], [50, 0], Math.PI / 2)]
    for (const e of expected) {
      const near = centres.some((c) => Math.hypot(c[0] - e[0], c[1] - e[1]) < 0.5)
      expect(near, `no handle at ${e.map((v) => v.toFixed(1))}`).toBe(true)
    }
  })
})

describe("resize handles sit on the selection frame", () => {
  test("corner handles are centred on the frame corners of a single selection", () => {
    const rect = newElement("rectangle", { x: 0, y: 0, width: 100, height: 50 })
    const r = recordingCanvas()
    renderInteractiveScene(r.ctx, input({ selected: [rect] }))
    const frame = r.calls.find((c) => c.op === "strokeRect")!
    const [fx, fy] = frame.args as number[]
    const frameTopLeft = r.toPage(frame, fx!, fy!)
    const handles = r.calls
      .filter((c) => c.op === "rect")
      .map((c) => {
        const [x, y, w, h] = c.args as number[]
        return r.toPage(c, x! + w! / 2, y! + h! / 2)
      })
    const nw = handles.reduce((best, h) => (h[0] + h[1] < best[0] + best[1] ? h : best))
    expect(Math.hypot(nw[0] - frameTopLeft[0], nw[1] - frameTopLeft[1])).toBeLessThan(0.5)
  })
})

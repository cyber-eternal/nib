import { describe, expect, test } from "vitest"
import { exportToSvg } from "../../src/io/exportSvg"
import { newElement } from "../../src/model/element"
import { type Arrowhead, DEFAULT_APP_STATE } from "../../src/model/types"
import { drawArrowhead } from "../../src/render/arrowheads"
import { recordingCanvas } from "./mockCanvas"

const KINDS: Arrowhead[] = [
  "arrow",
  "bar",
  "dot",
  "circle",
  "circle_outline",
  "triangle",
  "triangle_outline",
  "diamond",
  "diamond_outline",
  "crowfoot_one",
  "crowfoot_many",
  "crowfoot_one_or_many",
]

const arrow = (kind: Arrowhead, background = "transparent") =>
  newElement("arrow", {
    x: 0,
    y: 0,
    width: 100,
    height: 0,
    strokeWidth: 2,
    roughness: 0,
    backgroundColor: background,
    points: [
      [0, 0],
      [100, 0],
    ],
    startArrowhead: null,
    endArrowhead: kind,
  })

const key = (x: number, y: number) => `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`

const canvasHead = (kind: Arrowhead, background: string) => {
  const r = recordingCanvas()
  const el = arrow(kind, background)
  drawArrowhead(r.ctx, kind, [100, 0], [0, 0], el, "#1e1e1e", background)
  const points = new Set<string>()
  const circles: string[] = []
  for (const c of r.calls) {
    if (c.op === "moveTo" || c.op === "lineTo") points.add(key(c.args[0] as number, c.args[1] as number))
    if (c.op === "arc") circles.push(`${key(c.args[0] as number, c.args[1] as number)} r${c.args[2]}`)
  }
  const filledWith = r.calls.filter((c) => c.op === "fill").map((c) => c.fillStyle)
  return { points, circles, filledWith }
}

/** Arrowhead markup is everything after the rough body: straight M/L paths and circles. */
const svgHead = (kind: Arrowhead, background: string) => {
  const svg = exportToSvg({
    elements: [arrow(kind, background)],
    appState: DEFAULT_APP_STATE,
    exportBackground: false,
    exportPadding: 0,
    scale: 1,
    theme: "light",
  })
  const points = new Set<string>()
  const circles: string[] = []
  const fills: string[] = []
  for (const m of svg.matchAll(/<path d="([^"]*)"([^>]*)\/>/g)) {
    const d = m[1]!
    if (/[CQ]/.test(d)) continue
    const nums = d.match(/-?\d+(\.\d+)?(e-?\d+)?/g)!.map(Number)
    for (let i = 0; i + 1 < nums.length; i += 2) points.add(key(nums[i]!, nums[i + 1]!))
    const fill = /fill="([^"]*)"/.exec(m[2]!)?.[1]
    if (fill && fill !== "none") fills.push(fill)
  }
  for (const m of svg.matchAll(/<circle cx="([^"]*)" cy="([^"]*)" r="([^"]*)" fill="([^"]*)"/g)) {
    circles.push(`${key(Number(m[1]), Number(m[2]))} r${m[3]}`)
    if (m[4] !== "none") fills.push(m[4]!)
  }
  return { points, circles, fills }
}

describe("crow's-foot heads open toward the entity", () => {
  // In ER notation the prongs of "many" touch the shape and meet back along the line.
  for (const kind of ["crowfoot_many", "crowfoot_one_or_many"] as const) {
    test(`${kind} prongs spread at the tip, not behind it`, () => {
      const r = recordingCanvas()
      drawArrowhead(r.ctx, kind, [100, 0], [0, 0], arrow(kind), "#000", "transparent")
      const pts = r.calls
        .filter((c) => c.op === "moveTo" || c.op === "lineTo")
        .map((c) => [c.args[0] as number, c.args[1] as number] as const)
      // the two outer prongs end off the line axis; they must sit at the tip end
      const offAxis = pts.filter(([, y]) => Math.abs(y) > 5)
      const prongEnds = offAxis.filter(([x]) => x > 90)
      expect(prongEnds.length).toBeGreaterThanOrEqual(2)
      // and the shape must not be identical to a plain "arrow" chevron plus a centre line
      const chevron = recordingCanvas()
      drawArrowhead(chevron.ctx, "arrow", [100, 0], [0, 0], arrow("arrow"), "#000", "transparent")
      const tipConverges = pts.filter(([x, y]) => Math.abs(x - 100) < 0.01 && Math.abs(y) < 0.01).length
      expect(tipConverges).toBeLessThan(3)
    })
  }
})

describe("SVG arrowheads match the canvas for every kind", () => {
  test("every arrowhead kind has the same geometry in SVG and canvas", () => {
    for (const kind of KINDS) {
      const c = canvasHead(kind, "transparent")
      const s = svgHead(kind, "transparent")
      expect.soft([...s.points].sort(), kind).toEqual([...c.points].sort())
      expect.soft(s.circles.sort(), kind).toEqual(c.circles.sort())
    }
  })

  for (const kind of ["triangle_outline", "diamond_outline", "circle_outline"] as const) {
    test(`${kind} is filled with the arrow background in SVG like on canvas`, () => {
      const c = canvasHead(kind, "#ffc9c9")
      const s = svgHead(kind, "#ffc9c9")
      expect(c.filledWith).toContain("#ffc9c9")
      expect(s.fills).toContain("#ffc9c9")
    })
  }
})

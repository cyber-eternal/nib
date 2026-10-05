import { describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { createBinding } from "../../src/geometry/binding"
import { straightRun } from "../../src/geometry/connector"
import { tidyLinearElements } from "../../src/geometry/tidy"
import { newElement } from "../../src/model/element"
import type { ArrowElement } from "../../src/model/types"
import { absPoints, distToOutline, draw } from "./helpers"

describe("straight runs end on the real outline", () => {
  test("tidy between two offset ellipses keeps the default gap", () => {
    const ed = new EditorCore()
    const a = draw(ed, "ellipse", [0, 0], [100, 100])
    const b = draw(ed, "ellipse", [300, 60], [400, 160])
    const arrow = draw(ed, "arrow", [50, 50], [350, 110]) as ArrowElement
    ed.clearSelection()
    ed.tidyUp()
    const t = ed.scene.get(arrow.id) as ArrowElement
    const pts = absPoints(t)
    expect(distToOutline(pts[0]!, ed.scene.get(a.id)!)).toBeLessThan(6)
    expect(distToOutline(pts[pts.length - 1]!, ed.scene.get(b.id)!)).toBeLessThan(6)
    expect(t.startBinding!.gap).toBeLessThan(6)
  })
})

describe("tidy never drags a bound end off its shape", () => {
  test("squaring up an arrow whose end is bound keeps that end on the shape", () => {
    const ell = newElement("ellipse", { x: 0, y: 200, width: 100, height: 100 })
    let arrow = newElement("arrow", {
      x: -30,
      y: 0,
      points: [
        [0, 0],
        [35, 200],
      ],
    }) as ArrowElement
    arrow = { ...arrow, endBinding: createBinding(ell, arrow, "end") }
    const gap = arrow.endBinding!.gap
    const out = tidyLinearElements([arrow], { all: [ell, arrow], zoom: 1 })
    const t = (out.elements[0] ?? arrow) as ArrowElement
    const pts = absPoints(t)
    expect(Math.abs(distToOutline(pts[pts.length - 1]!, ell) - gap)).toBeLessThan(2)
  })
})

describe("straight runs between nearly touching shapes", () => {
  test("the run never points backwards", () => {
    const a = newElement("rectangle", { x: -170, y: -127, width: 190, height: 132.5 }) // bottom 5.5
    const b = newElement("rectangle", { x: -110, y: 6.3, width: 85, height: 100 })
    const run = straightRun(a, b, 4, 4)
    if (!run) return
    // a is above b, so the run must go downward (start above end)
    expect(run[1][1]).toBeGreaterThanOrEqual(run[0][1])
  })
})

import { describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { getCommonBounds } from "../../src/geometry/elementBounds"
import { flipElements } from "../../src/geometry/resize"
import type { Point } from "../../src/math/vector"
import { newElement } from "../../src/model/element"
import type { ArrowElement } from "../../src/model/types"
import { absPoints, distToOutline, draw, renderedPoints } from "./helpers"

describe("vertical flip of rotated elements", () => {
  test("a rotated text is mirrored to -angle, not turned upside down", () => {
    const text = newElement("text", {
      x: 0,
      y: 0,
      width: 100,
      height: 25,
      angle: Math.PI / 6,
      text: "hi",
      originalText: "hi",
    })
    const [flipped] = flipElements([text], getCommonBounds([text]), "vertical")
    const deg = ((flipped!.angle * 180) / Math.PI + 360) % 360
    expect(deg).toBeCloseTo(330, 3)
  })

  test("a rotated arrow keeps its direction (start maps to the mirrored start)", () => {
    const arrow = newElement("arrow", {
      x: 0,
      y: 0,
      width: 100,
      height: 0,
      angle: Math.PI / 6,
      points: [
        [0, 0],
        [100, 0],
      ],
    })
    const b = getCommonBounds([arrow])
    const cy = (b[1] + b[3]) / 2
    const before = renderedPoints(arrow)
    const [flipped] = flipElements([arrow], b, "vertical")
    const after = renderedPoints(flipped!)
    const mirror = (p: Point): Point => [p[0], 2 * cy - p[1]]
    expect(after[0]![0]).toBeCloseTo(mirror(before[0]!)[0], 3)
    expect(after[0]![1]).toBeCloseTo(mirror(before[0]!)[1], 3)
    expect(after[1]![0]).toBeCloseTo(mirror(before[1]!)[0], 3)
    expect(after[1]![1]).toBeCloseTo(mirror(before[1]!)[1], 3)
  })
})

const connected = () => {
  const ed = new EditorCore()
  const a = draw(ed, "rectangle", [0, 0], [100, 100])
  const b = draw(ed, "rectangle", [300, 200], [400, 300])
  const arrow = draw(ed, "arrow", [50, 50], [350, 250]) as ArrowElement
  expect(arrow.startBinding?.elementId).toBe(a.id)
  expect(arrow.endBinding?.elementId).toBe(b.id)
  return { ed, a, b, arrow }
}

describe("align / distribute / flip refresh bound arrows", () => {
  test("aligning two connected shapes keeps the arrow attached", () => {
    const { ed, a, b, arrow } = connected()
    ed.selectElements([a.id, b.id])
    ed.align("top")
    const pts = absPoints(ed.scene.get(arrow.id) as ArrowElement)
    expect(distToOutline(pts[0]!, ed.scene.get(a.id)!)).toBeLessThan(34)
    expect(distToOutline(pts[pts.length - 1]!, ed.scene.get(b.id)!)).toBeLessThan(34)
  })

  test("distributing connected shapes keeps arrows attached", () => {
    const { ed, a, b, arrow } = connected()
    const c = draw(ed, "rectangle", [1000, 0], [1100, 100])
    ed.selectElements([a.id, b.id, c.id])
    ed.distribute("horizontal")
    const pts = absPoints(ed.scene.get(arrow.id) as ArrowElement)
    expect(distToOutline(pts[pts.length - 1]!, ed.scene.get(b.id)!)).toBeLessThan(34)
  })

  test("flipping two connected shapes keeps the arrow attached", () => {
    const { ed, a, b, arrow } = connected()
    ed.selectElements([a.id, b.id])
    ed.flip("horizontal")
    const pts = absPoints(ed.scene.get(arrow.id) as ArrowElement)
    expect(distToOutline(pts[0]!, ed.scene.get(a.id)!)).toBeLessThan(34)
    expect(distToOutline(pts[pts.length - 1]!, ed.scene.get(b.id)!)).toBeLessThan(34)
  })
})

describe("flip mirrors binding focus", () => {
  test("after flipping everything, the next refresh does not move the arrow", () => {
    const ed = new EditorCore()
    draw(ed, "rectangle", [0, 0], [100, 200])
    const b = draw(ed, "rectangle", [300, 0], [400, 200])
    const arrow = draw(ed, "arrow", [50, 30], [350, 170]) as ArrowElement
    ed.selectAll()
    ed.flip("vertical")
    const before = absPoints(ed.scene.get(arrow.id) as ArrowElement)
    ed.selectElements([b.id])
    ed.nudge(1, 0)
    const after = absPoints(ed.scene.get(arrow.id) as ArrowElement)
    const end0 = before[before.length - 1]!
    const end1 = after[after.length - 1]!
    expect(Math.hypot(end1[0] - end0[0], end1[1] - end0[1])).toBeLessThan(3)
  })
})

describe("align and distribute treat groups as units", () => {
  test("align bottom moves a group rigidly", () => {
    const ed = new EditorCore()
    const g1 = draw(ed, "rectangle", [0, 0], [50, 50])
    const g2 = draw(ed, "rectangle", [100, 100], [150, 150])
    const c = draw(ed, "rectangle", [300, 140], [350, 190])
    ed.selectElements([g1.id, g2.id])
    ed.group()
    ed.selectElements([g1.id, c.id])
    ed.align("bottom")
    const y1 = ed.scene.get(g1.id)!.y
    const y2 = ed.scene.get(g2.id)!.y
    expect(y2 - y1).toBeCloseTo(100, 5)
    // group bottom (150) aligns with the lower of the two: 190
    expect(y2 + 50).toBeCloseTo(190, 5)
  })

  test("distribute keeps grouped members together", () => {
    const ed = new EditorCore()
    const d1 = draw(ed, "rectangle", [0, 0], [50, 50])
    const d2 = draw(ed, "rectangle", [60, 0], [110, 50])
    const d3 = draw(ed, "rectangle", [400, 0], [450, 50])
    const d4 = draw(ed, "rectangle", [600, 0], [650, 50])
    ed.selectElements([d1.id, d2.id])
    ed.group()
    ed.selectElements([d1.id, d3.id, d4.id])
    ed.distribute("horizontal")
    expect(ed.scene.get(d2.id)!.x - ed.scene.get(d1.id)!.x).toBeCloseTo(60, 5)
  })
})

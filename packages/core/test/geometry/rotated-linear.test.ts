import { describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { updateBoundArrow } from "../../src/geometry/binding"
import { newElement } from "../../src/model/element"
import type { ArrowElement } from "../../src/model/types"
import { distToOutline, draw, renderedPoints, rotateSelection } from "./helpers"

describe("rotated linear elements keep their bindings", () => {
  test("rotating a selection of two shapes and their connecting arrow keeps the arrow attached", () => {
    const ed = new EditorCore()
    const a = draw(ed, "rectangle", [0, 0], [100, 100])
    const b = draw(ed, "rectangle", [300, 0], [400, 100])
    const arrow = draw(ed, "arrow", [50, 50], [350, 50]) as ArrowElement
    expect(arrow.startBinding?.elementId).toBe(a.id)
    expect(arrow.endBinding?.elementId).toBe(b.id)

    ed.selectAll()
    // handle starts above the centre; pointer to the right of the centre is +90deg
    rotateSelection(ed, (c) => [c[0] + 300, c[1]])

    const pts = renderedPoints(ed.scene.get(arrow.id)!)
    const gapTolerance = 32 + 2
    expect(distToOutline(pts[0]!, ed.scene.get(a.id)!)).toBeLessThan(gapTolerance)
    expect(distToOutline(pts[pts.length - 1]!, ed.scene.get(b.id)!)).toBeLessThan(gapTolerance)
  })

  test("a rotated bound arrow is solved in rendered (rotated) space", () => {
    const shape = newElement("rectangle", { x: 300, y: -50, width: 100, height: 100 })
    // a 2-point arrow drawn horizontally, then rotated 90deg about its centre (200, 0):
    // rendered it runs vertically from (200,-100) to (200,100)
    const arrow = newElement("arrow", {
      x: 100,
      y: 0,
      width: 200,
      height: 0,
      angle: Math.PI / 2,
      points: [
        [0, 0],
        [200, 0],
      ],
      endBinding: { elementId: shape.id, focus: 0, gap: 4 },
    }) as ArrowElement
    const solved = updateBoundArrow(arrow, (id) => (id === shape.id ? shape : undefined))
    const pts = renderedPoints(solved)
    // the free start must not move on screen
    expect(pts[0]![0]).toBeCloseTo(200, 0)
    expect(pts[0]![1]).toBeCloseTo(-100, 0)
    // the bound end must sit next to the shape outline
    expect(distToOutline(pts[pts.length - 1]!, shape)).toBeLessThan(6)
  })
})

import { describe, expect, test } from "vitest"
import { intersectOutline } from "../../src/geometry/binding"
import { getElementBounds } from "../../src/geometry/elementBounds"
import { cornerRadius, elementOutline } from "../../src/geometry/outline"
import { parseExcalidraw } from "../../src/io/excalidraw"
import { boundsFromPoints } from "../../src/math/bounds"
import { newElement } from "../../src/model/element"

describe("rounded diamond outline matches what is drawn", () => {
  // shapes.ts roundedDiamondPath with r = cornerRadius = 32 on a 200x200 diamond:
  // t = 32 / hypot(100,100) = 0.2263, the top corner bulges down to y = 100 * t / 2 = 11.31
  const d = newElement("diamond", { x: 0, y: 0, width: 200, height: 200, roundness: { type: 3 } })

  test("an arrow aimed down at the top corner stops at the drawn corner", () => {
    const hit = intersectOutline(d, [100, -200], [100, 100])!
    expect(hit[1]).toBeCloseTo(11.31, 0)
  })

  test("an arrow aimed at the middle of an edge stops on the drawn straight edge", () => {
    // ray from far up-right toward the centre crosses the top-right edge at (150, 50)
    const hit = intersectOutline(d, [300, -100], [100, 100])!
    expect(hit[0]).toBeCloseTo(150, 0)
    expect(hit[1]).toBeCloseTo(50, 0)
  })
})

describe("imported linear elements report the box they draw", () => {
  test("an Excalidraw arrow with negative points gets a correct box and centre", () => {
    const file = JSON.stringify({
      type: "excalidraw",
      version: 2,
      elements: [
        {
          id: "a1",
          type: "arrow",
          x: 500,
          y: 300,
          width: 400,
          height: 200,
          angle: 0,
          points: [
            [0, 0],
            [-400, -200],
          ],
        },
      ],
    })
    const res = parseExcalidraw(file)
    if (!res.ok) throw new Error(res.error)
    const el = res.elements[0]!
    const drawn = boundsFromPoints(elementOutline(el))
    expect(getElementBounds(el)).toEqual(drawn)
  })
})

describe("corner radius follows the roundness type", () => {
  test("proportional radius (type 2, Excalidraw's diamond/legacy default) is 25% of the short side", () => {
    const r = newElement("rectangle", { x: 0, y: 0, width: 40, height: 40, roundness: { type: 2 } })
    expect(cornerRadius(r)).toBeCloseTo(10, 5)
  })

  test("a custom adaptive radius value is honoured", () => {
    const r = newElement("rectangle", {
      x: 0,
      y: 0,
      width: 300,
      height: 300,
      roundness: { type: 3, value: 8 },
    })
    expect(cornerRadius(r)).toBeCloseTo(8, 5)
  })

  test("the radius never exceeds half the short side", () => {
    const r = newElement("rectangle", {
      x: 0,
      y: 0,
      width: 20,
      height: 200,
      roundness: { type: 2, value: 32 },
    })
    expect(cornerRadius(r)).toBeLessThanOrEqual(10)
  })
})

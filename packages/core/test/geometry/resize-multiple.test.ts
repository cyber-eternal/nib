import { describe, expect, test } from "vitest"
import { getCommonBounds, getElementBounds } from "../../src/geometry/elementBounds"
import { resizeMultiple } from "../../src/geometry/resize"
import { newElement } from "../../src/model/element"

const pair = () => [
  newElement("rectangle", { x: 0, y: 0, width: 100, height: 100 }),
  newElement("rectangle", { x: 200, y: 0, width: 100, height: 100 }),
]
const plain = { keepAspect: false, fromCenter: false }

const expectBounds = (got: readonly number[], want: readonly number[]) => {
  for (let i = 0; i < 4; i++) expect(got[i]).toBeCloseTo(want[i]!, 3)
}

describe("multi-select resize from the west/north handles", () => {
  test("dragging the w handle keeps the selection inside the dragged box", () => {
    const els = pair()
    const orig = getCommonBounds(els) // [0,0,300,100]
    const out = resizeMultiple(els, orig, "w", [-300, 50], plain)
    expectBounds(getCommonBounds(out), [-300, 0, 300, 100])
    // relative layout scales: first box spans the left third
    expectBounds(getElementBounds(out[0]!), [-300, 0, -100, 100])
  })

  test("dragging the nw handle with aspect lock anchors the se corner", () => {
    const els = pair()
    const orig = getCommonBounds(els)
    const out = resizeMultiple(els, orig, "nw", [-300, -100], { keepAspect: true, fromCenter: false })
    expectBounds(getCommonBounds(out), [-300, -100, 300, 100])
  })
})

describe("multi-select resize from the centre", () => {
  test("alt-dragging the e handle grows both sides symmetrically", () => {
    const els = pair()
    const orig = getCommonBounds(els) // centre x = 150
    const out = resizeMultiple(els, orig, "e", [450, 50], { keepAspect: false, fromCenter: true })
    expectBounds(getCommonBounds(out), [-150, 0, 450, 100])
  })
})

describe("multi-select resize through zero", () => {
  test("dragging the e handle past the west edge flips the selection to the other side", () => {
    const els = pair()
    const orig = getCommonBounds(els)
    const out = resizeMultiple(els, orig, "e", [-100, 50], plain)
    expectBounds(getCommonBounds(out), [-100, 0, 0, 100])
  })
})

describe("multi-select resize of rotated elements", () => {
  test("a 90deg-rotated member scales along scene axes, not its local ones", () => {
    // 200x50 rotated 90deg: occupies a 50 wide x 200 tall scene box centred on (100, 25)
    const tall = newElement("rectangle", { x: 0, y: 0, width: 200, height: 50, angle: Math.PI / 2 })
    const other = newElement("rectangle", { x: 300, y: -75, width: 100, height: 200 })
    const els = [tall, other]
    const orig = getCommonBounds(els) // [75,-75,400,125]
    const h = orig[3] - orig[1]
    // stretch vertically x2 with the s handle
    const out = resizeMultiple(els, orig, "s", [0, orig[3] + h], plain)
    expectBounds(getCommonBounds(out), [orig[0], orig[1], orig[2], orig[3] + h])
    const tb = getElementBounds(out[0]!)
    expect(tb[2] - tb[0]).toBeCloseTo(50, 3)
    expect(tb[3] - tb[1]).toBeCloseTo(400, 3)
  })
})

import { afterEach, beforeAll, describe, expect, test } from "vitest"
import { distributeElements } from "../../src/geometry/align"
import {
  createBinding,
  intersectOutline,
  previewAttachPoint,
  solveEndpoint,
  updateBoundArrow,
} from "../../src/geometry/binding"
import { arrowLabelAnchor, layoutBoundText } from "../../src/geometry/boundText"
import { connectorBetween, orthogonalConnector } from "../../src/geometry/connector"
import { routeElbow } from "../../src/geometry/elbow"
import { getElementBounds, getElementVisualBounds } from "../../src/geometry/elementBounds"
import {
  elementAtPoint,
  hitTestElement,
  pointInPolygon,
  segmentHitsElement,
} from "../../src/geometry/hitTest"
import {
  absolutePointsOf,
  bakeRotation,
  rebaseFromPoints,
  sceneToLocalPoint,
} from "../../src/geometry/linear"
import { elementCenter, elementOutline } from "../../src/geometry/outline"
import { flipElements, resizeElement, resizeMultiple, rotateElements } from "../../src/geometry/resize"
import { roundedDiamondPathData, roundedRectPathData } from "../../src/geometry/shapePaths"
import { computeSnap } from "../../src/geometry/snapping"
import { tidyLinearElements } from "../../src/geometry/tidy"
import { type Bounds, boundsFromPoints } from "../../src/math/bounds"
import { mulberry32, randomInteger, setRng } from "../../src/math/random"
import { type Point, rotatePoint } from "../../src/math/vector"
import { newElement } from "../../src/model/element"
import type { ArrowElement, ImageElement, NibElement, TextElement } from "../../src/model/types"
import { setTextMeasurer } from "../../src/render/textMeasure"
import { distToOutline, isOrthogonal, segmentCrossesBox } from "./helpers"

beforeAll(() => setTextMeasurer((t, font) => t.length * Number.parseFloat(font) * 0.5))

const plain = { keepAspect: false, fromCenter: false }

const expectPoint = (got: Point, want: Point, digits = 3) => {
  expect(got[0]).toBeCloseTo(want[0], digits)
  expect(got[1]).toBeCloseTo(want[1], digits)
}

const rotatedArrow = (angle: number): ArrowElement =>
  newElement("arrow", {
    x: 100,
    y: 0,
    width: 200,
    height: 100,
    angle,
    points: [
      [0, 0],
      [200, 100],
    ],
  }) as ArrowElement

describe("rotated linear elements are solved in drawn space", () => {
  test("absolute points apply the rotation and sceneToLocalPoint inverts them", () => {
    const arrow = rotatedArrow(Math.PI / 3)
    const abs = absolutePointsOf(arrow)
    const centre: Point = [200, 50]
    expectPoint(abs[1]!, rotatePoint([300, 100], centre, Math.PI / 3))
    expectPoint(sceneToLocalPoint(arrow, abs[1]!), [200, 100])
  })

  test("rebasing a rotated element keeps its angle and draws exactly the given points", () => {
    const arrow = rotatedArrow(Math.PI / 5)
    const target: Point[] = [
      [40, -30],
      [260, 180],
      [10, 220],
    ]
    const rebased = rebaseFromPoints(arrow, target)
    expect(rebased.angle).toBeCloseTo(Math.PI / 5)
    absolutePointsOf(rebased).forEach((p, i) => expectPoint(p, target[i]!))
    // the element outline (what is hit-tested and painted) agrees
    elementOutline({ ...rebased, roundness: null }).forEach((p, i) => expectPoint(p, target[i]!))
  })

  test("bakeRotation folds the angle into the points without moving the drawing", () => {
    const arrow = rotatedArrow(1.1)
    const before = absolutePointsOf(arrow)
    const baked = bakeRotation(arrow)
    expect(baked.angle).toBe(0)
    absolutePointsOf(baked).forEach((p, i) => expectPoint(p, before[i]!))
    expect(getElementBounds(baked)).toEqual(boundsFromPoints(absolutePointsOf(baked)))
  })

  test("rotateElements bakes the turn into lines and orbits shapes", () => {
    const a = newElement("rectangle", { x: 0, y: 0, width: 100, height: 100 })
    const arrow = newElement("arrow", {
      x: 104,
      y: 50,
      width: 192,
      height: 0,
      points: [
        [0, 0],
        [192, 0],
      ],
    })
    const [ra, rarrow] = rotateElements([a, arrow], [200, 50], Math.PI / 2)
    expect(ra!.angle).toBeCloseTo(Math.PI / 2)
    expectPoint(elementCenter(ra!), [200, -100])
    expect(rarrow!.angle).toBe(0)
    const pts = absolutePointsOf(rarrow as ArrowElement)
    expectPoint(pts[0]!, [200, -46])
    expectPoint(pts[1]!, [200, 146])
  })

  test("a rotated arrow's label sits on the drawn path", () => {
    const arrow = rotatedArrow(Math.PI / 2)
    const abs = absolutePointsOf(arrow)
    expectPoint(arrowLabelAnchor(arrow), [(abs[0]![0] + abs[1]![0]) / 2, (abs[0]![1] + abs[1]![1]) / 2])
  })

  test("tidy squares up a rotated line in scene space", () => {
    // a 200px line drawn at 3deg, then rotated by another 4deg: 7deg on screen
    const line = newElement("line", {
      x: 0,
      y: 0,
      width: 200,
      height: 200 * Math.tan((3 * Math.PI) / 180),
      angle: (4 * Math.PI) / 180,
      points: [
        [0, 0],
        [200, 200 * Math.tan((3 * Math.PI) / 180)],
      ],
    })
    const out = tidyLinearElements([line], { all: [line], zoom: 1 })
    const pts = absolutePointsOf(out.elements[0] as never)
    expect(pts[1]![1]).toBeCloseTo(pts[0]![1], 5)
  })
})

describe("labels take their container's rotation", () => {
  const label = (container: NibElement, align: "left" | "center" = "center"): TextElement =>
    newElement("text", {
      text: "hello",
      originalText: "hello",
      containerId: container.id,
      fontSize: 20,
      textAlign: align,
      verticalAlign: "middle",
    }) as TextElement

  test("a centred label is centred on the rotated container and shares its angle", () => {
    const rect = newElement("rectangle", { x: 0, y: 0, width: 200, height: 100, angle: 1.2 })
    const laid = layoutBoundText(rect, label(rect))
    expect(laid.text.angle).toBeCloseTo(1.2)
    expectPoint(elementCenter(laid.text), elementCenter(rect))
  })

  test("a left-aligned label stays inside the rotated container", () => {
    const rect = newElement("rectangle", { x: 0, y: 0, width: 300, height: 100, angle: Math.PI / 2 })
    const laid = layoutBoundText(rect, label(rect, "left"))
    const outline = elementOutline(laid.container)
    for (const corner of elementOutline(laid.text)) expect(pointInPolygon(corner, outline)).toBe(true)
  })
})

describe("a growing container keeps the edge opposite the handle", () => {
  const words = "one two three four five six seven eight"
  test("dragging the top handle grows the container upward", () => {
    const rect = newElement("rectangle", { x: 0, y: 150, width: 120, height: 20 })
    const text = newElement("text", { text: words, originalText: words, containerId: rect.id, fontSize: 20 })
    const laid = layoutBoundText(rect, text as TextElement, { handle: "n" })
    expect(laid.container.height).toBeGreaterThan(20)
    expect(laid.container.y + laid.container.height).toBeCloseTo(170, 5)
  })

  test("a rotated container grows along its own axis", () => {
    const rect = newElement("rectangle", { x: 0, y: 0, width: 120, height: 20, angle: Math.PI / 2 })
    const text = newElement("text", { text: words, originalText: words, containerId: rect.id, fontSize: 20 })
    const before = elementOutline(rect)
    const laid = layoutBoundText(rect, text as TextElement)
    const after = elementOutline(laid.container)
    // the local top edge (first two outline corners) stays where it was
    expectPoint(after[0]!, before[0]!)
    expectPoint(after[1]!, before[1]!)
  })
})

describe("shared rounded paths", () => {
  test("the diamond path data starts and corners where the outline does", () => {
    const d = roundedDiamondPathData(200, 200, 32)
    expect(d.startsWith("M ")).toBe(true)
    expect(d).toContain(" Q 200 100, ")
    expect(d.trim().endsWith("Z")).toBe(true)
  })

  test("a rounded rectangle path clamps its radius to half the short side", () => {
    const d = roundedRectPathData(40, 20, 32)
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number)
    const ys = nums.filter((_, i) => i % 2 === 1)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...ys)).toBeLessThanOrEqual(20)
  })
})

describe("multi-select resize", () => {
  test("dragging through the anchor mirrors lines, images and binding focus", () => {
    const arrow = newElement("arrow", {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      points: [
        [0, 0],
        [100, 50],
      ],
      endBinding: { elementId: "s", focus: 0.4, gap: 4 },
    }) as ArrowElement
    const img = newElement("image", { x: 200, y: 0, width: 100, height: 50, scale: [1, 1] }) as ImageElement
    const orig: Bounds = [0, 0, 300, 50]
    const out = resizeMultiple([arrow, img], orig, "e", [-300, 25], plain)
    const a = out[0] as ArrowElement
    const pts = absolutePointsOf(a)
    // the start sat on the anchored west edge and stays there; the head now points left
    expectPoint(pts[0]!, [0, 0])
    expectPoint(pts[1]!, [-100, 50])
    expect(a.endBinding!.focus).toBeCloseTo(-0.4)
    expect((out[1] as ImageElement).scale).toEqual([-1, 1])
  })

  test("a member rotated off the right angles scales uniformly and stays inside the box", () => {
    const tilted = newElement("rectangle", { x: 0, y: 0, width: 100, height: 40, angle: Math.PI / 4 })
    const other = newElement("rectangle", { x: 200, y: -100, width: 50, height: 300 })
    const orig = [...getElementBounds(tilted)] as unknown as Bounds
    const all: Bounds = [Math.min(orig[0], 200), -100, 250, 200]
    const out = resizeMultiple([tilted, other], all, "s", [0, 500], plain)
    const tb = getElementBounds(out[0]!)
    expect(tb[1]).toBeGreaterThanOrEqual(-100 - 1e-6)
    expect(tb[3]).toBeLessThanOrEqual(500 + 1e-6)
    expect(out[0]!.width / out[0]!.height).toBeCloseTo(100 / 40, 5)
  })
})

describe("flip", () => {
  test("flipping a whole connected picture mirrors fixed points as well as focus", () => {
    const shape = newElement("rectangle", { x: 300, y: 0, width: 100, height: 100 })
    const arrow = newElement("arrow", {
      x: 0,
      y: 50,
      width: 296,
      height: 0,
      points: [
        [0, 0],
        [296, 0],
      ],
      endBinding: { elementId: shape.id, focus: 0.5, gap: 4, fixedPoint: [0, 0.25] },
    }) as ArrowElement
    const [flipped] = flipElements([arrow, shape], [0, 0, 400, 100], "vertical") as [ArrowElement]
    expect(flipped.endBinding!.focus).toBeCloseTo(-0.5)
    expect(flipped.endBinding!.fixedPoint).toEqual([0, 0.75])
  })
})

describe("elbow routes", () => {
  test("random routes between separated shapes are orthogonal and never cut through either", () => {
    const rng = mulberry32(3)
    let checked = 0
    for (let i = 0; i < 400; i++) {
      const rect = (): NibElement =>
        newElement("rectangle", {
          x: -200 + rng() * 400,
          y: -200 + rng() * 400,
          width: 40 + rng() * 160,
          height: 40 + rng() * 160,
        })
      const a = rect()
      const self = rng() < 0.15
      const b = self ? a : rect()
      const port = (el: NibElement): Point => {
        const t = 0.1 + rng() * 0.8
        switch (Math.floor(rng() * 4)) {
          case 0:
            return [el.x + el.width * t, el.y - 4]
          case 1:
            return [el.x + el.width + 4, el.y + el.height * t]
          case 2:
            return [el.x + el.width * t, el.y + el.height + 4]
          default:
            return [el.x - 4, el.y + el.height * t]
        }
      }
      const s = port(a)
      const e = port(b)
      const near =
        !self &&
        a.x < b.x + b.width + 45 &&
        b.x < a.x + a.width + 45 &&
        a.y < b.y + b.height + 45 &&
        b.y < a.y + a.height + 45
      if (near) continue
      checked++
      const route = routeElbow(s, e, a, b)
      expect(isOrthogonal(route), JSON.stringify(route)).toBe(true)
      for (let k = 0; k < route.length - 1; k++) {
        expect(segmentCrossesBox(route[k]!, route[k + 1]!, a), JSON.stringify(route)).toBe(false)
        expect(segmentCrossesBox(route[k]!, route[k + 1]!, b), JSON.stringify(route)).toBe(false)
      }
    }
    expect(checked).toBeGreaterThan(100)
  })

  test("routes with no shapes keep the dominant-axis L bend", () => {
    expect(routeElbow([10, 10], [300, 200])).toEqual([
      [10, 10],
      [300, 10],
      [300, 200],
    ])
  })
})

describe("routes can avoid other shapes", () => {
  test("a connector detours around an obstacle box it would otherwise cut through", () => {
    const a = newElement("rectangle", { x: 0, y: 0, width: 100, height: 100 })
    const b = newElement("rectangle", { x: 600, y: 0, width: 100, height: 100 })
    const blocker = newElement("rectangle", { x: 300, y: -50, width: 100, height: 200 })
    const padded: Bounds = [280, -70, 420, 170]
    expect(connectorBetween(a, b, 4, 4)).toHaveLength(2)
    const route = connectorBetween(a, b, 4, 4, [padded])
    expect(isOrthogonal(route)).toBe(true)
    for (let k = 0; k < route.length - 1; k++) {
      expect(segmentCrossesBox(route[k]!, route[k + 1]!, blocker), JSON.stringify(route)).toBe(false)
      expect(segmentCrossesBox(route[k]!, route[k + 1]!, a)).toBe(false)
      expect(segmentCrossesBox(route[k]!, route[k + 1]!, b)).toBe(false)
    }
  })

  test("an obstacle covering an end is ignored rather than blocking every route", () => {
    const a = newElement("rectangle", { x: 0, y: 0, width: 100, height: 100 })
    const frame: Bounds = [-500, -500, 1500, 1500]
    const route = routeElbow([104, 50], [600, 300], a, null, { obstacles: [frame] })
    expect(isOrthogonal(route)).toBe(true)
    expect(route[route.length - 1]).toEqual([600, 300])
  })
})

describe("connectors end on the real outline", () => {
  test("an L connector between rotated shapes keeps the gap from each outline", () => {
    const a = newElement("rectangle", { x: 0, y: 0, width: 120, height: 60, angle: 0.4 })
    const b = newElement("diamond", { x: 400, y: 300, width: 120, height: 120 })
    const route = orthogonalConnector(a, b, 4, 4)
    expect(isOrthogonal(route)).toBe(true)
    expect(distToOutline(route[0]!, a)).toBeCloseTo(4, 0)
    expect(distToOutline(route[route.length - 1]!, b)).toBeCloseTo(4, 0)
  })

  test("tidy adopts a loose end with the minimum gap, not the distance it was left at", () => {
    const a = newElement("rectangle", { x: 0, y: 0, width: 100, height: 100 })
    const b = newElement("rectangle", { x: 300, y: 0, width: 100, height: 100 })
    const arrow = newElement("arrow", {
      x: 135,
      y: 50,
      width: 135,
      height: 0,
      points: [
        [0, 0],
        [135, 0],
      ],
    }) as ArrowElement
    const out = tidyLinearElements([arrow], { all: [a, b, arrow], zoom: 1 })
    const t = out.elements[0] as ArrowElement
    const pts = absolutePointsOf(t)
    expect(t.startBinding!.gap).toBe(4)
    expect(t.endBinding!.gap).toBe(4)
    expect(pts[0]![0]).toBeCloseTo(104, 3)
    expect(pts[1]![0]).toBeCloseTo(296, 3)
  })
})

describe("text corner resize scales the font", () => {
  test("doubling the box from the se handle doubles the font size", () => {
    const text = newElement("text", { x: 0, y: 0, width: 100, height: 25, fontSize: 20, text: "hi" })
    const r = resizeElement(text, "se", [200, 50], plain) as TextElement
    expect(r.fontSize).toBeCloseTo(40, 5)
    expect(r.width).toBeCloseTo(200, 5)
    expect(r.height).toBeCloseTo(50, 5)
  })

  test("multi-resize scales standalone text and labels travelling with their container", () => {
    const rect = newElement("rectangle", { x: 0, y: 0, width: 100, height: 50 })
    const lbl = newElement("text", {
      x: 20,
      y: 12,
      width: 60,
      height: 25,
      containerId: rect.id,
      fontSize: 20,
    })
    const free = newElement("text", { x: 200, y: 0, width: 100, height: 25, fontSize: 20 })
    const out = resizeMultiple([rect, lbl, free], [0, 0, 300, 50], "se", [600, 100], plain)
    expect((out[1] as TextElement).fontSize).toBeCloseTo(40, 5)
    expect((out[2] as TextElement).fontSize).toBeCloseTo(40, 5)
  })
})

describe("the hint dot is the committed endpoint", () => {
  test("previewAttachPoint with the tip matches createBinding + updateBoundArrow", () => {
    const shape = newElement("rectangle", { x: 0, y: 0, width: 200, height: 100 })
    const from: Point = [-300, 0]
    const tip: Point = [5, 10]
    let arrow = newElement("arrow", {
      x: from[0],
      y: from[1],
      points: [
        [0, 0],
        [tip[0] - from[0], tip[1] - from[1]],
      ],
    }) as ArrowElement
    arrow = { ...arrow, endBinding: createBinding(shape, arrow, "end") }
    const end = absolutePointsOf(updateBoundArrow(arrow, () => shape))[1]!
    expectPoint(previewAttachPoint(shape, from, tip)!, end)
    expectPoint(solveEndpoint(arrow.endBinding!, shape, from)!, end)
  })
})

describe("curved lines are boxed by their curve", () => {
  test("bounds include the overshoot of a curved arrow", () => {
    const arrow = newElement("arrow", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      roundness: { type: 2 },
      points: [
        [0, 0],
        [100, 0],
        [100, 100],
      ],
    })
    const b = getElementBounds(arrow)
    expect(b[1]).toBeLessThan(-5)
    expect(b[2]).toBeGreaterThan(105)
  })
})

describe("snap guides", () => {
  test("guides span the snapped box", () => {
    const other = newElement("rectangle", { x: 200, y: 0, width: 100, height: 100 })
    const snap = computeSnap([197, 103, 297, 203], [other], 1)
    expect(snap.offset).toEqual([3, -3])
    const x = snap.lines.find((l) => l.axis === "x")!
    const y = snap.lines.find((l) => l.axis === "y")!
    expect(x.from).toBe(0)
    expect(x.to).toBe(200)
    expect(y.from).toBe(200)
    expect(y.to).toBe(300)
  })

  test("an x-only snap never yields NaN extents", () => {
    const other = newElement("rectangle", { x: 200, y: 500, width: 100, height: 100 })
    const snap = computeSnap([197, 0, 297, 100], [other], 1)
    expect(snap.lines).toHaveLength(1)
    expect(Number.isFinite(snap.lines[0]!.from)).toBe(true)
    expect(snap.lines[0]!.from).toBe(0)
  })
})

describe("distribute keeps order", () => {
  test("overlapping extents are spaced by centre without swapping", () => {
    const a = newElement("rectangle", { x: 0, y: 0, width: 300, height: 10 })
    const b = newElement("rectangle", { x: 100, y: 0, width: 50, height: 10 })
    const c = newElement("rectangle", { x: 200, y: 0, width: 50, height: 10 })
    const out = distributeElements([a, b, c], "horizontal")
    const centre = (id: string) => {
      const el = out.find((e) => e.id === id)!
      return el.x + el.width / 2
    }
    expect(centre(b.id)).toBeLessThan(centre(a.id))
    expect(centre(a.id)).toBeLessThan(centre(c.id))
    expect(centre(a.id) - centre(b.id)).toBeCloseTo(centre(c.id) - centre(a.id), 5)
  })
})

describe("freehand fills are not hit", () => {
  test("the inside of a closed freehand loop with a background colour is not a hit", () => {
    const loop = newElement("freedraw", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      backgroundColor: "#ff0000",
      points: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
        [0, 0],
      ],
    })
    expect(hitTestElement(loop, [50, 50], 2)).toBe(false)
    expect(hitTestElement(loop, [50, 1], 2)).toBe(true)
  })
})

describe("the binding gap is measured from the outline", () => {
  test("bound endpoints sit at the gap from rects, ellipses and diamonds", () => {
    const rng = mulberry32(11)
    for (let i = 0; i < 300; i++) {
      const type = (["rectangle", "ellipse", "diamond"] as const)[i % 3]!
      const shape = newElement(type, {
        width: 50 + rng() * 200,
        height: 50 + rng() * 200,
        angle: rng() < 0.3 ? rng() * 6 : 0,
        roundness: rng() < 0.5 ? { type: 3 } : null,
      })
      const dir = rng() * Math.PI * 2
      const from: Point = [shape.width / 2 + Math.cos(dir) * 600, shape.height / 2 + Math.sin(dir) * 600]
      const tip: Point = [rng() * shape.width, rng() * shape.height]
      let arrow = newElement("arrow", {
        x: from[0],
        y: from[1],
        points: [
          [0, 0],
          [tip[0] - from[0], tip[1] - from[1]],
        ],
      }) as ArrowElement
      const gap = 4 + rng() * 20
      arrow = { ...arrow, endBinding: { ...createBinding(shape, arrow, "end"), gap } }
      const pts = absolutePointsOf(updateBoundArrow(arrow, () => shape))
      expect(Math.abs(distToOutline(pts[pts.length - 1]!, shape) - gap)).toBeLessThan(1)
    }
  })
})

describe("side handles with aspect lock", () => {
  test("the other axis grows evenly about its middle", () => {
    const rect = newElement("rectangle", { x: 0, y: 0, width: 100, height: 50 })
    const r = resizeElement(rect, "e", [200, 25], { keepAspect: true, fromCenter: false })
    expect(r.width).toBeCloseTo(200)
    expect(r.height).toBeCloseTo(100)
    expect(r.y + r.height / 2).toBeCloseTo(25)
  })
})

describe("companion edits", () => {
  afterEach(() => setRng(Math.random))

  test("an unknown element type still has an outline and finite bounds", () => {
    const odd = { ...newElement("rectangle", { x: 10, y: 20, width: 30, height: 40 }), type: "blob" }
    const el = odd as unknown as NibElement
    expect(elementOutline(el)).toHaveLength(4)
    expect(getElementVisualBounds(el).every(Number.isFinite)).toBe(true)
  })

  test("a points element with no points falls back to its box", () => {
    const empty = newElement("line", { x: 5, y: 5, width: 0, height: 0, points: [] })
    expect(getElementBounds(empty)).toEqual([5, 5, 5, 5])
    expect(getElementVisualBounds(empty).every(Number.isFinite)).toBe(true)
  })

  test("randomInteger never returns 0", () => {
    setRng(() => 0)
    expect(randomInteger()).toBeGreaterThan(0)
    setRng(() => 0.9999999999)
    expect(randomInteger()).toBeLessThanOrEqual(2 ** 31 - 1)
  })

  test("elementAtPoint can include locked elements", () => {
    const locked = newElement("rectangle", { x: 0, y: 0, width: 100, height: 100, locked: true })
    const state = { editingGroupId: null }
    expect(elementAtPoint([locked], [0, 50], 1, state)).toBeNull()
    expect(elementAtPoint([locked], [0, 50], 1, state, { includeLocked: true })?.id).toBe(locked.id)
  })

  test("segmentHitsElement catches a shape between two samples", () => {
    const rect = newElement("rectangle", { x: 100, y: 0, width: 50, height: 50 })
    expect(segmentHitsElement([0, 25], [300, 25], rect, 2)).toBe(true)
    expect(segmentHitsElement([0, 80], [300, 80], rect, 2)).toBe(false)
    // an unfilled shape is only hit on its stroke, like a click
    expect(segmentHitsElement([110, 10], [140, 40], rect, 2)).toBe(false)
  })
})

describe("diamond corner bindings", () => {
  test("an aim point near a diamond tip is pulled inside so the ray still lands", () => {
    const d = newElement("diamond", { x: 0, y: 0, width: 112, height: 268 })
    const hit = intersectOutline(d, [-49, -456], elementCenter(d))
    expect(hit).not.toBeNull()
    const end = solveEndpoint({ focus: 1, gap: 4 }, d, [-49, -456])
    expect(end).not.toBeNull()
    expect(distToOutline(end!, d)).toBeCloseTo(4, 0)
  })
})

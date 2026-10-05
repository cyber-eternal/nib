import { describe, expect, test } from "vitest"
import {
  FIXED_BINDING_DEPTH,
  MIN_FIXED_BINDING_DEPTH,
  createBinding,
  fromFixedPoint,
  isFixedBindingPoint,
  previewAttachPoint,
  solveEndpoint,
  toFixedPoint,
  updateBoundArrow,
} from "../../src/geometry/binding"
import { containerMaxTextWidth, layoutBoundText, polygonLabelAnchor } from "../../src/geometry/boundText"
import { elbowSegments, moveElbowSegment, routeCrossesBoxes, routeElbow } from "../../src/geometry/elbow"
import { getElementBounds } from "../../src/geometry/elementBounds"
import { absolutePointsOf } from "../../src/geometry/linear"
import { elementOutline } from "../../src/geometry/outline"
import {
  computeBoundsSnap,
  computePointSnap,
  computeSnap,
  handleSnapAxes,
  normalizeGridSize,
  snapToGrid,
} from "../../src/geometry/snapping"
import { type Bounds, expandBounds } from "../../src/math/bounds"
import { mulberry32 } from "../../src/math/random"
import { type Point, distance } from "../../src/math/vector"
import { mutateElement, newElement } from "../../src/model/element"
import type { ArrowElement, NibElement } from "../../src/model/types"
import { isOrthogonal, segmentCrossesBox } from "./helpers"

/** 200 shapes on a jittered grid, so a clear route between any two always exists. */
const crowdedBoard = (seed: number): NibElement[] => {
  const rng = mulberry32(seed)
  const shapes: NibElement[] = []
  for (let row = 0; row < 14; row++)
    for (let col = 0; col < 15; col++) {
      if (shapes.length === 200) break
      const w = 60 + rng() * 80
      const h = 40 + rng() * 60
      const x = col * 220 + 20 + rng() * (180 - w)
      const y = row * 180 + 20 + rng() * (140 - h)
      shapes.push(newElement("rectangle", { x, y, width: w, height: h }))
    }
  return shapes
}

/** Midpoint of the side of `from` facing `to`, `gap` outside it. */
const port = (from: NibElement, to: NibElement, gap = 4): Point => {
  const cx = from.x + from.width / 2
  const cy = from.y + from.height / 2
  const dx = to.x + to.width / 2 - cx
  const dy = to.y + to.height / 2 - cy
  if (Math.abs(dx) / from.width >= Math.abs(dy) / from.height)
    return dx > 0 ? [from.x + from.width + gap, cy] : [from.x - gap, cy]
  return dy > 0 ? [cx, from.y + from.height + gap] : [cx, from.y - gap]
}

const obstaclesExcept = (shapes: readonly NibElement[], skip: readonly NibElement[]): Bounds[] =>
  shapes.filter((s) => !skip.includes(s)).map((s) => expandBounds(getElementBounds(s), 16))

describe("elbow routes avoid obstacles on a crowded board", () => {
  test("routes between random pairs of 200 shapes stay orthogonal and clear of every other shape", () => {
    const shapes = crowdedBoard(3)
    const rng = mulberry32(11)
    let total = 0
    for (let k = 0; k < 40; k++) {
      const a = shapes[Math.floor(rng() * shapes.length)]!
      let b = shapes[Math.floor(rng() * shapes.length)]!
      if (b === a) b = shapes[(shapes.indexOf(a) + 37) % shapes.length]!
      const obstacles = obstaclesExcept(shapes, [a, b])
      const start = port(a, b)
      const end = port(b, a)
      const t0 = performance.now()
      const route = routeElbow(start, end, a, b, { obstacles })
      total += performance.now() - t0
      const label = JSON.stringify({ k, start, end, route })
      expect(route[0], label).toEqual(start)
      expect(route[route.length - 1], label).toEqual(end)
      expect(isOrthogonal(route), label).toBe(true)
      expect(routeCrossesBoxes(route, obstacles), label).toBe(false)
      for (let i = 0; i < route.length - 1; i++) {
        expect(segmentCrossesBox(route[i]!, route[i + 1]!, a), label).toBe(false)
        expect(segmentCrossesBox(route[i]!, route[i + 1]!, b), label).toBe(false)
      }
    }
    // generous for slow CI machines; a typical run averages a few milliseconds
    expect(total / 40).toBeLessThan(40)
  })

  test("routing is deterministic and does not depend on the order of the obstacles", () => {
    const shapes = crowdedBoard(5)
    const a = shapes[15]!
    const b = shapes[184]!
    const obstacles = obstaclesExcept(shapes, [a, b])
    const shuffled = [...obstacles]
    const rng = mulberry32(2)
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
    }
    const first = routeElbow(port(a, b), port(b, a), a, b, { obstacles })
    expect(routeElbow(port(a, b), port(b, a), a, b, { obstacles })).toEqual(first)
    expect(routeElbow(port(a, b), port(b, a), a, b, { obstacles: shuffled })).toEqual(first)
  })

  test("obstacles that do not block the plain route leave it untouched", () => {
    const a = newElement("rectangle", { x: 0, y: 0, width: 100, height: 100 })
    const b = newElement("rectangle", { x: 400, y: 300, width: 100, height: 100 })
    const plain = routeElbow([104, 50], [450, 296], a, b)
    const aside: Bounds[] = [
      [700, -200, 800, -100],
      [-300, 600, -200, 700],
    ]
    expect(routeElbow([104, 50], [450, 296], a, b, { obstacles: aside })).toEqual(plain)
  })

  test("a wall of shapes is routed round its end, not through it", () => {
    const a = newElement("rectangle", { x: 0, y: 200, width: 100, height: 100 })
    const b = newElement("rectangle", { x: 800, y: 200, width: 100, height: 100 })
    const wall: Bounds[] = []
    for (let i = 0; i < 10; i++) wall.push([380, i * 50 - 20, 460, i * 50 + 40])
    const route = routeElbow([104, 250], [796, 250], a, b, { obstacles: wall })
    expect(isOrthogonal(route)).toBe(true)
    expect(routeCrossesBoxes(route, wall)).toBe(false)
    const ys = route.map((p) => p[1])
    expect(Math.min(...ys) <= -20 || Math.max(...ys) >= 490, JSON.stringify(route)).toBe(true)
  })
})

describe("snapping a moving point while resizing or drawing", () => {
  const other = newElement("rectangle", { x: 200, y: 100, width: 100, height: 80 })

  test("a point snaps to the nearest edge or centre within the threshold, scaled by zoom", () => {
    const snap = computePointSnap([203, 137], [other], 1)
    expect(snap.point).toEqual([200, 140])
    expect(snap.lines.map((l) => [l.axis, l.at])).toEqual([
      ["x", 200],
      ["y", 140],
    ])
    expect(computePointSnap([210, 137], [other], 1).point).toEqual([210, 140])
    // 10 scene units is 5 screen pixels at zoom 0.5
    expect(computePointSnap([210, 137], [other], 0.5).point).toEqual([200, 140])
  })

  test("guides reach from the snapped point to the shape it lines up with", () => {
    const snap = computePointSnap([302, 400], [other], 1)
    expect(snap.point).toEqual([300, 400])
    expect(snap.lines).toEqual([{ axis: "x", at: 300, from: 100, to: 400 }])
  })

  test("only the axes a handle moves are snapped", () => {
    expect(handleSnapAxes("e")).toEqual({ x: true, y: false })
    expect(handleSnapAxes("n")).toEqual({ x: false, y: true })
    expect(handleSnapAxes("se")).toEqual({ x: true, y: true })
    expect(handleSnapAxes("rotation")).toEqual({ x: false, y: false })
    const snap = computePointSnap([203, 137], [other], 1, { axes: handleSnapAxes("e") })
    expect(snap.point).toEqual([200, 137])
    expect(snap.lines).toHaveLength(1)
  })

  test("the grid takes any axis no object pulled", () => {
    const snap = computePointSnap([203, 157], [other], 1, { gridSize: 20 })
    expect(snap.point).toEqual([200, 160])
    expect(snap.lines.map((l) => l.axis)).toEqual(["x"])
    expect(computePointSnap([33, 47], [], 1, { gridSize: 25 }).point).toEqual([25, 50])
    expect(computePointSnap([33, 47], [], 1, { gridSize: 25, axes: { x: true, y: false } }).point).toEqual([
      25, 47,
    ])
  })

  test("line ends snap to the vertices of other lines", () => {
    const line = newElement("line", {
      x: 500,
      y: 500,
      width: 100,
      height: 60,
      points: [
        [0, 0],
        [40, 60],
        [100, 0],
      ],
    })
    const snap = computePointSnap([542, 556], [line], 1)
    expect(snap.point).toEqual([540, 560])
  })

  test("grid sizes from preferences or files are sanitised", () => {
    expect(normalizeGridSize(20)).toBe(20)
    expect(normalizeGridSize(12.6)).toBe(13)
    expect(normalizeGridSize(1)).toBe(4)
    expect(normalizeGridSize(5000)).toBe(200)
    expect(normalizeGridSize(0)).toBeNull()
    expect(normalizeGridSize(-5)).toBeNull()
    expect(normalizeGridSize(Number.NaN)).toBeNull()
    expect(normalizeGridSize("20")).toBeNull()
    expect(snapToGrid([13, 27], 10)).toEqual([10, 30])
    expect(snapToGrid([13, 27], Number.NaN)).toEqual([13, 27])
    expect(snapToGrid([13, 27], -10)).toEqual([13, 27])
  })
})

describe("gap snapping while moving", () => {
  const left: Bounds = [0, 0, 100, 100]
  const right: Bounds = [300, 0, 400, 100]

  test("a box dropped between two neighbours centres in the space between them", () => {
    // 100 wide in a 200 gap: 50 either side
    const snap = computeBoundsSnap([153, 20, 253, 80], [left, right], 1)
    expect(snap.offset).toEqual([-3, 0])
    const gaps = snap.lines.filter((l) => l.kind === "gap")
    expect(gaps.map((l) => [l.from, l.to, l.distance])).toEqual([
      [100, 150, 50],
      [250, 300, 50],
    ])
    expect(gaps.every((l) => l.axis === "y" && l.at === 50)).toBe(true)
  })

  test("a box past the last neighbour repeats their spacing", () => {
    // left..right gap is 200, so the next box starts 200 past right's far edge
    const snap = computeBoundsSnap([603, 10, 653, 60], [left, right], 1)
    expect(snap.offset[0]).toBe(-3)
    const gaps = snap.lines.filter((l) => l.kind === "gap")
    expect(gaps.map((l) => l.distance)).toEqual([200, 200])
  })

  test("vertical stacks snap to equal spacing too", () => {
    const top: Bounds = [0, 0, 100, 50]
    const mid: Bounds = [0, 100, 100, 150]
    const snap = computeBoundsSnap([10, 198, 90, 248], [top, mid], 1)
    expect(snap.offset).toEqual([0, 2])
    expect(snap.lines.filter((l) => l.kind === "gap").every((l) => l.axis === "x" && l.distance === 50)).toBe(
      true,
    )
  })

  test("shapes outside the moving box's band, or with a shape between them, are not a gap", () => {
    expect(computeBoundsSnap([153, 300, 253, 380], [left, right], 1).offset).toEqual([0, 0])
    const between: Bounds = [180, 0, 220, 100]
    const snap = computeBoundsSnap([603, 10, 653, 60], [left, between, right], 1)
    expect(snap.lines.some((l) => l.kind === "gap" && l.distance === 200)).toBe(false)
  })

  test("gap snapping can be turned off, and alignment still wins when closer", () => {
    expect(computeBoundsSnap([153, 20, 253, 80], [left, right], 1, { gaps: false }).offset).toEqual([0, 0])
    const snap = computeBoundsSnap([152, 1, 252, 101], [left, right], 1)
    expect(snap.offset).toEqual([-2, -1])
  })

  test("one alignment guide spans every shape lined up on it", () => {
    const a = newElement("rectangle", { x: 0, y: 0, width: 100, height: 50 })
    const b = newElement("rectangle", { x: 0, y: 400, width: 60, height: 50 })
    const snap = computeSnap([2, 200, 82, 260], [a, b], 1, { gaps: false })
    expect(snap.offset).toEqual([-2, 0])
    expect(snap.lines).toEqual([{ axis: "x", at: 0, from: 0, to: 450 }])
  })
})

describe("binding to a fixed point inside a shape", () => {
  const shapes: NibElement[] = [
    newElement("rectangle", { x: 100, y: 100, width: 200, height: 100 }),
    newElement("ellipse", { x: 100, y: 100, width: 200, height: 100, angle: 0.6 }),
    newElement("diamond", { x: 100, y: 100, width: 160, height: 160, angle: -1.1 }),
  ]

  test("only a tip well inside the outline counts as a fixed point", () => {
    for (const s of shapes) {
      const c: Point = [s.x + s.width / 2, s.y + s.height / 2]
      expect(isFixedBindingPoint(s, c), s.type).toBe(true)
      expect(isFixedBindingPoint(s, [c[0] + 1000, c[1]]), s.type).toBe(false)
    }
    const rect = shapes[0]!
    // half-span 50, so the tip must be at least 12.5 inside an edge
    expect(FIXED_BINDING_DEPTH).toBe(0.25)
    expect(isFixedBindingPoint(rect, [200, 110])).toBe(false)
    expect(isFixedBindingPoint(rect, [200, 114])).toBe(true)
    // a small shape needs MIN_FIXED_BINDING_DEPTH, so most drops on it still bind to the outline
    const small = newElement("rectangle", { x: 0, y: 0, width: 24, height: 24 })
    expect(isFixedBindingPoint(small, [12, 12])).toBe(true)
    expect(isFixedBindingPoint(small, [12, 6])).toBe(false)
    expect(MIN_FIXED_BINDING_DEPTH).toBe(8)
  })

  test("a binding made deep inside a rotated shape keeps its spot through moves, turns and resizes", () => {
    for (const s of shapes) {
      const c: Point = [s.x + s.width / 2, s.y + s.height / 2]
      const tip: Point = [c[0] + 12, c[1] - 8]
      const arrow = newElement("arrow", {
        x: -200,
        y: -100,
        width: tip[0] + 200,
        height: tip[1] + 100,
        points: [
          [0, 0],
          [tip[0] + 200, tip[1] + 100],
        ],
      }) as ArrowElement
      const binding = createBinding(s, arrow, "end", undefined, { allowFixed: true })
      expect(binding.fixedPoint, s.type).toBeTruthy()
      expect(distance(fromFixedPoint(s, binding.fixedPoint!), tip)).toBeLessThan(1e-9)
      const bound = mutateElement(arrow, { endBinding: binding })
      const moved = mutateElement(s, {
        x: s.x + 300,
        y: s.y - 50,
        width: s.width * 1.5,
        angle: s.angle + 0.7,
      } as Partial<NibElement>)
      const next = updateBoundArrow(bound, (id) => (id === s.id ? moved : undefined))
      const end = absolutePointsOf(next).at(-1)!
      expect(distance(end, fromFixedPoint(moved, binding.fixedPoint!)), s.type).toBeLessThan(1e-6)
      expect(toFixedPoint(moved, end)[0]).toBeCloseTo(binding.fixedPoint![0], 9)
      expect(toFixedPoint(moved, end)[1]).toBeCloseTo(binding.fixedPoint![1], 9)
    }
  })

  test("without allowFixed, or near the outline, the end still stops at the outline", () => {
    const rect = shapes[0]!
    const arrow = newElement("arrow", {
      x: 0,
      y: 150,
      width: 200,
      height: 0,
      points: [
        [0, 0],
        [200, 0],
      ],
    }) as ArrowElement
    expect(createBinding(rect, arrow, "end").fixedPoint).toBeUndefined()
    const shallow = mutateElement(arrow, {
      width: 105,
      points: [
        [0, 0],
        [105, 0],
      ],
    })
    expect(createBinding(rect, shallow, "end", undefined, { allowFixed: true }).fixedPoint).toBeUndefined()
  })

  test("the hint dot shows the pinned spot the commit will use", () => {
    const rect = shapes[0]!
    expect(previewAttachPoint(rect, [0, 150], [210, 160], { allowFixed: true })).toEqual([210, 160])
    const outline = previewAttachPoint(rect, [0, 150], [210, 160])!
    expect(outline[0]).toBeLessThan(100)
    expect(solveEndpoint({ focus: 0, gap: 4, fixedPoint: [0.25, 0.5] }, rect, [0, 0])).toEqual([150, 150])
  })
})

describe("dragging an elbow segment keeps the route orthogonal", () => {
  const route: Point[] = [
    [0, 0],
    [100, 0],
    [100, 200],
    [300, 200],
  ]

  test("segments report their midpoints and direction", () => {
    expect(elbowSegments(route)).toEqual([
      { index: 0, mid: [50, 0], horizontal: true, length: 100 },
      { index: 1, mid: [100, 100], horizontal: false, length: 200 },
      { index: 2, mid: [200, 200], horizontal: true, length: 200 },
    ])
  })

  test("an inner segment slides sideways and its neighbours stretch", () => {
    expect(moveElbowSegment(route, 1, [160, 90])).toEqual([
      [0, 0],
      [160, 0],
      [160, 200],
      [300, 200],
    ])
  })

  test("the first or last segment keeps a stub at the end it leaves from", () => {
    const first = moveElbowSegment(route, 0, [40, -60])
    expect(first[0]).toEqual([0, 0])
    expect(first.at(-1)).toEqual([300, 200])
    expect(isOrthogonal(first, 1e-9)).toBe(true)
    expect(first[1]).toEqual([20, 0])
    expect(first.some((p) => p[1] === -60)).toBe(true)
    const last = moveElbowSegment(route, 2, [200, 260])
    expect(last[0]).toEqual([0, 0])
    expect(last.at(-1)).toEqual([300, 200])
    expect(isOrthogonal(last, 1e-9)).toBe(true)
    expect(last.at(-2)).toEqual([280, 200])
  })

  test("a straight two-point route gains a detour with both ends kept", () => {
    const moved = moveElbowSegment(
      [
        [0, 0],
        [300, 0],
      ],
      0,
      [150, 80],
    )
    expect(moved).toEqual([
      [0, 0],
      [20, 0],
      [20, 80],
      [280, 80],
      [280, 0],
      [300, 0],
    ])
  })

  test("out-of-range or diagonal segments are left alone", () => {
    expect(moveElbowSegment(route, 7, [0, 0])).toEqual(route)
    expect(
      moveElbowSegment(
        [
          [0, 0],
          [50, 50],
        ],
        0,
        [10, 10],
      ),
    ).toEqual([
      [0, 0],
      [50, 50],
    ])
  })
})

describe("closed polygon lines carry labels", () => {
  const triangle = newElement("line", {
    x: 0,
    y: 0,
    width: 300,
    height: 240,
    polygon: true,
    points: [
      [150, 0],
      [300, 240],
      [0, 240],
      [150, 0],
    ],
  })

  test("the label fits about half the polygon's width", () => {
    expect(containerMaxTextWidth(triangle)).toBe(140)
  })

  test("the label centres on the area centroid and the polygon is left as drawn", () => {
    expect(polygonLabelAnchor(triangle)[0]).toBeCloseTo(150, 9)
    expect(polygonLabelAnchor(triangle)[1]).toBeCloseTo(160, 9)
    const text = newElement("text", { text: "Hi", originalText: "Hi", containerId: triangle.id })
    const out = layoutBoundText(triangle, text)
    expect(out.container).toBe(triangle)
    expect(out.text.x + out.text.width / 2).toBeCloseTo(150, 6)
    expect(out.text.y + out.text.height / 2).toBeCloseTo(160, 6)
  })

  test("an open line's label sits halfway along it, like an arrow's", () => {
    const line = newElement("line", {
      x: 0,
      y: 0,
      width: 200,
      height: 0,
      points: [
        [0, 0],
        [200, 0],
      ],
    })
    const text = newElement("text", { text: "Hi", originalText: "Hi", containerId: line.id })
    const out = layoutBoundText(line, text)
    expect(out.container).toBe(line)
    expect(out.text.x + out.text.width / 2).toBeCloseTo(100, 6)
    expect(out.text.y + out.text.height / 2).toBeCloseTo(0, 6)
  })
})

describe("closed polygon lines hit-test the edges they draw", () => {
  test("a rounded closed line keeps straight edges in its outline, as the renderer draws it", () => {
    const triangle = newElement("line", {
      x: 0,
      y: 0,
      width: 300,
      height: 240,
      polygon: true,
      roundness: { type: 2 },
      points: [
        [150, 0],
        [300, 240],
        [0, 240],
        [150, 0],
      ],
    })
    expect(elementOutline(triangle)).toEqual(absolutePointsOf(triangle))
    expect(getElementBounds(triangle)).toEqual([0, 0, 300, 240])
  })

  test("bounds of a line with malformed points fall back to its box instead of throwing", () => {
    const broken = { ...newElement("line", { x: 5, y: 6, width: 10, height: 20 }), points: {} } as never
    expect(getElementBounds(broken)).toEqual([5, 6, 15, 26])
  })
})

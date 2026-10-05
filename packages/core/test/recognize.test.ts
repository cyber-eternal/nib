import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { type Recognized, recognizeStroke } from "../src/geometry/recognize"
import {
  circularArcFit,
  convexHull,
  cumulativeLengths,
  douglasPeucker,
  fitEllipse,
  minAreaRect,
  pathLength,
  pca,
  pointToSegment,
  polygonArea,
  resample,
} from "../src/math/fit"
import { mulberry32 } from "../src/math/random"
import { type Point, distanceToSegment } from "../src/math/vector"
import {
  CASES,
  CASE_NAMES,
  NEGATIVE_KINDS,
  SHAPE_KINDS,
  type Sample,
  compareToTruth,
  synthCase,
  synthNegative,
  synthShape,
} from "./fixtures/pencil/synth"

const DEG = Math.PI / 180

const ellipsePts = (cx: number, cy: number, rx: number, ry: number, angle = 0, n = 64, sweep = 1): Point[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * 2 * Math.PI * sweep
    const x = rx * Math.cos(t)
    const y = ry * Math.sin(t)
    return [cx + x * Math.cos(angle) - y * Math.sin(angle), cy + x * Math.sin(angle) + y * Math.cos(angle)]
  })

const polyPts = (verts: readonly Point[], perEdge = 20, closed = true): Point[] => {
  const out: Point[] = []
  const edges = closed ? verts.length : verts.length - 1
  for (let e = 0; e < edges; e++) {
    const a = verts[e]!
    const b = verts[(e + 1) % verts.length]!
    for (let k = 0; k < perEdge; k++)
      out.push([a[0] + ((b[0] - a[0]) * k) / perEdge, a[1] + ((b[1] - a[1]) * k) / perEdge])
  }
  out.push(closed ? verts[0]! : verts[verts.length - 1]!)
  return out
}

const rotated = (pts: readonly Point[], angle: number, c: Point): Point[] =>
  pts.map((p) => {
    const dx = p[0] - c[0]
    const dy = p[1] - c[1]
    return [
      c[0] + dx * Math.cos(angle) - dy * Math.sin(angle),
      c[1] + dx * Math.sin(angle) + dy * Math.cos(angle),
    ]
  })

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Zero when segment ab runs parallel to segment cd. */
const parallel = (a: Point, b: Point, c: Point, d: Point) =>
  Math.abs((b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]))

const as = <K extends Recognized["kind"]>(
  r: Recognized | null,
  kind: K,
): Extract<Recognized, { kind: K }> => {
  expect(r?.kind).toBe(kind)
  return r as Extract<Recognized, { kind: K }>
}

describe("fit helpers", () => {
  test("pathLength and cumulativeLengths", () => {
    const pts: Point[] = [
      [0, 0],
      [3, 4],
      [3, 8],
    ]
    expect(pathLength(pts)).toBeCloseTo(9)
    expect(cumulativeLengths(pts)).toEqual([0, 5, 9])
    expect(pathLength([])).toBe(0)
  })

  test("resample spaces points equally and keeps both ends", () => {
    const out = resample(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      5,
    )
    expect(out).toHaveLength(5)
    expect(out[0]).toEqual([0, 0])
    expect(out[4]).toEqual([10, 10])
    for (let i = 1; i < out.length; i++) expect(dist(out[i]!, out[i - 1]!)).toBeCloseTo(5)
    const part = resample(
      [
        [0, 0],
        [10, 0],
      ],
      3,
      2,
      6,
    )
    expect(part).toEqual([
      [2, 0],
      [4, 0],
      [6, 0],
    ])
    expect(resample([[1, 2]], 3)).toEqual([
      [1, 2],
      [1, 2],
      [1, 2],
    ])
  })

  test("convexHull drops interior and collinear points; polygonArea is signed", () => {
    const hull = convexHull([
      [0, 0],
      [5, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [4, 6],
      [2, 3],
    ])
    expect(hull).toHaveLength(4)
    expect(Math.abs(polygonArea(hull))).toBeCloseTo(100)
    expect(polygonArea([...hull].reverse())).toBeCloseTo(-polygonArea(hull))
  })

  test("minAreaRect finds a rotated rectangle", () => {
    const pts = rotated(
      polyPts(
        [
          [0, 0],
          [80, 0],
          [80, 30],
          [0, 30],
        ],
        5,
      ),
      25 * DEG,
      [40, 15],
    )
    const r = minAreaRect(pts)
    expect(r.width * r.height).toBeCloseTo(2400, 0)
    expect(Math.max(r.width, r.height)).toBeCloseTo(80, 1)
    const a = (((r.width > r.height ? r.angle : r.angle + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI
    expect(a).toBeCloseTo(25 * DEG, 3)
    expect(r.center[0]).toBeCloseTo(40)
    expect(r.center[1]).toBeCloseTo(15)
  })

  test("minAreaRect's calipers match trying every hull edge, and its corners enclose every point", () => {
    const rng = mulberry32(7)
    for (let trial = 0; trial < 300; trial++) {
      const n = 3 + Math.floor(rng() * 60)
      const sx = 1 + rng() * 300
      const sy = 1 + rng() * 300
      // Every third set is a dense loop whose closing point differs from its start only by float error.
      const pts: Point[] =
        trial % 3 === 2
          ? ellipsePts(rng() * 100, rng() * 100, sx, sy, rng() * 3, n + 20)
          : Array.from({ length: n }, () => [rng() * sx - 500, rng() * sy + 900])
      if (trial % 3 === 1) pts.push([pts[0]![0] + 1e-13, pts[0]![1] - 1e-13])
      const hull = convexHull(pts)
      let brute = Number.POSITIVE_INFINITY
      for (let i = 0; i < hull.length; i++) {
        const a = hull[i]!
        const b = hull[(i + 1) % hull.length]!
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
        const us = hull.map((p) => p[0] * Math.cos(ang) + p[1] * Math.sin(ang))
        const vs = hull.map((p) => -p[0] * Math.sin(ang) + p[1] * Math.cos(ang))
        brute = Math.min(brute, (Math.max(...us) - Math.min(...us)) * (Math.max(...vs) - Math.min(...vs)))
      }
      const r = minAreaRect(pts)
      expect(r.width * r.height).toBeCloseTo(brute, 6)
      const c = Math.cos(r.angle)
      const s = Math.sin(r.angle)
      for (const p of pts) {
        const u = (p[0] - r.center[0]) * c + (p[1] - r.center[1]) * s
        const v = -(p[0] - r.center[0]) * s + (p[1] - r.center[1]) * c
        expect(Math.abs(u)).toBeLessThanOrEqual(r.width / 2 + 1e-6)
        expect(Math.abs(v)).toBeLessThanOrEqual(r.height / 2 + 1e-6)
      }
    }
    expect(minAreaRect([[3, 4]]).width).toBe(0)
    const seg = minAreaRect([
      [0, 0],
      [30, 40],
    ])
    expect(seg.width).toBeCloseTo(50)
    expect(seg.height).toBeCloseTo(0)
  })

  test("pca recovers the direction of an elongated cloud", () => {
    const pts: Point[] = Array.from({ length: 50 }, (_, i) => [
      i * Math.cos(30 * DEG),
      i * Math.sin(30 * DEG),
    ])
    const axes = pca(pts)
    expect(axes.angle).toBeCloseTo(30 * DEG)
    expect(axes.lambda2).toBeCloseTo(0)
    expect(axes.lambda1).toBeGreaterThan(100)
  })

  test("douglasPeucker keeps corners, and a closed loop's corners do not depend on its start", () => {
    const open: Point[] = [
      [0, 0],
      [5, 0.2],
      [10, 0],
      [10, 5],
      [10, 10],
    ]
    expect(douglasPeucker(open, 1)).toEqual([0, 2, 4])
    const square = polyPts(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      5,
    ).slice(0, -1)
    for (const shift of [0, 3, 7, 12]) {
      const loop = [...square.slice(shift), ...square.slice(0, shift)]
      const kept = douglasPeucker(loop, 0.5, true).map((i) => loop[i]!)
      expect(kept).toHaveLength(4)
      for (const c of [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ] as Point[]) {
        expect(kept.some((p) => dist(p, c) < 1e-9)).toBe(true)
      }
    }
  })

  test("pointToSegment is the shared segment distance", () => {
    expect(pointToSegment).toBe(distanceToSegment)
    expect(pointToSegment([5, 3], [0, 0], [10, 0])).toBeCloseTo(3)
  })

  test("circularArcFit fits an arc and rejects collinear points", () => {
    const arc: Point[] = Array.from({ length: 20 }, (_, i) => {
      const t = (i / 19) * 1.2
      return [10 + 50 * Math.cos(t), 20 + 50 * Math.sin(t)]
    })
    const fit = circularArcFit(arc)!
    expect(fit.center[0]).toBeCloseTo(10)
    expect(fit.center[1]).toBeCloseTo(20)
    expect(fit.radius).toBeCloseTo(50)
    expect(fit.rms).toBeCloseTo(0)
    expect(
      circularArcFit([
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
      ]),
    ).toBeNull()
  })

  test("fitEllipse recovers an ellipse from a partial, rotated outline", () => {
    const fit = fitEllipse(ellipsePts(100, 50, 80, 30, 0.5, 48, 0.85))!
    expect(fit.center[0]).toBeCloseTo(100)
    expect(fit.center[1]).toBeCloseTo(50)
    const major = Math.max(fit.rx, fit.ry)
    const dir = fit.rx >= fit.ry ? fit.angle : fit.angle + Math.PI / 2
    expect(major).toBeCloseTo(80)
    expect(Math.min(fit.rx, fit.ry)).toBeCloseTo(30)
    expect(Math.abs(Math.sin(dir - 0.5))).toBeLessThan(1e-6)
    expect(
      fitEllipse(
        polyPts(
          [
            [0, 0],
            [10, 10],
          ],
          6,
          false,
        ),
      ),
    ).toBeNull()
  })
})

describe("recognizeStroke: shapes and beautify", () => {
  test("a round loop becomes a circle", () => {
    const e = as(recognizeStroke(ellipsePts(200, 200, 80, 78), { zoom: 1 }), "ellipse")
    expect(e.rx).toBe(e.ry)
    expect(e.rx).toBeCloseTo(79, 0)
    expect(e.angle).toBe(0)
    expect(e.cx).toBeCloseTo(200, 0)
    expect(e.score).toBeLessThanOrEqual(1)
  })

  test("a tilted ellipse keeps its angle; one near an axis is squared up with its axes swapped", () => {
    const tilted = as(recognizeStroke(ellipsePts(0, 0, 120, 50, 30 * DEG), { zoom: 1 }), "ellipse")
    expect(tilted.angle).toBeCloseTo(30 * DEG, 2)
    expect(tilted.rx).toBeCloseTo(120, 0)
    expect(tilted.ry).toBeCloseTo(50, 0)
    const upright = as(recognizeStroke(ellipsePts(0, 0, 120, 50, 85 * DEG), { zoom: 1 }), "ellipse")
    expect(upright.angle).toBe(0)
    expect(upright.rx).toBeCloseTo(50, 0)
    expect(upright.ry).toBeCloseTo(120, 0)
  })

  test("rectangles: angle kept, near-axis squared up, near-square made square", () => {
    const box: Point[] = [
      [0, 0],
      [200, 0],
      [200, 100],
      [0, 100],
    ]
    const r20 = as(recognizeStroke(rotated(polyPts(box), 20 * DEG, [100, 50]), { zoom: 1 }), "rectangle")
    expect(r20.angle).toBeCloseTo(20 * DEG, 3)
    expect(r20.w).toBeCloseTo(200, 0)
    expect(r20.h).toBeCloseTo(100, 0)
    expect(r20.cx).toBeCloseTo(100, 0)
    expect(r20.cy).toBeCloseTo(50, 0)
    const r5 = as(recognizeStroke(rotated(polyPts(box), 5 * DEG, [100, 50]), { zoom: 1 }), "rectangle")
    expect(r5.angle).toBe(0)
    const sq = as(
      recognizeStroke(
        polyPts([
          [0, 0],
          [104, 0],
          [104, 100],
          [0, 100],
        ]),
        { zoom: 1 },
      ),
      "rectangle",
    )
    expect(sq.w).toBe(sq.h)
  })

  test("a square turned 45° is a diamond, and a near-square diamond is equalised", () => {
    const sq = rotated(
      polyPts([
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ]),
      45 * DEG,
      [50, 50],
    )
    const d = as(recognizeStroke(sq, { zoom: 1 }), "diamond")
    expect(d.w).toBeCloseTo(141.4, 0)
    expect(d.w).toBe(d.h)
    const tall = as(
      recognizeStroke(
        polyPts([
          [100, 0],
          [160, 100],
          [100, 200],
          [40, 100],
        ]),
        { zoom: 1 },
      ),
      "diamond",
    )
    expect(tall.w).toBeCloseTo(120, 0)
    expect(tall.h).toBeCloseTo(200, 0)
    expect(tall.cx).toBeCloseTo(100, 0)
    expect(tall.cy).toBeCloseTo(100, 0)
  })

  test("triangles: a nearly level base is levelled, a nearly equilateral one is made equilateral", () => {
    const level = (v: readonly Point[]) =>
      [0, 1, 2].some((i) => Math.abs(v[i]![1] - v[(i + 1) % 3]![1]) < 1e-6)
    const scalene = rotated(
      polyPts([
        [0, 0],
        [240, 0],
        [80, 140],
      ]),
      4 * DEG,
      [107, 47],
    )
    expect(level(as(recognizeStroke(scalene, { zoom: 1 }), "triangle").vertices)).toBe(true)
    // Legs within 8% would make it isosceles, but only by moving the vertex opposite the level base.
    const nearIso = rotated(
      polyPts([
        [0, 0],
        [200, 0],
        [60, 120],
      ]),
      4 * DEG,
      [87, 40],
    )
    expect(level(as(recognizeStroke(nearIso, { zoom: 1 }), "triangle").vertices)).toBe(true)
    const iso = as(
      recognizeStroke(
        rotated(
          polyPts([
            [0, 0],
            [160, 0],
            [83, 150],
          ]),
          3 * DEG,
          [80, 50],
        ),
        { zoom: 1 },
      ),
      "triangle",
    )
    expect(level(iso.vertices)).toBe(true)
    const [p, q, r] = iso.vertices
    const isoSides = [dist(p, q), dist(q, r), dist(r, p)].sort((a, b) => a - b)
    expect(isoSides[2]! - isoSides[1]!).toBeLessThan(1e-6)
    const eq = as(
      recognizeStroke(
        polyPts([
          [0, 0],
          [100, 0],
          [52, 90],
        ]),
        { zoom: 1 },
      ),
      "triangle",
    )
    const eqSides = [0, 1, 2].map((i) => dist(eq.vertices[i]!, eq.vertices[(i + 1) % 3]!))
    expect(Math.max(...eqSides) - Math.min(...eqSides)).toBeLessThan(1e-6)
  })

  test("a triangle comes back as three vertices of the drawn corners", () => {
    const corners: Point[] = [
      [0, 0],
      [240, 0],
      [80, 140],
    ]
    const t = as(recognizeStroke(rotated(polyPts(corners), 0.3, [100, 50]), { zoom: 1 }), "triangle")
    const want = rotated(corners, 0.3, [100, 50])
    for (const w of want) expect(Math.min(...t.vertices.map((v) => dist(v, w)))).toBeLessThan(1)
    const reversed = as(
      recognizeStroke(rotated(polyPts(corners), 0.3, [100, 50]).reverse(), { zoom: 1 }),
      "triangle",
    )
    expect(polygonArea(t.vertices)).toBeGreaterThan(0)
    expect(polygonArea(reversed.vertices)).toBeGreaterThan(0)
  })

  test("lines snap to 0/45/90° within 4°, or to 15° steps with Shift", () => {
    const at = (deg: number): Point[] =>
      Array.from({ length: 20 }, (_, i) => [i * 10 * Math.cos(deg * DEG), i * 10 * Math.sin(deg * DEG)])
    const flat = as(recognizeStroke(at(2), { zoom: 1 }), "line")
    expect(flat.from[1]).toBeCloseTo(flat.to[1])
    const free = as(recognizeStroke(at(20), { zoom: 1 }), "line")
    expect(Math.atan2(free.to[1] - free.from[1], free.to[0] - free.from[0])).toBeCloseTo(20 * DEG)
    const stepped = as(recognizeStroke(at(20), { zoom: 1, shift: true }), "line")
    expect(Math.atan2(stepped.to[1] - stepped.from[1], stepped.to[0] - stepped.from[0])).toBeCloseTo(15 * DEG)
    expect(dist(stepped.from, stepped.to)).toBeCloseTo(190)
  })

  const arrowStroke = (): Point[] => {
    const tip: Point = [300, 100]
    const back = Math.PI + 10 * DEG
    const barb = (spread: number): Point => [
      tip[0] + 50 * Math.cos(back + spread),
      tip[1] + 50 * Math.sin(back + spread),
    ]
    return polyPts([[0, 47], tip, barb(30 * DEG), tip, barb(-30 * DEG)], 15, false)
  }

  test("an arrow: shaft, then a barb-back-barb head", () => {
    const a = as(recognizeStroke(arrowStroke(), { zoom: 1 }), "arrow")
    expect(dist(a.from, [0, 47])).toBeLessThan(2)
    expect(dist(a.to, [300, 100])).toBeLessThan(2)
    expect(a.via).toBeUndefined()
    expect(a.startHead).toBeFalsy()
  })

  test("an arrow drawn head first keeps its direction and puts the head at `from`", () => {
    const a = as(recognizeStroke([...arrowStroke()].reverse(), { zoom: 1 }), "arrow")
    expect(a.startHead).toBe(true)
    expect(dist(a.from, [300, 100])).toBeLessThan(2)
    expect(dist(a.to, [0, 47])).toBeLessThan(2)
  })

  test("a curved shaft gives a curved arrow through the arc's midpoint", () => {
    const shaft: Point[] = Array.from({ length: 40 }, (_, i) => {
      const t = Math.PI * (0.9 - (0.8 * i) / 39)
      return [200 + 150 * Math.cos(t), 200 - 150 * Math.sin(t)]
    })
    const tip = shaft[shaft.length - 1]!
    // Travel at the tip is along the tangent; the barbs fan out 30° either side of straight back.
    const t = Math.PI * 0.1
    const back = Math.atan2(-Math.cos(t), -Math.sin(t))
    const barb = (spread: number): Point => [
      tip[0] + 40 * Math.cos(back + spread),
      tip[1] + 40 * Math.sin(back + spread),
    ]
    const head = polyPts([tip, barb(30 * DEG), barb(-30 * DEG)], 10, false).slice(1)
    const a = as(recognizeStroke([...shaft, ...head], { zoom: 1 }), "arrow")
    expect(a.via).toBeDefined()
    expect(dist(a.via!, [200, 50])).toBeLessThan(6)
    expect(dist(a.to, tip)).toBeLessThan(3)
  })

  test("a closed shape is found through overshoot and through a gap", () => {
    expect(recognizeStroke(ellipsePts(0, 0, 100, 60, 0, 64, 1.1), { zoom: 1 })?.kind).toBe("ellipse")
    expect(recognizeStroke(ellipsePts(0, 0, 100, 60, 0, 64, 0.95), { zoom: 1 })?.kind).toBe("ellipse")
  })

  test("a parallelogram gets exactly parallel sides, clockwise from its top-left corner, levelled within 10°", () => {
    const drawn: Point[] = [
      [100, 0],
      [400, 0],
      [300, 200],
      [0, 200],
    ]
    for (const pts of [
      rotated(polyPts(drawn), 4 * DEG, [200, 100]),
      rotated(polyPts(drawn), 4 * DEG, [200, 100]).reverse(),
    ]) {
      const p = as(recognizeStroke(pts, { zoom: 1 }), "parallelogram")
      const [a, b, c, d] = p.vertices
      expect(parallel(a, b, d, c)).toBeLessThan(1e-6)
      expect(parallel(b, c, a, d)).toBeLessThan(1e-6)
      expect(a[1]).toBeCloseTo(b[1], 6)
      expect(polygonArea(p.vertices)).toBeGreaterThan(0)
      expect(Math.min(...p.vertices.map((v) => v[0] + v[1]))).toBe(a[0] + a[1])
      // Levelling turns it back about its centre, onto the corners as drawn before the 4° tilt.
      for (let i = 0; i < 4; i++) expect(dist(p.vertices[i]!, drawn[i]!)).toBeLessThan(3)
    }
    // Turned well off level it keeps its tilt.
    const tilted = as(
      recognizeStroke(rotated(polyPts(drawn), -25 * DEG, [200, 100]), { zoom: 1 }),
      "parallelogram",
    )
    const [a, b] = tilted.vertices
    expect(Math.abs(a[1] - b[1])).toBeGreaterThan(50)
  })

  test("a box with clearly rounded corners is a rounded rectangle; a sharp box is not", () => {
    const roundedBox = (w: number, h: number, r: number): Point[] => {
      const out: Point[] = []
      const corners: [number, number, number][] = [
        [w - r, r, -90],
        [w - r, h - r, 0],
        [r, h - r, 90],
        [r, r, 180],
      ]
      for (const [x, y, a0] of corners)
        for (let k = 0; k <= 12; k++) {
          const a = (a0 + (k / 12) * 90) * DEG
          out.push([x + r * Math.cos(a), y + r * Math.sin(a)])
        }
      out.push(out[0]!)
      return resample(out, 160)
    }
    const r = as(recognizeStroke(roundedBox(300, 200, 60), { zoom: 1 }), "rectangle")
    expect(r.rounded).toBe(true)
    expect(r.w).toBeCloseTo(300, -1)
    expect(r.h).toBeCloseTo(200, -1)
    expect(r.cx).toBeCloseTo(150, 0)
    const sharp = as(
      recognizeStroke(
        polyPts([
          [0, 0],
          [300, 0],
          [300, 200],
          [0, 200],
        ]),
        { zoom: 1 },
      ),
      "rectangle",
    )
    expect(sharp.rounded).toBeFalsy()
  })

  test("a pentagon, a hexagon and a trapezoid come back as straightened polygons, clockwise", () => {
    const regular = (k: number): Point[] =>
      Array.from({ length: k }, (_, i) => [
        200 + 100 * Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / k),
        200 + 100 * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / k),
      ])
    const trapezoid: Point[] = [
      [100, 0],
      [200, 0],
      [300, 150],
      [0, 150],
    ]
    for (const verts of [regular(5), regular(6), trapezoid]) {
      const p = as(recognizeStroke(polyPts(verts, 30), { zoom: 1 }), "polygon")
      expect(p.vertices).toHaveLength(verts.length)
      expect(polygonArea(p.vertices)).toBeGreaterThan(0)
      for (const w of verts) expect(Math.min(...p.vertices.map((v) => dist(v, w)))).toBeLessThan(4)
    }
  })

  test("a box drawn loosely, one side sloped 20°, is still the rectangle meant", () => {
    const slope = Math.tan(20 * DEG) * 150
    const r = as(
      recognizeStroke(
        polyPts([
          [0, 0],
          [200, 0],
          [200 + slope, 150],
          [0, 150],
        ]),
        { zoom: 1 },
      ),
      "rectangle",
    )
    expect(r.angle).toBe(0)
    expect(r.h).toBeCloseTo(150, -1)
    expect(Math.abs(r.w - (200 + slope / 2))).toBeLessThan(8)
  })

  test("a kite-ish diamond, its side corners off centre, is still a diamond", () => {
    const d = as(
      recognizeStroke(
        polyPts([
          [100, 0],
          [160, 80],
          [100, 200],
          [40, 80],
        ]),
        { zoom: 1 },
      ),
      "diamond",
    )
    expect(d.w).toBeCloseTo(120, 0)
    expect(d.h).toBeCloseTo(200, 0)
  })

  test("overshoot past the closing corner is trimmed: crossing ends, a run past the corner, a retrace", () => {
    const box = (path: Point[]) => {
      const r = as(recognizeStroke(polyPts(path, 20, false), { zoom: 1 }), "rectangle")
      expect(r.cx).toBeCloseTo(100, -1)
      expect(r.cy).toBeCloseTo(60, -1)
      expect(r.w).toBeCloseTo(200, -1)
      expect(r.h).toBeCloseTo(120, -1)
    }
    box([
      [-25, 0],
      [200, 0],
      [200, 120],
      [0, 120],
      [0, -30],
    ])
    box([
      [0, 0],
      [200, 0],
      [200, 120],
      [0, 120],
      [0, -35],
    ])
    box([
      [0, 0],
      [200, 0],
      [200, 120],
      [0, 120],
      [0, 0],
      [70, 0],
    ])
    const t = as(
      recognizeStroke(
        polyPts(
          [
            [-20, 0],
            [200, 0],
            [100, 160],
            [-12, -20],
          ],
          20,
          false,
        ),
        { zoom: 1 },
      ),
      "triangle",
    )
    for (const w of [
      [0, 0],
      [200, 0],
      [100, 160],
    ] as Point[])
      expect(Math.min(...t.vertices.map((v) => dist(v, w)))).toBeLessThan(8)
  })

  test("a gap of a quarter of the diagonal still closes a rectangle and a circle", () => {
    const r = as(
      recognizeStroke(
        polyPts(
          [
            [60, 0],
            [200, 0],
            [200, 120],
            [0, 120],
            [0, 0],
            [2, 0],
          ],
          20,
          false,
        ),
        { zoom: 1 },
      ),
      "rectangle",
    )
    expect(r.w).toBeCloseTo(200, -1)
    expect(recognizeStroke(ellipsePts(0, 0, 100, 100, 0, 64, 310 / 360), { zoom: 1 })?.kind).toBe("ellipse")
    // A three-quarter arc is a C, not a circle left open.
    expect(recognizeStroke(ellipsePts(0, 0, 100, 100, 0, 64, 0.75), { zoom: 1 })).toBeNull()
  })
})

describe("recognizeStroke: input handling", () => {
  test("too few points, a dot, or junk input stay raw", () => {
    expect(recognizeStroke([], { zoom: 1 })).toBeNull()
    expect(recognizeStroke([[5, 5]], { zoom: 1 })).toBeNull()
    expect(
      recognizeStroke(
        Array.from({ length: 20 }, () => [3, 3] as Point),
        { zoom: 1 },
      ),
    ).toBeNull()
    expect(recognizeStroke(ellipsePts(0, 0, 50, 50, 0, 4), { zoom: 1 })).toBeNull()
    expect(
      recognizeStroke(
        [
          [Number.NaN, 1],
          [2, Number.POSITIVE_INFINITY],
        ],
        { zoom: 1 },
      ),
    ).toBeNull()
  })

  test("non-finite points are dropped rather than poisoning the fit", () => {
    const pts = ellipsePts(0, 0, 80, 80)
    pts.splice(10, 0, [Number.NaN, 0])
    expect(recognizeStroke(pts, { zoom: 1 })?.kind).toBe("ellipse")
  })

  test("the size gate is in screen pixels", () => {
    const tiny = ellipsePts(0, 0, 5, 5)
    expect(recognizeStroke(tiny, { zoom: 1 })).toBeNull()
    expect(recognizeStroke(tiny, { zoom: 2 })?.kind).toBe("ellipse")
  })

  test("a bad zoom falls back to 1", () => {
    for (const zoom of [0, -1, Number.NaN])
      expect(recognizeStroke(ellipsePts(0, 0, 60, 60), { zoom })?.kind).toBe("ellipse")
  })

  test("the input is not mutated", () => {
    const pts = ellipsePts(0, 0, 60, 40, 0.3)
    const copy = JSON.stringify(pts)
    recognizeStroke(pts, { zoom: 1 })
    expect(JSON.stringify(pts)).toBe(copy)
  })
})

describe("recognizeStroke: synthetic corpus", () => {
  const PER_CLASS = 300
  const PER_NEGATIVE = 200
  const cols = [...SHAPE_KINDS, "null"] as const

  interface Tally {
    expected: string
    confusion: Record<string, number>
    geometry: number
    rounded: number
  }
  const tally = (expected: string, gen: (i: number) => Sample, n: number): Tally => {
    const t: Tally = {
      expected,
      confusion: Object.fromEntries(cols.map((c) => [c, 0])),
      geometry: 0,
      rounded: 0,
    }
    for (let i = 0; i < n; i++) {
      const s = gen(i)
      const r = recognizeStroke(s.points, { zoom: s.zoom })
      t.confusion[r?.kind ?? "null"]!++
      if (!r || r.kind !== expected) continue
      if (r.kind === "rectangle" && r.rounded) t.rounded++
      const xs = s.points.map((p) => p[0])
      const ys = s.points.map((p) => p[1])
      const diag = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
      if (compareToTruth(r, s.truth!, diag, s.zoom) === null) t.geometry++
    }
    return t
  }

  const shapes = Object.fromEntries(
    SHAPE_KINDS.map((k, ki) => [k, tally(k, (i) => synthShape(k, 1000 * (ki + 1) + i), PER_CLASS)]),
  )
  const cases = Object.fromEntries(
    CASE_NAMES.map((c, ci) => [c, tally(CASES[c], (i) => synthCase(c, 20000 + 1000 * ci + i), PER_CLASS)]),
  )
  const negatives = Object.fromEntries(
    NEGATIVE_KINDS.map((k, ki) => [
      k,
      tally("null", (i) => synthNegative(k, 50000 + 1000 * ki + i), PER_NEGATIVE),
    ]),
  )
  const falsePositives = (k: string) => PER_NEGATIVE - negatives[k]!.confusion.null!
  const rows = { ...shapes, ...cases }
  const table = [
    `${"".padEnd(20)}${cols.map((c) => c.slice(0, 9).padStart(10)).join("")}`,
    ...Object.entries(rows).map(
      ([name, t]) => `${name.padEnd(20)}${cols.map((c) => String(t.confusion[c]).padStart(10)).join("")}`,
    ),
    `false positives per ${PER_NEGATIVE}: ${JSON.stringify(Object.fromEntries(NEGATIVE_KINDS.map((k) => [k, falsePositives(k)])))}`,
  ].join("\n")

  test.each(Object.keys(rows))(
    "%s: at least 95% recognised as meant, and 95% of those within tolerance",
    (name) => {
      const t = rows[name]!
      const hits = t.confusion[t.expected]!
      expect(hits / PER_CLASS, table).toBeGreaterThanOrEqual(0.95)
      expect(t.geometry / hits, table).toBeGreaterThanOrEqual(0.95)
    },
  )

  test("clearly rounded boxes come back rounded; boxes drawn with sharp corners rarely do", () => {
    for (const c of ["rect-rounded", "blob"] as const)
      expect(cases[c]!.rounded / cases[c]!.confusion.rectangle!, c).toBeGreaterThanOrEqual(0.9)
    for (const c of ["rect-tails", "rect-loose", "square-slanted"] as const)
      expect(cases[c]!.rounded / cases[c]!.confusion.rectangle!, c).toBeLessThanOrEqual(0.1)
  })

  test("precision over every correction made is at least 97%", () => {
    let corrections = 0
    let correct = 0
    for (const t of [...Object.values(rows), ...Object.values(negatives)]) {
      corrections += Object.entries(t.confusion).reduce((n, [k, v]) => (k === "null" ? n : n + v), 0)
      if (t.expected !== "null") correct += t.confusion[t.expected]!
    }
    expect(correct / corrections, table).toBeGreaterThanOrEqual(0.97)
  })

  test("negatives: at most 2% corrected overall, and no class above 4%", () => {
    const total = NEGATIVE_KINDS.reduce((n, k) => n + falsePositives(k), 0)
    expect(total / (PER_NEGATIVE * NEGATIVE_KINDS.length), table).toBeLessThanOrEqual(0.02)
    for (const kind of NEGATIVE_KINDS)
      expect(falsePositives(kind) / PER_NEGATIVE, `${kind}\n${table}`).toBeLessThanOrEqual(0.04)
  })
})

describe("recognizeStroke: mouse-like fixtures", () => {
  const dir = join(__dirname, "fixtures", "pencil")
  const fixtures = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map(
      (f) =>
        JSON.parse(readFileSync(join(dir, f), "utf8")) as {
          name: string
          expected: string | null
          zoom: number
          points: Point[]
        },
    )

  test("there are fixtures for every class they were made for, and for strokes that stay raw", () => {
    const kinds = new Set(fixtures.map((f) => f.expected))
    for (const k of ["ellipse", "rectangle", "diamond", "triangle", "line", "arrow", null])
      expect(kinds.has(k)).toBe(true)
  })

  test.each(fixtures.map((f) => [f.name, f] as const))("%s", (_name, f) => {
    expect(recognizeStroke(f.points, { zoom: f.zoom })?.kind ?? null).toBe(f.expected)
  })
})

describe("recognizeStroke: real user strokes", () => {
  const dir = join(__dirname, "fixtures", "pencil", "user")
  const strokes = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map(
      (f) =>
        [f, JSON.parse(readFileSync(join(dir, f), "utf8")) as { label: string; points: Point[] }] as const,
    )

  test.each(strokes.flatMap(([f, s]) => [0.16, 0.5, 1, 2].map((zoom) => [f, zoom, s] as const)))(
    "%s at zoom %s",
    (_f, zoom, s) => {
      expect(recognizeStroke(s.points, { zoom })?.kind).toBe(s.label)
    },
  )

  test("the parallelogram lands on its drawn corners with level, parallel sides", () => {
    const s = strokes.find(([, t]) => t.label === "parallelogram")![1]
    const p = as(recognizeStroke(s.points, { zoom: 1 }), "parallelogram")
    const [a, b, c, d] = p.vertices
    expect(a[1]).toBeCloseTo(b[1], 6)
    expect(parallel(b, c, a, d)).toBeLessThan(1e-6)
    // The corners the user drew: top-left, top-right, bottom-right, bottom-left.
    const drawn: Point[] = [
      [397, 244],
      [718, 238],
      [608, 437],
      [316, 430],
    ]
    for (let i = 0; i < 4; i++) expect(dist(p.vertices[i]!, drawn[i]!)).toBeLessThan(20)
  })

  test("the slanted square is an upright box over the stroke", () => {
    const s = strokes.find(([, t]) => t.label === "rectangle")![1]
    const r = as(recognizeStroke(s.points, { zoom: 1 }), "rectangle")
    expect(r.angle).toBe(0)
    const xs = s.points.map((p) => p[0])
    const ys = s.points.map((p) => p[1])
    expect(r.cx).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2, -1)
    expect(r.cy).toBeCloseTo((Math.min(...ys) + Math.max(...ys)) / 2, -1)
    expect(r.w).toBeGreaterThan(0.8 * (Math.max(...xs) - Math.min(...xs)))
    expect(r.h).toBeGreaterThan(0.8 * (Math.max(...ys) - Math.min(...ys)))
  })
})

// shared CI runners are several times slower than a laptop; 5ms locally, still well inside a 16ms frame on CI
const RECOGNIZE_BUDGET_MS = process.env.CI ? 15 : 5

describe("recognizeStroke: performance", () => {
  test("a 5000-point stroke is recognised within one frame", () => {
    const strokes: Point[][] = [
      ellipsePts(400, 300, 200, 140, 0.2, 4999, 1.05),
      Array.from(
        { length: 5000 },
        (_, i) => [i * 0.1 + 30 * Math.sin(i / 20), 40 * Math.cos(i / 7)] as Point,
      ),
      polyPts(
        [
          [0, 0],
          [400, 0],
          [400, 250],
          [0, 250],
        ],
        1250,
      ),
    ]
    for (const pts of strokes) {
      expect(pts.length).toBeGreaterThanOrEqual(5000)
      for (let i = 0; i < 5; i++) recognizeStroke(pts, { zoom: 1 })
      const times: number[] = []
      for (let i = 0; i < 15; i++) {
        const t0 = performance.now()
        recognizeStroke(pts, { zoom: 1 })
        times.push(performance.now() - t0)
      }
      times.sort((a, b) => a - b)
      expect(times[Math.floor(times.length / 2)]!).toBeLessThan(RECOGNIZE_BUDGET_MS)
    }
  })
})

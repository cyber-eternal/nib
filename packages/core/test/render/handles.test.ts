import { describe, expect, test } from "vitest"
import { HANDLE_SIZE } from "../../src/geometry/transformHandles"
import { exportToSvg } from "../../src/io/exportSvg"
import { newElement } from "../../src/model/element"
import { Scene } from "../../src/model/scene"
import { DEFAULT_APP_STATE, type NibElement } from "../../src/model/types"
import { arrowheadBase, arrowheadPrimitives } from "../../src/render/arrowheads"
import {
  type InteractiveSceneInput,
  renderInteractiveScene,
  selectionHandleSet,
} from "../../src/render/interactiveScene"
import { ShapeCache } from "../../src/render/shapes"
import { renderElementsTo, renderStaticScene } from "../../src/render/staticScene"
import { recordingCanvas } from "./mockCanvas"

const interactive = (over: Partial<InteractiveSceneInput>): InteractiveSceneInput => ({
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

const line2 = () =>
  newElement("line", {
    x: 0,
    y: 100,
    width: 300,
    height: 0,
    points: [
      [0, 0],
      [300, 0],
    ],
  }) as NibElement

describe("selection handle set", () => {
  test("a multi-selection has corner handles only", () => {
    const a = newElement("rectangle", { x: 0, y: 0, width: 100, height: 100 })
    const b = newElement("rectangle", { x: 200, y: 0, width: 100, height: 100 })
    const keys = Object.keys(selectionHandleSet([a, b], 1)!.handles).sort()
    expect(keys).toEqual(["ne", "nw", "rotation", "se", "sw"])
  })

  test("standalone text gets e/w handles for its wrap width, whatever its height", () => {
    const t = newElement("text", { x: 0, y: 0, width: 120, height: 25, text: "hello" })
    const keys = Object.keys(selectionHandleSet([t], 1)!.handles).sort()
    expect(keys).toEqual(["e", "ne", "nw", "rotation", "se", "sw", "w"])
  })

  test("a 2-point line or arrow gets no box handles", () => {
    expect(selectionHandleSet([line2()], 1)).toBeNull()
    const arrow = { ...line2(), type: "arrow" } as unknown as NibElement
    expect(selectionHandleSet([arrow], 1)).toBeNull()
  })

  test("a selected 2-point line shows its endpoint handles and no frame", () => {
    const line = line2()
    const r = recordingCanvas()
    renderInteractiveScene(r.ctx, interactive({ selected: [line] }))
    expect(r.calls.some((c) => c.op === "strokeRect")).toBe(false)
    const ends = r.calls
      .filter((c) => c.op === "arc")
      .map((c) => r.toPage(c, c.args[0] as number, c.args[1] as number))
    expect(ends).toEqual([
      [0, 100],
      [300, 100],
    ])
  })

  test("handles whose hit square would cover a tiny element's centre are left out", () => {
    const tiny = newElement("rectangle", { x: 0, y: 0, width: 4, height: 4 })
    const set = selectionHandleSet([tiny], 1)!
    const r = HANDLE_SIZE
    for (const [key, h] of Object.entries(set.handles)) {
      if (key === "rotation") continue
      expect(Math.abs(h![0] - 2) <= r && Math.abs(h![1] - 2) <= r, key).toBe(false)
    }
    // a normal shape keeps all eight
    const big = newElement("rectangle", { x: 0, y: 0, width: 100, height: 100 })
    expect(Object.keys(selectionHandleSet([big], 1)!.handles)).toHaveLength(9)
  })
})

describe("link badges are editor-only", () => {
  const linked = () =>
    newElement("ellipse", { x: 0, y: 0, width: 100, height: 60, link: "https://example.com", index: "a0" })

  const badgeArcs = (calls: ReturnType<typeof recordingCanvas>["calls"]) =>
    calls.filter((c) => c.op === "arc" && (c.args[2] as number) > 4 && (c.args[2] as number) < 5)

  test("the canvas shows a badge clear of the corner handle", () => {
    const r = recordingCanvas()
    renderStaticScene(r.ctx, {
      scene: new Scene([linked()]),
      appState: DEFAULT_APP_STATE,
      width: 800,
      height: 600,
      dpr: 1,
      theme: "light",
      cache: new ShapeCache(),
    })
    const [badge] = badgeArcs(r.calls)
    expect(badge).toBeDefined()
    const [x, y] = r.toPage(badge!, badge!.args[0] as number, badge!.args[1] as number)
    // the ne handle square spans up to 10px beyond the corner
    expect(x - (badge!.args[2] as number)).toBeGreaterThan(100 + 10)
    expect(y + (badge!.args[2] as number)).toBeLessThan(-10)
  })

  test("PNG export (renderElementsTo) and SVG export leave the badge out", () => {
    const r = recordingCanvas()
    renderElementsTo(r.ctx, [linked()], { theme: "light", cache: new ShapeCache() })
    expect(badgeArcs(r.calls)).toHaveLength(0)
    const svg = exportToSvg({
      elements: [linked()],
      appState: DEFAULT_APP_STATE,
      exportBackground: false,
      exportPadding: 0,
      scale: 1,
      theme: "light",
    })
    expect(svg).not.toContain("<circle")
  })
})

describe("arrowheads never outgrow a short segment", () => {
  test("a 10px arrow keeps its heads within half the segment (a quarter for diamonds)", () => {
    const reach = (kind: Parameters<typeof arrowheadPrimitives>[0]) => {
      const prims = arrowheadPrimitives(kind, [10, 0], [0, 0], 2, "#000", "transparent")
      const xs = prims.flatMap((p) =>
        p.type === "circle" ? [p.center[0] - p.radius] : p.points.map((q) => q[0]),
      )
      return 10 - Math.min(...xs)
    }
    expect(reach("arrow")).toBeLessThanOrEqual(5)
    expect(reach("triangle")).toBeLessThanOrEqual(5)
    expect(reach("diamond")).toBeLessThanOrEqual(10 * 0.25 * 1.2 + 1e-9)
  })

  test("long segments keep the full head size", () => {
    const [p] = arrowheadPrimitives("triangle", [200, 0], [0, 0], 2, "#000", "transparent")
    if (p!.type !== "polygon") throw new Error("expected a polygon")
    expect(200 - p!.points[1]![0]).toBeCloseTo(18)
  })
})

describe("heads aim along the last non-degenerate segment", () => {
  test("repeated end points are skipped at both ends", () => {
    const pts: [number, number][] = [
      [0, 0],
      [0, 0],
      [100, 0],
      [200, 50],
      [200, 50],
    ]
    expect(arrowheadBase(pts, "end")).toEqual([100, 0])
    expect(arrowheadBase(pts, "start")).toEqual([100, 0])
    expect(
      arrowheadBase(
        [
          [5, 5],
          [5, 5],
        ],
        "end",
      ),
    ).toBeNull()
  })
})

describe("interactive layer for the core features (integration)", () => {
  const elbow = () =>
    newElement("arrow", {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      elbowed: true,
      roundness: null,
      points: [
        [0, 0],
        [100, 0],
        [100, 100],
        [200, 100],
      ],
    }) as NibElement

  test("an equal-spacing marker is solid, has end ticks and shows its distance", () => {
    const r = recordingCanvas()
    renderInteractiveScene(
      r.ctx,
      interactive({ snapLines: [{ axis: "y", at: 50, from: 100, to: 160, kind: "gap", distance: 60 }] }),
    )
    const strokes = r.calls.filter((c) => c.op === "stroke")
    expect(strokes).toHaveLength(1)
    expect(strokes[0]!.dash).toEqual([])
    expect(r.calls.filter((c) => c.op === "moveTo")).toHaveLength(3)
    const label = r.calls.find((c) => c.op === "fillText")!
    expect(label.args[0]).toBe("60")
    expect(r.toPage(label, label.args[1] as number, label.args[2] as number)[0]).toBeCloseTo(130)
  })

  test("alignment guides stay dashed and unlabelled", () => {
    const r = recordingCanvas()
    renderInteractiveScene(r.ctx, interactive({ snapLines: [{ axis: "x", at: 10, from: 0, to: 100 }] }))
    expect(r.calls.find((c) => c.op === "stroke")!.dash.length).toBeGreaterThan(0)
    expect(r.calls.some((c) => c.op === "fillText")).toBe(false)
  })

  test("picked vertices in the line editor are filled with the selection colour", () => {
    const line = newElement("line", {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      points: [
        [0, 0],
        [100, 100],
        [200, 0],
      ],
    }) as NibElement
    const r = recordingCanvas()
    renderInteractiveScene(
      r.ctx,
      interactive({
        appState: { ...DEFAULT_APP_STATE, editingLinearElementId: line.id, selectedPointIndices: [1] },
        selected: [line],
        editingLinear: line,
      }),
    )
    const vertexFills = r.calls.filter((c) => c.op === "fill").slice(0, 3)
    expect(vertexFills.map((c) => c.fillStyle === vertexFills[0]!.fillStyle)).toEqual([true, false, true])
  })

  test("a selected elbow arrow shows a handle on each grabbable segment", () => {
    const r = recordingCanvas()
    renderInteractiveScene(r.ctx, interactive({ selected: [elbow()] }))
    // box handles are rects too, so look for a rect centred on each segment's midpoint
    const mids = r.calls
      .filter((c) => c.op === "rect")
      .map((c) => {
        const [x, y, w, h] = c.args as number[]
        return r.toPage(c, x! + w! / 2, y! + h! / 2)
      })
    for (const m of [
      [50, 0],
      [100, 50],
      [150, 100],
    ])
      expect(mids.some((p) => Math.abs(p[0] - m[0]!) < 1e-6 && Math.abs(p[1] - m[1]!) < 1e-6)).toBe(true)
  })

  test("an elbow arrow in the line editor gets segment handles, not midpoint dots", () => {
    const el = elbow()
    const r = recordingCanvas()
    renderInteractiveScene(
      r.ctx,
      interactive({
        appState: { ...DEFAULT_APP_STATE, editingLinearElementId: el.id },
        selected: [el],
        editingLinear: el,
      }),
    )
    const arcs = r.calls.filter((c) => c.op === "arc")
    expect(arcs).toHaveLength(4)
    expect(r.calls.filter((c) => c.op === "rect")).toHaveLength(3)
  })
})

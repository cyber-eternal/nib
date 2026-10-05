import { type Point, type Viewport, screenToScene } from "@nib/core"
import { describe, expect, it } from "vitest"
import {
  MiddlePan,
  PointerRouter,
  gestureViewport,
  pinchState,
  pinchViewport,
} from "../../src/canvas/gestures"

const vp: Viewport = { zoom: 1, scrollX: 0, scrollY: 0 }

describe("pinchViewport", () => {
  it("keeps the board point under the fingers' centroid as they move and spread", () => {
    const from = pinchState([100, 100], [200, 100])
    const to = pinchState([150, 220], [350, 220])
    const before = screenToScene(from.centroid, vp)
    const next = pinchViewport(vp, from, to)
    expect(next.zoom).toBeCloseTo(2)
    const after = screenToScene(to.centroid, next)
    expect(after[0]).toBeCloseTo(before[0])
    expect(after[1]).toBeCloseTo(before[1])
  })

  it("only pans when the spread is unchanged", () => {
    const next = pinchViewport(vp, pinchState([0, 0], [100, 0]), pinchState([10, 20], [110, 20]))
    expect(next.zoom).toBe(1)
    expect(next.scrollX).toBeCloseTo(10)
    expect(next.scrollY).toBeCloseTo(20)
  })

  it("ignores a degenerate zero-distance pinch", () => {
    const next = pinchViewport(vp, pinchState([5, 5], [5, 5]), pinchState([5, 5], [50, 5]))
    expect(next.zoom).toBe(1)
  })
})

describe("gestureViewport (WebKit pinch)", () => {
  it("zooms by the ratio of successive cumulative scales about the anchor", () => {
    const anchor: Point = [400, 300]
    const before = screenToScene(anchor, vp)
    const step1 = gestureViewport(vp, anchor, 1, 1.5)
    const step2 = gestureViewport(step1, anchor, 1.5, 3)
    expect(step1.zoom).toBeCloseTo(1.5)
    expect(step2.zoom).toBeCloseTo(3)
    const after = screenToScene(anchor, step2)
    expect(after[0]).toBeCloseTo(before[0])
    expect(after[1]).toBeCloseTo(before[1])
  })

  it("leaves the viewport alone for nonsense scales", () => {
    expect(gestureViewport(vp, [0, 0], 0, 2)).toBe(vp)
    expect(gestureViewport(vp, [0, 0], 1, Number.NaN)).toBe(vp)
  })
})

describe("PointerRouter", () => {
  it("gives the first touch to the tool", () => {
    const r = new PointerRouter()
    expect(r.down(1, [0, 0], "touch", true)).toEqual({ action: "tool" })
    expect(r.move(1, [5, 5])).toEqual({ action: "tool" })
    expect(r.up(1)).toEqual({ action: "tool" })
  })

  it("cancels the tool gesture when a second finger lands, then pinches", () => {
    const r = new PointerRouter()
    r.down(1, [0, 0], "touch", true)
    expect(r.down(2, [100, 0], "touch", false)).toEqual({ action: "pinch-start", cancelTool: true })
    expect(r.toolPointerId).toBeNull()
    const moved = r.move(2, [200, 0])
    expect(moved.action).toBe("pinch")
    if (moved.action === "pinch") {
      expect(moved.from.distance).toBeCloseTo(100)
      expect(moved.to.distance).toBeCloseTo(200)
    }
    // the gesture's end is the pinch's, not a tool release
    expect(r.up(1)).toEqual({ action: "ignore" })
  })

  it("keeps the finger left after a pinch from drawing until every finger is up", () => {
    const r = new PointerRouter()
    r.down(1, [0, 0], "touch", true)
    r.down(2, [100, 0], "touch", false)
    r.up(2)
    expect(r.move(1, [10, 10])).toEqual({ action: "ignore" })
    expect(r.down(3, [50, 50], "touch", false)).toEqual({ action: "pinch-start", cancelTool: false })
    r.up(1)
    r.up(3)
    expect(r.down(4, [0, 0], "touch", true)).toEqual({ action: "tool" })
  })

  it("ignores a third finger and non-primary mouse or pen pointers", () => {
    const r = new PointerRouter()
    r.down(1, [0, 0], "touch", true)
    r.down(2, [10, 0], "touch", false)
    expect(r.down(3, [20, 0], "touch", false)).toEqual({ action: "ignore" })
    const m = new PointerRouter()
    expect(m.down(9, [0, 0], "pen", false)).toEqual({ action: "ignore" })
    expect(m.down(1, [0, 0], "mouse", true)).toEqual({ action: "tool" })
    expect(m.down(2, [0, 0], "pen", true)).toEqual({ action: "ignore" })
  })
})

describe("pointer bookkeeping recovers from lost releases", () => {
  it("ends a mouse gesture whose release was lost when it moves with no button held", () => {
    const r = new PointerRouter()
    expect(r.down(1, [0, 0], "mouse", true)).toEqual({ action: "tool" })
    expect(r.move(1, [5, 5], 1)).toEqual({ action: "tool" })
    expect(r.move(1, [6, 6], 0)).toEqual({ action: "released" })
    expect(r.toolPointerId).toBeNull()
    expect(r.down(1, [9, 9], "mouse", true)).toEqual({ action: "tool" })
  })

  it("never reads a touch move as a release", () => {
    const r = new PointerRouter()
    r.down(3, [0, 0], "touch", true)
    expect(r.move(3, [5, 5], 0)).toEqual({ action: "tool" })
  })

  it("drops a tool pointer that went down again, or that the canvas no longer captures", () => {
    const r = new PointerRouter()
    r.down(1, [0, 0], "mouse", true)
    expect(r.takeStale(1, true)).toBe(1)
    expect(r.down(1, [0, 0], "mouse", true)).toEqual({ action: "tool" })

    const pen = new PointerRouter()
    pen.down(77, [0, 0], "pen", true)
    // a live, captured pen keeps the tool from a second pointer
    expect(pen.takeStale(1, true)).toBeNull()
    expect(pen.down(1, [0, 0], "mouse", true)).toEqual({ action: "ignore" })
    // an uncaptured one (a synthetic press, a capture that threw) has lost its release
    expect(pen.takeStale(1, false)).toBe(77)
    expect(pen.down(1, [0, 0], "mouse", true)).toEqual({ action: "tool" })
  })
})

describe("MiddlePan", () => {
  it("pans while the middle button is held", () => {
    const pan = new MiddlePan()
    pan.start(1, 10, 10)
    expect(pan.move(1, 15, 30, 4)).toEqual([5, 20])
    expect(pan.move(1, 20, 30, 4)).toEqual([5, 0])
  })

  it("stops at the first move without the middle button, so plain hover never pans", () => {
    const pan = new MiddlePan()
    pan.start(1, 10, 10)
    // a chorded release: the middle button let go while the left is held
    expect(pan.move(1, 40, 40, 1)).toBeNull()
    expect(pan.active).toBe(false)
    expect(pan.move(1, 200, 120, 0)).toBeNull()
  })

  it("ends on any release, cancel or lost capture of its pointer, and ignores other pointers", () => {
    const pan = new MiddlePan()
    pan.start(1, 0, 0)
    expect(pan.move(2, 5, 5, 4)).toBeNull()
    expect(pan.end(2)).toBe(false)
    expect(pan.end(1)).toBe(true)
    expect(pan.active).toBe(false)
  })
})

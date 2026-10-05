import {
  FRAME_LABEL_INSET,
  type NibElement,
  type TextElement,
  type Viewport,
  arrowLabelAnchor,
  containerMaxTextWidth,
  layoutBoundText,
  layoutStandaloneText,
  newElement,
  sceneToScreen,
  setTextMeasurer,
} from "@nib/core"
import { beforeAll, describe, expect, it } from "vitest"
import {
  type OverlayBox,
  embedFrameStyle,
  frameNameBox,
  inflateBox,
  sceneRectToClient,
  textOverlayBox,
} from "../../src/canvas/overlayGeometry"

// 10px per character, so widths are predictable
beforeAll(() => setTextMeasurer((text) => text.length * 10))

const vp = (zoom = 1, scrollX = 0, scrollY = 0): Viewport => ({ zoom, scrollX, scrollY })

/** Where the box's centre lands after the CSS rotation about its transform-origin. */
const rotatedCentre = (b: OverlayBox): [number, number] => {
  const ox = b.left + b.originX
  const oy = b.top + b.originY
  const dx = b.width / 2 - b.originX
  const dy = b.height / 2 - b.originY
  const c = Math.cos(b.angle)
  const s = Math.sin(b.angle)
  return [ox + dx * c - dy * s, oy + dx * s + dy * c]
}

const text = (init: Partial<TextElement>): TextElement =>
  layoutStandaloneText(
    newElement("text", { x: 0, y: 0, fontSize: 20, text: "ab", originalText: "ab", ...init }) as TextElement,
  )

describe("textOverlayBox", () => {
  it("covers free text exactly and pivots on its centre when rotated", () => {
    const t = text({ x: 200, y: 100, angle: Math.PI / 2 })
    const box = textOverlayBox(t, null, vp())
    expect(box.width).toBeCloseTo(t.width)
    expect(box.height).toBeCloseTo(t.height)
    expect(box.wrap).toBe(false)
    const [cx, cy] = rotatedCentre(box)
    const expected = sceneToScreen([t.x + t.width / 2, t.y + t.height / 2], vp())
    expect(cx).toBeCloseTo(expected[0])
    expect(cy).toBeCloseTo(expected[1])
  })

  it("scales with zoom: one line at zoom 2 is one line tall, not two", () => {
    const t = text({ x: 10, y: 10 })
    const box = textOverlayBox(t, null, vp(2, 5, 5))
    expect(box.height).toBeCloseTo(t.height * 2)
    expect(box.left).toBeCloseTo((10 + 5) * 2)
    expect(box.top).toBeCloseTo((10 + 5) * 2)
  })

  it("wraps fixed-width text at its own width", () => {
    const t = text({ autoResize: false, width: 60, originalText: "one two three", text: "one two three" })
    const box = textOverlayBox(t, null, vp())
    expect(box.wrap).toBe(true)
    expect(box.width).toBeCloseTo(60)
  })

  it("lays a container label over the container's text area, at the wrap width", () => {
    const rect = newElement("rectangle", { x: 0, y: 0, width: 200, height: 80 }) as NibElement
    const raw = newElement("text", {
      fontSize: 20,
      text: "hello",
      originalText: "hello",
      containerId: rect.id,
      textAlign: "left",
      verticalAlign: "middle",
    }) as TextElement
    const laid = layoutBoundText(rect, raw).text
    const box = textOverlayBox(laid, rect, vp())
    expect(box.wrap).toBe(true)
    expect(box.width).toBeCloseTo(containerMaxTextWidth(rect))
    // left-aligned: the box starts where the drawn text starts
    expect(box.left).toBeCloseTo(laid.x)
    expect(box.top).toBeCloseTo(laid.y)
  })

  it("centres an arrow label on the arrow's drawn midpoint, even for an L-shaped arrow", () => {
    const arrow = newElement("arrow", {
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      points: [
        [0, 0],
        [200, 0],
        [200, 200],
      ],
      roundness: null,
    }) as NibElement
    const raw = newElement("text", {
      fontSize: 20,
      text: "yes",
      originalText: "yes",
      containerId: arrow.id,
    }) as TextElement
    const laid = layoutBoundText(arrow, raw).text
    const box = textOverlayBox(laid, arrow, vp())
    const anchor = arrowLabelAnchor(arrow)
    expect(box.left + box.width / 2).toBeCloseTo(anchor[0])
    expect(box.top + box.height / 2).toBeCloseTo(anchor[1])
  })

  it("rotates a label in a rotated container about the label's own centre", () => {
    const rect = newElement("rectangle", { x: 0, y: 0, width: 200, height: 80, angle: 0.6 }) as NibElement
    const raw = newElement("text", {
      fontSize: 20,
      text: "hi",
      originalText: "hi",
      containerId: rect.id,
      textAlign: "right",
    }) as TextElement
    const laid = layoutBoundText(rect, raw).text
    const box = textOverlayBox(laid, rect, vp())
    expect(box.angle).toBeCloseTo(0.6)
    const pivot = sceneToScreen([laid.x + laid.width / 2, laid.y + laid.height / 2], vp())
    expect(box.left + box.originX).toBeCloseTo(pivot[0])
    expect(box.top + box.originY).toBeCloseTo(pivot[1])
  })
})

describe("frameNameBox", () => {
  it("sits on the drawn name above the frame, as wide as the frame on screen", () => {
    const frame = newElement("frame", {
      x: 100,
      y: 100,
      width: 300,
      height: 200,
      name: "Login",
    }) as NibElement & {
      type: "frame"
    }
    const box = frameNameBox(frame, vp(), (s) => s.length * 7)
    expect(box.left).toBeCloseTo(100 + FRAME_LABEL_INSET)
    expect(box.top).toBeLessThan(100)
    expect(box.top + box.height).toBeLessThanOrEqual(100)
    expect(box.width).toBeCloseTo(300 - FRAME_LABEL_INSET * 2)
    // pivot is the frame centre
    expect(box.left + box.originX).toBeCloseTo(250)
    expect(box.top + box.originY).toBeCloseTo(200)
  })

  it("keeps a usable width when the frame is tiny on screen", () => {
    const frame = newElement("frame", { x: 0, y: 0, width: 20, height: 20 }) as NibElement & {
      type: "frame"
    }
    expect(frameNameBox(frame, vp(0.5)).width).toBeGreaterThanOrEqual(120)
  })

  it("inflates around the same pivot", () => {
    const frame = newElement("frame", { x: 0, y: 0, width: 300, height: 200 }) as NibElement & {
      type: "frame"
    }
    const box = frameNameBox(frame, vp())
    const big = inflateBox(box, 4)
    expect(big.left + big.originX).toBeCloseTo(box.left + box.originX)
    expect(big.top + big.originY).toBeCloseTo(box.top + box.originY)
    expect(big.width).toBeCloseTo(box.width + 8)
  })
})

describe("sceneRectToClient", () => {
  it("maps scene bounds through the viewport and canvas origin, padded", () => {
    const r = sceneRectToClient([10, 20, 110, 70], vp(2, 0, 0), [5, 6], 4)
    expect(r).toEqual({ x: 5 + 20 - 4, y: 6 + 40 - 4, width: 200 + 8, height: 100 + 8 })
  })
})

describe("embedFrameStyle", () => {
  it("lays the page out at element size and scales it to the zoom", () => {
    const el = newElement("embeddable", { x: 10, y: 20, width: 320, height: 180 }) as NibElement
    const style = embedFrameStyle(el, vp(2, 5, 0))
    expect(style).toMatchObject({ left: 30, top: 40, width: 320, height: 180, transformOrigin: "0 0" })
    expect(style.transform).toBe("scale(2)")
    const turned = embedFrameStyle({ ...el, angle: 0.5 }, vp())
    expect(turned.transform).toContain("rotate(0.5rad)")
  })
})

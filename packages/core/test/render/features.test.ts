import { describe, expect, test } from "vitest"
import { resetCrop } from "../../src/geometry/crop"
import { HANDLE_SIZE } from "../../src/geometry/transformHandles"
import { exportToSvg } from "../../src/io/exportSvg"
import { newElement } from "../../src/model/element"
import { Scene } from "../../src/model/scene"
import { type AppState, DEFAULT_APP_STATE, type ImageElement, type NibElement } from "../../src/model/types"
import { PENDING_ERASE_ALPHA, frameLabelLayout } from "../../src/render/drawElement"
import {
  CROP_GHOST_ALPHA,
  type InteractiveSceneInput,
  cropGhostRect,
  renderInteractiveScene,
  selectionHandleSet,
} from "../../src/render/interactiveScene"
import { ShapeCache } from "../../src/render/shapes"
import { renderElementsTo, renderStaticScene } from "../../src/render/staticScene"
import { type CanvasPalette, defaultCanvasPalette } from "../../src/render/theme"
import { type Call, recordingCanvas } from "./mockCanvas"

type Matrix = [number, number, number, number, number, number]
const matrixOf = (c: Call): Matrix => (c as Call & { matrix: Matrix }).matrix
const scaleOf = (c: Call): number => {
  const m = matrixOf(c)
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
}

const PALETTE: CanvasPalette = {
  ...defaultCanvasPalette("light"),
  selection: "#00aa01",
  searchHighlight: "#00aa02",
}

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
  palette: PALETTE,
  ...over,
})

const staticScene = (elements: NibElement[], appState: Partial<AppState> = {}, extra = {}) => {
  const r = recordingCanvas()
  renderStaticScene(r.ctx, {
    scene: new Scene(elements),
    appState: { ...DEFAULT_APP_STATE, ...appState },
    width: 800,
    height: 600,
    dpr: 1,
    theme: "light",
    cache: new ShapeCache(),
    ...extra,
  })
  return r
}

const svg = (elements: NibElement[]) =>
  exportToSvg({
    elements,
    appState: DEFAULT_APP_STATE,
    exportBackground: false,
    exportPadding: 0,
    scale: 1,
    theme: "light",
  })

const at = (zoom: number): Partial<AppState> => ({ viewport: { scrollX: 0, scrollY: 0, zoom } })

describe("the frame name keeps its screen size and is cut to the frame", () => {
  const frame = (over: Record<string, unknown> = {}) =>
    newElement("frame", { id: "fr", x: 40, y: 60, width: 200, height: 100, name: "Login", ...over })

  test("the label is drawn at the same on-screen size and offset at every zoom", () => {
    for (const zoom of [0.25, 1, 3]) {
      const r = staticScene([frame()], at(zoom))
      const label = r.calls.find((c) => c.op === "fillText" && c.args[0] === "Login")!
      expect(label, `zoom ${zoom}`).toBeDefined()
      expect(label.font).toMatch(/^12px /)
      expect(scaleOf(label)).toBeCloseTo(1)
      // 2px in from the frame's left edge, 6px above its top, in screen px
      expect(
        r.toPage(label as Call & { matrix: Matrix }, label.args[1] as number, label.args[2] as number),
      ).toEqual([expect.closeTo(40 * zoom + 2), expect.closeTo(60 * zoom - 6)])
    }
  })

  test("the label follows a rotated frame", () => {
    const r = staticScene([frame({ angle: Math.PI / 2 })], at(2))
    const label = r.calls.find((c) => c.op === "fillText")!
    const m = matrixOf(label)
    expect(m[0]).toBeCloseTo(0)
    expect(m[1]).toBeCloseTo(1)
  })

  test("a long name is ellipsized to the frame's on-screen width", () => {
    const long = frame({ width: 60, name: "Onboarding checklist" })
    const measure = (s: string) => s.length * 8 // the recording canvas measures 8px a character
    const text = (zoom: number) =>
      staticScene([long], at(zoom)).calls.find((c) => c.op === "fillText")?.args[0] as string | undefined
    const z1 = text(1)!
    expect(z1.endsWith("…")).toBe(true)
    expect(measure(z1)).toBeLessThanOrEqual(60 - 4)
    const z3 = text(3)!
    expect(z3.length).toBeGreaterThan(z1.length)
    expect(measure(z3)).toBeLessThanOrEqual(180 - 4)
    // too small on screen for even one character
    expect(text(0.05)).toBeUndefined()
  })

  test("exports draw the name at scene size, ellipsized to the frame width", () => {
    const long = frame({ width: 60, name: "Onboarding checklist" })
    const r = recordingCanvas()
    renderElementsTo(r.ctx, [long], { theme: "light", cache: new ShapeCache(), zoom: 4 })
    const label = r.calls.find((c) => c.op === "fillText")!
    expect(scaleOf(label)).toBeCloseTo(1)
    expect(label.args.slice(1)).toEqual([2, -6])
    const out = svg([long])
    const svgLabel = /<text x="2" y="-6"[^>]*>([^<]*)<\/text>/.exec(out)![1]
    expect(svgLabel).toBe(label.args[0])
    expect(svgLabel!.endsWith("…")).toBe(true)
  })

  test("a frame below the viewport still draws the name that reaches into it when zoomed out", () => {
    // visible scene rect at zoom 0.25 is 3200x2400; the frame starts 30 scene px below it
    const r = staticScene([frame({ x: 100, y: 2430 })], at(0.25))
    expect(r.calls.some((c) => c.op === "fillText" && c.args[0] === "Login")).toBe(true)
  })

  test("frameLabelLayout is the box the name is drawn in, for hit-testing and the rename overlay", () => {
    const long = frame({ width: 60, name: "Onboarding checklist" })
    const measure = (s: string) => s.length * 8
    const drawn = (zoom: number) =>
      staticScene([long], at(zoom)).calls.find((c) => c.op === "fillText")!.args[0] as string
    for (const zoom of [0.5, 1, 2]) {
      const box = frameLabelLayout(long, zoom, measure)!
      expect(box.text, `zoom ${zoom}`).toBe(drawn(zoom))
      // 12px text, its baseline 6px above the frame and 2px in, kept at screen size
      expect([box.x, box.y, box.width, box.height]).toEqual([
        expect.closeTo(2 / zoom),
        expect.closeTo(-18 / zoom),
        expect.closeTo(measure(box.text) / zoom),
        expect.closeTo(16 / zoom),
      ])
    }
    expect(frameLabelLayout(long, 0.05, measure)).toBeNull()
    expect(frameLabelLayout(frame({ name: 42 }), 1, measure)!.text).toBe("Frame")
  })

  test("a frame whose name is being renamed inline draws its border but not its name", () => {
    const r = staticScene([frame()], {}, { hiddenFrameLabelIds: new Set(["fr"]) })
    expect(r.calls.some((c) => c.op === "fillText")).toBe(false)
    expect(r.calls.some((c) => c.op === "stroke" && c.strokeStyle === PALETTE.frameBorder)).toBe(true)
  })

  test("children are still clipped to the frame", () => {
    const child = newElement("rectangle", {
      x: 200,
      y: 120,
      width: 120,
      height: 80,
      frameId: "fr",
      strokeColor: "#e03131",
    })
    const r = staticScene([frame(), child])
    const first = r.calls.findIndex((c) => c.op === "stroke" && c.strokeStyle === "#e03131")
    expect(r.calls.slice(0, first).some((c) => c.op === "clip")).toBe(true)
    expect(r.depth()).toBe(0)
  })
})

describe("the arrow line stops short of its label", () => {
  const scene = (text = "yes", deleted = false) => {
    const arrow = newElement("arrow", {
      id: "ar",
      x: 0,
      y: 50,
      width: 200,
      height: 0,
      points: [
        [0, 0],
        [200, 0],
      ],
      strokeColor: "#1971c2",
      boundElements: [{ type: "text", id: "lbl" }],
    })
    const label = newElement("text", {
      id: "lbl",
      x: 80,
      y: 38,
      width: 40,
      height: 25,
      text,
      textAlign: "center",
      containerId: "ar",
      isDeleted: deleted,
    })
    return [arrow, label]
  }

  /** The clip region's subpaths in page space: the outer box and the label hole. */
  const clipBeforeArrow = (calls: readonly Call[]) => {
    const firstStroke = calls.findIndex((c) => c.op === "stroke" && c.strokeStyle === "#1971c2")
    const clip = calls.slice(0, firstStroke).findLastIndex((c) => c.op === "clip")
    if (clip < 0) return null
    const begin = calls.slice(0, clip).findLastIndex((c) => c.op === "beginPath")
    return { clip: calls[clip]!, path: calls.slice(begin + 1, clip) }
  }

  test("canvas clips an evenodd hole the size of the padded label out of the arrow", () => {
    const r = staticScene(scene())
    const found = clipBeforeArrow(r.calls)!
    expect(found).not.toBeNull()
    expect(found.clip.args[0]).toBe("evenodd")
    const hole = found.path
      .filter((c) => c.op === "moveTo" || c.op === "lineTo")
      .map((c) => r.toPage(c as Call & { matrix: Matrix }, c.args[0] as number, c.args[1] as number))
    expect(hole).toEqual([
      [75, 33],
      [125, 33],
      [125, 68],
      [75, 68],
    ])
    // the outer box covers the whole arrow, so only the hole is cut away
    const outer = found.path.find((c) => c.op === "rect")!.args as number[]
    expect(outer[0]).toBeLessThanOrEqual(0)
    expect(outer[0]! + outer[2]!).toBeGreaterThanOrEqual(200)
    expect(r.depth()).toBe(0)
  })

  test("the label itself is not clipped, and PNG exports mask too", () => {
    const r = staticScene(scene())
    const clip = r.calls.findIndex((c) => c.op === "clip")
    const text = r.calls.findIndex((c) => c.op === "fillText")
    expect(clip).toBeLessThan(text)
    // the save the clip was made under is restored before the label paints
    const clipDepth = r.calls[clip]!.depth
    expect(r.calls.slice(clip, text).some((c) => c.op === "restore" && c.depth < clipDepth)).toBe(true)

    const e = recordingCanvas()
    renderElementsTo(e.ctx, scene(), { theme: "light", cache: new ShapeCache() })
    expect(clipBeforeArrow(e.calls)?.clip.args[0]).toBe("evenodd")
  })

  test("no mask without a visible label", () => {
    expect(clipBeforeArrow(staticScene(scene("   ")).calls)).toBeNull()
    expect(clipBeforeArrow(staticScene(scene("yes", true)).calls)).toBeNull()
    expect(clipBeforeArrow(staticScene(scene().slice(0, 1)).calls)).toBeNull()
  })

  test("SVG wraps the arrow, not the label, in a luminance mask with the same hole", () => {
    const out = svg(scene())
    const mask = /<mask id="([^"]+)" maskUnits="userSpaceOnUse"[^>]*>(.*?)<\/mask>/.exec(out)!
    expect(mask).not.toBeNull()
    expect(mask[2]).toContain('fill="#ffffff"')
    expect(mask[2]).toContain('<path d="M 75 33 L 125 33 L 125 68 L 75 68 Z" fill="#000000"/>')
    const masked = new RegExp(`<g mask="url\\(#${mask[1]}\\)">(.*?)</g></g>`).exec(out)![1]!
    expect(masked).toContain('stroke="#1971c2"')
    expect(masked).not.toContain("<text")
    expect(out).toContain(">yes</tspan>")
  })

  test("a hostile label cannot break out of the mask markup", () => {
    const [arrow, label] = scene()
    const evil = { ...label!, x: '"/><script>alert(1)</script>', width: "1e999" } as unknown as NibElement
    const out = svg([arrow!, evil])
    expect(out).not.toContain("<script")
    expect(out).not.toMatch(/NaN|Infinity/)
  })

  test("an arrow with malformed bound elements still draws", () => {
    const [arrow] = scene()
    const odd = { ...arrow!, boundElements: "text" } as unknown as NibElement
    const r = staticScene([odd])
    expect(r.calls.some((c) => c.op === "stroke" && c.strokeStyle === "#1971c2")).toBe(true)
    expect(svg([odd])).toContain('stroke="#1971c2"')
  })
})

describe("crop mode shows a ghost of the whole image and crop handles", () => {
  const cropped = (over: Partial<ImageElement> = {}): ImageElement =>
    newElement("image", {
      id: "img",
      x: 100,
      y: 100,
      width: 100,
      height: 50,
      fileId: "f",
      status: "saved",
      crop: { x: 50, y: 25, width: 100, height: 50, naturalWidth: 200, naturalHeight: 100 },
      ...over,
    }) as ImageElement
  const bitmap = { image: { tag: "bmp" }, width: 200, height: 100 }
  const cropping = (el: ImageElement, over: Partial<InteractiveSceneInput> = {}) => {
    const r = recordingCanvas()
    renderInteractiveScene(
      r.ctx,
      interactive({
        appState: { ...DEFAULT_APP_STATE, croppingElementId: el.id, selectedElementIds: { [el.id]: true } },
        selected: [el],
        resolveImage: (id) => (id === "f" ? bitmap : null),
        ...over,
      }),
    )
    return r
  }

  test("the ghost lines up with the box a crop reset would restore", () => {
    for (const scale of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ] as [number, number][]) {
      const el = cropped({ scale })
      const [gx, gy, gw, gh] = cropGhostRect(el)!
      const full = resetCrop(el)
      expect([el.x + gx, el.y + gy, gw, gh]).toEqual([
        expect.closeTo(full.x),
        expect.closeTo(full.y),
        expect.closeTo(full.width),
        expect.closeTo(full.height),
      ])
    }
  })

  test("the full bitmap is drawn dimmed, clipped to outside the crop box", () => {
    const r = cropping(cropped())
    const draw = r.calls.findIndex((c) => c.op === "drawImage")
    expect(draw).toBeGreaterThan(-1)
    const call = r.calls[draw]!
    expect(call.alpha).toBeCloseTo(CROP_GHOST_ALPHA)
    expect(call.args[0]).toBe(bitmap.image)
    // the whole 200x100 bitmap at the crop's 1:1 display scale, shifted by the crop offset
    expect(
      r.toPage(call as Call & { matrix: Matrix }, call.args[1] as number, call.args[2] as number),
    ).toEqual([50, 75])
    expect(call.args.slice(3)).toEqual([200, 100])
    const clip = r.calls.slice(0, draw).findLast((c) => c.op === "clip")!
    expect(clip.args[0]).toBe("evenodd")
    expect(r.depth()).toBe(0)
  })

  test("a mirrored image's ghost shows the source mirrored around the crop", () => {
    const el = cropped({ scale: [-1, 1] })
    const r = cropping(el)
    const call = r.calls.find((c) => c.op === "drawImage")!
    // source pixel 0 sits at the far (right) end of the ghost when mirrored
    const [gx, , gw] = cropGhostRect(el)!
    const left = r.toPage(call as Call & { matrix: Matrix }, call.args[1] as number, call.args[2] as number)
    expect(left[0]).toBeCloseTo(el.x + gx + gw)
  })

  test("without a decoded bitmap only the ghost outline is drawn", () => {
    const r = cropping(cropped(), { resolveImage: () => null })
    expect(r.calls.some((c) => c.op === "drawImage")).toBe(false)
    const outline = r.calls.find((c) => c.op === "strokeRect" && c.dash.length > 0)!
    expect(outline.args).toEqual([-50, -25, 200, 100])
  })

  test("crop handles are L brackets on the crop box, with no square handles and no rotation", () => {
    const el = cropped()
    const r = cropping(el)
    const squareHandles = r.calls.filter((c) => c.op === "rect" && c.args[2] === HANDLE_SIZE)
    expect(squareHandles).toHaveLength(0)
    expect(r.calls.some((c) => c.op === "arc")).toBe(false)
    const brackets = r.calls.filter(
      (c) => c.op === "stroke" && c.strokeStyle === PALETTE.selection && c.lineWidth === 3,
    )
    expect(brackets).toHaveLength(1)
    // each corner is the vertex of an L: moveTo along one edge, lineTo the corner, lineTo along the other
    const pts = r.calls
      .filter((c) => c.op === "moveTo" || c.op === "lineTo")
      .map((c) => r.toPage(c as Call & { matrix: Matrix }, c.args[0] as number, c.args[1] as number))
    for (const corner of [
      [100, 100],
      [200, 100],
      [200, 150],
      [100, 150],
    ])
      expect(pts).toContainEqual(corner)
  })

  test("the crop handle set sits on the crop box and drops rotation", () => {
    const el = cropped()
    const set = selectionHandleSet([el], 1, { croppingElementId: el.id })!
    expect(set.handles.rotation).toBeUndefined()
    expect(set.handles.nw).toEqual([100, 100])
    expect(set.handles.se).toEqual([200, 150])
    expect(set.handles.e).toEqual([200, 125])
    // a tiny crop keeps its handles; dragging the box is not what crop mode is for
    const tiny = cropped({ width: 16, height: 16 })
    expect(selectionHandleSet([tiny], 1, { croppingElementId: tiny.id })!.handles.se).toEqual([116, 116])
    // outside crop mode nothing changes
    expect(selectionHandleSet([el], 1)!.handles.rotation).toBeDefined()
  })

  test("a rotated crop draws its ghost and brackets in the image's own frame", () => {
    const el = cropped({ angle: Math.PI / 2 })
    const r = cropping(el)
    const call = r.calls.find((c) => c.op === "drawImage")!
    const m = matrixOf(call)
    expect(m[0]).toBeCloseTo(0)
    expect(m[1]).toBeCloseTo(1)
  })
})

describe("search highlights every match and the active one distinctly", () => {
  const a = newElement("rectangle", { id: "a", x: 0, y: 0, width: 50, height: 50 })
  const b = newElement("rectangle", { id: "b", x: 100, y: 0, width: 50, height: 50 })
  const c = newElement("text", { id: "c", x: 200, y: 0, width: 50, height: 25, text: "hit" })
  const scene = new Scene([a, b, c])
  const highlights = (activeSearchMatch?: string) => {
    const r = recordingCanvas()
    renderInteractiveScene(r.ctx, interactive({ scene, searchMatches: ["a", "b", "c"], activeSearchMatch }))
    return {
      strokes: r.calls.filter((x) => x.op === "strokeRect" && x.strokeStyle === PALETTE.searchHighlight),
      fills: r.calls.filter((x) => x.op === "fillRect" && x.fillStyle === PALETTE.searchHighlight),
      r,
    }
  }

  test("every match is filled and outlined", () => {
    const { strokes, fills } = highlights()
    expect(strokes).toHaveLength(3)
    expect(fills).toHaveLength(3)
    expect(new Set(strokes.map((s) => s.lineWidth)).size).toBe(1)
  })

  test("the active match is drawn last, stronger and wider", () => {
    const { strokes, fills, r } = highlights("b")
    expect(strokes).toHaveLength(3)
    const last = strokes[strokes.length - 1]!
    const lastPos = r.toPage(last as Call & { matrix: Matrix }, 0, 0)
    // the active match is centred on b
    expect(lastPos[0]).toBeCloseTo(125)
    expect(last.lineWidth).toBeGreaterThan(strokes[0]!.lineWidth)
    expect(fills[fills.length - 1]!.alpha).toBeGreaterThan(fills[0]!.alpha)
    expect((last.args[2] as number) > (strokes[0]!.args[2] as number)).toBe(true)
  })

  test("an active match outside the list is still shown, once", () => {
    const r = recordingCanvas()
    renderInteractiveScene(r.ctx, interactive({ scene, searchMatches: ["a"], activeSearchMatch: "c" }))
    expect(
      r.calls.filter((x) => x.op === "strokeRect" && x.strokeStyle === PALETTE.searchHighlight),
    ).toHaveLength(2)
  })

  test("highlights keep a constant screen width when zoomed", () => {
    const r = recordingCanvas()
    renderInteractiveScene(
      r.ctx,
      interactive({ appState: { ...DEFAULT_APP_STATE, ...at(4) }, scene, searchMatches: ["a"] }),
    )
    const s = r.calls.find((x) => x.op === "strokeRect" && x.strokeStyle === PALETTE.searchHighlight)!
    expect(s.lineWidth * scaleOf(s)).toBeCloseTo(1.5)
  })
})

describe("elements pending erase are drawn faded", () => {
  const box = newElement("rectangle", {
    id: "box",
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    strokeColor: "#e03131",
    opacity: 80,
    boundElements: [{ type: "text", id: "lbl" }],
  })
  const lbl = newElement("text", {
    id: "lbl",
    x: 20,
    y: 18,
    width: 60,
    height: 25,
    text: "hi",
    containerId: "box",
  })
  const other = newElement("ellipse", {
    id: "other",
    x: 200,
    y: 0,
    width: 50,
    height: 50,
    strokeColor: "#2f9e44",
  })

  test("pending elements and their labels paint at a fraction of their opacity", () => {
    const r = staticScene([box, lbl, other], {}, { pendingEraseIds: ["box"] })
    const boxStroke = r.calls.find((c) => c.op === "stroke" && c.strokeStyle === "#e03131")!
    expect(boxStroke.alpha).toBeCloseTo(0.8 * PENDING_ERASE_ALPHA)
    expect(r.calls.find((c) => c.op === "fillText")!.alpha).toBeCloseTo(PENDING_ERASE_ALPHA)
    expect(r.calls.find((c) => c.op === "stroke" && c.strokeStyle === "#2f9e44")!.alpha).toBeCloseTo(1)
  })

  test("nothing fades without pending ids, and exports never fade", () => {
    const r = staticScene([box, lbl, other])
    expect(r.calls.find((c) => c.op === "stroke" && c.strokeStyle === "#e03131")!.alpha).toBeCloseTo(0.8)
    const e = recordingCanvas()
    renderElementsTo(e.ctx, [box, lbl, other], { theme: "light", cache: new ShapeCache() })
    expect(e.calls.find((c) => c.op === "stroke" && c.strokeStyle === "#e03131")!.alpha).toBeCloseTo(0.8)
  })
})

describe("laser trail", () => {
  test("is stroked in the palette's laser colour", () => {
    const r = recordingCanvas()
    const now = Date.now()
    renderInteractiveScene(
      r.ctx,
      interactive({
        palette: { ...PALETTE, laser: "#00aa09" },
        laserTrail: [
          { p: [0, 0], t: now },
          { p: [10, 10], t: now },
        ],
      }),
    )
    const strokes = r.calls.filter((c) => c.op === "stroke")
    expect(strokes.length).toBeGreaterThan(0)
    expect(strokes.every((c) => c.strokeStyle === "#00aa09")).toBe(true)
  })
})

import { beforeAll, describe, expect, test } from "vitest"
import { exportToSvg } from "../../src/io/exportSvg"
import { newElement } from "../../src/model/element"
import { Scene } from "../../src/model/scene"
import { DEFAULT_APP_STATE, type NibElement, type TextElement } from "../../src/model/types"
import { displayTextColor } from "../../src/render/drawElement"
import { ShapeCache } from "../../src/render/shapes"
import { renderStaticScene } from "../../src/render/staticScene"
import { surfaceLookup } from "../../src/render/surfaces"
import { setTextMeasurer } from "../../src/render/textMeasure"
import { contrastRatio, deriveCanvasPalette, themeColor } from "../../src/render/theme"
import { recordingCanvas } from "./mockCanvas"

beforeAll(() => setTextMeasurer((t) => t.length * 10))

const KRAFT = deriveCanvasPalette({ mode: "light", board: "#D8C29D", ink: "#2B2118", course: "#9E2F14" })
const WHITEBOARD = deriveCanvasPalette({ mode: "light", board: "#FBFBFA", ink: "#202124", course: "#2F6BFF" })
const GRAPHITE = deriveCanvasPalette({ mode: "dark", board: "#16171A", ink: "#E6E7EA", course: "#7AA2FF" })

/** A dark solid box, a white line and white text inside it, and a white arrow out to the board. */
const scene = (): NibElement[] => [
  newElement("rectangle", {
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    backgroundColor: "#343a40",
    fillStyle: "solid",
    index: "a0",
  }),
  newElement("line", {
    x: 40,
    y: 50,
    width: 200,
    height: 0,
    points: [
      [0, 0],
      [200, 0],
    ],
    strokeColor: "#ffffff",
    index: "a1",
  }),
  newElement("text", {
    x: 40,
    y: 120,
    width: 80,
    height: 25,
    text: "Hi there",
    originalText: "Hi there",
    strokeColor: "#ffffff",
    index: "a2",
  }),
  newElement("arrow", {
    x: 150,
    y: 100,
    width: 400,
    height: 0,
    points: [
      [0, 0],
      [400, 0],
    ],
    strokeColor: "#ffffff",
    index: "a3",
  }),
]

const svgOf = (elements: NibElement[], theme: "light" | "dark", palette = KRAFT) =>
  exportToSvg({
    elements,
    appState: DEFAULT_APP_STATE,
    exportBackground: true,
    exportPadding: 0,
    scale: 1,
    theme,
    palette,
  })

describe("ink is kept legible against what it actually sits on", () => {
  test("the lookup finds the solid box under an element, and the board for one that leaves it", () => {
    const [box, line, text, arrow] = scene()
    const under = surfaceLookup([box!, line!, text!, arrow!], "light", KRAFT.board, KRAFT.board)
    expect(under(line!)).toBe("#343a40")
    expect(under(text!)).toBe("#343a40")
    expect(under(arrow!)).toBe(KRAFT.board)
    expect(under(box!)).toBe(KRAFT.board)
  })

  test("a box drawn above an element is not behind it", () => {
    const [box, line] = scene()
    const under = surfaceLookup([line!, { ...box!, index: "a2" }], "light", KRAFT.board, KRAFT.board)
    expect(under(line!)).toBe(KRAFT.board)
  })

  test("a translucent box is blended over what is behind it", () => {
    const [box, line] = scene()
    const half = { ...box!, opacity: 50 }
    const under = surfaceLookup([half, line!], "light", "#ffffff", "#ffffff")
    expect(under(line!)).toBe("#9a9da0")
  })

  test("Kraft: white ink on a dark box stays white in the canvas and in SVG", () => {
    const elements = scene()
    const r = recordingCanvas()
    renderStaticScene(r.ctx, {
      scene: new Scene(elements),
      appState: DEFAULT_APP_STATE,
      width: 800,
      height: 600,
      dpr: 1,
      theme: "light",
      palette: KRAFT,
      cache: new ShapeCache(),
    })
    const strokes = r.calls.filter((c) => c.op === "stroke").map((c) => String(c.strokeStyle).toLowerCase())
    expect(strokes).toContain("#ffffff")
    const text = r.calls.find((c) => c.op === "fillText")!
    expect(String(text.fillStyle).toLowerCase()).toBe("#ffffff")
    const svg = svgOf(elements, "light")
    expect(svg).toContain('stroke="#ffffff"')
    expect(svg).toMatch(/<text[^>]*fill="#ffffff"/)
  })

  test("Whiteboard: white ink on a dark box stays white", () => {
    expect(svgOf(scene(), "light", WHITEBOARD)).toMatch(/<text[^>]*fill="#ffffff"/)
  })

  test("Graphite: white ink on a dark box keeps its contrast with the box", () => {
    const elements = scene()
    const fill = themeColor("#343a40", "dark", GRAPHITE.board, "fill")
    const text = elements[2] as TextElement
    const under = surfaceLookup(elements, "dark", GRAPHITE.board, GRAPHITE.board)
    const shown = displayTextColor(text, { theme: "dark", palette: GRAPHITE, surfaceUnder: under })
    expect(contrastRatio(shown, fill)).toBeGreaterThan(8)
    // the arrow leaves the box, so it is still lifted off the board
    const arrow = themeColor("#ffffff", "dark", GRAPHITE.board, "stroke", under(elements[3]!))
    expect(contrastRatio(arrow, GRAPHITE.board)).toBeGreaterThanOrEqual(3)
  })

  test("a label still reads against its container's fill over what the container sits on", () => {
    const box = newElement("rectangle", {
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      backgroundColor: "#1e1e1e",
      fillStyle: "solid",
      index: "a0",
    })
    const label = newElement("text", {
      x: 100,
      y: 90,
      width: 80,
      height: 25,
      text: "Hi",
      originalText: "Hi",
      containerId: box.id,
      strokeColor: "#1e1e1e",
      index: "a1",
    }) as TextElement
    const elements = [box, label]
    const byId = new Map(elements.map((e) => [e.id, e]))
    const under = surfaceLookup(elements, "light", WHITEBOARD.board, WHITEBOARD.board)
    const shown = displayTextColor(label, {
      theme: "light",
      palette: WHITEBOARD,
      surfaceUnder: under,
      getElement: (id) => byId.get(id),
    })
    expect(contrastRatio(shown, "#1e1e1e")).toBeGreaterThanOrEqual(4.5)
  })
})

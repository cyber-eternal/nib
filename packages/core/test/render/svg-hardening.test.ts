import { describe, expect, test } from "vitest"
import { exportToSvg, extractSceneFromSvg } from "../../src/io/exportSvg"
import { newElement } from "../../src/model/element"
import { type BinaryFiles, DEFAULT_APP_STATE, type ElementType, type NibElement } from "../../src/model/types"
import { drawElement } from "../../src/render/drawElement"
import { ShapeCache } from "../../src/render/shapes"
import { recordingCanvas } from "./mockCanvas"

const svg = (elements: readonly NibElement[], extra: { files?: BinaryFiles; embedFontCss?: string } = {}) =>
  exportToSvg({
    elements,
    appState: DEFAULT_APP_STATE,
    exportBackground: true,
    exportPadding: 10,
    scale: 1,
    theme: "light",
    ...extra,
  })

const PAYLOAD = '0)"/><script>alert(1)</script><g a="'
const FILES: BinaryFiles = {
  f: { id: "f", mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", created: 1 },
}

const TYPES: ElementType[] = [
  "rectangle",
  "diamond",
  "ellipse",
  "frame",
  "embeddable",
  "text",
  "line",
  "arrow",
  "freedraw",
  "image",
]

const sample = (type: ElementType): NibElement =>
  newElement(type, {
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    angle: 0.3,
    text: "hi",
    textAlign: "right",
    fileId: "f",
    status: "saved",
    scale: [-1, -1],
    crop: { x: 0, y: 0, width: 10, height: 10, naturalWidth: 20, naturalHeight: 20 },
    points: [
      [0, 0],
      [100, 50],
    ],
    pressures: [0.5, 0.5],
    endArrowhead: "triangle",
    startArrowhead: "circle_outline",
    backgroundColor: "#ffc9c9",
    link: "https://example.com",
    name: "Frame",
  }) as NibElement

describe("every interpolated field is sanitised", () => {
  test("a hostile string in any field of any element type never reaches the markup", () => {
    for (const type of TYPES) {
      const base = sample(type) as unknown as Record<string, unknown>
      for (const field of Object.keys(base)) {
        if (field === "type" || field === "isDeleted" || field === "id") continue
        const el = { ...base, [field]: PAYLOAD } as unknown as NibElement
        let out = ""
        expect(() => {
          out = svg([el], { files: FILES })
        }, `${type}.${field}`).not.toThrow()
        expect(out, `${type}.${field}`).not.toContain("<script")
      }
    }
  })

  test("hostile points, crop and scale entries are coerced to numbers", () => {
    const line = {
      ...sample("arrow"),
      points: [
        [0, 0],
        [PAYLOAD, 5],
        [20, PAYLOAD],
      ],
    } as unknown as NibElement
    const img = {
      ...sample("image"),
      scale: [PAYLOAD, 1],
      crop: { x: PAYLOAD, y: 0, width: 10, height: 10, naturalWidth: PAYLOAD, naturalHeight: 20 },
    } as unknown as NibElement
    const out = svg([line, img], { files: FILES })
    expect(out).not.toContain("<script")
    expect(out).not.toContain("NaN")
  })

  test("embedded font CSS cannot close its style element", () => {
    const out = svg([sample("rectangle")], { embedFontCss: "@font-face{} </style><script>alert(1)</script>" })
    expect(out).not.toContain("<script")
    expect(out).toMatch(/<defs><style>@font-face\{\}/)
  })
})

describe("embedFontCss", () => {
  test("the font CSS lands in a style element inside defs", () => {
    const css = '@font-face { font-family: "Shantell Sans"; src: url(data:font/woff2;base64,AAAA) }'
    const out = svg([sample("text")], { embedFontCss: css })
    const defs = /<defs>(.*?)<\/defs>/.exec(out)?.[1] ?? ""
    expect(defs).toContain("<style>@font-face { font-family: &quot;Shantell Sans&quot;;")
    expect(defs).toContain("url(data:font/woff2;base64,AAAA)")
  })

  test("no defs are written when nothing needs them", () => {
    expect(svg([sample("rectangle")])).not.toContain("<defs>")
  })
})

describe("embedded scenes", () => {
  test("an export of an empty selection still carries the embedded scene", () => {
    const out = exportToSvg({
      elements: [],
      appState: DEFAULT_APP_STATE,
      exportBackground: false,
      exportPadding: 0,
      scale: 1,
      theme: "light",
      embedScene: '{"type":"nib"}',
    })
    expect(extractSceneFromSvg(out)).toBe('{"type":"nib"}')
  })
})

describe("SVG placeholders match the canvas", () => {
  test("a missing image exports as a dashed placeholder instead of vanishing", () => {
    const img = newElement("image", {
      x: 0,
      y: 0,
      width: 40,
      height: 30,
      fileId: "missing",
      status: "pending",
    })
    const out = svg([img])
    expect(out).toMatch(
      /<rect width="40" height="30" fill="none" stroke="#999999"[^>]*stroke-dasharray="6 6"/,
    )
  })

  test("a failed image looks different from a loading one, on canvas and in SVG", () => {
    const failed = newElement("image", { x: 0, y: 0, width: 40, height: 30, fileId: "x", status: "error" })
    const loading = { ...failed, status: "pending" as const }
    const strokesOf = (el: NibElement) => {
      const r = recordingCanvas()
      drawElement(r.ctx, el, { theme: "light", cache: new ShapeCache() })
      return r.calls.filter((c) => c.op === "stroke").map((c) => c.strokeStyle)
    }
    expect(strokesOf(failed)).not.toEqual(strokesOf(loading))
    const out = svg([failed])
    expect(out).toContain("#e03131")
    expect(out).toMatch(/<path d="M 0 0 L 40 30 M 40 0 L 0 30"/)
  })

  test("an embeddable keeps its link label, clipped to its box", () => {
    const embed = newElement("embeddable", {
      x: 0,
      y: 0,
      width: 80,
      height: 40,
      link: "https://example.com/a/very/long/path",
    })
    const out = svg([embed])
    expect(out).toMatch(/<svg width="80" height="40"><text [^>]*>[^<]*…<\/text><\/svg>/)
  })

  test("the canvas ellipsizes an embeddable label that does not fit", () => {
    const embed = newElement("embeddable", {
      x: 0,
      y: 0,
      width: 80,
      height: 40,
      link: "https://example.com/a/very/long/path",
    })
    const r = recordingCanvas()
    drawElement(r.ctx, embed, { theme: "light", cache: new ShapeCache() })
    const label = r.calls.find((c) => c.op === "fillText")!.args[0] as string
    expect(label.endsWith("…")).toBe(true)
    expect(label.length * 8).toBeLessThanOrEqual(80 - 16)
  })

  test("filled self-intersecting shapes use evenodd in SVG as on canvas", () => {
    const poly = newElement("line", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      polygon: true,
      backgroundColor: "#a5d8ff",
      fillStyle: "solid",
      points: [
        [0, 0],
        [100, 100],
        [100, 0],
        [0, 100],
        [0, 0],
      ],
    })
    const r = recordingCanvas()
    drawElement(r.ctx, poly, { theme: "light", cache: new ShapeCache() })
    expect(r.calls.find((c) => c.op === "fill")!.args[0]).toBe("evenodd")
    expect(svg([poly])).toMatch(/fill="#a5d8ff" fill-rule="evenodd"/)
  })
})

describe("closed polygon lines render filled", () => {
  const triangle = () =>
    newElement("line", {
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      polygon: true,
      backgroundColor: "#ffc9c9",
      fillStyle: "solid",
      roughness: 0,
      points: [
        [50, 0],
        [100, 80],
        [0, 80],
        [50, 0],
      ],
    })

  test("a polygon line is filled on canvas", () => {
    const r = recordingCanvas()
    drawElement(r.ctx, triangle(), { theme: "light", cache: new ShapeCache() })
    expect(r.calls.some((c) => c.op === "fill" && c.fillStyle === "#ffc9c9")).toBe(true)
  })

  test("a polygon line is filled in SVG", () => {
    expect(svg([triangle()])).toMatch(/<path d="[^"]+" stroke="none" fill="#ffc9c9"/)
  })

  test("the repeated closing vertex is not traced as an extra corner", () => {
    const r = recordingCanvas()
    drawElement(r.ctx, triangle(), { theme: "light", cache: new ShapeCache() })
    // the solid fill traces the vertices once each
    const fillIndex = r.calls.findIndex((c) => c.op === "fill")
    const begin = r.calls
      .slice(0, fillIndex)
      .map((c) => c.op)
      .lastIndexOf("beginPath")
    const traced = r.calls.slice(begin, fillIndex).filter((c) => c.op === "moveTo" || c.op === "lineTo")
    expect(traced).toHaveLength(3)
  })

  test("an open line never fills, even with a background colour", () => {
    const open = { ...triangle(), polygon: false }
    const r = recordingCanvas()
    drawElement(r.ctx, open, { theme: "light", cache: new ShapeCache() })
    expect(r.calls.some((c) => c.op === "fill")).toBe(false)
  })
})

describe("export bounds include what is drawn outside the outline", () => {
  test("an arrowhead's wings stay inside the exported viewBox", () => {
    const arrow = newElement("arrow", {
      x: 0,
      y: 0,
      width: 200,
      height: 0,
      roughness: 0,
      points: [
        [0, 0],
        [200, 0],
      ],
      endArrowhead: "triangle",
    })
    const out = exportToSvg({
      elements: [arrow],
      appState: DEFAULT_APP_STATE,
      exportBackground: false,
      exportPadding: 0,
      scale: 1,
      theme: "light",
    })
    const [, , , h] = /viewBox="([^"]+)"/.exec(out)![1]!.split(" ").map(Number)
    // the triangle is 18px long and spreads 7.2px either side of the shaft
    expect(h!).toBeGreaterThanOrEqual(14.4)
  })
})

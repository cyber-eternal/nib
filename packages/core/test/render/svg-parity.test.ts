import { describe, expect, test } from "vitest"
import { exportToSvg } from "../../src/io/exportSvg"
import { newElement } from "../../src/model/element"
import { Scene } from "../../src/model/scene"
import { type BinaryFiles, DEFAULT_APP_STATE, type NibElement } from "../../src/model/types"
import { drawElement } from "../../src/render/drawElement"
import { ShapeCache } from "../../src/render/shapes"
import { renderStaticScene } from "../../src/render/staticScene"
import { recordingCanvas } from "./mockCanvas"

const svg = (elements: NibElement[], files: BinaryFiles = {}) =>
  exportToSvg({
    elements,
    appState: DEFAULT_APP_STATE,
    files,
    exportBackground: false,
    exportPadding: 0,
    scale: 1,
    theme: "light",
  })

const attrs = (tag: string): Record<string, string> =>
  Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]))

describe("SVG export honours image crop", () => {
  test("a cropped image shows only the cropped region", () => {
    const files: BinaryFiles = {
      f: { id: "f", mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", created: 1 },
    }
    // right half of a 100x100 bitmap, displayed at 50x100
    const img = newElement("image", {
      x: 0,
      y: 0,
      width: 50,
      height: 100,
      fileId: "f",
      status: "saved",
      crop: { x: 50, y: 0, width: 50, height: 100, naturalWidth: 100, naturalHeight: 100 },
    })
    const out = svg([img], files)
    const tag = /<image [^>]*>/.exec(out)![0]
    const a = attrs(tag)
    // the full bitmap is laid out at display scale and clipped, as the canvas does via drawImage(sx,sy,sw,sh,...)
    expect(Number(a.width)).toBeCloseTo(100)
    expect(Number(a.height)).toBeCloseTo(100)
    const viaViewBox = /viewBox="50 0 50 100"/.test(out)
    const viaClip = /clip-path=/.test(out) && Number(a.x) === -50
    expect(viaViewBox || viaClip).toBe(true)
  })
})

describe("SVG text keeps whitespace like the canvas", () => {
  test("runs of spaces and indentation survive", () => {
    const t = newElement("text", { x: 0, y: 0, width: 120, height: 50, text: "a   b\n  indented" })
    const out = svg([t])
    expect(out).toMatch(/xml:space="preserve"|white-space:\s*pre/)
  })
})

describe("SVG freedraw matches the canvas outline", () => {
  test("the exported path is the same outline the canvas fills", () => {
    const points: [number, number][] = []
    for (let i = 0; i < 40; i++) points.push([i * 3, Math.sin(i / 4) * 20 + 20])
    const el = newElement("freedraw", {
      x: 0,
      y: 0,
      width: 120,
      height: 40,
      points,
      pressures: points.map(() => 0.5),
      simulatePressure: true,
      lastCommittedPoint: points[points.length - 1]!,
    })
    const r = recordingCanvas()
    drawElement(r.ctx, el, { theme: "light", cache: new ShapeCache() })
    const canvasNums = r.calls
      .filter((c) => c.op === "moveTo" || c.op === "quadraticCurveTo")
      .flatMap((c) => c.args as number[])
    const d = /<path d="(M[^"]*)" fill=/.exec(svg([el]))![1]!
    const svgNums = d.match(/-?\d+(\.\d+)?(e-?\d+)?/g)!.map(Number)
    expect(svgNums.length).toBe(canvasNums.length)
    const maxDiff = Math.max(...svgNums.map((v, i) => Math.abs(v - canvasNums[i]!)))
    expect(maxDiff).toBeLessThan(0.01)
  })
})

describe("SVG dashed outlines do not dash the fill hatching", () => {
  test("hachure lines of a dashed shape are solid, as on canvas", () => {
    const rect = newElement("rectangle", {
      x: 0,
      y: 0,
      width: 120,
      height: 80,
      strokeStyle: "dashed",
      fillStyle: "hachure",
      backgroundColor: "#a5d8ff",
    })
    // canvas: the fill sketch is stroked with no dash
    const r = recordingCanvas()
    drawElement(r.ctx, rect, { theme: "light", cache: new ShapeCache() })
    const hatchStrokes = r.calls.filter((c) => c.op === "stroke" && c.strokeStyle === "#a5d8ff")
    expect(hatchStrokes.length).toBeGreaterThan(0)
    expect(hatchStrokes.every((c) => c.dash.length === 0)).toBe(true)

    const hatchPaths = [...svg([rect]).matchAll(/<path [^>]*stroke="#a5d8ff"[^>]*>/g)].map((m) => m[0])
    expect(hatchPaths.length).toBeGreaterThan(0)
    for (const p of hatchPaths) expect(p).not.toContain("stroke-dasharray")
  })
})

describe("frames clip their children and show their name", () => {
  const frameScene = () => {
    const frame = newElement("frame", {
      id: "fr",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      name: "Login",
      index: "a0",
    })
    const child = newElement("rectangle", {
      x: 50,
      y: 50,
      width: 120,
      height: 120,
      frameId: "fr",
      strokeColor: "#e03131",
      index: "a1",
    })
    return [frame, child]
  }

  test("canvas clips a frame child to the frame box", () => {
    const r = recordingCanvas()
    renderStaticScene(r.ctx, {
      scene: new Scene(frameScene()),
      appState: DEFAULT_APP_STATE,
      width: 800,
      height: 600,
      dpr: 1,
      theme: "light",
      cache: new ShapeCache(),
    })
    const firstChildStroke = r.calls.findIndex((c) => c.op === "stroke" && c.strokeStyle === "#e03131")
    expect(firstChildStroke).toBeGreaterThan(-1)
    const clipBefore = r.calls.slice(0, firstChildStroke).some((c) => c.op === "clip")
    expect(clipBefore).toBe(true)
  })

  test("SVG clips frame children and carries the frame name", () => {
    const out = svg(frameScene())
    expect(out).toContain("<clipPath")
    expect(out).toContain("Login")
  })
})

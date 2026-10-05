import { describe, expect, test } from "vitest"
import { exportToSvg } from "../../src/io/exportSvg"
import { newElement } from "../../src/model/element"
import { Scene } from "../../src/model/scene"
import { DEFAULT_APP_STATE, type NibElement } from "../../src/model/types"
import { parseColor } from "../../src/render/color"
import { type InteractiveSceneInput, renderInteractiveScene } from "../../src/render/interactiveScene"
import { ShapeCache } from "../../src/render/shapes"
import { renderElementsTo, renderStaticScene } from "../../src/render/staticScene"
import { FONT_STACKS } from "../../src/render/textMeasure"
import {
  type CanvasPalette,
  canvasBackground,
  defaultCanvasPalette,
  deriveCanvasPalette,
  remapLuminance,
  themeColor,
} from "../../src/render/theme"
import { recordingCanvas } from "./mockCanvas"

const PALETTE: CanvasPalette = {
  board: "#0f3460",
  selection: "#ffd166",
  selectionFill: "rgba(255, 209, 102, 0.08)",
  binding: "#00ff01",
  snapGuide: "#00ff02",
  frameBorder: "#00ff03",
  frameLabel: "#00ff04",
  gridMinor: "#00ff05",
  gridMajor: "#00ff06",
  correctionFlash: "#00ff07",
  searchHighlight: "#00ff08",
  laser: "#00ff09",
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
  ...over,
})

describe("CanvasPalette", () => {
  test("default palettes exist for both modes and are stable objects", () => {
    for (const mode of ["light", "dark"] as const) {
      const p = defaultCanvasPalette(mode)
      expect(defaultCanvasPalette(mode)).toBe(p)
      for (const key of Object.keys(PALETTE)) expect(typeof p[key as keyof CanvasPalette]).toBe("string")
    }
    expect(defaultCanvasPalette("light").board).toBe("#ffffff")
  })

  test("deriveCanvasPalette takes the course ink for selection and correction", () => {
    const p = deriveCanvasPalette({ mode: "dark", board: "#1f2d27", ink: "#edefe6", course: "#f4d35e" })
    expect(p.board).toBe("#1f2d27")
    expect(p.selection).toBe("#f4d35e")
    expect(p.correctionFlash).toBe("#f4d35e")
    expect(p.selectionFill).toBe("rgba(244, 211, 94, 0.08)")
  })

  test("canvasBackground paints the board for the default white document background", () => {
    expect(canvasBackground("#ffffff", "light", PALETTE)).toBe(PALETTE.board)
    expect(canvasBackground("#ffffff", "dark", PALETTE)).toBe(PALETTE.board)
    expect(canvasBackground("#ffffff", "dark")).toBe(defaultCanvasPalette("dark").board)
    expect(canvasBackground("#ffffff", "light")).toBe("#ffffff")
  })

  test("a custom document tint survives dark mode instead of collapsing to the board", () => {
    const a = canvasBackground("#fff9db", "dark")
    const b = canvasBackground("#e7f5ff", "dark")
    expect(a).not.toBe(b)
    expect(a).not.toBe(defaultCanvasPalette("dark").board)
    expect(canvasBackground("#fff9db", "light")).toBe("#fff9db")
  })

  test("the static scene fills the board and draws the grid from the palette", () => {
    const r = recordingCanvas()
    renderStaticScene(r.ctx, {
      scene: new Scene([]),
      appState: { ...DEFAULT_APP_STATE, gridSize: 20 },
      width: 200,
      height: 200,
      dpr: 1,
      theme: "dark",
      palette: PALETTE,
      cache: new ShapeCache(),
    })
    expect(r.calls.find((c) => c.op === "fillRect")!.fillStyle).toBe(PALETTE.board)
    const strokes = r.calls.filter((c) => c.op === "stroke").map((c) => c.strokeStyle)
    expect(strokes).toContain(PALETTE.gridMinor)
    expect(strokes).toContain(PALETTE.gridMajor)
  })

  test("frames use the palette in both renderers", () => {
    const frame = newElement("frame", { x: 0, y: 0, width: 100, height: 80, name: "F", index: "a0" })
    const r = recordingCanvas()
    renderElementsTo(r.ctx, [frame], { theme: "light", cache: new ShapeCache(), palette: PALETTE })
    expect(r.calls.find((c) => c.op === "stroke")!.strokeStyle).toBe(PALETTE.frameBorder)
    expect(r.calls.find((c) => c.op === "fillText")!.fillStyle).toBe(PALETTE.frameLabel)
    const svg = exportToSvg({
      elements: [frame],
      appState: DEFAULT_APP_STATE,
      exportBackground: true,
      exportPadding: 0,
      scale: 1,
      theme: "light",
      palette: PALETTE,
    })
    expect(svg).toContain(`stroke="${PALETTE.frameBorder}"`)
    expect(svg).toContain(`fill="${PALETTE.board}"`)
  })

  test("the interactive layer draws selection, marquee, snap guides and laser from the palette", () => {
    const rect = newElement("rectangle", { x: 0, y: 0, width: 100, height: 50 })
    const r = recordingCanvas()
    renderInteractiveScene(
      r.ctx,
      interactive({
        palette: PALETTE,
        selected: [rect],
        marquee: [0, 0, 10, 10],
        snapLines: [{ axis: "x", at: 5, from: 0, to: 10 }] as InteractiveSceneInput["snapLines"],
        laserTrail: [
          { p: [0, 0], t: Date.now() },
          { p: [10, 10], t: Date.now() },
        ],
      }),
    )
    const strokes = new Set(
      r.calls.filter((c) => c.op === "stroke" || c.op === "strokeRect").map((c) => c.strokeStyle),
    )
    for (const c of [PALETTE.selection, PALETTE.snapGuide, PALETTE.laser]) expect(strokes).toContain(c)
    expect(r.calls.find((c) => c.op === "fillRect")!.fillStyle).toBe(PALETTE.selectionFill)
    // handles are filled with the board so they read on any theme
    expect(r.calls.filter((c) => c.op === "fill").every((c) => c.fillStyle === PALETTE.board)).toBe(true)
  })

  test("save/restore stays balanced in the interactive layer", () => {
    const r = recordingCanvas()
    const rect = newElement("rectangle", { x: 0, y: 0, width: 100, height: 50 })
    renderInteractiveScene(
      r.ctx,
      interactive({ selected: [rect], bindingHighlight: rect, frameHighlight: rect }),
    )
    expect(r.depth()).toBe(0)
  })
})

describe("correction flash and search matches", () => {
  const circle = newElement("ellipse", { id: "c1", x: 0, y: 0, width: 100, height: 100 })
  const scene = { get: (id: string): NibElement | undefined => (id === circle.id ? circle : undefined) }

  test("the corrected element's outline is stroked in the flash colour, fading with t", () => {
    const at = (t: number) => {
      const r = recordingCanvas()
      renderInteractiveScene(
        r.ctx,
        interactive({ palette: PALETTE, scene, correctionFlash: { elementId: "c1", t } }),
      )
      return r.calls.filter((c) => c.op === "stroke" && c.strokeStyle === PALETTE.correctionFlash)
    }
    expect(at(0)).toHaveLength(1)
    expect(at(0)[0]!.alpha).toBeCloseTo(1)
    expect(at(0.75)[0]!.alpha).toBeCloseTo(0.25)
    expect(at(1)).toHaveLength(0)
  })

  test("a flash for an id that is not in the scene draws nothing", () => {
    const r = recordingCanvas()
    renderInteractiveScene(
      r.ctx,
      interactive({ palette: PALETTE, scene, correctionFlash: { elementId: "nope", t: 0 } }),
    )
    expect(r.calls.some((c) => c.strokeStyle === PALETTE.correctionFlash && c.op === "stroke")).toBe(false)
  })

  test("search matches are outlined in the highlight colour", () => {
    const r = recordingCanvas()
    renderInteractiveScene(r.ctx, interactive({ palette: PALETTE, scene, searchMatches: ["c1", "missing"] }))
    expect(
      r.calls.filter((c) => c.op === "strokeRect" && c.strokeStyle === PALETTE.searchHighlight),
    ).toHaveLength(1)
  })
})

describe("the dark remap is one monotonic transform around the board", () => {
  test("white lands exactly on the board's luminance and black on white", () => {
    for (const board of [0, 0.007, 0.01, 0.033, 0.2]) {
      expect(remapLuminance(1, board)).toBeCloseTo(board)
      expect(remapLuminance(0, board)).toBeCloseTo(1)
    }
  })

  test("the transform is strictly decreasing for every board", () => {
    for (const board of [0, 0.005, 0.01, 0.033, 0.2]) {
      let prev = Number.POSITIVE_INFINITY
      for (let l = 0; l <= 1.0001; l += 0.01) {
        const v = remapLuminance(Math.min(1, l), board)
        expect(v).toBeLessThan(prev)
        prev = v
      }
    }
  })

  test("a white fill takes on the theme's board colour", () => {
    expect(themeColor("#ffffff", "dark", "#0f3460", "fill")).toBe("#0f3460")
    expect(themeColor("#ffffff", "dark", undefined, "fill")).toBe(defaultCanvasPalette("dark").board)
  })

  test("pale fills are never darker than the board", () => {
    const board = "#16171a"
    const luminance = (hex: string) => {
      const c = parseColor(hex)!
      const lin = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
      return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
    }
    for (const c of ["#fff5f5", "#f8f9fa", "#e7f5ff", "#ebfbee"]) {
      expect(luminance(themeColor(c, "dark", board, "fill"))).toBeGreaterThanOrEqual(luminance(board) - 5e-4)
    }
  })

  test("alpha and notation are kept", () => {
    expect(themeColor("#00000080", "dark")).toBe("#ffffff80")
    expect(themeColor("#0008", "dark")).toBe("#ffffff88")
    expect(themeColor("rgba(0, 0, 0, 0.5)", "dark")).toBe("rgba(255, 255, 255, 0.5)")
    expect(themeColor("hsl(0 0% 0% / 25%)", "dark")).toBe("rgba(255, 255, 255, 0.25)")
    expect(themeColor("transparent", "dark")).toBe("transparent")
    expect(themeColor("not a colour", "dark")).toBe("not a colour")
  })

  test("light mode leaves colours untouched", () => {
    expect(themeColor("#e03131", "light")).toBe("#e03131")
  })
})

describe("font stacks", () => {
  test("the bundled faces lead each stack", () => {
    expect(FONT_STACKS.hand).toBe('"Shantell Sans", "Comic Sans MS", cursive')
    expect(FONT_STACKS.normal).toBe('"Nunito", "Helvetica Neue", Arial, sans-serif')
    expect(FONT_STACKS.code).toBe('"Cascadia Code", "SF Mono", Menlo, monospace')
    expect(FONT_STACKS.serif).toBeTruthy()
    expect(FONT_STACKS.mono).toBeTruthy()
  })
})

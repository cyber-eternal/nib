import { DEFAULT_APP_STATE, type NibElement, newElement } from "@nib/core"
import { describe, expect, it } from "vitest"
import { EXPORT_PADDING, MAX_EXPORT_SIDE } from "../../src/export/exportImage"
import {
  DEFAULT_EXPORT_PREFS,
  exportErrorMessage,
  exportSize,
  fileStem,
  frameFileStems,
  frameTitles,
  initialScope,
  parseExportPrefs,
  serializeExportPrefs,
} from "../../src/ui/panels/exportModel"

const opts = (elements: readonly NibElement[], scale: number, frameId: string | null = null) => ({
  elements,
  appState: DEFAULT_APP_STATE,
  files: {},
  scale,
  exportBackground: true,
  theme: "light" as const,
  frameId,
})

describe("export size readout", () => {
  it("frames the frame exactly, without padding, at the chosen scale", () => {
    const frame = newElement("frame", { x: 0, y: 0, width: 400, height: 300 } as never)
    const size = exportSize(opts([frame], 2, frame.id), "png")
    expect(size).toMatchObject({ width: 800, height: 600, scale: 2, reduced: false })
  })

  it("adds the padding around ordinary content", () => {
    const r = newElement("rectangle", { x: 0, y: 0, width: 100, height: 100, roughness: 0, strokeWidth: 0 })
    const size = exportSize(opts([r], 1), "svg")
    expect(size.width).toBeGreaterThanOrEqual(100 + EXPORT_PADDING * 2)
    expect(size.scale).toBe(1)
  })

  it("reports the scale the browser's canvas limit forces", () => {
    const frame = newElement("frame", { x: 0, y: 0, width: MAX_EXPORT_SIDE, height: 100 } as never)
    const size = exportSize(opts([frame], 3, frame.id), "png")
    expect(size.reduced).toBe(true)
    expect(size.scale).toBeLessThanOrEqual(1)
    expect(size.requested).toBe(3)
    expect(size.width).toBeLessThanOrEqual(MAX_EXPORT_SIDE)
  })
})

describe("remembered export options", () => {
  it("round-trips and falls back field by field", () => {
    const p = { ...DEFAULT_EXPORT_PREFS, format: "svg" as const, scale: 3 as const, dark: true }
    expect(parseExportPrefs(serializeExportPrefs(p))).toEqual(p)
    expect(parseExportPrefs('{"scale":7,"background":"yes"}')).toEqual(DEFAULT_EXPORT_PREFS)
    expect(parseExportPrefs("not json")).toEqual(DEFAULT_EXPORT_PREFS)
    expect(parseExportPrefs(null)).toEqual(DEFAULT_EXPORT_PREFS)
  })
})

describe("export scope and file names", () => {
  const frame = newElement("frame", { x: 0, y: 0, width: 10, height: 10 } as never)
  const box = newElement("rectangle", { x: 0, y: 0, width: 10, height: 10 })

  it("starts on the one selected frame, then the selection, then the canvas", () => {
    expect(initialScope([frame])).toEqual({ scope: "frame", frameId: frame.id })
    expect(initialScope([frame, box])).toEqual({ scope: "selection", frameId: null })
    expect(initialScope([])).toEqual({ scope: "canvas", frameId: null })
  })

  it("numbers repeated and unnamed frame names", () => {
    const named = newElement("frame", { x: 0, y: 0, width: 1, height: 1, name: "Intro" } as never)
    const other = newElement("frame", { x: 0, y: 0, width: 1, height: 1 } as never)
    expect(frameTitles([frame, named, other])).toEqual(["Frame 1", "Intro", "Frame 2"])
  })

  it("makes safe, unique stems for an every-frame export", () => {
    expect(fileStem("My: plan/v2.nibd")).toBe("My- plan-v2")
    expect(fileStem("Old plan.excalidraw")).toBe("Old plan")
    expect(fileStem("   ")).toBe("drawing")
    expect(frameFileStems("Deck", ["Intro", "Intro", "a/b"])).toEqual([
      "Deck - Intro",
      "Deck - Intro 2",
      "Deck - a-b",
    ])
  })

  it("stays quiet about a cancelled save picker and names other failures", () => {
    const abort = new Error("cancelled")
    abort.name = "AbortError"
    expect(exportErrorMessage(abort)).toBeNull()
    expect(exportErrorMessage(new Error("Couldn't encode the PNG."))).toMatch(
      /Export failed: Couldn't encode/,
    )
  })
})

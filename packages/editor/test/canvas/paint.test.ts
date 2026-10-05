import { defaultCanvasPalette } from "@nib/core"
import { describe, expect, it } from "vitest"
import {
  CORRECTION_FLASH_MS,
  type StaticKey,
  backingSize,
  correctionFlashAt,
  staticKeyChanged,
} from "../../src/canvas/paint"

const palette = defaultCanvasPalette("light")
const base: StaticKey = {
  version: 3,
  width: 800,
  height: 600,
  dpr: 2,
  palette,
  images: 0,
  fonts: 1,
  hiddenFrameLabel: null,
}

describe("staticKeyChanged", () => {
  it("repaints the first frame", () => {
    expect(staticKeyChanged(null, base)).toBe(true)
  })

  it("skips interaction-only frames where nothing the static layer draws changed", () => {
    expect(staticKeyChanged(base, { ...base })).toBe(false)
  })

  it.each<[string, Partial<StaticKey>]>([
    ["the scene or viewport (staticVersion)", { version: 4 }],
    ["the canvas size", { width: 801 }],
    ["the device pixel ratio", { dpr: 1 }],
    ["the theme palette", { palette: defaultCanvasPalette("dark") }],
    ["a decoded image", { images: 1 }],
    ["loaded fonts", { fonts: 2 }],
    ["the frame being renamed", { hiddenFrameLabel: "f1" }],
  ])("repaints when %s changes", (_name, patch) => {
    expect(staticKeyChanged(base, { ...base, ...patch })).toBe(true)
  })
})

describe("correctionFlashAt (pencil feedback)", () => {
  const last = { elementId: "e1", at: 1000 }

  it("fades from 0 to 1 over 150ms", () => {
    expect(correctionFlashAt(last, 1000, false)).toEqual({ elementId: "e1", t: 0 })
    expect(correctionFlashAt(last, 1000 + CORRECTION_FLASH_MS / 2, false)?.t).toBeCloseTo(0.5)
    expect(correctionFlashAt(last, 1000 + CORRECTION_FLASH_MS, false)).toBeNull()
  })

  it("is skipped under reduced motion and when nothing was corrected", () => {
    expect(correctionFlashAt(last, 1010, true)).toBeNull()
    expect(correctionFlashAt(null, 1010, false)).toBeNull()
  })

  it("ignores a correction stamped in the future (clock skew)", () => {
    expect(correctionFlashAt(last, 900, false)).toBeNull()
  })
})

describe("backingSize", () => {
  it("scales by the pixel ratio and never returns zero", () => {
    expect(backingSize(400.4, 2)).toBe(801)
    expect(backingSize(0, 2)).toBe(1)
  })
})

describe("samePalette", () => {
  it("treats an equal copy as unchanged", () => {
    expect(staticKeyChanged(base, { ...base, palette: { ...palette } })).toBe(false)
  })
})

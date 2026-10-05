import { describe, expect, it } from "vitest"
import { gridMove } from "../../src/ui/style/grid"
import { HEX_HINT, hexDraft, normalizeColor, parseHexInput, sameColor } from "../../src/ui/style/hex"
import { parseFontSize, parseGridSize } from "../../src/ui/style/parse"

describe("hex validation", () => {
  it("accepts 3 and 6 digits, with or without #, any case, and expands short forms", () => {
    expect(parseHexInput("#1E1E1E")).toEqual({ ok: true, color: "#1e1e1e" })
    expect(parseHexInput("1e1e1e")).toEqual({ ok: true, color: "#1e1e1e" })
    expect(parseHexInput("  #abc ")).toEqual({ ok: true, color: "#aabbcc" })
    expect(parseHexInput("F0A")).toEqual({ ok: true, color: "#ff00aa" })
  })

  it("rejects partial and malformed input with a hint, so #123 is never committed on the way to #123456", () => {
    for (const bad of ["#12", "#1234", "12345", "#12345", "#1234567", "#ggg", "red", "##123"]) {
      const r = parseHexInput(bad)
      expect(r.ok, bad).toBe(false)
    }
    expect(parseHexInput("#1234")).toEqual({ ok: false, error: HEX_HINT })
    expect(parseHexInput("   ")).toEqual({ ok: false, error: "Enter a colour" })
  })

  it("accepts transparent only where a fill allows it", () => {
    expect(parseHexInput("transparent").ok).toBe(false)
    expect(parseHexInput("Transparent", { allowTransparent: true })).toEqual({
      ok: true,
      color: "transparent",
    })
    expect(parseHexInput("none", { allowTransparent: true })).toEqual({ ok: true, color: "transparent" })
  })

  it("normalises colours for comparison and drafts", () => {
    expect(normalizeColor("#ABC")).toBe("#aabbcc")
    expect(sameColor("#E03131", "e03131")).toBe(true)
    expect(sameColor("#e03131", "#e03132")).toBe(false)
    expect(hexDraft("#E03131")).toBe("e03131")
    expect(hexDraft(null)).toBe("")
    expect(hexDraft("transparent")).toBe("")
  })
})

describe("number fields", () => {
  it("reads font sizes within the core's limits", () => {
    expect(parseFontSize("24")).toBe(24)
    expect(parseFontSize(" 24px ")).toBe(24)
    expect(parseFontSize("12.6")).toBe(13)
    expect(parseFontSize("0")).toBeNull()
    expect(parseFontSize("1001")).toBeNull()
    expect(parseFontSize("-4")).toBeNull()
    expect(parseFontSize("big")).toBeNull()
  })

  it("reads grid sizes: empty or off hides the grid, numbers clamp", () => {
    expect(parseGridSize("")).toEqual({ ok: true, size: null })
    expect(parseGridSize("off")).toEqual({ ok: true, size: null })
    expect(parseGridSize("25")).toEqual({ ok: true, size: 25 })
    expect(parseGridSize("1")).toEqual({ ok: true, size: 4 })
    expect(parseGridSize("900")).toEqual({ ok: true, size: 200 })
    expect(parseGridSize("x").ok).toBe(false)
  })
})

describe("swatch grid keyboard movement", () => {
  it("moves by one across and by a row up and down, wrapping", () => {
    expect(gridMove(0, 14, 7, "ArrowRight")).toBe(1)
    expect(gridMove(13, 14, 7, "ArrowRight")).toBe(0)
    expect(gridMove(0, 14, 7, "ArrowLeft")).toBe(13)
    expect(gridMove(2, 14, 7, "ArrowDown")).toBe(9)
    expect(gridMove(9, 14, 7, "ArrowDown")).toBe(2)
    expect(gridMove(9, 14, 7, "ArrowUp")).toBe(2)
    expect(gridMove(2, 14, 7, "ArrowUp")).toBe(9)
    expect(gridMove(6, 13, 7, "ArrowUp")).toBe(12)
    expect(gridMove(5, 13, 7, "Home")).toBe(0)
    expect(gridMove(5, 13, 7, "End")).toBe(12)
    expect(gridMove(5, 13, 7, "a")).toBeNull()
  })
})

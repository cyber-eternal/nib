import { themeColor } from "@nib/core"
import { describe, expect, it } from "vitest"
import { getTheme, themes } from "../../src/theme/themes"
import { BACKGROUND_PALETTE, CANVAS_PALETTE, STROKE_PALETTE, colorName } from "../../src/ui/palette"
import {
  displayColor,
  paletteSwatches,
  pushRecent,
  recentRow,
  sceneColors,
  shadeSwatches,
  storedColor,
  themeCapSwatches,
} from "../../src/ui/style/colors"
import { capNames } from "../../src/ui/tray/trayModel"

const channels = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
const close = (a: string, b: string, tol = 6) =>
  channels(a).every((v, i) => Math.abs(v - channels(b)[i]!) <= tol)

describe("palette", () => {
  it("offers 13 stroke hues and transparent plus 13 fills, with names, never hex codes", () => {
    expect(STROKE_PALETTE).toHaveLength(13)
    expect(BACKGROUND_PALETTE[0]).toBe("transparent")
    expect(BACKGROUND_PALETTE).toHaveLength(14)
    for (const c of [...STROKE_PALETTE, ...BACKGROUND_PALETTE]) expect(colorName(c)).not.toMatch(/#/)
    expect(colorName("#e03131")).toBe("Red")
    expect(colorName("#ffc9c9")).toBe("Red, light")
    expect(colorName("#F4D35E")).toBe("Yellow")
    expect(colorName("transparent")).toBe("Transparent")
  })

  it("names the canvas tints by their hue, not all White", () => {
    const names = paletteSwatches("canvas", getTheme("graphite")).map((s) => s.name)
    expect(names).toEqual([
      "Theme default",
      "Grey, lightest",
      "Blue tint",
      "Yellow tint",
      "Bronze tint",
      "Green tint",
      "Pink tint",
    ])
    expect(new Set(names).size).toBe(CANVAS_PALETTE.length)
    expect(colorName("#fafafa")).toBe("White")
    expect(colorName("#ffffff")).toBe("White")
  })

  it("offers transparent exactly once in the fill palette", () => {
    const sw = paletteSwatches("background", getTheme("whiteboard"))
    expect(sw.filter((s) => s.stored === "transparent")).toHaveLength(1)
    const shades = shadeSwatches("transparent", "background", getTheme("whiteboard"))
    expect(shades.some((s) => s.stored === "transparent")).toBe(false)
  })

  it("shows the shades of the current colour's family", () => {
    const shades = shadeSwatches("#1971c2", "stroke", getTheme("whiteboard"))
    expect(shades.map((s) => s.stored)).toContain("#1971c2")
    expect(shades).toHaveLength(5)
  })
})

describe("dark themes show display colours but store canonical ones", () => {
  it("light themes store exactly what they show", () => {
    const wb = getTheme("whiteboard")
    expect(storedColor("#E03131", wb)).toBe("#e03131")
    expect(displayColor("#e03131", wb)).toBe("#e03131")
  })

  it("a dark theme's caps store a light-authored colour that renders as the cap", () => {
    for (const theme of themes.filter((t) => t.mode === "dark")) {
      themeCapSwatches(theme).forEach((s, i) => {
        expect(s.display).toBe(theme.caps[i])
        const shown = themeColor(s.stored, "dark", theme.board)
        expect(close(shown.toLowerCase(), s.display.toLowerCase()), `${theme.id} ${s.display}`).toBe(true)
      })
    }
  })

  it("the panel names each theme's caps as the tray does, uniquely", () => {
    for (const theme of themes) {
      const names = themeCapSwatches(theme).map((s) => s.name)
      expect(names, theme.id).toEqual(capNames(theme.caps, theme))
      expect(new Set(names).size, theme.id).toBe(names.length)
    }
  })

  it("palette swatches on a dark board display through the canvas remap", () => {
    const graphite = getTheme("graphite")
    const black = paletteSwatches("stroke", graphite)[0]!
    expect(black.stored).toBe("#1e1e1e")
    expect(black.display).toBe(themeColor("#1e1e1e", "dark", graphite.board))
    expect(black.display).not.toBe("#1e1e1e")
  })

  it("stroke swatches show the canvas's contrast floor on light boards too", () => {
    const kraft = getTheme("kraft")
    const orange = paletteSwatches("stroke", kraft).find((s) => s.stored === "#f08c00")!
    expect(orange.display).toBe(themeColor("#f08c00", "light", kraft.board, "stroke"))
    expect(orange.display).not.toBe("#f08c00")
    expect(displayColor("#f08c00", kraft)).toBe(orange.display)
    const shade = shadeSwatches("#f08c00", "stroke", kraft).find((s) => s.stored === "#f08c00")!
    expect(shade.drawn).toBe(orange.display)
  })

  it("shades stay tellable apart where the floor clamps them, with the drawn colour alongside", () => {
    for (const theme of [getTheme("kraft"), getTheme("graphite"), getTheme("blackboard")]) {
      const reds = shadeSwatches("#e03131", "stroke", theme)
      expect(new Set(reds.map((s) => s.display)).size, theme.id).toBe(5)
      for (const s of reds) {
        expect(s.display, theme.id).toBe(themeColor(s.stored, theme.mode, theme.board, "stroke", null))
        const drawn = themeColor(s.stored, theme.mode, theme.board, "stroke")
        expect(s.drawn ?? s.display, theme.id).toBe(drawn)
      }
    }
    const kraftReds = shadeSwatches("#e03131", "stroke", getTheme("kraft"))
    expect(kraftReds.some((s) => s.drawn)).toBe(true)
    expect(shadeSwatches("#e03131", "stroke", getTheme("whiteboard")).every((s) => !s.drawn)).toBe(true)
    expect(shadeSwatches("#e03131", "background", getTheme("graphite")).every((s) => !s.drawn)).toBe(true)
  })

  it("fill swatches are never floored: white shows as the dark board", () => {
    const graphite = getTheme("graphite")
    const white = paletteSwatches("background", graphite).find((s) => s.stored === "#ffffff")!
    expect(white.display.toLowerCase()).toBe(graphite.board.toLowerCase())
    expect(displayColor("#ffffff", graphite, "fill").toLowerCase()).toBe(graphite.board.toLowerCase())
    const kraft = getTheme("kraft")
    const pale = paletteSwatches("background", kraft)[2]!
    expect(pale.display).toBe(pale.stored)
  })

  it("the canvas default paints as each theme's own board", () => {
    for (const theme of themes) expect(paletteSwatches("canvas", theme)[0]!.display).toBe(theme.board)
  })
})

describe("recent colours", () => {
  it("keeps the newest first without duplicates", () => {
    expect(pushRecent(["#aaaaaa", "#bbbbbb"], "#BBBBBB")).toEqual(["#bbbbbb", "#aaaaaa"])
    expect(
      pushRecent(
        Array.from({ length: 8 }, (_, i) => `#00000${i}`),
        "#ffffff",
      ),
    ).toHaveLength(8)
  })

  it("fills the row from picks, then colours on the canvas, skipping what the palette shows", () => {
    expect(recentRow(["#123456"], ["#e03131", "#654321", "#123456"], ["#e03131"])).toEqual([
      "#123456",
      "#654321",
    ])
  })

  it("ranks canvas colours by use and skips transparent", () => {
    const els = [
      { strokeColor: "#111111", backgroundColor: "transparent", isDeleted: false },
      { strokeColor: "#222222", backgroundColor: "#ffc9c9", isDeleted: false },
      { strokeColor: "#222222", backgroundColor: "#ffc9c9", isDeleted: false },
      { strokeColor: "#333333", backgroundColor: "#a5d8ff", isDeleted: true },
    ] as never
    expect(sceneColors(els, "stroke")).toEqual(["#222222", "#111111"])
    expect(sceneColors(els, "background")).toEqual(["#ffc9c9"])
  })
})

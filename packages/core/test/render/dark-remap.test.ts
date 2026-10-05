import { describe, expect, test } from "vitest"
import { parseColor, rgbToHsl } from "../../src/render/color"
import {
  TEXT_CONTRAST,
  contrastRatio,
  remapLuminance,
  storedColorFor,
  themeColor,
  unmapLuminance,
} from "../../src/render/theme"

const hsl = (color: string): { h: number; s: number; l: number } => {
  const c = parseColor(color)!
  const [h, s, l] = rgbToHsl(c.r, c.g, c.b)
  return { h, s, l }
}

const luminance = (color: string): number => {
  const c = parseColor(color)!
  const lin = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

const GRAPHITE = "#16171a"

describe("dark-mode colour remap", () => {
  test("hue and saturation survive, and a mid-tone keeps the contrast it had on white", () => {
    for (const c of ["#e03131", "#1971c2", "#2f9e44", "#6741d9", "#9c36b5", "#1864ab"]) {
      const before = hsl(c)
      const shown = themeColor(c, "dark", GRAPHITE, "fill")
      const after = hsl(shown)
      expect(Math.abs(after.h - before.h), c).toBeLessThan(3)
      expect(Math.abs(after.s - before.s), c).toBeLessThan(0.05)
      expect(contrastRatio(shown, GRAPHITE), c).toBeCloseTo(contrastRatio(c, "#ffffff"), 1)
    }
  })

  // Rows ordered dark to light in light mode, as the picker shows them. In dark mode the same
  // row must stay ordered (light to dark), or neighbouring shades swap places and the lightest
  // fills turn darker than the canvas itself.
  const rows: Record<string, string[]> = {
    redStroke: ["#c92a2a", "#e03131", "#f03e3e", "#fa5252", "#ff6b6b"],
    blueStroke: ["#1864ab", "#1971c2", "#1c7ed6", "#228be6", "#339af0"],
    orangeStroke: ["#e67700", "#f08c00", "#f59f00", "#fab005", "#fcc419"],
    redFill: ["#ff8787", "#ffa8a8", "#ffc9c9", "#ffe3e3", "#fff5f5", "#ffffff"],
    blueFill: ["#4dabf7", "#74c0fc", "#a5d8ff", "#d0ebff", "#e7f5ff", "#ffffff"],
  }
  for (const [name, row] of Object.entries(rows)) {
    test(`${name} shades stay in order after the dark remap`, () => {
      const dark = row.map((c) => luminance(themeColor(c, "dark", GRAPHITE, "fill")))
      for (let i = 1; i < dark.length; i++) expect(dark[i]!).toBeLessThanOrEqual(dark[i - 1]! + 1e-3)
    })
  }

  test("non-hex colours are remapped too (8-digit hex, rgb(), named)", () => {
    expect(themeColor("#000000cc", "dark").toLowerCase()).not.toBe("#000000cc")
    expect(themeColor("rgb(0, 0, 0)", "dark").replace(/\s/g, "")).not.toBe("rgb(0,0,0)")
    expect(themeColor("black", "dark")).not.toBe("black")
  })

  test("a mid-tone is never pushed toward the board (violet on Blueprint)", () => {
    const shown = themeColor("#6741d9", "dark", "#0f3460", "fill")
    expect(contrastRatio(shown, "#0f3460")).toBeGreaterThan(contrastRatio("#6741d9", "#0f3460"))
    expect(contrastRatio(shown, "#0f3460")).toBeGreaterThanOrEqual(6)
  })
})

describe("storedColorFor, the inverse of the dark remap", () => {
  const off = (a: string, b: string) => {
    const x = parseColor(a)!
    const y = parseColor(b)!
    return Math.max(Math.abs(x.r - y.r), Math.abs(x.g - y.g), Math.abs(x.b - y.b))
  }

  test("a stored colour shows as the swatch the theme asked for", () => {
    for (const board of ["#16171a", "#1f2a24", "#232136", "#000000", "#1f2d27", "#0f3460", "#0e1424"]) {
      for (const display of ["#f1f3ee", "#ffd43b", "#74c0fc", "#ff8787", "#e6e7ea", "#8ce99a", "#ffffff"]) {
        const stored = storedColorFor(display, "dark", board)
        // a bright display colour comes from a dark stored one, whose 8-bit hue is a little coarse
        expect(off(themeColor(stored, "dark", board), display), `${display} on ${board}`).toBeLessThanOrEqual(
          4,
        )
      }
    }
  })

  test("light mode and keywords pass through, and alpha and notation are kept", () => {
    expect(storedColorFor("#123456", "light")).toBe("#123456")
    expect(storedColorFor("transparent", "dark")).toBe("transparent")
    expect(storedColorFor("rgba(241, 243, 238, 0.5)", "dark")).toMatch(/^rgba\(.*, 0\.5\)$/)
  })

  test("unmapLuminance undoes remapLuminance on its whole range", () => {
    for (const board of [0, 0.005, 0.009, 0.033, 0.2])
      for (let l = 0; l <= 1; l += 0.01)
        expect(unmapLuminance(remapLuminance(l, board), board)).toBeCloseTo(l, 9)
  })

  test("a pastel picked on a dark board is stored as a colour that reads on white", () => {
    for (const [cap, board] of [
      ["#ffd43b", "#16171a"],
      ["#b9f18c", "#0f3460"],
      ["#f7a8b8", "#1f2d27"],
      ["#69db7c", "#0e1424"],
    ] as const) {
      const stored = storedColorFor(cap, "dark", board)
      expect(contrastRatio(stored, "#ffffff"), `${cap} on ${board}`).toBeGreaterThanOrEqual(
        contrastRatio(cap, board),
      )
      for (const light of ["#fbfbfa", "#d8c29d", "#fff4b8", "#eef6f1", "#fff5f7"])
        expect(contrastRatio(stored, light), `${cap} from ${board} on ${light}`).toBeGreaterThanOrEqual(3)
    }
  })
})

// The editor's themes and stroke palette, copied so the floor is checked against what ships.
const BOARDS: Record<string, { mode: "light" | "dark"; board: string; caps: string[] }> = {
  whiteboard: {
    mode: "light",
    board: "#FBFBFA",
    caps: ["#1E1E1E", "#1971C2", "#E03131", "#2F9E44", "#F08C00"],
  },
  blackboard: {
    mode: "dark",
    board: "#1F2D27",
    caps: ["#F1F3EE", "#F5A742", "#F7A8B8", "#9AD1F5", "#B5E48C"],
  },
  graphite: { mode: "dark", board: "#16171A", caps: ["#E6E7EA", "#74C0FC", "#FF8787", "#69DB7C", "#FFD43B"] },
  blueprint: {
    mode: "dark",
    board: "#0F3460",
    caps: ["#FFFFFF", "#8BE9FD", "#FFA94D", "#FF9AC1", "#B9F18C"],
  },
  kraft: { mode: "light", board: "#D8C29D", caps: ["#1E1E1E", "#A8123E", "#1F3A5F", "#2E5E3A", "#7C5300"] },
  legalpad: {
    mode: "light",
    board: "#FFF4B8",
    caps: ["#1F2A44", "#1E1E1E", "#7F1D1D", "#2F7D32", "#6A1B9A"],
  },
  mint: { mode: "light", board: "#EEF6F1", caps: ["#1C2B24", "#2F9E44", "#1971C2", "#E03131", "#F08C00"] },
  midnight: { mode: "dark", board: "#0E1424", caps: ["#E7EBF5", "#FF6B8B", "#7AA2FF", "#69DB7C", "#FFD43B"] },
  sakura: { mode: "light", board: "#FFF5F7", caps: ["#2E1F24", "#E64980", "#1971C2", "#2F9E44", "#F08C00"] },
  contrast: {
    mode: "light",
    board: "#FFFFFF",
    caps: ["#000000", "#003A70", "#C00000", "#006B00", "#8A4B00"],
  },
}
const STROKE_PALETTE = [
  "#1e1e1e",
  "#868e96",
  "#e03131",
  "#c2255c",
  "#9c36b5",
  "#6741d9",
  "#1971c2",
  "#0c8599",
  "#099268",
  "#2f9e44",
  "#f08c00",
  "#e8590c",
  "#846358",
]

// Whiteboard, Sakura and High Contrast are near enough to white that colours keep Excalidraw's look
const NEAR_WHITE = new Set(["whiteboard", "sakura", "contrast"])
const FLOORED = Object.entries(BOARDS).filter(([id]) => !NEAR_WHITE.has(id))

describe("strokes and text keep a display floor on tinted and dark boards", () => {
  const stored = (cap: string, from: (typeof BOARDS)[string]) =>
    from.mode === "dark" ? storedColorFor(cap, "dark", from.board) : cap

  test("every stroke palette colour reaches 3:1 on every tinted and dark board", () => {
    for (const [id, t] of FLOORED)
      for (const c of STROKE_PALETTE)
        expect(
          contrastRatio(themeColor(c, t.mode, t.board), t.board),
          `${c} on ${id}`,
        ).toBeGreaterThanOrEqual(3)
  })

  test("every theme's caps reach 3:1 on every tinted and dark board", () => {
    for (const from of Object.values(BOARDS))
      for (const cap of from.caps)
        for (const [id, t] of FLOORED) {
          const shown = themeColor(stored(cap, from), t.mode, t.board)
          expect(contrastRatio(shown, t.board), `${cap} on ${id}`).toBeGreaterThanOrEqual(3)
        }
  })

  test("text reaches 4.5:1 on every tinted and dark board", () => {
    for (const [id, t] of FLOORED)
      for (const c of [...STROKE_PALETTE, "#e67700", "#fab005"])
        expect(
          contrastRatio(themeColor(c, t.mode, t.board, "text"), t.board),
          `${c} on ${id}`,
        ).toBeGreaterThanOrEqual(TEXT_CONTRAST)
  })

  test("near-white boards draw strokes and text exactly as authored", () => {
    for (const id of NEAR_WHITE) {
      const t = BOARDS[id]!
      for (const c of ["#ffffff", "#ffc9c9", "#a5d8ff", "#f08c00", "#fab005", ...STROKE_PALETTE]) {
        expect(themeColor(c, t.mode, t.board), `${c} on ${id}`).toBe(c)
        expect(themeColor(c, t.mode, t.board, "text"), `${c} text on ${id}`).toBe(c)
      }
    }
  })

  test("on a tinted light board, ink lighter than the board is left for the dark fill it sits on", () => {
    for (const c of ["#ffffff", "#ffc9c9", "#a5d8ff"]) {
      expect(themeColor(c, "light", "#D8C29D"), c).toBe(c)
      expect(themeColor(c, "light", "#D8C29D", "text"), c).toBe(c)
    }
    // a known dark fill behind it only ever lifts it further
    expect(themeColor("#ffffff", "light", "#D8C29D", "text", "#343a40")).toBe("#ffffff")
    expect(
      contrastRatio(themeColor("#adb5bd", "light", "#D8C29D", "text", "#343a40"), "#343a40"),
    ).toBeGreaterThanOrEqual(TEXT_CONTRAST)
  })

  test("Kraft darkens the faint strokes but keeps their hue", () => {
    const shown = themeColor("#f08c00", "light", "#D8C29D")
    expect(shown).not.toBe("#f08c00")
    expect(Math.abs(hsl(shown).h - hsl("#f08c00").h)).toBeLessThan(3)
    expect(hsl(shown).l).toBeLessThan(hsl("#f08c00").l)
  })

  test("a colour that already reads on a light board is returned exactly as written", () => {
    expect(themeColor("#1971c2", "light", "#FBFBFA")).toBe("#1971c2")
    expect(themeColor("#E03131", "light", "#FFF5F7")).toBe("#E03131")
    expect(themeColor("rgba(30, 30, 30, 0.5)", "light", "#D8C29D")).toBe("rgba(30, 30, 30, 0.5)")
  })

  test("fills are never floored, on light or dark boards", () => {
    expect(themeColor("#ffec99", "light", "#D8C29D", "fill")).toBe("#ffec99")
    expect(themeColor("#ffffff", "dark", "#16171a", "fill")).toBe("#16171a")
  })

  test("text is floored against what is behind it, and null means nothing is", () => {
    expect(
      contrastRatio(themeColor("#fab005", "light", "#ffffff", "text", "#1e1e1e"), "#1e1e1e"),
    ).toBeGreaterThanOrEqual(TEXT_CONTRAST)
    expect(themeColor("#fab005", "light", "#ffffff", "text", null)).toBe("#fab005")
  })
})

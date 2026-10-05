import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { storedColorFor, themeColor } from "@nib/core"
import { describe, expect, it } from "vitest"
import {
  MATCH_SYSTEM,
  SYSTEM_THEMES,
  applyTheme,
  canvasPaletteFor,
  contrastRatio,
  deriveTokens,
  getTheme,
  matchSystemTheme,
  resolveThemeId,
  themeCssVars,
  themes,
} from "../../src/theme/themes"

const BRIEF_IDS = [
  "whiteboard",
  "blackboard",
  "graphite",
  "blueprint",
  "kraft",
  "legalpad",
  "mint",
  "midnight",
  "sakura",
  "contrast",
  "clay",
]

describe("theme registry", () => {
  it("ships the brief's ten themes plus Clay Dark, in order", () => {
    expect(themes.map((t) => t.id)).toEqual(BRIEF_IDS)
    for (const t of themes) {
      expect(t.caps).toHaveLength(5)
      for (const hex of [t.board, t.tray, t.ink, t.course, ...t.caps]) expect(hex).toMatch(/^#[0-9A-F]{6}$/i)
    }
  })

  it("getTheme falls back to the default, Clay Dark, for unknown or missing ids", () => {
    expect(getTheme("kraft").name).toBe("Kraft")
    expect(getTheme("nope").id).toBe("clay")
    expect(getTheme(null).id).toBe("clay")
  })

  it("Match system pairs Whiteboard (light) with Clay Dark (dark); no pref opens on Clay Dark", () => {
    expect(SYSTEM_THEMES).toEqual({ light: "whiteboard", dark: "clay" })
    expect(matchSystemTheme(false).id).toBe("whiteboard")
    expect(matchSystemTheme(true).id).toBe("clay")
    expect(resolveThemeId(MATCH_SYSTEM, true)).toBe("clay")
    expect(resolveThemeId(MATCH_SYSTEM, false)).toBe("whiteboard")
    expect(resolveThemeId(null, false)).toBe("clay")
    expect(resolveThemeId("garbage", false)).toBe("clay")
    expect(resolveThemeId("sakura", true)).toBe("sakura")
  })

  it("modes match the brief", () => {
    const dark = themes.filter((t) => t.mode === "dark").map((t) => t.id)
    expect(dark).toEqual(["blackboard", "graphite", "blueprint", "midnight", "clay"])
  })
})

describe("WCAG contrast for every theme", () => {
  for (const def of themes) {
    describe(def.name, () => {
      const t = deriveTokens(def)
      const ratio = (a: string, b: string) => contrastRatio(a, b)

      it("ink is at least 4.5:1 on board, tray, surface and surface-2", () => {
        for (const bg of [def.board, def.tray, t.surface, t.surface2])
          expect(ratio(def.ink, bg)).toBeGreaterThanOrEqual(4.5)
      })

      it("ink-dim is at least 4.5:1 on surface, surface-2, board and tray", () => {
        for (const bg of [t.surface, t.surface2, def.board, def.tray])
          expect(ratio(t.inkDim, bg)).toBeGreaterThanOrEqual(4.5)
        expect(ratio(t.inkDim, t.surface)).toBeLessThan(ratio(def.ink, t.surface))
      })

      it("ink-faint holds 3:1 for non-text UI and stays quieter than ink-dim", () => {
        for (const bg of [t.surface, def.board, def.tray])
          expect(ratio(t.inkFaint, bg)).toBeGreaterThanOrEqual(3)
        expect(ratio(t.inkFaint, t.surface)).toBeLessThan(ratio(t.inkDim, t.surface))
      })

      it("course ink is at least 3:1 against board, tray and surface (selection, focus ring)", () => {
        for (const bg of [def.board, def.tray, t.surface])
          expect(ratio(def.course, bg)).toBeGreaterThanOrEqual(3)
      })

      it("text on the course fill (primary button, active tool) is at least 4.5:1", () => {
        expect(ratio(t.courseInk, t.courseFill)).toBeGreaterThanOrEqual(4.5)
      })

      it("the course fill only deepens the accent when white text needs it", () => {
        if (def.whiteOnCourse) expect(t.courseInk).toBe("#FFFFFF")
        if (t.courseInk !== "#FFFFFF") expect(t.courseFill).toBe(def.course)
      })

      it("ink on course-soft (selected rows, text selection) is at least 4.5:1", () => {
        expect(ratio(def.ink, t.courseSoft)).toBeGreaterThanOrEqual(4.5)
      })

      it("danger text is at least 4.5:1 on surface and on danger-soft", () => {
        for (const bg of [t.surface, t.surface2, t.dangerSoft, def.board])
          expect(ratio(t.danger, bg)).toBeGreaterThanOrEqual(4.5)
      })

      it("tooltips and toasts (surface on ink) are at least 4.5:1", () => {
        expect(ratio(t.surface, def.ink)).toBeGreaterThanOrEqual(4.5)
      })

      it("snap and search signal is at least 3:1 on the board", () => {
        expect(ratio(t.signal, def.board)).toBeGreaterThanOrEqual(3)
      })

      it("laser is at least 3:1 on the board", () => {
        expect(ratio(canvasPaletteFor(def).laser, def.board)).toBeGreaterThanOrEqual(3)
      })
    })
  }

  it("High Contrast uses 2px seams and a 3px focus ring, and holds secondary ink to 7:1", () => {
    const t = deriveTokens(getTheme("contrast"))
    expect(t.seamWidth).toBe("2px")
    expect(t.focusWidth).toBe("3px")
    expect(contrastRatio(t.inkDim, t.surface)).toBeGreaterThanOrEqual(7)
    expect(deriveTokens(getTheme("whiteboard")).seamWidth).toBeNull()
  })

  it("records the one adjusted hex: Whiteboard course", () => {
    // the brief's #2F6BFF gives white text 4.499:1
    expect(contrastRatio("#FFFFFF", "#2F6BFF")).toBeLessThan(4.5)
    expect(getTheme("whiteboard").course).toBe("#2D68FA")
  })
})

/** CIE76 distance in Lab: about 2 is a just-noticeable step, 15 a plainly different colour. */
const deltaE = (a: string, b: string): number => {
  const lab = (hex: string) => {
    const lin = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    const [r, g, b] = lin as [number, number, number]
    const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
    const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047)
    const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722)
    const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883)
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
  }
  const [p, q] = [lab(a), lab(b)]
  return Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!)
}

describe("marker caps", () => {
  const dark = themes.filter((t) => t.mode === "dark")
  const light = themes.filter((t) => t.mode === "light")
  const stored = (cap: string, mode: "light" | "dark", board: string) =>
    mode === "dark" ? storedColorFor(cap, "dark", board) : cap
  const onDark = (cap: string, from: (typeof themes)[number], board: string) =>
    contrastRatio(themeColor(stored(cap, from.mode, from.board), "dark", board).slice(0, 7), board)

  it("no cap is its theme's course ink, which marks selection and binding", () => {
    for (const t of themes)
      for (const cap of t.caps) expect(deltaE(cap, t.course), `${t.id} ${cap}`).toBeGreaterThanOrEqual(15)
  })

  it("Kraft's caps hold 3:1 on Kraft and stay visible on every other board", () => {
    const kraft = getTheme("kraft")
    for (const cap of kraft.caps) {
      expect(contrastRatio(cap, kraft.board), cap).toBeGreaterThanOrEqual(3)
      for (const t of light)
        expect(contrastRatio(cap, t.board), `${cap} on ${t.id}`).toBeGreaterThanOrEqual(3)
      for (const t of dark) expect(onDark(cap, kraft, t.board), `${cap} on ${t.id}`).toBeGreaterThanOrEqual(3)
    }
  })

  it("no cap of any theme vanishes when the drawing moves to a dark board", () => {
    for (const from of themes)
      for (const cap of from.caps)
        for (const t of dark)
          expect(onDark(cap, from, t.board), `${from.id} ${cap} on ${t.id}`).toBeGreaterThanOrEqual(1.8)
  })

  it("names five caps per theme, each name once", () => {
    for (const t of themes) {
      expect(t.capNames, t.id).toHaveLength(5)
      expect(new Set(t.capNames).size, t.id).toBe(5)
      for (const name of t.capNames) expect(name).toMatch(/^[A-Z][a-z]+( [a-z]+)?$/)
    }
  })
})

describe("ledge seams", () => {
  for (const def of themes) {
    it(`${def.name}: a highlight above and a shadow below that read as a ledge`, () => {
      const t = deriveTokens(def)
      if (def.highContrast) {
        expect(t.seamHi).toBe(def.ink)
        expect(t.seamLo).toBe(def.ink)
        return
      }
      const lighter = (c: string) => contrastRatio(c, "#000000") > contrastRatio(def.tray, "#000000")
      expect(lighter(t.seamHi)).toBe(true)
      expect(lighter(t.seamLo)).toBe(false)
      if (def.mode === "light") {
        expect(t.seamHi).toBe("#FFFFFF")
        expect(contrastRatio(t.seamLo, def.tray)).toBeGreaterThanOrEqual(1.75)
      } else {
        expect(contrastRatio(t.seamHi, def.tray)).toBeGreaterThanOrEqual(1.4)
        expect(contrastRatio(t.seamLo, def.tray)).toBeGreaterThanOrEqual(1.2)
      }
    })
  }
})

describe("canvas palette", () => {
  const KEYS = [
    "board",
    "selection",
    "selectionFill",
    "binding",
    "snapGuide",
    "frameBorder",
    "frameLabel",
    "gridMinor",
    "gridMajor",
    "correctionFlash",
    "searchHighlight",
    "laser",
  ]

  it("has exactly the pinned CanvasPalette keys and derives from ink and course", () => {
    for (const def of themes) {
      const p = canvasPaletteFor(def)
      expect(Object.keys(p).sort()).toEqual([...KEYS].sort())
      expect(p.board).toBe(def.board)
      expect(p.selection).toBe(def.course)
      expect(p.correctionFlash).toBe(def.course)
      expect(p.snapGuide).not.toBe(def.course)
    }
  })

  it("matches the recorded palettes", () => {
    expect(Object.fromEntries(themes.map((t) => [t.id, canvasPaletteFor(t)]))).toMatchSnapshot()
  })
})

describe("CSS variables", () => {
  it("tokens.css defaults equal the derived Whiteboard values", () => {
    const css = readFileSync(fileURLToPath(new URL("../../src/theme/tokens.css", import.meta.url)), "utf8")
    const root = /:root\s*\{([^}]*)\}/.exec(css)![1]!
    const declared = Object.fromEntries(
      [...root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k!, v!.trim().toLowerCase()]),
    )
    const vars = themeCssVars(getTheme("whiteboard"))
    for (const [name, value] of Object.entries(vars)) expect(declared[name], name).toBe(value.toLowerCase())
  })

  it("applyTheme sets variables, colour scheme and data attributes, and clears the HC seam override", () => {
    const props = new Map<string, string>()
    const root = {
      dataset: {} as Record<string, string>,
      style: {
        colorScheme: "",
        setProperty: (k: string, v: string) => props.set(k, v),
        removeProperty: (k: string) => {
          props.delete(k)
          return ""
        },
      },
    }
    applyTheme(root as unknown as HTMLElement, getTheme("contrast"))
    expect(props.get("--seam-w")).toBe("2px")
    expect(props.get("--focus-w")).toBe("3px")
    expect(root.dataset.nibTheme).toBe("contrast")

    applyTheme(root as unknown as HTMLElement, getTheme("midnight"))
    expect(props.has("--seam-w")).toBe(false)
    expect(props.get("--board")).toBe("#0E1424")
    expect(props.get("--course")).toBe("#FF7A59")
    expect(props.get("--cap-2")).toBe("#FF6B8B")
    expect(root.style.colorScheme).toBe("dark")
    expect(root.dataset.nibMode).toBe("dark")
  })
})

import { EditorCore, type NibElement, newElement, storedColorFor, themeColor } from "@nib/core"
import { describe, expect, it } from "vitest"
import { getTheme, themes } from "../../src/theme/themes"
import {
  DRAWER_COLUMNS,
  DRAWER_ITEMS,
  PENCIL_PREF_KEY,
  TRAY_GROUPS,
  TRAY_TOOLS,
  VIEW_MODE_MARKERS,
  applyStroke,
  ariaKeys,
  armFreehand,
  armPen,
  armPencil,
  capIndexFor,
  capNames,
  capStroke,
  capStrokePatch,
  colorName,
  correctionTool,
  gridMove,
  liftLabel,
  markerHeld,
  markerKey,
  markerName,
  normalizeHex,
  penHoldsPencil,
  pickImage,
  preferredFreehandTool,
  readPencilDefault,
  selectionStroke,
  snapshotKey,
  themeForCaps,
  trayFit,
  trayGroups,
  traySnapshot,
  writePencilDefault,
} from "../../src/ui/tray/trayModel"

const memoryPrefs = () => {
  const m = new Map<string, string>()
  return {
    get: (k: string) => m.get(k) ?? null,
    set: (k: string, v: string | null) => (v === null ? m.delete(k) : m.set(k, v)),
  }
}

const withElements = (els: NibElement[], select = true): EditorCore => {
  const core = new EditorCore()
  for (const el of els) core.scene.insert({ ...el, index: core.scene.nextIndex() })
  if (select) core.selectElements(els.map((e) => e.id))
  return core
}

describe("tray order (brief: Layout, the marker tray)", () => {
  it("groups Select and Hand, then the ten drawing markers, pen before pencil", () => {
    expect(TRAY_GROUPS.map((g) => g.map((m) => m.tool))).toEqual([
      ["selection", "hand"],
      [
        "rectangle",
        "diamond",
        "parallelogram",
        "ellipse",
        "arrow",
        "line",
        "freedraw",
        "pencil",
        "text",
        "eraser",
      ],
    ])
  })

  it("puts the brief's Image, Frame, Embed, Laser, Lasso, Mermaid and the lock in the More drawer", () => {
    expect(DRAWER_ITEMS.map((i) => i.id)).toEqual([
      "image",
      "frame",
      "embeddable",
      "laser",
      "lasso",
      "mermaid",
      "lock",
    ])
  })

  it("lays the seven drawer cells out 4 + 3, with arrow keys that stay on the grid", () => {
    expect(DRAWER_COLUMNS).toBe(4)
    const n = DRAWER_ITEMS.length
    expect(gridMove(1, "ArrowDown", DRAWER_COLUMNS, n)).toBe(5)
    expect(gridMove(3, "ArrowDown", DRAWER_COLUMNS, n)).toBe(3)
    expect(gridMove(6, "ArrowUp", DRAWER_COLUMNS, n)).toBe(2)
    expect(gridMove(6, "ArrowRight", DRAWER_COLUMNS, n)).toBe(6)
    expect(gridMove(4, "End", DRAWER_COLUMNS, n)).toBe(6)
  })

  it("puts the pencil before the pen where the tray scrolls", () => {
    const tools = (narrow: boolean) => trayGroups(narrow)[1]!.map((m) => m.tool)
    expect(tools(false).indexOf("freedraw")).toBeLessThan(tools(false).indexOf("pencil"))
    expect(tools(true).indexOf("pencil")).toBeLessThan(tools(true).indexOf("freedraw"))
    expect([...tools(true)].sort()).toEqual([...tools(false)].sort())
  })

  it("never shows a tool twice", () => {
    const drawerTools = DRAWER_ITEMS.flatMap((i) => (i.kind === "tool" ? [i.def.tool] : []))
    const all = [...TRAY_TOOLS, ...drawerTools]
    expect(new Set(all).size).toBe(all.length)
  })

  it("keeps only view-mode tools in view mode, with the laser for presenters", () => {
    expect(VIEW_MODE_MARKERS.map((m) => m.tool)).toEqual(["selection", "hand", "laser"])
  })
})

describe("shortcut labels come from core SHORTCUTS", () => {
  const byTool = new Map(
    [...TRAY_GROUPS.flat(), ...DRAWER_ITEMS.flatMap((i) => (i.kind === "tool" ? [i.def] : []))].map((m) => [
      m.tool,
      m,
    ]),
  )
  const m = (tool: string) => byTool.get(tool as never)!

  it("P is the pencil and 7 the pen", () => {
    expect(markerKey(m("pencil"))).toBe("P")
    expect(markerKey(m("freedraw"))).toBe("7")
    expect(markerName(m("freedraw"))).toBe("Pen")
  })

  it("lifts with a 'Name · Key' label", () => {
    expect(liftLabel(m("rectangle"))).toBe("Rectangle · R")
    expect(liftLabel(m("parallelogram"))).toBe("Parallelogram · G")
    expect(liftLabel(m("selection"))).toBe("Select · V")
    expect(liftLabel(m("eraser"))).toBe("Eraser · E")
    expect(liftLabel(m("image"))).toBe("Image · 9")
    expect(liftLabel(m("lasso"))).toBe("Lasso · Q")
  })

  it("announces every key that arms a tool", () => {
    expect(ariaKeys(m("selection"))).toBe("V 1")
    expect(ariaKeys(m("rectangle"))).toBe("R 2")
    expect(ariaKeys(m("pencil"))).toBe("P")
    // Embed has its own key now that core has a tool.embed row
    expect(ariaKeys(m("embeddable"))).toBe("W")
  })

  it("names Embed and the lock in words", () => {
    expect(markerName(m("embeddable"))).toBe("Embed")
    const lock = DRAWER_ITEMS.find((i) => i.kind === "lock")!
    expect(lock.kind === "lock" && lock.label).toBe("Keep tool active")
  })
})

describe("gridMove (More drawer and colour grid roving focus)", () => {
  it("moves within a 4-wide grid of 8 without wrapping", () => {
    expect(gridMove(0, "ArrowRight", 4, 8)).toBe(1)
    expect(gridMove(3, "ArrowRight", 4, 8)).toBe(4)
    expect(gridMove(7, "ArrowRight", 4, 8)).toBe(7)
    expect(gridMove(0, "ArrowLeft", 4, 8)).toBe(0)
    expect(gridMove(1, "ArrowDown", 4, 8)).toBe(5)
    expect(gridMove(5, "ArrowDown", 4, 8)).toBe(5)
    expect(gridMove(6, "ArrowUp", 4, 8)).toBe(2)
    expect(gridMove(2, "ArrowUp", 4, 8)).toBe(2)
    expect(gridMove(5, "Home", 4, 8)).toBe(0)
    expect(gridMove(1, "End", 4, 8)).toBe(7)
  })

  it("stays put on a short last row and ignores other keys", () => {
    expect(gridMove(2, "ArrowDown", 5, 6)).toBe(2)
    expect(gridMove(0, "ArrowDown", 5, 6)).toBe(5)
    expect(gridMove(3, "a", 5, 6)).toBe(3)
    expect(gridMove(0, "ArrowRight", 5, 0)).toBe(-1)
  })
})

describe("colour caps (brief: item 4 of the tray)", () => {
  const whiteboard = getTheme("whiteboard")
  const graphite = getTheme("graphite")

  it("finds the theme, and so the board, from its caps", () => {
    for (const t of themes) expect(themeForCaps(t.caps)?.id).toBe(t.id)
    expect(themeForCaps(["#123456"])).toBeUndefined()
  })

  it("stores light caps as they are and dark caps as their light originals", () => {
    expect(capStrokePatch("#1971C2", "light")).toEqual({ strokeColor: "#1971c2" })
    const stored = capStroke(graphite.caps[1], "dark", graphite.board)
    expect(stored).toBe(storedColorFor(graphite.caps[1], "dark", graphite.board).toLowerCase())
    expect(stored).not.toBe(graphite.caps[1].toLowerCase())
  })

  it("rings the cap that shows as the current stroke, in light and dark themes", () => {
    expect(capIndexFor("#e03131", whiteboard.caps, "light")).toBe(2)
    expect(capIndexFor("#1e1e1e", whiteboard.caps, "light")).toBe(0)
    expect(capIndexFor("#123456", whiteboard.caps, "light")).toBe(-1)
    expect(capIndexFor(null, whiteboard.caps, "light")).toBe(-1)
    graphite.caps.forEach((cap, i) => {
      const stored = capStroke(cap, "dark", graphite.board)
      expect(capIndexFor(stored, graphite.caps, "dark", graphite.board)).toBe(i)
    })
  })

  it("rings the ink cap for core's default black in every theme", () => {
    for (const t of themes) {
      const i = capIndexFor("#1e1e1e", t.caps, t.mode, t.board)
      expect(i, t.id).toBe(t.id === "legalpad" ? 1 : 0)
    }
  })

  it("matches a stored colour whose dark display is the cap", () => {
    for (const t of themes.filter((x) => x.mode === "dark")) {
      t.caps.forEach((cap, i) => {
        const stored = capStroke(cap, "dark", t.board)
        expect(themeColor(stored, "dark", t.board)).toBeTruthy()
        expect(capIndexFor(stored.toUpperCase(), t.caps, "dark", t.board)).toBe(i)
      })
    }
  })

  it("applies a cap to the selection as one undo step", () => {
    const a = newElement("rectangle", { x: 0, y: 0, width: 50, height: 50, strokeColor: "#1e1e1e" })
    const b = newElement("ellipse", { x: 80, y: 0, width: 50, height: 50, strokeColor: "#2f9e44" })
    const core = withElements([a, b])
    applyStroke(core, capStrokePatch(whiteboard.caps[1], "light").strokeColor)
    expect(core.scene.get(a.id)?.strokeColor).toBe("#1971c2")
    expect(core.scene.get(b.id)?.strokeColor).toBe("#1971c2")
    expect(core.appState.currentItemStrokeColor).toBe("#1971c2")
    core.undo()
    expect(core.scene.get(a.id)?.strokeColor).toBe("#1e1e1e")
    expect(core.scene.get(b.id)?.strokeColor).toBe("#2f9e44")
    expect(core.history.canUndo()).toBe(false)
  })

  it("sets the next element's stroke when nothing is selected, without an undo step", () => {
    const core = new EditorCore()
    applyStroke(core, "#e03131")
    expect(core.appState.currentItemStrokeColor).toBe("#e03131")
    expect(core.history.canUndo()).toBe(false)
  })
})

describe("selection stroke snapshot", () => {
  it("reports the default with no selection, the shared colour, or null when mixed", () => {
    const a = newElement("rectangle", { x: 0, y: 0, width: 50, height: 50, strokeColor: "#E03131" })
    const b = newElement("rectangle", { x: 80, y: 0, width: 50, height: 50, strokeColor: "#e03131" })
    const c = newElement("rectangle", { x: 160, y: 0, width: 50, height: 50, strokeColor: "#1971c2" })
    expect(selectionStroke(withElements([a], false))).toEqual({ stroke: "#1e1e1e", hasSelection: false })
    expect(selectionStroke(withElements([a, b]))).toEqual({ stroke: "#e03131", hasSelection: true })
    expect(selectionStroke(withElements([a, c]))).toEqual({ stroke: null, hasSelection: true })
  })

  it("keys the snapshot on what the tray shows", () => {
    const core = new EditorCore()
    const before = snapshotKey(traySnapshot(core))
    core.setTool("pencil")
    const after = traySnapshot(core)
    expect(after.tool).toBe("pencil")
    expect(snapshotKey(after)).not.toBe(before)
  })
})

describe("hex input", () => {
  it("accepts 3 or 6 digits with or without #, lowercased", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc")
    expect(normalizeHex("1971C2")).toBe("#1971c2")
    expect(normalizeHex(" #1e1e1e ")).toBe("#1e1e1e")
  })

  it("rejects partial and malformed values, so #123 is never committed on the way to #123456", () => {
    expect(normalizeHex("#12")).toBeNull()
    expect(normalizeHex("#1234")).toBeNull()
    expect(normalizeHex("#12345g")).toBeNull()
    expect(normalizeHex("")).toBeNull()
  })
})

describe("colour names for swatch labels", () => {
  it("names the Whiteboard caps", () => {
    expect(getTheme("whiteboard").caps.map(colorName)).toEqual(["Black", "Blue", "Red", "Green", "Orange"])
  })

  it("names every cap of every theme in words", () => {
    for (const t of themes)
      for (const cap of t.caps) expect(colorName(cap)).toMatch(/^[A-Z][a-z]+( [a-z]+)?$/)
  })

  it("calls faint tints of white and black what they look like", () => {
    expect(colorName("#F1F3EE")).toBe("White")
    expect(colorName("#E7EBF5")).toBe("White")
    expect(colorName("#E6E7EA")).toBe("White")
    expect(colorName("#1C2B24")).toBe("Black")
    expect(colorName("#2E1F24")).toBe("Black")
    expect(colorName("#B5E48C")).toBe("Light green")
  })

  it("takes cap names from the theme, so no two caps of a theme share one", () => {
    for (const t of themes) {
      const names = capNames(t.caps, t)
      expect(names, t.id).toEqual([...t.capNames])
      expect(new Set(names).size, t.id).toBe(names.length)
    }
    expect(capNames(["#ffffff", "#123456"])).toEqual(["White", colorName("#123456")])
    expect(capNames(["#1e1e1e", "#abcdef"], getTheme("whiteboard"))).toEqual(["Black", colorName("#abcdef")])
  })

  it("handles light, dark, grey and transparent", () => {
    expect(colorName("#FFFFFF")).toBe("White")
    expect(colorName("#74C0FC")).toBe("Light blue")
    expect(colorName("#1F3A5F")).toBe("Dark blue")
    expect(colorName("#868e96")).toBe("Grey")
    expect(colorName("#8A4B00")).toBe("Brown")
    expect(colorName("transparent")).toBe("Transparent")
  })
})

describe("pencil default and Correct shapes", () => {
  it("remembers the switch in prefs nib.pencilDefault", () => {
    const prefs = memoryPrefs()
    expect(readPencilDefault(prefs)).toBe(false)
    expect(preferredFreehandTool(prefs)).toBe("freedraw")
    writePencilDefault(prefs, true)
    expect(prefs.get(PENCIL_PREF_KEY)).toBe("true")
    expect(preferredFreehandTool(prefs)).toBe("pencil")
    writePencilDefault(prefs, false)
    expect(readPencilDefault(prefs)).toBe(false)
  })

  it("leads the switch to the pencil when on and the pen when off", () => {
    expect(correctionTool(true)).toBe("pencil")
    expect(correctionTool(false)).toBe("freedraw")
  })

  it("arms the remembered choice from the Pen marker and 7, and the Pen stays the held marker", () => {
    const prefs = memoryPrefs()
    const core = new EditorCore()
    armPen(core, prefs)
    expect(core.appState.activeTool).toBe("freedraw")
    expect(penHoldsPencil(core)).toBe(false)
    writePencilDefault(prefs, true)
    core.setTool("selection")
    armPen(core, prefs)
    expect(core.appState.activeTool).toBe("pencil")
    expect(penHoldsPencil(core)).toBe(true)
    const snap = traySnapshot(core)
    const pen = TRAY_GROUPS[1]!.find((m) => m.tool === "freedraw")!
    const pencil = TRAY_GROUPS[1]!.find((m) => m.tool === "pencil")!
    expect(markerHeld(pen, snap)).toBe(true)
    expect(markerHeld(pencil, snap)).toBe(false)
  })

  it("hands the hold to the Pencil marker for P, and drops it on any other tool", () => {
    const prefs = memoryPrefs()
    writePencilDefault(prefs, true)
    const core = new EditorCore()
    armPen(core, prefs)
    const before = snapshotKey(traySnapshot(core))
    armPencil(core)
    expect(core.appState.activeTool).toBe("pencil")
    expect(penHoldsPencil(core)).toBe(false)
    expect(snapshotKey(traySnapshot(core))).not.toBe(before)
    armPen(core, prefs)
    core.setTool("rectangle")
    core.setTool("pencil")
    expect(penHoldsPencil(core)).toBe(false)
  })

  it("keeps the Pen held when its switch turns correction off and on again", () => {
    const core = new EditorCore()
    armFreehand(core, "pencil", true)
    expect(penHoldsPencil(core)).toBe(true)
    armFreehand(core, "freedraw", true)
    expect(core.appState.activeTool).toBe("freedraw")
    expect(penHoldsPencil(core)).toBe(false)
    const pen = TRAY_GROUPS[1]!.find((m) => m.tool === "freedraw")!
    expect(markerHeld(pen, traySnapshot(core))).toBe(true)
  })

  it("leaves view mode's tools alone", () => {
    const prefs = memoryPrefs()
    writePencilDefault(prefs, true)
    const core = new EditorCore()
    core.toggleViewMode()
    armPen(core, prefs)
    expect(core.appState.activeTool).toBe("selection")
    expect(penHoldsPencil(core)).toBe(false)
  })

  it("survives a prefs store that throws", () => {
    const broken = {
      get: () => {
        throw new Error("blocked")
      },
      set: () => {
        throw new Error("full")
      },
    }
    expect(readPencilDefault(broken)).toBe(false)
    expect(() => writePencilDefault(broken, true)).not.toThrow()
  })
})

describe("image marker", () => {
  it("arms the tool and lets core open the picker at once", () => {
    const core = new EditorCore()
    const asked: unknown[] = []
    core.host = { onRequestImage: (at) => asked.push(at) }
    let fallback = 0
    pickImage(core, () => fallback++)
    expect(core.appState.activeTool).toBe("image")
    expect(asked).toHaveLength(1)
    expect(fallback).toBe(0)
    core.cancelImageInsert()
    expect(core.appState.activeTool).toBe("selection")
  })

  it("uses the tray's own picker when the host installed none", () => {
    const core = new EditorCore()
    let fallback = 0
    pickImage(core, () => fallback++)
    expect(fallback).toBe(1)
  })
})

describe("tray fit (the layout is measured, the caps collapse last)", () => {
  // the shipped tray: 600px with the caps collapsed, five 40px caps, a 290px ledge end and 49px of help
  const at = (viewport: number, extra: Partial<Parameters<typeof trayFit>[0]> = {}) =>
    trayFit({
      content: 800,
      collapsed: false,
      capCell: 40,
      capCount: 5,
      narrow: false,
      viewport,
      ledge: 290,
      corner: 49,
      gap: 12,
      ...extra,
    })

  it("keeps the true centre line in a wide window", () => {
    expect(at(1440)).toEqual({ layout: "centre", collapse: false, scroll: false })
  })

  it("falls back to sitting beside the ledge end at 1410px, where centring would hide the caps", () => {
    expect(at(1410)).toEqual({ layout: "side", collapse: false, scroll: false })
  })

  it("stacks under the ledge end at 1180px and 1024px instead of collapsing the caps", () => {
    expect(at(1180)).toEqual({ layout: "stacked", collapse: false, scroll: false })
    expect(at(1024)).toEqual({ layout: "stacked", collapse: false, scroll: false })
    expect(at(1197).layout).toBe("side")
  })

  it("decides the same from a measurement taken with the caps collapsed", () => {
    expect(at(1024, { content: 600, collapsed: true })).toEqual(at(1024))
    expect(at(1410, { content: 600, collapsed: true })).toEqual(at(1410))
  })

  it("collapses the caps only when even the full width is too narrow, then scrolls last", () => {
    expect(at(800)).toEqual({ layout: "stacked", collapse: true, scroll: false })
    expect(at(600)).toEqual({ layout: "stacked", collapse: true, scroll: true })
  })

  it("always collapses below the narrow breakpoint, and scrolls a phone-width tray", () => {
    expect(at(2000, { narrow: true })).toEqual({ layout: "stacked", collapse: true, scroll: false })
    expect(at(390, { narrow: true, content: 600, collapsed: true })).toEqual({
      layout: "stacked",
      collapse: true,
      scroll: true,
    })
  })
})

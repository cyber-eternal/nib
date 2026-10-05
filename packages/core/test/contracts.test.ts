import { beforeAll, describe, expect, test } from "vitest"
import {
  type AppState,
  type CanvasPalette,
  DEFAULT_APP_STATE,
  EditorCore,
  FONT_STACKS,
  type InteractiveSceneInput,
  type Point,
  type Recognized,
  SHORTCUTS,
  SHORTCUT_TOOLS,
  type StaticSceneInput,
  type ToolType,
  canvasBackground,
  defaultCanvasPalette,
  exportToSvg,
  isSafeLink,
  matchShortcut,
  newElement,
  normalizeLink,
  parseNib,
  recognizeStroke,
  serializeNib,
} from "../src/index"
import { click, setupMeasurer } from "./editor/helpers"

// The pinned cross-agent contracts, checked through the public index so the UI phase can rely on them.

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
const typeIs = <T extends true>(): T => true as T

beforeAll(setupMeasurer)

describe("safe links", () => {
  test("isSafeLink and normalizeLink are exported from core", () => {
    typeIs<Equal<typeof isSafeLink, (url: string) => boolean>>()
    typeIs<Equal<typeof normalizeLink, (url: string) => string | null>>()
    expect(isSafeLink("https://example.com")).toBe(true)
    expect(isSafeLink("javascript:alert(1)")).toBe(false)
    expect(normalizeLink("example.com")).toBe("https://example.com")
  })
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
  ] as const

  test("CanvasPalette has exactly the pinned keys, and defaults exist for both modes", () => {
    typeIs<Equal<keyof CanvasPalette, (typeof KEYS)[number]>>()
    for (const mode of ["light", "dark"] as const) {
      const p = defaultCanvasPalette(mode)
      expect(Object.keys(p).sort()).toEqual([...KEYS].sort())
      for (const k of KEYS) expect(typeof p[k]).toBe("string")
    }
  })

  test("the default document background paints as the palette's board", () => {
    const custom: CanvasPalette = { ...defaultCanvasPalette("dark"), board: "#1f2a24" }
    expect(canvasBackground("#ffffff", "dark", custom)).toBe("#1f2a24")
    expect(canvasBackground("#ffffff", "light")).toBe(defaultCanvasPalette("light").board)
  })

  test("both scene inputs take a palette; the interactive one also takes the flash and search matches", () => {
    typeIs<Equal<StaticSceneInput["palette"], CanvasPalette | undefined>>()
    typeIs<Equal<InteractiveSceneInput["palette"], CanvasPalette | undefined>>()
    typeIs<Equal<InteractiveSceneInput["correctionFlash"], { elementId: string; t: number } | undefined>>()
    const matches: string[] = ["a"]
    const input: Pick<InteractiveSceneInput, "searchMatches"> = { searchMatches: matches }
    expect(input.searchMatches).toEqual(["a"])
  })
})

describe("pencil", () => {
  test("recognizeStroke takes absolute points and a zoom", () => {
    typeIs<
      Equal<
        typeof recognizeStroke,
        (points: readonly Point[], opts: { zoom: number; shift?: boolean }) => Recognized | null
      >
    >()
    typeIs<
      Equal<
        Recognized["kind"],
        "ellipse" | "rectangle" | "diamond" | "triangle" | "parallelogram" | "polygon" | "line" | "arrow"
      >
    >()
    const circle: Point[] = Array.from({ length: 80 }, (_, i) => {
      const t = (i / 79) * Math.PI * 2
      return [500 + 100 * Math.cos(t), 300 + 100 * Math.sin(t)]
    })
    expect(recognizeStroke(circle, { zoom: 1 })?.kind).toBe("ellipse")
    expect(recognizeStroke([[0, 0]], { zoom: 1 })).toBeNull()
  })

  test("the pencil tool, replaceStrokeWithShape and lastCorrection", () => {
    const pencil: ToolType = "pencil"
    const ed = new EditorCore()
    ed.setTool(pencil)
    expect(ed.appState.activeTool).toBe("pencil")
    const stroke = newElement("freedraw", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      points: [
        [0, 0],
        [100, 100],
      ],
      pressures: [0.5, 0.5],
    })
    ed.addElements([stroke])
    const id = ed.replaceStrokeWithShape(stroke.id, {
      kind: "triangle",
      vertices: [
        [50, 0],
        [100, 100],
        [0, 100],
      ],
      score: 0.1,
    })
    const tri = ed.scene.get(id!)!
    expect(tri.type).toBe("line")
    expect(tri.type === "line" && tri.polygon).toBe(true)
    expect(tri.type === "line" && tri.points.length).toBe(4)
    expect(tri.type === "line" && tri.points[0]).toEqual(tri.type === "line" && tri.points[3])
    expect(ed.lastCorrection?.elementId).toBe(id)
    expect(ed.scene.get(stroke.id)!.isDeleted).toBe(true)
    ed.undo()
    expect(ed.scene.get(stroke.id)!.isDeleted).toBe(false)
    expect(ed.lastCorrection).toBeNull()
  })
})

describe("one shortcut table", () => {
  test("the pinned tool keys", () => {
    const keysOf = (id: string) => SHORTCUTS.find((s) => s.id === id)?.keys
    const pinned: Record<string, [string, readonly string[]]> = {
      "tool.selection": ["selection", ["V", "1"]],
      "tool.hand": ["hand", ["H"]],
      "tool.rectangle": ["rectangle", ["R", "2"]],
      "tool.diamond": ["diamond", ["D", "3"]],
      "tool.ellipse": ["ellipse", ["O", "4"]],
      "tool.arrow": ["arrow", ["A", "5"]],
      "tool.line": ["line", ["L", "6"]],
      "tool.pen": ["freedraw", ["7"]],
      "tool.pencil": ["pencil", ["P"]],
      "tool.text": ["text", ["T", "8"]],
      "tool.image": ["image", ["9"]],
      "tool.eraser": ["eraser", ["E", "0"]],
      "tool.frame": ["frame", ["F"]],
      "tool.laser": ["laser", ["K"]],
      "tool.lasso": ["lasso", ["Q"]],
    }
    for (const [id, [tool, keys]] of Object.entries(pinned)) {
      expect(keysOf(id), id).toEqual(keys)
      expect(SHORTCUT_TOOLS[id], id).toBe(tool)
    }
    for (const s of SHORTCUTS) {
      expect(typeof s.label).toBe("string")
      expect(["tools", "edit", "arrange", "view", "file", "help"]).toContain(s.group)
    }
  })

  test("chords match on the physical key, so Option chords work on macOS", () => {
    const k = (
      key: string,
      code: string,
      mods: Partial<Record<"metaKey" | "altKey" | "shiftKey", boolean>>,
    ) => ({
      key,
      code,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      ctrlKey: false,
      ...mods,
    })
    expect(matchShortcut(k("d", "KeyD", { metaKey: true }))).toBe("edit.duplicate")
    expect(matchShortcut(k("†", "KeyT", { altKey: true }))).toBe("arrange.tidy")
    expect(matchShortcut(k("H", "KeyH", { shiftKey: true }))).toBe("arrange.flipH")
    expect(matchShortcut(k("V", "KeyV", { shiftKey: true }))).toBe("arrange.flipV")
    expect(matchShortcut(k("р", "KeyP", {}))).toBe("tool.pencil")
  })
})

describe("documents don't carry the UI theme", () => {
  test("theme is neither written nor read", () => {
    const text = serializeNib([], { ...DEFAULT_APP_STATE, theme: "dark" } as AppState, {})
    expect(JSON.parse(text).appState.theme).toBeUndefined()
    const parsed = parseNib(
      JSON.stringify({ type: "nib", version: 1, elements: [], appState: { theme: "dark" } }),
    )
    expect(parsed.ok && "theme" in parsed.appState).toBe(false)
  })
})

describe("fonts", () => {
  test("the bundled faces lead the stacks", () => {
    expect(FONT_STACKS.hand).toBe('"Shantell Sans", "Comic Sans MS", cursive')
    expect(FONT_STACKS.normal).toBe('"Nunito", "Helvetica Neue", Arial, sans-serif')
    expect(FONT_STACKS.code).toBe('"Cascadia Code", "SF Mono", Menlo, monospace')
    expect(FONT_STACKS.serif).toBeTruthy()
    expect(FONT_STACKS.mono).toBeTruthy()
  })

  test("exportToSvg writes embedFontCss into a style in defs", () => {
    const svg = exportToSvg({
      elements: [newElement("text", { x: 0, y: 0, width: 40, height: 25, text: "Hi", originalText: "Hi" })],
      appState: DEFAULT_APP_STATE,
      exportBackground: false,
      exportPadding: 10,
      scale: 1,
      theme: "light",
      embedFontCss: '@font-face { font-family: "Shantell Sans"; src: url(data:font/woff2;base64,AA==) }',
    })
    expect(svg).toMatch(/<defs>[\s\S]*<style[^>]*>[\s\S]*@font-face[\s\S]*<\/style>[\s\S]*<\/defs>/)
  })
})

describe("EditorCore APIs the UI calls", () => {
  test("staticVersion bumps for what the static layer draws, not for selection", () => {
    const ed = new EditorCore()
    const bumps = (f: () => void) => {
      const before = ed.staticVersion
      f()
      return ed.staticVersion > before
    }
    const rect = newElement("rectangle", { x: 0, y: 0, width: 50, height: 50 })
    expect(bumps(() => ed.addElements([rect]))).toBe(true)
    expect(bumps(() => ed.setAppState({ viewport: { zoom: 2, scrollX: 0, scrollY: 0 } }))).toBe(true)
    expect(bumps(() => ed.setAppState({ theme: "dark" }))).toBe(true)
    expect(bumps(() => ed.setAppState({ gridSize: 20 }))).toBe(true)
    expect(bumps(() => ed.setAppState({ editingTextId: "x" }))).toBe(true)
    expect(bumps(() => ed.setAppState({ selectedElementIds: { [rect.id]: true } }))).toBe(false)
  })

  test("unlockElement, insertScene and previewText", () => {
    const ed = new EditorCore()
    const locked = newElement("rectangle", { x: 0, y: 0, width: 50, height: 50, locked: true })
    ed.loadScene([locked])
    ed.unlockElement(locked.id)
    expect(ed.scene.get(locked.id)!.locked).toBe(false)
    ed.undo()
    expect(ed.scene.get(locked.id)!.locked).toBe(true)

    const foreign = newElement("rectangle", { id: locked.id, x: 0, y: 0, width: 20, height: 20, index: "a0" })
    const inserted = ed.insertScene([foreign], {}, [500, 500])
    expect(inserted).toHaveLength(1)
    expect(inserted[0]!.id).not.toBe(locked.id)
    expect(inserted[0]!.index > ed.scene.get(locked.id)!.index).toBe(true)
    expect(inserted[0]!.x + inserted[0]!.width / 2).toBeCloseTo(500)
    ed.undo()
    expect(ed.scene.getNonDeleted()).toHaveLength(1)

    ed.setTool("text")
    click(ed, 0, 200)
    const editing = ed.appState.editingTextId!
    ed.previewText("draft")
    const draft = ed.scene.get(editing)
    expect(draft?.type === "text" && draft.text).toBe("draft")
  })
})

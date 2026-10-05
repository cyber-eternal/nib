import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { parseClipboard, serializeClipboard } from "../src/io/clipboard"
import { parseExcalidraw, parseLibrary, parseScene, toExcalidraw } from "../src/io/excalidraw"
import { exportToSvg, extractSceneFromSvg } from "../src/io/exportSvg"
import { NIB_FILE_TYPE, NIB_FILE_VERSION, parseNib, serializeNib } from "../src/io/nibFile"
import { newElement } from "../src/model/element"
import { DEFAULT_APP_STATE } from "../src/model/types"

const sample = () => [
  newElement("rectangle", { x: 10, y: 20, width: 100, height: 50, index: "a0" }),
  newElement("ellipse", { x: 200, y: 20, width: 80, height: 80, index: "a1" }),
  newElement("arrow", {
    x: 120,
    y: 45,
    index: "a2",
    points: [
      [0, 0],
      [70, 0],
    ],
  }),
]

describe("nib file", () => {
  test("round-trips elements and persisted state", () => {
    const elements = sample()
    const text = serializeNib(elements, { ...DEFAULT_APP_STATE, gridSize: 20 })
    const parsed = parseNib(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.elements).toHaveLength(3)
    expect(parsed.elements[0]!.x).toBe(10)
    expect(parsed.appState.gridSize).toBe(20)
  })

  test("drops deleted elements on save", () => {
    const elements = [
      ...sample(),
      newElement("rectangle", { x: 0, y: 0, width: 1, height: 1, isDeleted: true }),
    ]
    const parsed = parseNib(serializeNib(elements, DEFAULT_APP_STATE))
    expect(parsed.ok && parsed.elements.length).toBe(3)
  })

  test("transient selection state never reaches the file", () => {
    const text = serializeNib(sample(), {
      ...DEFAULT_APP_STATE,
      selectedElementIds: { abc: true },
      editingTextId: "abc",
    })
    expect(text).not.toContain("selectedElementIds")
    expect(text).not.toContain("editingTextId")
  })

  test("rejects unreadable input with a message", () => {
    expect(parseNib("not json")).toEqual({ ok: false, error: expect.stringContaining("JSON") })
    const wrong = parseNib(JSON.stringify({ type: "sketch", elements: [] }))
    expect(wrong.ok).toBe(false)
  })

  test("fills in fields an older or foreign file omits", () => {
    const parsed = parseNib(
      JSON.stringify({
        type: "nib",
        version: 1,
        elements: [{ id: "x", type: "rectangle", x: 0, y: 0, width: 10, height: 10 }],
      }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const el = parsed.elements[0]!
    expect(el.strokeColor).toBe("#1e1e1e")
    expect(el.opacity).toBe(100)
    expect(typeof el.index).toBe("string")
    expect(el.isDeleted).toBe(false)
  })

  test("duplicate z-indices in a foreign file are repaired on parse", () => {
    const parsed = parseNib(
      JSON.stringify({
        type: "nib",
        version: 1,
        elements: [
          { id: "a", type: "rectangle", x: 0, y: 0, width: 1, height: 1, index: "a0" },
          { id: "b", type: "rectangle", x: 0, y: 0, width: 1, height: 1, index: "a0" },
        ],
      }),
    )
    expect(parsed.ok).toBe(true)
  })
})

describe("the Nib format", () => {
  test("a drawing is written with type nib and the same version", () => {
    const written = JSON.parse(serializeNib(sample(), DEFAULT_APP_STATE))
    expect(NIB_FILE_TYPE).toBe("nib")
    expect(written.type).toBe("nib")
    expect(written.version).toBe(NIB_FILE_VERSION)
    expect(written.source).toBe("nib")
    expect(Object.keys(written)).toEqual(["type", "version", "source", "elements", "appState", "files"])
  })

  test("only nib and excalidraw are drawing types", () => {
    for (const type of ["nibd", "Nib", "NIB", "nib/clipboard", "other"]) {
      expect(parseNib(JSON.stringify({ type, version: 1, elements: [] })).ok).toBe(false)
    }
  })

  test("the example drawing is a Nib drawing", () => {
    const path = fileURLToPath(new URL("../../../examples/demo.nibd", import.meta.url))
    const text = readFileSync(path, "utf8")
    expect(JSON.parse(text).type).toBe("nib")
    const parsed = parseScene(text)
    expect(parsed.ok && parsed.format).toBe("nib")
    expect(parsed.ok && parsed.elements.length).toBeGreaterThan(0)
  })

  test("copies are nib/clipboard; clipboard JSON and whole documents both paste", () => {
    const copied = JSON.parse(serializeClipboard(sample(), {}))
    expect(copied.type).toBe("nib/clipboard")
    for (const type of ["nib/clipboard", "nib"]) {
      const pasted = parseClipboard(JSON.stringify({ type, elements: sample(), files: {} }))
      expect(pasted?.elements).toHaveLength(3)
      expect(pasted?.type).toBe("nib/clipboard")
    }
  })

  test("an SVG is marked nib-scene and gives its scene back", () => {
    const scene = serializeNib(sample(), DEFAULT_APP_STATE)
    const svg = exportToSvg({
      elements: sample(),
      appState: DEFAULT_APP_STATE,
      files: {},
      exportBackground: true,
      exportPadding: 10,
      scale: 1,
      theme: "light",
      embedScene: scene,
    })
    expect(svg).toContain("<!-- nib-scene:")
    expect(extractSceneFromSvg(svg)).toBe(scene)
    expect(extractSceneFromSvg(svg.replace("<!-- nib-scene:", "<!-- other-scene:"))).toBeNull()
  })
})

describe("excalidraw interop", () => {
  test("reads an excalidraw file", () => {
    const file = JSON.stringify({
      type: "excalidraw",
      version: 2,
      elements: [
        {
          id: "abc",
          type: "text",
          x: 5,
          y: 5,
          width: 50,
          height: 25,
          text: "hi",
          fontFamily: 1,
          fontSize: 20,
        },
      ],
      appState: { viewBackgroundColor: "#ffffff", gridSize: null },
    })
    const parsed = parseExcalidraw(file)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const text = parsed.elements[0]!
    expect(text.type).toBe("text")
    expect((text as { fontFamily: string }).fontFamily).toBe("hand")
  })

  test("writes a file excalidraw can read back", () => {
    const out = toExcalidraw(sample(), DEFAULT_APP_STATE)
    const back = parseExcalidraw(out)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.elements).toHaveLength(3)
    expect(back.elements.map((e) => e.type).sort()).toEqual(["arrow", "ellipse", "rectangle"])
  })

  test("reads a library file in both shapes", () => {
    const nested = parseLibrary(
      JSON.stringify({ type: "excalidrawlib", libraryItems: [{ id: "1", elements: [] }] }),
    )
    expect(nested).toHaveLength(1)
    const flat = parseLibrary(JSON.stringify({ library: [[]] }))
    expect(flat).toHaveLength(1)
    expect(parseLibrary("nonsense")).toEqual([])
  })
})

describe("clipboard payloads", () => {
  test("round-trips", () => {
    const payload = serializeClipboard(sample(), {})
    const parsed = parseClipboard(payload)
    expect(parsed?.elements).toHaveLength(3)
  })
  test("ignores unrelated clipboard text", () => {
    expect(parseClipboard("just some text")).toBeNull()
    expect(parseClipboard(JSON.stringify({ type: "other", elements: [] }))).toBeNull()
  })
})

describe("svg export", () => {
  const opts = {
    appState: DEFAULT_APP_STATE,
    exportBackground: true,
    exportPadding: 10,
    scale: 1,
    theme: "light" as const,
  }

  test("emits a sized svg containing the shapes", () => {
    const svg = exportToSvg({ ...opts, elements: sample() })
    expect(svg.startsWith("<svg")).toBe(true)
    expect(svg).toContain("viewBox")
    expect((svg.match(/<path/g) ?? []).length).toBeGreaterThan(2)
  })

  test("embeds and recovers the scene", () => {
    const scene = serializeNib(sample(), DEFAULT_APP_STATE)
    const svg = exportToSvg({ ...opts, elements: sample(), embedScene: scene })
    const recovered = extractSceneFromSvg(svg)
    expect(recovered).toBe(scene)
  })

  test("a hostile colour cannot break out of an attribute", () => {
    const evil = newElement("rectangle", {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      strokeColor: '"><script>alert(1)</script>',
    })
    const svg = exportToSvg({ ...opts, elements: [evil] })
    expect(svg).not.toContain("<script")
  })

  test("an image with a non-data source is dropped", () => {
    const img = newElement("image", { x: 0, y: 0, width: 10, height: 10, fileId: "f1" })
    const svg = exportToSvg({
      ...opts,
      elements: [img],
      files: {
        f1: { id: "f1", mimeType: "image/png", dataURL: "javascript:alert(1)", created: 0 },
      },
    })
    expect(svg).not.toContain("javascript:")
  })

  test("handles an empty scene", () => {
    const svg = exportToSvg({ ...opts, elements: [] })
    expect(svg).toContain("<svg")
  })
})

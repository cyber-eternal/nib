import { describe, expect, test } from "vitest"
import { EditorCore } from "../../src/editor/editorCore"
import { parseExcalidraw } from "../../src/io/excalidraw"
import { exportToSvg } from "../../src/io/exportSvg"
import { parseNib } from "../../src/io/nibFile"
import { DEFAULT_APP_STATE } from "../../src/model/types"

const svgOpts = {
  appState: DEFAULT_APP_STATE,
  exportBackground: true,
  exportPadding: 10,
  scale: 1,
  theme: "light" as const,
}

const nib = (elements: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "nib", version: 1, elements, ...extra })

const mustParse = (text: string) => {
  const parsed = parseNib(text)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed
}

describe("IO hostile and foreign input", () => {
  test("excalidraw iframe and magicframe elements are mapped to a renderable type", () => {
    const parsed = parseExcalidraw(
      JSON.stringify({
        type: "excalidraw",
        version: 2,
        elements: [
          { id: "m", type: "magicframe", x: 0, y: 0, width: 100, height: 80, name: "AI" },
          { id: "i", type: "iframe", x: 200, y: 0, width: 100, height: 80, link: "https://example.com" },
        ],
      }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const known = [
      "rectangle",
      "diamond",
      "ellipse",
      "text",
      "line",
      "arrow",
      "freedraw",
      "image",
      "frame",
      "embeddable",
    ]
    for (const el of parsed.elements) expect(known).toContain(el.type)
    expect(() => exportToSvg({ ...svgOpts, elements: parsed.elements })).not.toThrow()
  })

  test("non-numeric geometry from a file is coerced to finite numbers on parse", () => {
    const parsed = mustParse(
      nib([
        {
          id: "a",
          type: "rectangle",
          x: '0 0)"/><script>alert(1)</script><g a="',
          y: null,
          width: "10",
          height: {},
        },
        {
          id: "t",
          type: "text",
          x: 0,
          y: 0,
          width: '"/><script>alert(2)</script>',
          height: 10,
          text: "hi",
          textAlign: "right",
        },
      ]),
    )
    for (const el of parsed.elements) {
      for (const key of ["x", "y", "width", "height"] as const) {
        expect(typeof el[key]).toBe("number")
        expect(Number.isFinite(el[key])).toBe(true)
      }
    }
    expect(exportToSvg({ ...svgOpts, elements: parsed.elements })).not.toContain("<script")
  })

  test("an invalid fractional index does not make parsing throw", () => {
    const text = nib([
      { id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10, index: "foo" },
      { id: "b", type: "rectangle", x: 0, y: 0, width: 10, height: 10 },
    ])
    expect(() => parseNib(text)).not.toThrow()
  })

  test("after opening a file with an invalid index the user can still draw", () => {
    const parsed = mustParse(
      nib([{ id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10, index: "b" }]),
    )
    const core = new EditorCore()
    core.loadScene(parsed.elements, parsed.appState, parsed.files)
    expect(() => core.scene.nextIndex()).not.toThrow()
  })

  test("a null entry in boundElements does not crash duplicate", () => {
    const parsed = mustParse(
      nib([
        {
          id: "a",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          boundElements: [null, 5, { id: 1 }],
        },
      ]),
    )
    const core = new EditorCore()
    core.loadScene(parsed.elements, parsed.appState, parsed.files)
    core.selectAll()
    expect(() => core.duplicateSelected()).not.toThrow()
  })

  test("a file entry with a non-string dataURL does not crash SVG export", () => {
    const parsed = mustParse(
      nib([{ id: "i", type: "image", x: 0, y: 0, width: 10, height: 10, fileId: "f" }], {
        files: { f: { id: "f", mimeType: "image/png", dataURL: 5 } },
      }),
    )
    expect(() => exportToSvg({ ...svgOpts, elements: parsed.elements, files: parsed.files })).not.toThrow()
  })

  test("file entries whose dataURL is not an inline image are dropped on parse", () => {
    const parsed = mustParse(
      nib([], {
        files: {
          remote: {
            id: "remote",
            mimeType: "image/png",
            dataURL: "https://tracker.example/p.png",
            created: 0,
          },
          ok: { id: "ok", mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", created: 0 },
        },
      }),
    )
    expect(Object.keys(parsed.files)).toEqual(["ok"])
  })

  test("malformed appState from a file is sanitised before it reaches the editor", () => {
    const parsed = mustParse(
      nib([{ id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10 }], {
        appState: {
          viewBackgroundColor: 5,
          theme: "neon",
          gridSize: "abc",
          viewport: { scrollX: "x", scrollY: 0, zoom: -5 },
        },
      }),
    )
    const core = new EditorCore()
    core.loadScene(parsed.elements, parsed.appState, parsed.files)
    expect(["light", "dark"]).toContain(core.appState.theme)
    expect(typeof core.appState.viewBackgroundColor).toBe("string")
    expect(core.appState.gridSize === null || typeof core.appState.gridSize === "number").toBe(true)
    const vp = core.appState.viewport
    expect(Number.isFinite(vp.scrollX) && Number.isFinite(vp.scrollY)).toBe(true)
    expect(vp.zoom).toBeGreaterThan(0)
    expect(() =>
      exportToSvg({ ...svgOpts, appState: core.appState, elements: parsed.elements }),
    ).not.toThrow()
  })

  test("opening a file does not override the user's current theme", () => {
    const parsed = mustParse(nib([], { appState: { theme: "dark" } }))
    const core = new EditorCore()
    expect(core.appState.theme).toBe("light")
    core.loadScene(parsed.elements, parsed.appState, parsed.files)
    expect(core.appState.theme).toBe("light")
  })

  test("a link from a file with a non-web scheme is dropped on parse", () => {
    const parsed = mustParse(
      nib([
        { id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10, link: "javascript:alert(1)" },
        {
          id: "b",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          link: "file:///Applications/Calculator.app",
        },
        { id: "c", type: "rectangle", x: 0, y: 0, width: 10, height: 10, link: "https://example.com/x" },
      ]),
    )
    expect(parsed.elements.map((e) => e.link)).toEqual([null, null, "https://example.com/x"])
  })
})

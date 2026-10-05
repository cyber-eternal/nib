import { describe, expect, test } from "vitest"
import { getElementBounds } from "../../src/geometry/elementBounds"
import { elementOutline } from "../../src/geometry/outline"
import { parseClipboard } from "../../src/io/clipboard"
import {
  createLibraryItem,
  parseExcalidraw,
  parseLibrary,
  serializeLibrary,
  toExcalidraw,
} from "../../src/io/excalidraw"
import { isSafeLink, normalizeLink } from "../../src/io/links"
import { parseNib, serializeNib } from "../../src/io/nibFile"
import { boundsFromPoints } from "../../src/math/bounds"
import { newElement } from "../../src/model/element"
import type { ArrowElement, FreedrawElement, ImageElement, TextElement } from "../../src/model/types"
import { DEFAULT_APP_STATE } from "../../src/model/types"

const nib = (elements: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "nib", version: 1, elements, ...extra })
const excalidraw = (elements: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "excalidraw", version: 2, elements, ...extra })

const must = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error((r as unknown as { error: string }).error)
  return r as Extract<T, { ok: true }>
}
const rect = (extra: Record<string, unknown> = {}) => ({
  id: "r",
  type: "rectangle",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  ...extra,
})

describe("IO links", () => {
  test("only web, mail and element links are safe", () => {
    expect(isSafeLink("https://example.com/x")).toBe(true)
    expect(isSafeLink("HTTP://example.com")).toBe(true)
    expect(isSafeLink("mailto:a@b.c")).toBe(true)
    expect(isSafeLink("#element=abc_123")).toBe(true)
    for (const bad of [
      "javascript:alert(1)",
      " JavaScript:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,<b>x</b>",
      "file:///etc/passwd",
      "vscode://open",
      "https://",
      "example.com",
      "",
    ])
      expect(isSafeLink(bad)).toBe(false)
  })

  test("a typed link gets a scheme, an unsafe one is refused", () => {
    expect(normalizeLink("example.com/a")).toBe("https://example.com/a")
    expect(normalizeLink("  https://x.org ")).toBe("https://x.org")
    expect(normalizeLink("javascript:alert(1)")).toBeNull()
    expect(normalizeLink("   ")).toBeNull()
  })

  test("element links survive saving and loading in their #element= form", () => {
    expect(isSafeLink("#element=abc_123")).toBe(true)
    expect(normalizeLink(" #element=abc_123 ")).toBe("#element=abc_123")
    for (const bad of [
      "#element=",
      "#element=a b",
      "#element=<x>",
      `#element=${"a".repeat(129)}`,
      "#other=a",
    ])
      expect(isSafeLink(bad)).toBe(false)
    const loaded = must(parseNib(nib([rect({ link: "#element=target" })])))
    expect(loaded.elements[0]!.link).toBe("#element=target")
  })

  test("links pasted from the clipboard are sanitised too", () => {
    const pasted = parseClipboard(
      JSON.stringify({ type: "excalidraw/clipboard", elements: [rect({ link: "javascript:alert(1)" })] }),
    )
    expect(pasted?.elements[0]!.link).toBeNull()
  })
})

describe("IO element normalisation", () => {
  test("points, pressures, image scale and crop are validated numerically", () => {
    const parsed = must(
      parseNib(
        nib([
          {
            id: "l",
            type: "line",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            points: [[0, 0], ["1", 2], [3, "4"], "x"],
          },
          {
            id: "f",
            type: "freedraw",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            points: [[0, 0]],
            pressures: [2, "a", -1],
          },
          {
            id: "i",
            type: "image",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            scale: [-3, "1"],
            crop: { x: 0, y: 0, width: "9", height: 1, naturalWidth: 1, naturalHeight: 1 },
          },
        ]),
      ),
    )
    const [line, free, image] = parsed.elements as [ArrowElement, FreedrawElement, ImageElement]
    expect(line.points.flat().every((v) => Number.isFinite(v))).toBe(true)
    expect(free.points).toHaveLength(1)
    expect(free.pressures).toEqual([1, 0.5, 0])
    expect(image.scale).toEqual([-1, 1])
    expect(image.crop).toBeNull()
  })

  test("colours that could break out of an attribute fall back to defaults", () => {
    const parsed = must(
      parseNib(nib([rect({ strokeColor: '"/><script>', backgroundColor: "rgba(0, 0, 0, 0.5)" })])),
    )
    expect(parsed.elements[0]!.strokeColor).toBe("#1e1e1e")
    expect(parsed.elements[0]!.backgroundColor).toBe("rgba(0, 0, 0, 0.5)")
  })

  test("groupIds keep only strings and boundElements only well-formed refs", () => {
    const parsed = must(
      parseNib(
        nib([
          rect({
            groupIds: ["g", 5, null],
            boundElements: [null, { id: "a", type: "arrow", extra: 1 }, { id: "t", type: "image" }],
          }),
        ]),
      ),
    )
    expect(parsed.elements[0]!.groupIds).toEqual(["g"])
    expect(parsed.elements[0]!.boundElements).toEqual([{ id: "a", type: "arrow" }])
  })

  test("an unexpected failure while reading becomes an error result, not a throw", () => {
    const hostile = `{"type":"nib","elements":[{"id":"a","type":"rectangle","x":0,"y":0,"width":1,"height":1,"index":"${"z".repeat(5000)}"}]}`
    expect(() => parseNib(hostile)).not.toThrow()
    expect(() => parseExcalidraw(hostile)).not.toThrow()
  })

  test("seed 0 and fractional seeds become a stable non-zero hash of the id", () => {
    const a = must(parseNib(nib([rect({ id: "abc", seed: 0 })]))).elements[0]!
    const b = must(parseNib(nib([rect({ id: "abc", seed: 1.5 })]))).elements[0]!
    expect(a.seed).not.toBe(0)
    expect(Number.isInteger(a.seed)).toBe(true)
    expect(b.seed).toBe(a.seed)
    expect(must(parseNib(nib([rect({ seed: 42 })]))).elements[0]!.seed).toBe(42)
  })

  test("a rotated Excalidraw arrow has its rotation baked into the points", () => {
    const parsed = must(
      parseExcalidraw(
        excalidraw([
          {
            id: "a",
            type: "arrow",
            x: 100,
            y: 100,
            width: 100,
            height: 0,
            angle: Math.PI / 2,
            points: [
              [0, 0],
              [100, 0],
            ],
          },
        ]),
      ),
    )
    const arrow = parsed.elements[0] as ArrowElement
    expect(arrow.angle).toBe(0)
    // a horizontal segment from (100,100) to (200,100) turned 90° about (150,100) is vertical at x=150
    const abs = arrow.points.map((p) => [arrow.x + p[0], arrow.y + p[1]])
    expect(abs[0]![0]).toBeCloseTo(150)
    expect(abs[0]![1]).toBeCloseTo(50)
    expect(abs[1]![0]).toBeCloseTo(150)
    expect(abs[1]![1]).toBeCloseTo(150)
    expect(getElementBounds(arrow)).toEqual(boundsFromPoints(elementOutline(arrow)))
  })

  test("a Nib file's own linear elements keep their exact coordinates", () => {
    const arrow = newElement("arrow", {
      x: 0.1,
      y: 0.2,
      width: 0.2,
      height: 0,
      index: "a0",
      points: [
        [0, 0],
        [0.2, 0],
      ],
    })
    const back = must(parseNib(serializeNib([arrow], DEFAULT_APP_STATE))).elements[0] as ArrowElement
    expect([back.x, back.y, back.width, back.height]).toEqual([0.1, 0.2, 0.2, 0])
    expect(back.points).toEqual(arrow.points)
  })

  test("roundness follows Excalidraw's types, including the legacy strokeSharpness flag", () => {
    const parsed = must(
      parseExcalidraw(
        excalidraw([
          rect({ id: "legacy", roundness: { type: 1 } }),
          rect({ id: "adaptive", roundness: { type: 3, value: 12 } }),
          rect({ id: "old-rect", strokeSharpness: "round" }),
          { ...rect({ id: "old-diamond", strokeSharpness: "round" }), type: "diamond" },
          rect({ id: "sharp", strokeSharpness: "sharp" }),
        ]),
      ),
    )
    expect(parsed.elements.map((e) => e.roundness)).toEqual([
      { type: 2 },
      { type: 3, value: 12 },
      { type: 3 },
      { type: 2 },
      null,
    ])
    expect("strokeSharpness" in parsed.elements[2]!).toBe(false)
  })
})

describe("IO appState and files", () => {
  test("the file's tool defaults and theme are neither read nor written", () => {
    const parsed = must(
      parseNib(
        nib([], {
          appState: {
            theme: "dark",
            currentItemStrokeColor: "#e03131",
            currentItemFontFamily: "code",
            gridSize: 20,
          },
        }),
      ),
    )
    expect(parsed.appState).not.toHaveProperty("theme")
    expect(parsed.appState).not.toHaveProperty("currentItemStrokeColor")
    expect(parsed.appState.gridSize).toBe(20)
    const written = JSON.parse(
      serializeNib([], { ...DEFAULT_APP_STATE, theme: "dark", currentItemStrokeColor: "#e03131" }),
    )
    expect(written.appState).not.toHaveProperty("theme")
    expect(written.appState).not.toHaveProperty("currentItemStrokeColor")
  })

  test("Excalidraw 0.18's always-present gridSize stays off when grid mode is off", () => {
    const off = must(parseExcalidraw(excalidraw([], { appState: { gridSize: 20, gridModeEnabled: false } })))
    expect(off.appState.gridSize).toBeNull()
    const on = must(parseExcalidraw(excalidraw([], { appState: { gridSize: 20, gridModeEnabled: true } })))
    expect(on.appState.gridSize).toBe(20)
  })

  test("clipboard and library payloads drop non-inline image files", () => {
    const files = {
      remote: { id: "remote", mimeType: "image/png", dataURL: "https://tracker.example/p.png", created: 0 },
      ok: { id: "ok", mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", created: 0 },
      evil: { id: "evil", mimeType: "image/png", dataURL: 'data:image/png;base64,AA" onload="x', created: 0 },
    }
    const pasted = parseClipboard(JSON.stringify({ type: "nib/clipboard", elements: [], files }))
    expect(Object.keys(pasted!.files)).toEqual(["ok"])
  })
})

describe("IO Excalidraw export", () => {
  test("iframe and magicframe elements are exported with their original type", () => {
    const parsed = must(
      parseExcalidraw(
        excalidraw([
          { id: "m", type: "magicframe", x: 0, y: 0, width: 100, height: 80, name: "AI" },
          { id: "i", type: "iframe", x: 200, y: 0, width: 100, height: 80, customData: { keep: 1 } },
          { id: "x", type: "selection", x: 0, y: 0, width: 1, height: 1 },
        ]),
      ),
    )
    expect(parsed.elements.map((e) => e.type)).toEqual(["frame", "embeddable"])
    const out = JSON.parse(toExcalidraw(parsed.elements, DEFAULT_APP_STATE)).elements
    expect(out.map((e: { type: string }) => e.type)).toEqual(["magicframe", "iframe"])
    expect(out[0].customData).toBeUndefined()
    expect(out[1].customData).toEqual({ keep: 1 })
  })

  test("closed lines keep their polygon flag", () => {
    const line = newElement("line", {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      index: "a0",
      polygon: true,
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 0],
      ],
    })
    expect(JSON.parse(toExcalidraw([line], DEFAULT_APP_STATE)).elements[0].polygon).toBe(true)
  })

  const pencilTriangle = () =>
    newElement("line", {
      id: "tri",
      x: 0,
      y: 0,
      width: 300,
      height: 240,
      index: "a0",
      polygon: true,
      points: [
        [150, 0],
        [300, 240],
        [0, 240],
        [150, 0],
      ],
    })

  test("a pencil triangle survives an Excalidraw round trip as a closed 4-point line", () => {
    const back = must(parseExcalidraw(toExcalidraw([pencilTriangle()], DEFAULT_APP_STATE))).elements[0]!
    expect(back.type).toBe("line")
    expect((back as unknown as { polygon: boolean }).polygon).toBe(true)
    expect((back as unknown as { points: unknown }).points).toEqual(pencilTriangle().points)
    expect([back.x, back.y, back.width, back.height]).toEqual([0, 0, 300, 240])
  })

  test("Excalidraw gets free arrows and free text instead of a closed line's bindings and label", () => {
    const tri = {
      ...pencilTriangle(),
      boundElements: [
        { id: "arr", type: "arrow" as const },
        { id: "lbl", type: "text" as const },
      ],
    }
    const label = newElement("text", {
      id: "lbl",
      x: 130,
      y: 150,
      text: "Tri",
      containerId: "tri",
      index: "a1",
    })
    const other = newElement("rectangle", { id: "box", x: 500, y: 0, width: 50, height: 50, index: "a2" })
    const arrow = newElement("arrow", {
      id: "arr",
      x: -200,
      y: 160,
      index: "a3",
      points: [
        [0, 0],
        [240, 0],
      ],
      startBinding: { elementId: "box", focus: 0, gap: 4 },
      endBinding: { elementId: "tri", focus: 0, gap: 4 },
    })
    const out = JSON.parse(toExcalidraw([tri, label, other, arrow], DEFAULT_APP_STATE)).elements
    const byId = Object.fromEntries(out.map((e: { id: string }) => [e.id, e]))
    expect(byId.tri.boundElements).toBeNull()
    expect(byId.lbl.containerId).toBeNull()
    expect([byId.lbl.x, byId.lbl.y]).toEqual([130, 150])
    expect(byId.arr.endBinding).toBeNull()
    expect(byId.arr.startBinding.elementId).toBe("box")
    // the Nib document itself keeps them
    const kept = must(parseNib(serializeNib([tri, label, other, arrow], DEFAULT_APP_STATE, {})))
    expect((kept.elements.find((e) => e.id === "lbl") as TextElement).containerId).toBe("tri")
  })

  test("font codes follow Excalidraw's current FONT_FAMILY table and round-trip exactly", () => {
    const text = (id: string, fontFamily: number) => ({
      id,
      type: "text",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      text: id,
      fontFamily,
    })
    const parsed = must(
      parseExcalidraw(
        excalidraw([
          text("virgil", 1),
          text("cascadia", 3),
          text("comic", 8),
          text("liberation", 9),
          text("lilita", 7),
        ]),
      ),
    )
    expect(parsed.elements.map((e) => (e as TextElement).fontFamily)).toEqual([
      "hand",
      "code",
      "code",
      "normal",
      "normal",
    ])
    const out = JSON.parse(toExcalidraw(parsed.elements, DEFAULT_APP_STATE)).elements
    expect(out.map((e: { fontFamily: number }) => e.fontFamily)).toEqual([1, 3, 8, 9, 7])
    expect(out[0].customData).toBeUndefined()

    const fresh = (family: TextElement["fontFamily"]) =>
      newElement("text", { x: 0, y: 0, width: 1, height: 1, index: "a0", text: "x", fontFamily: family })
    const codes = JSON.parse(
      toExcalidraw([fresh("hand"), fresh("normal"), fresh("code"), fresh("mono")], DEFAULT_APP_STATE),
    ).elements.map((e: { fontFamily: number }) => e.fontFamily)
    expect(codes).toEqual([5, 6, 3, 3])
  })
})

describe("IO libraries", () => {
  test("a library item carries the image files its elements use", () => {
    const img = newElement("image", { x: 0, y: 0, width: 10, height: 10, index: "a0", fileId: "f1" })
    const files = {
      f1: { id: "f1", mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", created: 0 },
      other: { id: "other", mimeType: "image/png", dataURL: "data:image/png;base64,BBBB", created: 0 },
    }
    const item = createLibraryItem([img], files, "Logo")
    expect(Object.keys(item.files!)).toEqual(["f1"])
    const [back] = parseLibrary(serializeLibrary([item]))
    expect(back!.name).toBe("Logo")
    expect(back!.elements).toHaveLength(1)
    expect(Object.keys(back!.files!)).toEqual(["f1"])
  })
})

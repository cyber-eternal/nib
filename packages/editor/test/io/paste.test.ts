import {
  type ArrowElement,
  DEFAULT_APP_STATE,
  EditorCore,
  type ImageElement,
  type NibElement,
  type TextElement,
  exportToSvg,
  newElement,
  serializeClipboard,
  serializeNib,
  setTextMeasurer,
} from "@nib/core"
import type { ClipboardPayload } from "@nib/platform"
import { beforeAll, describe, expect, test, vi } from "vitest"
import { copySelection, copyStyle, pasteAt, pasteContent, pasteStyle } from "../../src/document/clipboard"
import type { DecodedImage, ImageDecoder } from "../../src/document/imageImport"
import { createFakePlatform } from "../fakePlatform"

beforeAll(() => setTextMeasurer((t) => t.length * 10))

const decoder: ImageDecoder = async () =>
  ({
    width: 64,
    height: 32,
    encode: async () => null,
    hasAlpha: () => false,
    close() {},
  }) satisfies DecodedImage

const live = (core: EditorCore) => core.scene.getNonDeleted()
const labelOf = (core: EditorCore, el: NibElement) =>
  (live(core).find((e) => e.type === "text" && e.containerId === el.id) as TextElement | undefined)
    ?.originalText

describe("smart paste", () => {
  test("a plain URL becomes linked text, centred where it was pasted", async () => {
    const core = new EditorCore()
    const result = await pasteContent(core, createFakePlatform(), [500, 300], {
      text: "https://example.com/doc",
    })
    expect(result.kind).toBe("link")
    const [text] = live(core) as TextElement[]
    expect([text!.type, text!.text, text!.link]).toEqual([
      "text",
      "https://example.com/doc",
      "https://example.com/doc",
    ])
    expect(text!.x + text!.width / 2).toBeCloseTo(500)
    expect(core.appState.selectedElementIds[text!.id]).toBe(true)
  })

  test("a YouTube link becomes an embeddable, and one undo removes it", async () => {
    const core = new EditorCore()
    const result = await pasteContent(core, createFakePlatform(), [0, 0], {
      text: "https://youtu.be/dQw4w9WgXcQ",
    })
    expect(result.kind).toBe("embed")
    const [embed] = live(core)
    expect([embed!.type, embed!.link]).toEqual(["embeddable", "https://youtu.be/dQw4w9WgXcQ"])
    core.undo()
    expect(live(core)).toHaveLength(0)
  })

  test("SVG markup is inserted as an SVG image", async () => {
    const core = new EditorCore()
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><circle r="4"/></svg>'
    const result = await pasteContent(
      core,
      createFakePlatform(),
      [0, 0],
      { text: svg },
      { decodeImage: decoder },
    )
    expect(result).toMatchObject({ kind: "image", errors: [] })
    const image = live(core)[0] as ImageElement
    expect(core.scene.files[image.fileId!]!.mimeType).toBe("image/svg+xml")
    expect(image.width / image.height).toBeCloseTo(2)
  })

  test("SVG markup that carries a Nib scene pastes as editable elements", async () => {
    const core = new EditorCore()
    const elements = [newElement("ellipse", { x: 0, y: 0, width: 30, height: 30, index: "a0" })]
    const svg = exportToSvg({
      elements,
      appState: DEFAULT_APP_STATE,
      exportBackground: false,
      exportPadding: 0,
      scale: 1,
      theme: "light",
      embedScene: serializeNib(elements, DEFAULT_APP_STATE),
    })
    expect((await pasteContent(core, createFakePlatform(), [0, 0], { text: svg })).kind).toBe("elements")
    expect(live(core).map((e) => e.type)).toEqual(["ellipse"])
  })

  test("Mermaid text becomes a diagram in one undoable step", async () => {
    const core = new EditorCore()
    const result = await pasteContent(core, createFakePlatform(), [0, 0], {
      text: "flowchart LR\n A[Start] --> B[End]",
    })
    expect(result.kind).toBe("mermaid")
    expect(live(core).filter((e) => e.type === "rectangle")).toHaveLength(2)
    expect(live(core).filter((e) => e.type === "arrow")).toHaveLength(1)
    core.undo()
    expect(live(core)).toHaveLength(0)
  })

  test("the UI can take Mermaid text instead, to open its dialog prefilled", async () => {
    const core = new EditorCore()
    const onMermaid = vi.fn(() => true)
    const result = await pasteContent(
      core,
      createFakePlatform(),
      [0, 0],
      { text: "graph TD\n A --> B" },
      { onMermaid },
    )
    expect(result.kind).toBe("mermaid")
    expect(onMermaid).toHaveBeenCalledWith("graph TD\n A --> B")
    expect(live(core)).toHaveLength(0)
  })

  test("a spreadsheet range becomes one group of cells with their text", async () => {
    const core = new EditorCore()
    const result = await pasteContent(core, createFakePlatform(), [0, 0], {
      text: "Item\tCost\nTea\t3.50\nCake\t4",
    })
    expect(result.kind).toBe("table")
    const cells = live(core).filter((e) => e.type === "rectangle")
    expect(cells).toHaveLength(6)
    expect(new Set(cells.map((c) => c.groupIds[0])).size).toBe(1)
    expect(cells.map((c) => labelOf(core, c))).toEqual(["Item", "Cost", "Tea", "3.50", "Cake", "4"])
    const cost = live(core).find(
      (e) => e.type === "text" && (e as TextElement).text === "3.50",
    ) as TextElement
    expect(cost.textAlign).toBe("right")
    // columns line up: every cell in a column has the same x and width
    expect(cells[0]!.x).toBe(cells[2]!.x)
    expect(cells[1]!.width).toBe(cells[3]!.width)
  })

  test("Excalidraw clipboard JSON pastes as elements", async () => {
    const core = new EditorCore()
    const text = JSON.stringify({
      type: "excalidraw/clipboard",
      elements: [{ id: "x", type: "diamond", x: 0, y: 0, width: 20, height: 20, index: "a0" }],
      files: {},
    })
    expect((await pasteContent(core, createFakePlatform(), [0, 0], { text })).kind).toBe("elements")
    expect(live(core).map((e) => e.type)).toEqual(["diamond"])
  })

  test("other text still opens as a new text element", async () => {
    const core = new EditorCore()
    expect(await pasteAt(core, createFakePlatform(), [0, 0], { text: "just words" })).toBe(true)
    expect(core.appState.editingTextId).not.toBeNull()
  })
})

describe("images on the clipboard", () => {
  test("a Nib copy wins over the picture of it that rides along", async () => {
    const core = new EditorCore()
    const text = serializeClipboard([newElement("rectangle", { width: 10, height: 10, index: "a0" })], {})
    const png = new File([new Uint8Array(8)], "image.png", { type: "image/png" })
    const result = await pasteContent(
      core,
      createFakePlatform(),
      [0, 0],
      { text, files: [png] },
      { decodeImage: decoder },
    )
    expect(result.kind).toBe("elements")
    expect(live(core).map((e) => e.type)).toEqual(["rectangle"])
  })

  test("pasted image files are inserted, but a spreadsheet's picture of its cells is not", async () => {
    const core = new EditorCore()
    const png = new File([new Uint8Array(8)], "image.png", { type: "image/png" })
    const shot = await pasteContent(
      core,
      createFakePlatform(),
      [0, 0],
      { text: "", files: [png] },
      { decodeImage: decoder },
    )
    expect(shot.kind).toBe("image")
    const cells = await pasteContent(core, createFakePlatform(), [0, 0], { text: "a\t1\nb\t2", files: [png] })
    expect(cells.kind).toBe("table")
  })

  test("menu paste on desktop reads an image when the clipboard has no Nib copy", async () => {
    const core = new EditorCore()
    const platform = createFakePlatform()
    platform.clipboard.readText = async () => {
      throw new Error("The clipboard contents were not available in the requested format")
    }
    platform.clipboard.readImage = async () => new Uint8Array([137, 80, 78, 71])
    const result = await pasteContent(core, platform, [0, 0], undefined, { decodeImage: decoder })
    expect(result.kind).toBe("image")
    expect(live(core)[0]!.type).toBe("image")
  })

  test("an empty paste event in the desktop app falls back to the native image clipboard", async () => {
    const core = new EditorCore()
    const platform = createFakePlatform({ name: "tauri" })
    platform.clipboard.readImage = async () => new Uint8Array([1, 2, 3])
    const result = await pasteContent(core, platform, [0, 0], { text: "" }, { decodeImage: decoder })
    expect(result.kind).toBe("image")

    const browser = createFakePlatform({ name: "browser" })
    const readImage = vi.fn(async () => new Uint8Array([1]))
    browser.clipboard.readImage = readImage
    await pasteContent(new EditorCore(), browser, [0, 0], { text: "" })
    expect(readImage).not.toHaveBeenCalled()
  })
})

describe("multi-format copy", () => {
  const setup = () => {
    const core = new EditorCore()
    core.loadScene([
      newElement("rectangle", { x: 0, y: 0, width: 40, height: 30, index: "a0" }),
      newElement("text", { x: 0, y: 50, width: 40, height: 20, text: "Note", index: "a1" }),
    ])
    core.selectAll()
    const platform = createFakePlatform()
    const writes: ClipboardPayload[] = []
    platform.clipboard.write = vi.fn(async (items: ClipboardPayload) => {
      writes.push(items)
      await items.png
    })
    const writeText = vi.fn(async () => {})
    platform.clipboard.writeText = writeText
    return { core, platform, writes, writeText }
  }

  test("writes Nib JSON, a PNG, an SVG and a text summary in one go", async () => {
    const { core, platform, writes, writeText } = setup()
    const renderPng = vi.fn(async () => new Uint8Array([137, 80, 78, 71]))
    expect(await copySelection(core, platform, { renderPng })).toBe(true)
    expect(writes).toHaveLength(1)
    const [items] = writes
    expect(JSON.parse(items!.json!).type).toBe("nib/clipboard")
    expect(items!.text).toBe("Note")
    expect(items!.svg).toContain("<svg")
    expect(await items!.png).toEqual(new Uint8Array([137, 80, 78, 71]))
    expect(renderPng).toHaveBeenCalledTimes(1)
    expect(writeText).not.toHaveBeenCalled()
  })

  test("the PNG render starts before the clipboard write is awaited", async () => {
    const { core, platform } = setup()
    const order: string[] = []
    platform.clipboard.write = vi.fn(async (items: ClipboardPayload) => {
      order.push("write")
      await items.png
    })
    await copySelection(core, platform, {
      renderPng: async () => {
        order.push("render")
        return new Uint8Array([1])
      },
    })
    expect(order).toEqual(["render", "write"])
  })

  test("when the multi-format write fails, the JSON still goes in as text", async () => {
    const { core, platform, writeText } = setup()
    platform.clipboard.write = vi.fn(async () => {
      throw new Error("NotAllowedError")
    })
    await copySelection(core, platform, {
      renderPng: async () => {
        throw new Error("no canvas")
      },
    })
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(JSON.parse((writeText.mock.calls[0] as unknown as [string])[0]).type).toBe("nib/clipboard")
  })
})

describe("copy and paste styles", () => {
  test("pasting a style onto text and arrows carries font, alignment and arrowheads", () => {
    const core = new EditorCore()
    const source = newElement("text", {
      x: 0,
      y: 0,
      text: "a",
      fontFamily: "code",
      fontSize: 36,
      textAlign: "right",
      index: "a0",
    })
    const arrowSource = newElement("arrow", {
      x: 0,
      y: 100,
      startArrowhead: "dot",
      endArrowhead: "bar",
      index: "a1",
    })
    const target = newElement("text", { x: 100, y: 0, text: "b", index: "a2" })
    const arrow = newElement("arrow", { x: 100, y: 100, index: "a3" }) as ArrowElement
    const rect = newElement("rectangle", { x: 200, y: 0, width: 10, height: 10, index: "a4" })
    core.loadScene([source, arrowSource, target, arrow, rect])

    core.setAppState({ selectedElementIds: { [source.id]: true } })
    copyStyle(core)
    core.setAppState({ selectedElementIds: { [target.id]: true, [rect.id]: true } })
    pasteStyle(core)
    const t = core.scene.get(target.id) as TextElement
    expect([t.fontFamily, t.fontSize, t.textAlign]).toEqual(["code", 36, "right"])
    expect((core.scene.get(rect.id) as unknown as { fontSize?: number }).fontSize).toBeUndefined()

    core.setAppState({ selectedElementIds: { [arrowSource.id]: true } })
    copyStyle(core)
    core.setAppState({ selectedElementIds: { [arrow.id]: true } })
    pasteStyle(core)
    const a = core.scene.get(arrow.id) as ArrowElement
    expect([a.startArrowhead, a.endArrowhead]).toEqual(["dot", "bar"])
  })

  test("the arrow type travels with copied styles and the defaults for new elements stay put", () => {
    const core = new EditorCore()
    const elbow = newElement("arrow", { x: 0, y: 0, elbowed: true, roundness: null, index: "a0" })
    const plain = newElement("arrow", { x: 0, y: 100, index: "a1" }) as ArrowElement
    const rect = newElement("rectangle", { x: 200, y: 0, width: 10, height: 10, index: "a2" })
    core.loadScene([elbow, plain, rect])
    const defaults = { ...core.appState }

    core.setAppState({ selectedElementIds: { [elbow.id]: true } })
    copyStyle(core)
    core.setAppState({ selectedElementIds: { [plain.id]: true, [rect.id]: true } })
    pasteStyle(core)
    expect((core.scene.get(plain.id) as ArrowElement).elbowed).toBe(true)
    expect((core.scene.get(rect.id) as unknown as { elbowed?: boolean }).elbowed).toBeUndefined()
    expect(core.appState.currentItemArrowType).toBe(defaults.currentItemArrowType)
    expect(core.appState.currentItemRoundness).toBe(defaults.currentItemRoundness)
  })
})

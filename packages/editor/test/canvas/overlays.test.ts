import {
  type BinaryFiles,
  EditorCore,
  type NibElement,
  type TextElement,
  contrastRatio,
  deriveCanvasPalette,
  layoutStandaloneText,
  newElement,
  setTextMeasurer,
  themeColor,
} from "@nib/core"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CanvasHost } from "../../src/canvas/CanvasHost"
import { EmbedOverlay, embedOverlayKey } from "../../src/canvas/EmbedOverlay"
import { FrameNameOverlay } from "../../src/canvas/FrameNameOverlay"
import { TextEditorOverlay, textEditorKey } from "../../src/canvas/TextEditorOverlay"
import { elementPicker } from "../../src/canvas/elementPicker"
import { embedState } from "../../src/canvas/embedState"
import { ImageCache } from "../../src/canvas/imageCache"
import { textNeedingRelayout } from "../../src/canvas/textRelayout"

beforeEach(() => setTextMeasurer((text) => text.length * 10))

const styleOf = (markup: string): Record<string, string> => {
  const style = /style="([^"]*)"/.exec(markup)?.[1] ?? ""
  const out: Record<string, string> = {}
  for (const decl of style.split(";")) {
    const i = decl.indexOf(":")
    if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim()
  }
  return out
}

const editText = (core: EditorCore, init: Partial<TextElement> = {}) => {
  const text = layoutStandaloneText(
    newElement("text", {
      x: 10,
      y: 20,
      fontSize: 20,
      text: "hello",
      originalText: "hello",
      index: core.scene.nextIndex(),
      ...init,
    }) as TextElement,
  )
  core.scene.insert(text)
  core.setAppState({ editingTextId: text.id })
  return text
}

describe("TextEditorOverlay", () => {
  it("renders nothing when no text is being edited", () => {
    const core = new EditorCore()
    expect(renderToStaticMarkup(createElement(TextEditorOverlay, { core }))).toBe("")
  })

  it("starts from the edited element's own text, one row, no soft wrap for auto-sized text", () => {
    const core = new EditorCore()
    editText(core, { originalText: "First note", text: "First note" })
    const markup = renderToStaticMarkup(createElement(TextEditorOverlay, { core, version: 0 }))
    expect(markup).toContain(">First note</textarea>")
    expect(markup).toContain('rows="1"')
    expect(markup).toContain('wrap="off"')
    expect(markup).toContain("data-text-editor")
    const style = styleOf(markup)
    expect(style["white-space"]).toBe("pre")
    expect(Number.parseFloat(style.height!)).toBeCloseTo(25)
  })

  it("draws the typed text in the board's remapped colour on a dark theme", () => {
    const core = new EditorCore()
    core.setAppState({ theme: "dark" })
    editText(core, { strokeColor: "#1e1e1e" })
    const palette = deriveCanvasPalette({ mode: "dark", board: "#16171A", ink: "#E6E7EA", course: "#7AA2FF" })
    const markup = renderToStaticMarkup(createElement(TextEditorOverlay, { core, palette }))
    const expected = themeColor("#1e1e1e", "dark", palette.board, "text").toLowerCase()
    expect(styleOf(markup).color!.toLowerCase().replace(/\s/g, "")).toBe(expected.replace(/\s/g, ""))
  })

  it("keeps typed text at 4.5:1 against its container's solid fill, as the renderer draws it", () => {
    const core = new EditorCore()
    const box = newElement("rectangle", {
      x: 0,
      y: 0,
      width: 200,
      height: 80,
      backgroundColor: "#1e1e1e",
      fillStyle: "solid",
      index: core.scene.nextIndex(),
    })
    core.scene.insert(box)
    editText(core, { strokeColor: "#1e1e1e", containerId: box.id } as Partial<TextElement>)
    const color = styleOf(renderToStaticMarkup(createElement(TextEditorOverlay, { core }))).color!
    expect(contrastRatio(color, "#1e1e1e")).toBeGreaterThanOrEqual(4.5)
  })

  it("measures standalone typed text against the canvas colour actually painted", () => {
    const core = new EditorCore()
    core.setAppState({ viewBackgroundColor: "#343a40" })
    editText(core, { strokeColor: "#495057" })
    const color = styleOf(renderToStaticMarkup(createElement(TextEditorOverlay, { core }))).color!
    expect(contrastRatio(color, "#343a40")).toBeGreaterThanOrEqual(4.5)
  })

  it("reads standalone text typed over a solid box against the box, as the canvas does", () => {
    const core = new EditorCore()
    const box = newElement("rectangle", {
      x: 0,
      y: 0,
      width: 200,
      height: 80,
      backgroundColor: "#1e1e1e",
      fillStyle: "solid",
      index: core.scene.nextIndex(),
    })
    core.scene.insert(box)
    editText(core, { strokeColor: "#1e1e1e" })
    const color = styleOf(renderToStaticMarkup(createElement(TextEditorOverlay, { core }))).color!
    expect(contrastRatio(color, "#1e1e1e")).toBeGreaterThanOrEqual(4.5)
  })

  it("sets the font as longhands, so a zoom or size change keeps its line height", () => {
    const core = new EditorCore()
    editText(core, { fontSize: 16, lineHeight: 1.25 } as Partial<TextElement>)
    core.setAppState({ viewport: { ...core.appState.viewport, zoom: 1.35 } })
    const style = styleOf(renderToStaticMarkup(createElement(TextEditorOverlay, { core })))
    expect(style.font).toBeUndefined()
    expect(Number.parseFloat(style["font-size"]!)).toBeCloseTo(16 * 1.35)
    expect(style["font-family"]).toBeTruthy()
    expect(style["line-height"]).toBe("1.25")
  })

  it("wraps imported fixed-width text at its width", () => {
    const core = new EditorCore()
    editText(core, { autoResize: false, width: 60, originalText: "one two three", text: "one two three" })
    const markup = renderToStaticMarkup(createElement(TextEditorOverlay, { core }))
    expect(markup).toContain('wrap="soft"')
    expect(Number.parseFloat(styleOf(markup).width!)).toBeCloseTo(60)
  })
})

describe("FrameNameOverlay", () => {
  it("edits the frame's name in a labelled field placed above the frame", () => {
    const core = new EditorCore()
    const frame = newElement("frame", { x: 100, y: 100, width: 300, height: 200, name: "Login" })
    core.scene.insert(frame)
    const markup = renderToStaticMarkup(
      createElement(FrameNameOverlay, { core, frameId: frame.id, onClose: () => {} }),
    )
    expect(markup).toContain('aria-label="Frame name"')
    expect(markup).toContain('value="Login"')
    expect(Number.parseFloat(styleOf(markup).top!)).toBeLessThan(100)
  })
})

describe("textNeedingRelayout (fonts loaded)", () => {
  it("lists free text and containers whose measured layout changed", () => {
    const core = new EditorCore()
    const free = layoutStandaloneText(
      newElement("text", { fontSize: 20, text: "abc", originalText: "abc" }) as TextElement,
    )
    core.scene.insert(free)
    const get = (id: string) => core.scene.get(id)
    expect(textNeedingRelayout(core.scene.getNonDeleted(), get)).toEqual([])
    setTextMeasurer((text) => text.length * 14)
    expect(textNeedingRelayout(core.scene.getNonDeleted(), get)).toEqual([free.id])
    expect(textNeedingRelayout(core.scene.getNonDeleted(), get, free.id)).toEqual([])
    core.relayoutContainer(free.id)
    expect(textNeedingRelayout(core.scene.getNonDeleted(), get)).toEqual([])
  })
})

describe("ImageCache", () => {
  const files: BinaryFiles = {
    f1: { id: "f1", dataURL: "data:image/png;base64,broken", mimeType: "image/png", created: 0 },
  } as BinaryFiles

  const fakeImage = (fail: boolean) => {
    const made: { src: string }[] = []
    const create = () => {
      const img = {
        onload: null as null | (() => void),
        onerror: null as null | (() => void),
        naturalWidth: 4,
        naturalHeight: 3,
        set src(v: string) {
          made.push({ src: v })
          queueMicrotask(() => (fail ? img.onerror?.() : img.onload?.()))
        },
      }
      return img as unknown as HTMLImageElement
    }
    return { made, create }
  }

  it("does not decode a broken image again on every frame", async () => {
    const cache = new ImageCache()
    const { made, create } = fakeImage(true)
    const decoded = vi.fn()
    cache.onDecoded(decoded)
    cache.sync(files, create)
    await Promise.resolve()
    cache.sync(files, create)
    cache.sync(files, create)
    expect(made).toHaveLength(1)
    expect(cache.hasFailed("f1")).toBe(true)
    expect(decoded).toHaveBeenCalledTimes(1)
    // new data under the same id is tried again
    cache.sync({ f1: { ...files.f1!, dataURL: "data:image/png;base64,other" } } as BinaryFiles, create)
    expect(made).toHaveLength(2)
  })

  it("lets go of bitmaps and failures the scene no longer has, on New or Open", async () => {
    const cache = new ImageCache()
    const ok = fakeImage(false)
    const two = {
      ...files,
      f2: { id: "f2", dataURL: "data:image/png;base64,ok", mimeType: "image/png", created: 0 },
    } as BinaryFiles
    cache.sync(two, ok.create)
    await Promise.resolve()
    expect(cache.get("f1")).not.toBeNull()
    expect(cache.size).toBe(2)
    const next = { f2: two.f2! } as BinaryFiles
    cache.sync(next, ok.create)
    expect(cache.get("f1")).toBeNull()
    expect(cache.get("f2")).not.toBeNull()

    const broken = new ImageCache()
    const bad = fakeImage(true)
    broken.sync(files, bad.create)
    await Promise.resolve()
    expect(broken.hasFailed("f1")).toBe(true)
    broken.sync({} as BinaryFiles, bad.create)
    expect(broken.hasFailed("f1")).toBe(false)
  })

  it("drops a decode still in flight for a file that left the scene", async () => {
    const cache = new ImageCache()
    const { create } = fakeImage(false)
    cache.sync(files, create)
    cache.sync({} as BinaryFiles, create)
    await Promise.resolve()
    expect(cache.get("f1")).toBeNull()
    expect(cache.size).toBe(0)
  })

  it("bumps its version when a bitmap arrives", async () => {
    const cache = new ImageCache()
    const { create } = fakeImage(false)
    const before = cache.version
    cache.sync(files, create)
    await Promise.resolve()
    expect(cache.version).toBe(before + 1)
    expect(cache.get("f1")).toMatchObject({ width: 4, height: 3 })
  })
})

describe("elementPicker", () => {
  const el = (id: string) => ({ ...newElement("rectangle", {}), id }) as NibElement

  it("hands the next accepted element to the pick, then ends", () => {
    const picked: string[] = []
    elementPicker.start({ onPick: (e) => picked.push(e.id), accepts: (e) => e.id !== "self" })
    expect(elementPicker.pick(el("self"))).toBe(true)
    expect(elementPicker.active).not.toBeNull()
    expect(elementPicker.pick(null)).toBe(true)
    expect(elementPicker.pick(el("other"))).toBe(true)
    expect(picked).toEqual(["other"])
    expect(elementPicker.active).toBeNull()
    expect(elementPicker.pick(el("late"))).toBe(false)
  })

  it("tracks the hovered candidate and clears it on cancel", () => {
    const cancel = elementPicker.start({ onPick: () => {}, accepts: (e) => e.id !== "self" })
    elementPicker.hover(el("self"))
    expect(elementPicker.hovered).toBeNull()
    elementPicker.hover(el("a"))
    expect(elementPicker.hovered).toBe("a")
    cancel()
    expect(elementPicker.hovered).toBeNull()
    expect(elementPicker.active).toBeNull()
  })
})

describe("EmbedOverlay", () => {
  const embed = (core: EditorCore, link: string | null, x = 0) => {
    const el = { ...newElement("embeddable", { x, y: 0, width: 320, height: 180, link }), id: `embed-${x}` }
    core.scene.insert(el as NibElement)
    return el
  }

  it("shows a sandboxed page for an allowlisted link, under the pointer layer until woken", () => {
    const core = new EditorCore()
    core.setViewportSize(800, 600)
    embed(core, "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    const markup = renderToStaticMarkup(createElement(EmbedOverlay, { core }))
    expect(markup).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"')
    expect(markup).toContain("sandbox=")
    expect(markup).toContain('tabindex="-1"')
    expect(markup).not.toContain("data-active")
    embedState.activate("embed-0")
    core.selectElements(["embed-0"])
    const live = renderToStaticMarkup(createElement(EmbedOverlay, { core }))
    expect(live).toContain('data-active="true"')
    embedState.activate(null)
  })

  it("leaves pages far off-screen unloaded", () => {
    const core = new EditorCore()
    core.setViewportSize(800, 600)
    embed(core, "https://www.youtube.com/watch?v=dQw4w9WgXcQ", 50_000)
    expect(renderToStaticMarkup(createElement(EmbedOverlay, { core }))).not.toContain("<iframe")
  })

  it("asks for an address when the selected embed has none, and never for other sites' pages", () => {
    const core = new EditorCore()
    core.setViewportSize(800, 600)
    embed(core, null)
    core.selectElements(["embed-0"])
    const markup = renderToStaticMarkup(createElement(EmbedOverlay, { core }))
    expect(markup).toContain('aria-label="Embed address"')
    expect(markup).not.toContain("<iframe")
    const other = new EditorCore()
    other.setViewportSize(800, 600)
    embed(other, "https://example.com")
    other.selectElements(["embed-0"])
    const refused = renderToStaticMarkup(createElement(EmbedOverlay, { core: other }))
    expect(refused).not.toContain("<iframe")
    expect(refused).toContain("Not an embeddable address")
  })
})

describe("overlays re-render only for what they draw", () => {
  it("the text editor's key is constant while nothing is edited, and follows the edit", () => {
    const core = new EditorCore()
    const rect = newElement("rectangle", { x: 0, y: 0, width: 50, height: 50 })
    core.scene.insert(rect)
    expect(textEditorKey(core)).toBe("")
    core.setAppState({ viewport: { ...core.appState.viewport, scrollX: 30 } })
    core.selectElements([rect.id])
    expect(textEditorKey(core)).toBe("")
    const text = editText(core)
    core.startEditingText(core.scene.get(text.id) as TextElement)
    const editing = textEditorKey(core)
    expect(editing).toContain(text.id)
    core.previewText("hello there")
    expect(textEditorKey(core)).not.toBe(editing)
  })

  it("the embed overlay's key ignores pans, drags and selections while no embed is involved", () => {
    const core = new EditorCore()
    core.setViewportSize(800, 600)
    const rect = newElement("rectangle", { x: 0, y: 0, width: 50, height: 50 })
    core.scene.insert(rect)
    core.selectElements([rect.id])
    const quiet = embedOverlayKey(core)
    core.setAppState({ viewport: { ...core.appState.viewport, scrollX: 120 } })
    core.scene.update({ ...core.scene.get(rect.id)!, x: 40, version: rect.version + 1 })
    expect(embedOverlayKey(core)).toBe(quiet)
    const embed = { ...newElement("embeddable", { x: 0, y: 200, width: 320, height: 180 }), id: "e1" }
    core.scene.insert(embed as NibElement)
    const withEmbed = embedOverlayKey(core)
    expect(withEmbed).not.toBe(quiet)
    core.setAppState({ viewport: { ...core.appState.viewport, scrollX: 10 } })
    expect(embedOverlayKey(core)).not.toBe(withEmbed)
  })
})

describe("CanvasHost", () => {
  it("names the board as an application with a description", () => {
    const core = new EditorCore()
    const markup = renderToStaticMarkup(
      createElement(CanvasHost, { core, images: new ImageCache(), onContextMenu: () => {} }),
    )
    const board = /<div[^>]*role="application"[^>]*>/.exec(markup)![0]
    expect(board).toContain('aria-label="Drawing board"')
    const describedBy = /aria-describedby="([^"]+)"/.exec(board)![1]!
    expect(markup).toMatch(new RegExp(`id="${describedBy}"[^>]*>Pick a tool`))
    // the label sits on the role, never on a role-less canvas
    expect(/<canvas[^>]*aria-label/.test(markup)).toBe(false)
  })
})

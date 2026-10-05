import { EditorCore, type NibElement, type TextElement, elementLink, newElement } from "@nib/core"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { elementPicker } from "../../src/canvas/elementPicker"
import { describeElement, followLink, summarizeLink } from "../../src/canvas/links"
import { LinkPopup } from "../../src/ui/LinkPopup"

const noop = () => {}

const add = (core: EditorCore, init: Partial<NibElement> & { type?: NibElement["type"] } = {}) => {
  const { type = "rectangle", ...rest } = init
  const el = newElement(type, { x: 0, y: 0, width: 100, height: 80, index: core.scene.nextIndex(), ...rest })
  core.scene.insert(el)
  return core.scene.get(el.id)!
}

const attrs = (markup: string, tag: string): Record<string, string>[] =>
  [...markup.matchAll(new RegExp(`<${tag}([^>]*)>`, "g"))].map(([, a]) => {
    const out: Record<string, string> = {}
    for (const [, k, v] of a!.matchAll(/([\w-]+)="([^"]*)"/g)) out[k!] = v!
    return out
  })

const html = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(LinkPopup, props as never))

describe("LinkPopup editor", () => {
  it("edits the selection's link in a labelled field", () => {
    const core = new EditorCore()
    const rect = add(core, { link: "https://example.com" })
    core.selectElements([rect.id])
    const markup = html({ core, onClose: noop, open: true })
    const dialog = attrs(markup, "div").find((d) => d.role === "dialog")
    expect(dialog?.["aria-label"]).toBe("Link")
    const input = attrs(markup, "input")[0]!
    expect(input["aria-label"]).toBe("Link address")
    expect(input.value).toBe("https://example.com")
    const labels = attrs(markup, "button").map((b) => b["aria-label"])
    expect(labels).toEqual(
      expect.arrayContaining(["Link to an element", "Apply link", "Open link", "Remove link"]),
    )
  })

  it("names an element link's target under the field", () => {
    const core = new EditorCore()
    const target = add(core, { type: "frame", name: "Checkout", x: 400 })
    const rect = add(core, { link: elementLink(target.id) })
    core.selectElements([rect.id])
    const markup = html({ core, onClose: noop })
    expect(markup).toContain("Links to Checkout")
  })

  it("renders nothing to edit when nothing is selected", () => {
    const core = new EditorCore()
    expect(html({ core, onClose: noop, open: true })).toBe("")
  })
})

describe("LinkPopup chip", () => {
  it("shows a read-only chip for one linked element, without a focusable field", () => {
    const core = new EditorCore()
    const rect = add(core, { link: "https://example.com/docs" })
    core.selectElements([rect.id])
    const markup = html({ core, onClose: noop, open: false, onEdit: noop })
    expect(markup).toContain("example.com/docs")
    expect(attrs(markup, "input")).toHaveLength(0)
    expect(attrs(markup, "div").some((d) => d.role === "dialog")).toBe(false)
    const labels = attrs(markup, "button").map((b) => b["aria-label"])
    expect(labels).toEqual(expect.arrayContaining(["Open link", "Edit link", "Remove link"]))
  })

  it("stays hidden for unlinked, multiple or editing selections", () => {
    const core = new EditorCore()
    const a = add(core)
    const b = add(core, { x: 200, link: "https://example.com" })
    core.selectElements([a.id])
    expect(html({ core, onClose: noop, open: false })).toBe("")
    core.selectElements([a.id, b.id])
    expect(html({ core, onClose: noop, open: false })).toBe("")
    core.selectElements([b.id])
    core.setAppState({ editingTextId: "x" })
    expect(html({ core, onClose: noop, open: false })).toBe("")
  })

  it("stays hidden while an element is being picked", () => {
    const core = new EditorCore()
    const b = add(core, { link: "https://example.com" })
    core.selectElements([b.id])
    const cancel = elementPicker.start({ onPick: noop })
    expect(html({ core, onClose: noop, open: false })).toBe("")
    cancel()
    expect(html({ core, onClose: noop, open: false })).not.toBe("")
  })
})

describe("links helpers", () => {
  it("describes elements by frame name, text or label", () => {
    const core = new EditorCore()
    const frame = add(core, { type: "frame", name: "Sign in" })
    const text = add(core, {
      type: "text",
      originalText: "Hello there",
      text: "Hello there",
    } as Partial<TextElement>)
    const get = (id: string) => core.scene.get(id)
    expect(describeElement(frame, get)).toBe("Sign in")
    expect(describeElement(text, get)).toBe("“Hello there”")
    expect(describeElement(add(core), get)).toBe("Rectangle")
  })

  it("summarises web, element and dangling element links", () => {
    const core = new EditorCore()
    const get = (id: string) => core.scene.get(id)
    expect(summarizeLink("https://example.com/", get)).toEqual({
      kind: "web",
      label: "example.com",
      live: true,
    })
    const el = add(core)
    expect(summarizeLink(elementLink(el.id), get)).toMatchObject({
      kind: "element",
      label: "Rectangle",
      live: true,
    })
    expect(summarizeLink(elementLink("gone"), get)).toMatchObject({ kind: "element", live: false })
  })

  it("follows element links on the board, refuses unsafe ones, and opens web links through the host", () => {
    const core = new EditorCore()
    const el = add(core, { x: 1000, y: 1000 })
    expect(followLink(core, elementLink(el.id))).toBe("jumped")
    expect(core.selectedElements().map((e) => e.id)).toEqual([el.id])
    expect(followLink(core, "javascript:alert(1)")).toBe("refused")
    const open = vi.fn()
    expect(followLink(core, "https://example.com", open)).toBe("opened")
    expect(open).toHaveBeenCalledWith("https://example.com")
    const hostOpen = vi.fn()
    core.host = { onOpenLink: hostOpen }
    expect(followLink(core, "https://example.com", open)).toBe("opened")
    expect(hostOpen).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledTimes(1)
  })
})

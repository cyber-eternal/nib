import { EditorCore, newElement } from "@nib/core"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { CommandPalette } from "../../src/ui/CommandPalette"
import { ContextMenu, buildContextItems } from "../../src/ui/ContextMenu"
import { ExportDialog } from "../../src/ui/ExportDialog"
import { HelpDialog } from "../../src/ui/HelpDialog"
import { LibraryPanel } from "../../src/ui/LibraryPanel"
import { MainMenu } from "../../src/ui/MainMenu"
import { MermaidDialog } from "../../src/ui/MermaidDialog"

const noop = () => {}

const tags = (markup: string, tag: string): Record<string, string>[] =>
  [...markup.matchAll(new RegExp(`<${tag}([^>]*)>`, "g"))].map(([, attrs]) => {
    const out: Record<string, string> = {}
    for (const [, k, v] of attrs!.matchAll(/([\w-]+)="([^"]*)"/g)) out[k!] = v!
    return out
  })

const dialogOf = (markup: string) => tags(markup, "div").find((d) => d.role === "dialog")

describe("modal dialogs announce themselves as modal", () => {
  const core = new EditorCore()
  const cases: [string, string][] = [
    ["help", renderToStaticMarkup(createElement(HelpDialog, { onClose: noop }))],
    ["palette", renderToStaticMarkup(createElement(CommandPalette, { commands: [], onClose: noop }))],
    [
      "export",
      renderToStaticMarkup(
        createElement(ExportDialog, {
          core,
          onClose: noop,
          onSaveBlob: noop,
          onSaveText: noop,
          onCopyPng: noop,
          onCopyText: noop,
        }),
      ),
    ],
    ["mermaid", renderToStaticMarkup(createElement(MermaidDialog, { core, onClose: noop, onInsert: noop }))],
  ]
  for (const [name, markup] of cases) {
    it(`${name} dialog has aria-modal="true"`, () => {
      expect(dialogOf(markup)?.["aria-modal"]).toBe("true")
    })
  }
})

describe("menus expose menu items", () => {
  it("context menu entries are role=menuitem", () => {
    const core = new EditorCore()
    const items = buildContextItems(core, {
      hasSelection: false,
      onCopy: noop,
      onCut: noop,
      onPaste: noop,
      onCopyStyle: noop,
      onPasteStyle: noop,
      onCopyAsPng: noop,
      onCopyAsSvg: noop,
      onAddToLibrary: noop,
      onLink: noop,
      onTidy: noop,
    })
    vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 800 })
    const markup = renderToStaticMarkup(createElement(ContextMenu, { x: 0, y: 0, items, onClose: noop }))
    vi.unstubAllGlobals()
    const entries = tags(markup, "button")
    expect(entries.length).toBeGreaterThan(0)
    for (const b of entries) expect(b.role).toBe("menuitem")
  })

  // toggles are menuitemcheckbox and themes menuitemradio (ARIA's checkable menu items), each with aria-checked
  it("main menu entries are menu items", () => {
    const core = new EditorCore()
    const actions = new Proxy({}, { get: () => noop }) as never
    const markup = renderToStaticMarkup(
      createElement(MainMenu, { core, actions, onClose: noop, showStats: false }),
    )
    const entries = tags(markup, "button").filter((b) => b.class?.includes("menu-item"))
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.some((b) => b.role === "menuitem")).toBe(true)
    for (const b of entries) {
      expect(b.role).toMatch(/^menuitem(checkbox|radio)?$/)
      if (b.role !== "menuitem") expect(["true", "false"]).toContain(b["aria-checked"])
    }
  })
})

describe("library items have an accessible name", () => {
  it("each library tile button is labelled", () => {
    const core = new EditorCore()
    const rect = newElement("rectangle", { x: 0, y: 0, width: 40, height: 40 })
    const markup = renderToStaticMarkup(
      createElement(LibraryPanel, {
        core,
        items: [{ id: "lib-1", status: "unpublished", elements: [rect], created: 0 }],
        onChange: noop,
        onClose: noop,
        onImport: noop,
        onExport: noop,
      }),
    )
    const tiles = tags(markup, "button").filter((b) => b.class?.includes("lib-item"))
    expect(tiles.length).toBe(1)
    const imgAlt = /<button[^>]*class="lib-item"[^>]*>\s*<img[^>]*alt="([^"]*)"/.exec(markup)?.[1] ?? ""
    expect(Boolean(tiles[0]!["aria-label"]) || imgAlt.length > 0).toBe(true)
  })
})

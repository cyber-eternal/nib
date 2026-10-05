import { EditorCore, type NibElement, newElement } from "@nib/core"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { CommandPalette } from "../../src/ui/CommandPalette"
import { ExportDialog } from "../../src/ui/ExportDialog"
import { HelpDialog } from "../../src/ui/HelpDialog"
import { LibraryPanel } from "../../src/ui/LibraryPanel"
import { MERMAID_SAMPLES, MermaidDialog, buildForInsert, buildMermaid } from "../../src/ui/MermaidDialog"
import { PreferencesDialog } from "../../src/ui/PreferencesDialog"
import { SearchPanel, sameMatches } from "../../src/ui/SearchPanel"
import { StatsPanel } from "../../src/ui/StatsPanel"

const noop = () => {}
const html = (type: any, props: Record<string, unknown>) => renderToStaticMarkup(createElement(type, props))

const tags = (markup: string, tag: string): Record<string, string>[] =>
  [...markup.matchAll(new RegExp(`<${tag}(\\s[^>]*)?>`, "g"))].map(([, attrs = ""]) => {
    const out: Record<string, string> = {}
    for (const [, k, v] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) out[k!] = v!
    return out
  })

const byRole = (markup: string, role: string) =>
  ["div", "button", "input", "section", "aside", "p", "span"].flatMap((t) =>
    tags(markup, t).filter((a) => a.role === role),
  )

const coreWith = (els: NibElement[], select: string[] = []): EditorCore => {
  const core = new EditorCore()
  for (const el of els) core.scene.insert({ ...el, index: core.scene.nextIndex() } as never)
  if (select.length) core.selectElements(select)
  return core
}

const exportProps = (core: EditorCore) => ({
  core,
  onClose: noop,
  onSaveBlob: noop,
  onSaveText: noop,
  onCopyPng: noop,
  onCopyText: noop,
})

const prefs = { get: () => null, set: noop }

describe("dialogs are labelled modals", () => {
  const cases: [string, string][] = [
    ["help", html(HelpDialog, { onClose: noop })],
    ["palette", html(CommandPalette, { commands: [], onClose: noop })],
    ["export", html(ExportDialog, exportProps(new EditorCore()))],
    ["mermaid", html(MermaidDialog, { core: new EditorCore(), onClose: noop, onInsert: noop })],
    ["preferences", html(PreferencesDialog, { core: new EditorCore(), prefs, onClose: noop })],
  ]
  for (const [name, markup] of cases) {
    it(`${name}: aria-modal and aria-labelledby an h2`, () => {
      const dialog = tags(markup, "div").find((d) => d.role === "dialog")!
      expect(dialog["aria-modal"]).toBe("true")
      const title = tags(markup, "h2").find((h) => h.id === dialog["aria-labelledby"])
      expect(title).toBeTruthy()
    })
  }

  it("renders nothing while closed", () => {
    expect(html(HelpDialog, { onClose: noop, open: false })).toBe("")
    expect(html(ExportDialog, { ...exportProps(new EditorCore()), open: false })).toBe("")
  })
})

describe("help dialog", () => {
  const markup = html(HelpDialog, { onClose: noop, isMac: true })

  it("has a labelled search field and the pencil explained", () => {
    expect(markup).toContain("Search shortcuts")
    expect(markup).toContain('type="search"')
    expect(markup).toContain("The pencil tidies your shapes")
  })

  it("lists shortcut rows with platform keys", () => {
    expect(markup).toContain("<dt>Pencil<small>Freehand that turns into clean shapes</small></dt>")
    expect(markup).toContain(">⇧⌘Z</kbd>")
    expect(markup).toContain(">⌘ Arrows</kbd>")
  })

  it("keeps the search above a list the keyboard can reach and scroll", () => {
    const region = tags(markup, "div").find((d) => d.role === "region")!
    expect(region["aria-label"]).toBe("Shortcuts")
    expect(region.tabindex).toBe("0")
    expect(region.class).toContain("sc-dialog-body")
    const body = markup.slice(markup.indexOf('role="region"'))
    expect(body).not.toContain('type="search"')
    expect(body).toContain("<dt>Pencil")
  })
})

describe("mermaid insert", () => {
  it("inserts what the source says now, not a preview that has not caught up", () => {
    const core = new EditorCore()
    const before = MERMAID_SAMPLES.flowchart.source
    const now = MERMAID_SAMPLES.sequence.source
    const stale = buildMermaid(core, before)
    const build = buildForInsert(core, now, { source: before, build: stale })
    expect(build).not.toBe(stale)
    expect(build.kind).toBe("sequence")
    expect(buildForInsert(core, before, { source: before, build: stale })).toBe(stale)
  })
})

describe("search results", () => {
  it("treat a recomputed but identical list as unchanged", () => {
    const m = { id: "a", targetId: "a", kind: "text" as const, text: "apple", at: 0, length: 5 }
    expect(sameMatches([m], [{ ...m }])).toBe(true)
    expect(sameMatches([m], [{ ...m, at: 1 }])).toBe(false)
    expect(sameMatches([m], [])).toBe(false)
  })
})

describe("command palette", () => {
  const commands = [
    { id: "tool.pencil", label: "Pencil", group: "Tools", run: noop },
    { id: "file.save", label: "Save", group: "File", run: noop },
    { id: "theme.mint", label: "Theme: Mint", group: "Theme", run: noop, disabled: true },
  ]
  const markup = html(CommandPalette, { commands, onClose: noop, isMac: true })

  it("is a combobox driving a listbox through aria-activedescendant", () => {
    const input = byRole(markup, "combobox")[0]!
    const list = byRole(markup, "listbox")[0]!
    expect(input["aria-controls"]).toBe(list.id)
    const options = byRole(markup, "option")
    expect(options).toHaveLength(3)
    expect(input["aria-activedescendant"]).toBe(options[0]!.id)
    expect(options[0]!["aria-selected"]).toBe("true")
    expect(options[2]!["aria-disabled"]).toBe("true")
  })

  it("groups commands under labelled headers with their shortcuts", () => {
    const groups = byRole(markup, "group")
    expect(groups).toHaveLength(3)
    expect(markup).toContain(">Tools</div>")
    expect(markup).toMatch(/Pencil<\/span><kbd[^>]*>P<\/kbd>/)
    expect(markup).toMatch(/Save<\/span><kbd[^>]*>⌘S<\/kbd>/)
  })
})

describe("export dialog", () => {
  it("shows an empty state and disables saving with nothing to export", () => {
    const markup = html(ExportDialog, exportProps(new EditorCore()))
    expect(markup).toContain("Nothing to export yet")
    const save = tags(markup, "button").find((b) => b["data-variant"] === "primary")!
    expect("disabled" in save).toBe(true)
  })

  it("previews the canvas with its pixel size", () => {
    const r = newElement("rectangle", { x: 0, y: 0, width: 100, height: 50 })
    const markup = html(ExportDialog, exportProps(coreWith([r])))
    expect(markup).toContain('alt="Preview of the export"')
    expect(markup).toMatch(/\d+ × \d+ px/)
    expect(markup).toContain(" at 2×")
  })

  it("starts on the selected frame and offers every frame", () => {
    const a = newElement("frame", { x: 0, y: 0, width: 200, height: 100, name: "Intro" } as never)
    const b = newElement("frame", { x: 300, y: 0, width: 200, height: 100 } as never)
    const markup = html(ExportDialog, exportProps(coreWith([a, b], [a.id])))
    expect(markup).toContain("Every frame, one file each")
    expect(markup).toMatch(/<option value="[^"]+" selected="">Intro<\/option>/)
    expect(markup).toContain(">400 × 200 px</strong> at 2×")
  })
})

describe("mermaid dialog", () => {
  it("labels the source and names the supported diagram types", () => {
    const markup = html(MermaidDialog, { core: new EditorCore(), onClose: noop, onInsert: noop })
    const area = tags(markup, "textarea")[0]!
    expect(tags(markup, "label").some((l) => l.for === area.id)).toBe(true)
    expect(markup).toContain("flowcharts, sequence and class diagrams")
    expect(markup).toContain("Reading a flowchart")
  })

  it("shows the parse error live and disables Insert", () => {
    const markup = html(MermaidDialog, {
      core: new EditorCore(),
      onClose: noop,
      onInsert: noop,
      source: "pie title Pets",
    })
    expect(markup).toContain("not pie")
    expect(tags(markup, "textarea")[0]!["aria-invalid"]).toBe("true")
    const insert = tags(markup, "button").find((b) => b["data-variant"] === "primary")!
    expect("disabled" in insert).toBe(true)
  })
})

describe("library sheet", () => {
  const rect = newElement("rectangle", { x: 0, y: 0, width: 40, height: 40 })
  const items = [
    { id: "lib-1", status: "unpublished", elements: [rect], created: 0, name: "Server" },
    { id: "lib-2", status: "unpublished", elements: [rect], created: 0 },
  ]
  const props = {
    core: new EditorCore(),
    items,
    onChange: noop,
    onClose: noop,
    onImport: noop,
    onExport: noop,
  }
  const markup = html(LibraryPanel, props)

  it("labels each draggable tile by name or position", () => {
    const tiles = tags(markup, "button").filter((b) => b.class?.includes("lib-item"))
    expect(tiles.map((t) => t["aria-label"])).toEqual(["Server", "Library item 2"])
    for (const t of tiles) expect(t.draggable).toBe("true")
    expect(markup).toContain("drag it where you want it")
  })

  it("gives each tile a visible menu button and keeps Import and Export", () => {
    expect(markup).toContain('aria-label="More for Server"')
    expect(markup).toContain(">Import</button>")
    expect(markup).toContain(">Export</button>")
  })

  it("is a labelled side sheet with a teaching empty state", () => {
    const empty = html(LibraryPanel, { ...props, items: [] })
    const aside = tags(empty, "aside")[0]!
    expect(tags(empty, "h2").find((h) => h.id === aside["aria-labelledby"])).toBeTruthy()
    expect(empty).toContain("Keep shapes you reuse here")
    const exp = tags(empty, "button").find((b) => b.class === "sc-button" && empty.includes("Export"))
    expect(exp).toBeTruthy()
  })
})

describe("search sheet", () => {
  it("is a labelled sheet with a combobox and disabled next/previous until there are matches", () => {
    const markup = html(SearchPanel, { core: new EditorCore(), onClose: noop })
    expect(tags(markup, "aside")[0]!["aria-labelledby"]).toBeTruthy()
    const input = byRole(markup, "combobox")[0]!
    expect(input["aria-controls"]).toBe(byRole(markup, "listbox")[0]!.id)
    const nav = tags(markup, "button").filter((b) => /match$/.test(b["aria-label"] ?? ""))
    expect(nav.map((b) => b["aria-label"])).toEqual(["Previous match", "Next match"])
    for (const b of nav) expect("disabled" in b).toBe(true)
  })
})

describe("stats panel", () => {
  it("labels every geometry field for a single element", () => {
    const r = newElement("rectangle", { x: 10, y: 20, width: 100, height: 50 })
    const markup = html(StatsPanel, { core: coreWith([r], [r.id]), onClose: noop })
    const labels = tags(markup, "label")
    const inputs = tags(markup, "input")
    expect(inputs).toHaveLength(5)
    for (const i of inputs) expect(labels.some((l) => l.for === i.id)).toBe(true)
    expect(inputs.map((i) => i.value)).toEqual(["10", "20", "100", "50", "0"])
    expect(markup).toContain(">Rectangle</h3>")
  })

  it("explains why a locked element's fields are disabled", () => {
    const r = { ...newElement("rectangle", { x: 0, y: 0, width: 100, height: 50 }), locked: true }
    const markup = html(StatsPanel, { core: coreWith([r], [r.id]), onClose: noop })
    const inputs = tags(markup, "input")
    expect(inputs.every((i) => "disabled" in i)).toBe(true)
    expect(markup).toContain("Locked. Unlock it to change its position or size.")
    const note = tags(markup, "div").find((d) => d.id && d.id === inputs[0]!["aria-describedby"])
    expect(note).toBeTruthy()
  })
})

describe("preferences", () => {
  it("offers the eleven themes as a radio group only when the shell can apply them", () => {
    const without = html(PreferencesDialog, { core: new EditorCore(), prefs, onClose: noop })
    expect(byRole(without, "radiogroup")).toHaveLength(0)
    const withTheme = html(PreferencesDialog, {
      core: new EditorCore(),
      prefs,
      onClose: noop,
      theme: "mint",
      onThemeChange: noop,
      onMatchSystemChange: noop,
    })
    const radios = byRole(withTheme, "radio")
    expect(radios).toHaveLength(11)
    expect(radios.filter((r) => r["aria-checked"] === "true")).toHaveLength(1)
    expect(radios.filter((r) => r.tabindex === "0")).toHaveLength(1)
  })

  it("exposes its toggles as labelled switches", () => {
    const markup = html(PreferencesDialog, { core: new EditorCore(), prefs, onClose: noop })
    const labels = [...markup.matchAll(/role="switch"[^>]*>.*?<span class="sc-switch-label">([^<]+)</g)].map(
      (m) => m[1],
    )
    expect(labels).toEqual([
      "Reduce motion",
      "Pen corrects shapes",
      "Explain corrections",
      "Show grid",
      "Snap to objects",
    ])
  })

  it("offers Reopen tabs on launch only on desktop, on by default", () => {
    const switches = (markup: string) =>
      [
        ...markup.matchAll(
          /role="switch"[^>]*aria-checked="(\w+)"[^>]*>.*?<span class="sc-switch-label">([^<]+)</g,
        ),
      ].map((m) => [m[2], m[1]])
    const web = html(PreferencesDialog, { core: new EditorCore(), prefs, onClose: noop })
    expect(switches(web).map(([label]) => label)).not.toContain("Reopen tabs on launch")
    const desktop = html(PreferencesDialog, {
      core: new EditorCore(),
      prefs,
      onClose: noop,
      sessionRestore: true,
    })
    expect(switches(desktop)).toContainEqual(["Reopen tabs on launch", "true"])
  })
})

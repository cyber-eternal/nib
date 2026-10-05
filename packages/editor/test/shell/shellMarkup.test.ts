import { EditorCore } from "@nib/core"
import { createElement, createRef } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { MainMenu } from "../../src/ui/MainMenu"
import { LedgeEnd } from "../../src/ui/shell/LedgeEnd"
import { ModePill } from "../../src/ui/shell/ModePill"
import { TabBar, dropIndex, tabKeyTarget } from "../../src/ui/shell/TabBar"
import { ThemeDeck, deckColumns } from "../../src/ui/shell/ThemeDeck"
import { TopActions } from "../../src/ui/shell/TopActions"
import { ShellIcons } from "../../src/ui/shell/icons"
import { StyleIcons } from "../../src/ui/style/icons"
import { attrsOf, noop } from "./helpers"

const html = (type: any, props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(type as never, props as never))

const actions = new Proxy({}, { get: () => noop }) as never

const MENU_ROLES = new Set(["menuitem", "menuitemcheckbox", "menuitemradio"])

describe("main menu", () => {
  const core = new EditorCore()
  const markup = html(MainMenu, {
    core,
    actions,
    onClose: noop,
    showStats: false,
    recentFiles: ["/docs/Plan.nibd"],
    theme: { current: "whiteboard", matchSystem: false, onSelect: noop, onMatchSystem: noop },
  })
  const items = attrsOf(markup, "button").filter((b) => b.class?.includes("sc-menu-item"))

  it("is a role=menu of menu items", () => {
    expect(attrsOf(markup, "div").some((d) => d.role === "menu" && d["aria-label"] === "Main menu")).toBe(
      true,
    )
    expect(items.length).toBeGreaterThan(20)
    for (const b of items) expect(MENU_ROLES.has(b.role!)).toBe(true)
  })

  it("has the brief's sections in order", () => {
    const headings = [...markup.matchAll(/class="sc-menu-heading">([^<]*)</g)].map((m) => m[1])
    expect(headings).toEqual(["File", "Import / Export", "View", "Insert", "Theme · Whiteboard", "Help"])
  })

  it("names the Excalidraw items as interop, with an icon on every Import / Export item", () => {
    expect(markup).toContain("Import from Excalidraw (.excalidraw)…")
    expect(markup).toContain("Export to Excalidraw (.excalidraw)…")
    expect(markup).not.toContain(".excalidraw…")
    const group = markup
      .split('class="sc-menu-heading">Import / Export<')[1]!
      .split('class="sc-menu-heading">')[0]!
    const items = group.split('role="menuitem"').slice(1)
    expect(items).toHaveLength(3)
    for (const item of items) expect(item.split("</button>")[0]).toContain("<svg")
  })

  it("ends with Reset canvas, isolated and in danger colour", () => {
    const sections = [...markup.matchAll(/<div role="group"[^>]*class="sc-menu-section"([^>]*)>/g)]
    expect(sections.at(-1)?.[1]).toContain("data-isolated")
    const last = items.at(-1)!
    expect(last["data-danger"]).toBe("true")
    expect(markup.lastIndexOf("Reset canvas")).toBeGreaterThan(markup.lastIndexOf("Keyboard shortcuts"))
  })

  it("shows the eleven themes inline as radios, plus Match system", () => {
    const radios = items.filter((b) => b.role === "menuitemradio")
    expect(radios).toHaveLength(11)
    expect(radios.filter((b) => b["aria-checked"] === "true")).toHaveLength(1)
    expect(markup).toContain("Match system")
  })

  it("toggles are checkboxes that say whether they are on", () => {
    const checks = items.filter((b) => b.role === "menuitemcheckbox")
    expect(checks.length).toBeGreaterThanOrEqual(6)
    for (const c of checks) expect(["true", "false"]).toContain(c["aria-checked"])
  })

  it("offers Open Recent when the host keeps recent files", () => {
    expect(markup).toContain("Open Recent")
    const without = html(MainMenu, { core, actions, onClose: noop, showStats: false })
    expect(without).not.toContain("Open Recent")
  })

  it("shows shortcuts from the shortcut table", () => {
    expect(
      items.find((b) => b["aria-keyshortcuts"] === "Meta+S" || b["aria-keyshortcuts"] === "Control+S"),
    ).toBeTruthy()
  })

  it("renders nothing while closed", () => {
    expect(html(MainMenu, { core, actions, onClose: noop, showStats: false, open: false })).toBe("")
  })
})

describe("tab bar", () => {
  const tabs = [
    { id: "t1", name: "Roadmap.nibd", path: "/Users/u/Roadmap.nibd", dirty: false },
    { id: "t2", name: "Untitled 2", path: null, dirty: true },
    { id: "t3", name: "Board A.nibd", path: "fsa:2aee9803-1d2c/Board A.nibd", dirty: false },
  ]
  const base = {
    tabs,
    activeId: "t1",
    justSaved: false,
    menuOpen: false,
    menuButtonRef: createRef(),
    onToggleMenu: noop,
    onActivate: noop,
    onClose: noop,
    onNew: noop,
    onMove: noop,
    onRename: noop,
    onTabMenu: noop,
  }

  it("is the menu button, a tab list with one tab per drawing, and New tab", () => {
    const markup = html(TabBar, base)
    const buttons = attrsOf(markup, "button")
    expect(buttons.some((b) => b["aria-label"] === "Menu" && b["aria-haspopup"] === "menu")).toBe(true)
    expect(buttons.some((b) => b["aria-label"] === "New tab")).toBe(true)
    expect(
      attrsOf(markup, "div").some((d) => d.role === "tablist" && d["aria-label"] === "Open drawings"),
    ).toBe(true)
    const tabButtons = buttons.filter((b) => b.role === "tab")
    expect(tabButtons.map((b) => b["aria-selected"])).toEqual(["true", "false", "false"])
    expect(tabButtons.map((b) => b.tabindex)).toEqual(["0", "-1", "-1"])
    expect(markup).toContain(">Roadmap<")
    expect(markup).toContain(">Untitled 2<")
  })

  it("marks the active and the edited tabs, and names each close button", () => {
    const markup = html(TabBar, base)
    const wrappers = attrsOf(markup, "div").filter((d) => d.class === "shell-tab")
    expect(wrappers.map((w) => ["data-active" in w, "data-dirty" in w])).toEqual([
      [true, false],
      [false, true],
      [false, false],
    ])
    expect(markup).toContain(", edited</span>")
    const closers = attrsOf(markup, "button").filter((b) => b.class === "shell-tab-close")
    expect(closers.map((b) => b["aria-label"])).toEqual([
      "Close Roadmap",
      "Close Untitled 2",
      "Close Board A",
    ])
  })

  it("shows the full path as the tooltip, but a browser file handle by its name alone", () => {
    const titles = attrsOf(html(TabBar, base), "button")
      .filter((b) => b.role === "tab")
      .map((b) => b.title)
    expect(titles).toEqual(["/Users/u/Roadmap.nibd", "Untitled 2", "Board A.nibd"])
  })

  it("says Saved just after the tab in front was saved", () => {
    expect(html(TabBar, { ...base, justSaved: true })).toContain(">Saved<")
    expect(html(TabBar, base)).not.toContain("Saved")
  })

  it("moves through the tabs with the arrow keys, Home and End, wrapping around", () => {
    expect(tabKeyTarget("ArrowRight", 2, 3)).toBe(0)
    expect(tabKeyTarget("ArrowLeft", 0, 3)).toBe(2)
    expect(tabKeyTarget("Home", 2, 3)).toBe(0)
    expect(tabKeyTarget("End", 0, 3)).toBe(2)
    expect(tabKeyTarget("Enter", 0, 3)).toBeNull()
  })

  it("drops a dragged tab before or after the one under the pointer", () => {
    expect(dropIndex(0, 2, true)).toBe(2)
    expect(dropIndex(0, 2, false)).toBe(1)
    expect(dropIndex(3, 0, false)).toBe(0)
    expect(dropIndex(3, 1, true)).toBe(2)
    expect(dropIndex(1, 1, false)).toBe(1)
  })
})

describe("top-right actions", () => {
  const refs = { searchButtonRef: createRef(), libraryButtonRef: createRef(), themeButtonRef: createRef() }
  const base = {
    ...refs,
    searchOpen: false,
    libraryOpen: false,
    themeOpen: false,
    onSearch: noop,
    onLibrary: noop,
    onTheme: noop,
    onExport: noop,
  }

  it("is a toolbar of three quiet icons and one primary Export", () => {
    const markup = html(TopActions, base)
    expect(attrsOf(markup, "div").some((d) => d.role === "toolbar")).toBe(true)
    const buttons = attrsOf(markup, "button")
    expect(buttons.map((b) => b["aria-label"]).filter(Boolean)).toEqual([
      "Find on canvas",
      "Library",
      "Theme",
    ])
    const primary = buttons.filter((b) => b["data-variant"] === "primary")
    expect(primary).toHaveLength(1)
    expect(markup).toContain("Export</button>")
  })

  it("folds into one ⋯ button on narrow windows, Export staying", () => {
    const markup = html(TopActions, { ...base, narrow: true })
    const labels = attrsOf(markup, "button")
      .map((b) => b["aria-label"])
      .filter(Boolean)
    expect(labels).toEqual(["More"])
    expect(markup).toContain("Export</button>")
  })
})

describe("ledge end", () => {
  it("has undo, redo and zoom, with the level in tabular figures", () => {
    const markup = html(LedgeEnd, { core: new EditorCore() })
    const labels = attrsOf(markup, "button").map((b) => b["aria-label"])
    expect(labels).toEqual(["Undo", "Redo", "Zoom out", "Zoom 100%, reset to 100%", "Zoom in", "Zoom to fit"])
    const undo = attrsOf(markup, "button").find((b) => b["aria-label"] === "Undo")!
    expect("disabled" in undo || markup.includes('aria-label="Undo" aria-keyshortcuts')).toBe(true)
    expect(markup).toContain(">100%</button>")
  })

  it("view mode leaves only the zoom", () => {
    const core = new EditorCore()
    core.toggleViewMode()
    const labels = attrsOf(html(LedgeEnd, { core }), "button").map((b) => b["aria-label"])
    expect(labels).not.toContain("Undo")
    expect(labels).toContain("Zoom in")
  })
})

describe("theme deck", () => {
  const markup = html(ThemeDeck, {
    open: true,
    onClose: noop,
    anchor: createRef(),
    current: "kraft",
    matchSystem: false,
    onSelect: noop,
    onMatchSystem: noop,
  })

  it("is a labelled group of eleven theme radios with one checked and one tab stop", () => {
    const radios = attrsOf(markup, "button").filter((b) => b.role === "radio")
    expect(radios).toHaveLength(11)
    const checked = radios.filter((b) => b["aria-checked"] === "true")
    expect(checked).toHaveLength(1)
    expect(radios.filter((b) => b.tabindex === "0")).toHaveLength(1)
    expect(markup).toContain(">Kraft</span>")
    expect(markup).toContain(">High Contrast</span>")
  })

  it("has a Match system switch", () => {
    const sw = attrsOf(markup, "button").find((b) => b.role === "switch")
    expect(sw?.["aria-checked"]).toBe("false")
    expect(markup).toContain("Match system")
  })

  it("draws each miniature in its theme's own colours", () => {
    expect(markup).toContain("--mini-board:#D8C29D")
    expect(markup).toContain("--mini-course:#9E2F14")
  })

  it("lays its grid out in the columns its arrow keys walk, three on a phone", () => {
    expect(deckColumns(false)).toBe(5)
    expect(deckColumns(true)).toBe(3)
    expect(markup).toContain("--deck-columns:5")
  })
})

describe("the Theme icon", () => {
  it("is not Opacity's half-disc", () => {
    const theme = renderToStaticMarkup(ShellIcons.theme)
    expect(theme).not.toBe(renderToStaticMarkup(StyleIcons.opacity))
    expect(theme).not.toMatch(/<circle[^>]*r="6.5"/)
    expect(theme).toContain('stroke-width="1.75"')
  })
})

describe("mode pill", () => {
  it("always offers a way out of zen and view mode", () => {
    expect(html(ModePill, { mode: "zen", onExit: noop })).toContain("Exit zen")
    expect(html(ModePill, { mode: "view", onExit: noop })).toMatch(/View mode.*Edit/)
  })
})

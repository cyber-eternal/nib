import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Opts = Record<string, unknown> & { items?: Node[]; accelerator?: string; action?: () => void }
interface Node {
  kind: "menu" | "submenu" | "item" | "predefined"
  opts: Opts
  children: Node[]
  [k: string]: unknown
}

const created = { menus: [] as Node[] }
const make = (kind: Node["kind"], opts: Opts): Node => {
  const node: Node = {
    kind,
    opts,
    children: [...(opts.items ?? [])],
    close: vi.fn(async () => {}),
    setAsAppMenu: vi.fn(async () => null),
    setAsWindowsMenuForNSApp: vi.fn(async () => {}),
    setAsHelpMenuForNSApp: vi.fn(async () => {}),
    removeAt: vi.fn(async (i: number) => node.children.splice(i, 1)[0] ?? null),
    insert: vi.fn(async (item: Node, i: number) => void node.children.splice(i, 0, item)),
    items: vi.fn(async () => [...node.children]),
    remove: vi.fn(async (item: Node) => void node.children.splice(node.children.indexOf(item), 1)),
    append: vi.fn(async (items: Node[]) => void node.children.push(...items)),
  }
  if (kind === "menu") created.menus.push(node)
  return node
}

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: async (o: Opts) => make("menu", o) },
  Submenu: { new: async (o: Opts) => make("submenu", o) },
  MenuItem: { new: async (o: Opts) => make("item", o) },
  PredefinedMenuItem: { new: async (o: Opts) => make("predefined", o) },
}))

const docListeners = new Map<string, ((e: unknown) => void)[]>()
const fakeDocument = {
  activeElement: { tagName: "BODY" } as unknown,
  addEventListener: (type: string, l: (e: unknown) => void) => {
    docListeners.set(type, [...(docListeners.get(type) ?? []), l])
  },
}
const fire = (type: string, e: unknown = {}) => {
  for (const l of docListeners.get(type) ?? []) l(e)
}
const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)"
const LINUX_UA = "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/605.1.15 (KHTML, like Gecko)"
const settle = () => new Promise((r) => setTimeout(r, 0))

const load = async () => {
  vi.resetModules()
  return import("../../../apps/desktop/src/menu")
}

const flatten = (node: Node): Node[] => [node, ...node.children.flatMap(flatten)]
const submenu = (menu: Node, text: string) => menu.children.find((c) => c.opts.text === text)!

beforeEach(() => {
  created.menus.length = 0
  docListeners.clear()
  fakeDocument.activeElement = { tagName: "BODY" }
  vi.stubGlobal("document", fakeDocument)
  vi.stubGlobal("navigator", { userAgent: MAC_UA })
})

afterEach(() => vi.unstubAllGlobals())

describe("native menu install", () => {
  it("builds the menu once and routes commands to the latest handler", async () => {
    const { installAppMenu } = await load()
    const first = vi.fn()
    const second = vi.fn()
    await installAppMenu(first)
    await installAppMenu(second)
    await installAppMenu(second)
    expect(created.menus).toHaveLength(1)
    const save = flatten(created.menus[0]!).find((n) => n.opts.id === "file.save")!
    save.opts.action!()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith("file.save")
  })
})

describe("menu accelerators", () => {
  it("binds only Cmd shortcuts, so bare keys and Option combos reach text fields", async () => {
    const { installAppMenu } = await load()
    await installAppMenu(() => {})
    const accelerators = flatten(created.menus[0]!)
      .map((n) => n.opts.accelerator)
      .filter((a): a is string => typeof a === "string")
    expect(accelerators.length).toBeGreaterThan(10)
    for (const a of accelerators) expect(a).toMatch(/^CmdOrCtrl\+/)
  })

  it("uses native Cut, Copy and Paste so WebKit fires DOM clipboard events", async () => {
    const { installAppMenu } = await load()
    await installAppMenu(() => {})
    const edit = submenu(created.menus[0]!, "Edit")
    const predefined = edit.children.filter((c) => c.kind === "predefined").map((c) => c.opts.item)
    expect(predefined).toEqual(expect.arrayContaining(["Cut", "Copy", "Paste"]))
    const ids = edit.children.map((c) => c.opts.id)
    expect(ids).not.toContain("edit.cut")
    expect(ids).not.toContain("edit.copy")
    expect(ids).not.toContain("edit.paste")
  })

  it("replaces the predefined Quit with an item the shell guards", async () => {
    const { installAppMenu } = await load()
    await installAppMenu(() => {})
    const all = flatten(created.menus[0]!)
    expect(all.some((n) => n.kind === "predefined" && n.opts.item === "Quit")).toBe(false)
    const quit = all.find((n) => n.opts.id === "app.quit")!
    expect(quit.opts.accelerator).toBe("CmdOrCtrl+Q")
    expect(quit.opts.action).toBeUndefined()
  })
})

describe("Edit menu follows focus", () => {
  it("swaps in native Undo, Redo and Select All while a text field has focus", async () => {
    const { installAppMenu } = await load()
    const emit = vi.fn()
    await installAppMenu(emit)
    const menu = created.menus[0]!
    const canvasEdit = menu.children[2]!
    expect(canvasEdit.children[0]!.opts.id).toBe("edit.undo")

    fakeDocument.activeElement = { tagName: "TEXTAREA" }
    fire("focusin")
    await settle()
    const fieldEdit = menu.children[2]!
    expect(fieldEdit).not.toBe(canvasEdit)
    const native = fieldEdit.children.filter((c) => c.kind === "predefined").map((c) => c.opts.item)
    expect(native).toEqual(expect.arrayContaining(["Undo", "Redo", "SelectAll", "Cut", "Copy", "Paste"]))
    for (const n of flatten(fieldEdit)) expect(n.opts.accelerator).toBeUndefined()

    fakeDocument.activeElement = { tagName: "BODY" }
    fire("focusout")
    await settle()
    await settle()
    expect(menu.children[2]).toBe(canvasEdit)
  })

  it("enables native clipboard items on the canvas, but leaves fields alone", async () => {
    const { installAppMenu } = await load()
    await installAppMenu(() => {})
    const onCanvas = { preventDefault: vi.fn() }
    fire("beforepaste", onCanvas)
    expect(onCanvas.preventDefault).toHaveBeenCalled()
    fakeDocument.activeElement = { tagName: "INPUT", type: "text" }
    const inField = { preventDefault: vi.fn() }
    fire("beforecopy", inField)
    expect(inField.preventDefault).not.toHaveBeenCalled()
  })
})

describe("Open Recent", () => {
  it("labels duplicates with their folder and opens through the hook", async () => {
    const { installAppMenu, updateRecentMenu, recentLabels } = await load()
    expect(recentLabels(["/a/x.nibd", "/b/x.nibd", "/c/y.excalidraw"])).toEqual([
      "x.nibd — a",
      "x.nibd — b",
      "y.excalidraw",
    ])
    const openRecent = vi.fn()
    const clearRecent = vi.fn()
    const emit = vi.fn()
    await installAppMenu(emit, { recent: [], openRecent, clearRecent })
    const recent = flatten(created.menus[0]!).find((n) => n.opts.text === "Open Recent")!
    expect(recent.children.map((c) => c.opts.text)).toEqual(["Clear Menu"])

    await updateRecentMenu(["/docs/plan.nibd"])
    expect(recent.children.map((c) => c.opts.text)).toEqual(["plan.nibd", undefined, "Clear Menu"])
    recent.children[0]!.opts.action!()
    expect(openRecent).toHaveBeenCalledWith("/docs/plan.nibd")
    recent.children[2]!.opts.action!()
    expect(clearRecent).toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith("file.clearRecent")
  })
})

describe("tabs", () => {
  it("opens, closes and reopens tabs from File, and steps through them from Window", async () => {
    const { installAppMenu } = await load()
    const emit = vi.fn()
    await installAppMenu(emit)
    const menu = created.menus[0]!
    const file = submenu(menu, "File").children.map((c) => c.opts)
    expect(file.find((o) => o.id === "file.new")).toMatchObject({
      text: "New Tab",
      accelerator: "CmdOrCtrl+N",
    })
    expect(file.find((o) => o.id === "file.closeTab")).toMatchObject({ accelerator: "CmdOrCtrl+W" })
    expect(file.find((o) => o.id === "file.reopenClosedTab")).toMatchObject({
      text: "Reopen Closed Tab",
      accelerator: "CmdOrCtrl+Shift+T",
    })
    const windowMenu = submenu(menu, "Window").children.map((c) => c.opts)
    expect(windowMenu.find((o) => o.id === "view.nextTab")).toMatchObject({
      accelerator: "CmdOrCtrl+Shift+]",
    })
    expect(windowMenu.find((o) => o.id === "view.previousTab")).toMatchObject({
      accelerator: "CmdOrCtrl+Shift+[",
    })
    for (const id of ["file.closeTab", "file.reopenClosedTab", "view.nextTab"]) {
      flatten(menu).find((n) => n.opts.id === id)!.opts.action!()
      expect(emit).toHaveBeenLastCalledWith(id)
    }
  })

  it("puts the tab stepping in View on Linux", async () => {
    vi.stubGlobal("navigator", { userAgent: LINUX_UA })
    const { installAppMenu } = await load()
    await installAppMenu(() => {})
    const view = submenu(created.menus[0]!, "View").children.map((c) => c.opts.id)
    expect(view).toEqual(expect.arrayContaining(["view.nextTab", "view.previousTab"]))
  })
})

describe("app menu", () => {
  it("names the app Nib in the menu bar, About, Hide and Quit", async () => {
    const { installAppMenu } = await load()
    await installAppMenu(() => {}, { version: "0.4.2" })
    const app = created.menus[0]!.children[0]!
    expect(app.opts.text).toBe("Nib")
    const texts = flatten(app).map((n) => n.opts.text)
    expect(texts).toEqual(expect.arrayContaining(["About Nib", "Hide Nib", "Quit Nib"]))
    expect(flatten(app).find((n) => n.opts.item === "Hide")!.opts.text).toBe("Hide Nib")
  })

  it("shows the real version in About and Check for Updates only when the build has a feed", async () => {
    const { installAppMenu } = await load()
    await installAppMenu(() => {}, { version: "0.4.2" })
    const app = created.menus[0]!.children[0]!
    expect(app.children[0]!.opts.item).toEqual({ About: { name: "Nib", version: "0.4.2" } })
    expect(flatten(app).some((n) => n.opts.id === "app.checkForUpdates")).toBe(false)

    const again = await load()
    created.menus.length = 0
    const check = vi.fn()
    await again.installAppMenu(() => {}, { version: "0.4.2", checkForUpdates: check })
    const item = flatten(created.menus[0]!).find((n) => n.opts.id === "app.checkForUpdates")!
    expect(item.opts.text).toBe("Check for Updates…")
    item.opts.action!()
    expect(check).toHaveBeenCalled()
  })
})

describe("macOS menu shape", () => {
  it("keeps the app menu, Window menu and AppKit's own items", async () => {
    const { installAppMenu } = await load()
    await installAppMenu(() => {})
    const menu = created.menus[0]!
    expect(menu.children.map((c) => c.opts.text)).toEqual([
      "Nib",
      "File",
      "Edit",
      "View",
      "Arrange",
      "Window",
      "Help",
    ])
    const file = submenu(menu, "File")
    // ⌘W closes a tab, so the window's own close moves to ⇧⌘W and goes through the shell's guard
    expect(file.children.at(-1)!.opts).toMatchObject({ id: "window.close", accelerator: "CmdOrCtrl+Shift+W" })
    expect(file.children.at(-1)!.opts.action).toBeUndefined()
    expect(flatten(menu).some((n) => n.opts.item === "CloseWindow")).toBe(false)
    expect(submenu(menu, "View").children.at(-1)!.opts.item).toBe("Fullscreen")
    expect(flatten(menu).some((n) => n.opts.id === "app.preferences")).toBe(false)
  })

  it("groups the Excalidraw import and export with Export Image", async () => {
    const { installAppMenu } = await load()
    await installAppMenu(() => {})
    const texts = submenu(created.menus[0]!, "File").children.map((c) => c.opts.text ?? c.opts.item)
    const at = texts.indexOf("Export Image (PNG, SVG)…")
    expect(texts.slice(at - 1, at + 4)).toEqual([
      "Separator",
      "Export Image (PNG, SVG)…",
      "Import from Excalidraw (.excalidraw)…",
      "Export to Excalidraw (.excalidraw)…",
      "Separator",
    ])
  })
})

describe("Linux and Windows menu shape", () => {
  beforeEach(() => vi.stubGlobal("navigator", { userAgent: LINUX_UA }))

  it("detects the platform from the user agent", async () => {
    const { detectMenuPlatform } = await load()
    expect(detectMenuPlatform(MAC_UA)).toBe("macos")
    expect(detectMenuPlatform(LINUX_UA)).toBe("linux")
    expect(detectMenuPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows")
  })

  it("has no app menu: File ends with Quit, Edit with Preferences, Help with About", async () => {
    const { installAppMenu } = await load()
    await installAppMenu(() => {}, { version: "0.4.2" })
    const menu = created.menus[0]!
    expect(menu.children.map((c) => c.opts.text)).toEqual(["File", "Edit", "View", "Arrange", "Help"])
    const all = flatten(menu)
    for (const macOnly of [
      "Services",
      "Hide",
      "HideOthers",
      "ShowAll",
      "BringAllToFront",
      "CloseWindow",
      "Fullscreen",
    ]) {
      expect(all.some((n) => n.opts.item === macOnly)).toBe(false)
    }

    const file = submenu(menu, "File").children
    expect(file.at(-2)!.opts).toMatchObject({
      id: "window.close",
      text: "Close Window",
      accelerator: "CmdOrCtrl+Shift+W",
    })
    expect(file.at(-1)!.opts).toMatchObject({ id: "app.quit", text: "Quit", accelerator: "CmdOrCtrl+Q" })
    expect(file.at(-1)!.opts.action).toBeUndefined()

    const edit = submenu(menu, "Edit").children
    expect(edit.at(-1)!.opts).toMatchObject({ id: "app.preferences", accelerator: "CmdOrCtrl+," })

    const view = submenu(menu, "View").children
    expect(view.at(-1)!.opts).toMatchObject({ id: "window.fullscreen", accelerator: "F11" })
    expect(view.at(-1)!.opts.action).toBeUndefined()

    const help = submenu(menu, "Help").children
    expect(help[0]!.opts.id).toBe("help.shortcuts")
    expect(help.at(-1)!.opts).toMatchObject({ text: "About Nib" })
    expect((help.at(-1)!.opts.item as { About: { name: string; version: string } }).About).toMatchObject({
      name: "Nib",
      version: "0.4.2",
    })
  })

  it("routes Preferences to the editor and keeps every shortcut on Ctrl except F11", async () => {
    const { installAppMenu } = await load()
    const emit = vi.fn()
    await installAppMenu(emit)
    const all = flatten(created.menus[0]!)
    all.find((n) => n.opts.id === "app.preferences")!.opts.action!()
    expect(emit).toHaveBeenCalledWith("app.preferences")
    const accelerators = all.map((n) => n.opts.accelerator).filter((a): a is string => typeof a === "string")
    for (const a of accelerators) expect(a === "F11" || a.startsWith("CmdOrCtrl+")).toBe(true)
  })

  it("puts Check for Updates in Help and swaps the Edit menu at its own index", async () => {
    const { installAppMenu } = await load()
    await installAppMenu(() => {}, { checkForUpdates: vi.fn() })
    const menu = created.menus[0]!
    expect(flatten(submenu(menu, "Help")).some((n) => n.opts.id === "app.checkForUpdates")).toBe(true)
    const canvasEdit = menu.children[1]!
    fakeDocument.activeElement = { tagName: "TEXTAREA" }
    fire("focusin")
    await settle()
    expect(menu.children[1]).not.toBe(canvasEdit)
    expect(menu.children[1]!.opts.text).toBe("Edit")
    expect(menu.children.map((c) => c.opts.text)).toEqual(["File", "Edit", "View", "Arrange", "Help"])
  })
})

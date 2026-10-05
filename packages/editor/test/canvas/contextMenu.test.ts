import { EditorCore, type NibElement, newElement } from "@nib/core"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import {
  type ContextEntry,
  ContextMenu,
  type ContextMenuOptions,
  buildContextItems,
  contextMenuKind,
  toMenuSections,
} from "../../src/ui/ContextMenu"

const noop = () => {}

const allCallbacks: ContextMenuOptions = {
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
  onCopyText: noop,
}

const ids = (items: readonly ContextEntry[]) =>
  items.filter((i) => i !== "sep").map((i) => (i as { id?: string }).id)

const add = (core: EditorCore, init: Partial<NibElement> & { type?: NibElement["type"] } = {}) => {
  const { type = "rectangle", ...rest } = init
  const el = newElement(type, { x: 0, y: 0, width: 100, height: 80, index: core.scene.nextIndex(), ...rest })
  core.scene.insert(el)
  return core.scene.get(el.id)!
}

const tags = (markup: string, tag: string): Record<string, string>[] =>
  [...markup.matchAll(new RegExp(`<${tag}([^>]*)>`, "g"))].map(([, attrs]) => {
    const out: Record<string, string> = {}
    for (const [, k, v] of attrs!.matchAll(/([\w-]+)="([^"]*)"/g)) out[k!] = v!
    return out
  })

const render = (items: readonly ContextEntry[]) => {
  vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 800 })
  try {
    return renderToStaticMarkup(createElement(ContextMenu, { x: 10, y: 10, items, onClose: noop }))
  } finally {
    vi.unstubAllGlobals()
  }
}

describe("context menu item sets", () => {
  it("offers board items on empty board, with every entry a menuitem", () => {
    const core = new EditorCore()
    const items = buildContextItems(core, { ...allCallbacks, target: { element: null } })
    expect(contextMenuKind(core, { target: { element: null } })).toBe("canvas")
    expect(ids(items)).toEqual(
      expect.arrayContaining(["paste", "selectAll", "grid", "snap", "zen", "viewMode"]),
    )
    expect(ids(items)).not.toContain("delete")
    const markup = render(items)
    const buttons = tags(markup, "button")
    expect(buttons.length).toBe(items.filter((i) => i !== "sep").length)
    for (const b of buttons) expect(b.role).toBe("menuitem")
    expect(tags(markup, "div").some((d) => d.role === "menu")).toBe(true)
  })

  it("keeps the legacy hasSelection switch for callers without a target", () => {
    const core = new EditorCore()
    expect(contextMenuKind(core, { hasSelection: false })).toBe("canvas")
    const rect = add(core)
    core.selectElements([rect.id])
    expect(contextMenuKind(core, { hasSelection: true })).toBe("element")
  })

  it("offers selection actions, with Delete isolated at the end in danger colour", () => {
    const core = new EditorCore()
    const rect = add(core)
    core.selectElements([rect.id])
    const items = buildContextItems(core, { ...allCallbacks, target: { element: rect } })
    const list = ids(items)
    expect(list).toEqual(
      expect.arrayContaining(["cut", "copy", "duplicate", "lock", "copyElementLink", "link"]),
    )
    expect(list[list.length - 1]).toBe("delete")
    expect(list).not.toContain("group")
    const sections = toMenuSections(items)
    const last = sections[sections.length - 1]!
    expect(last.isolated).toBe(true)
    expect(last.items.map((i) => i.id)).toEqual(["delete"])
    expect(last.items[0]!.danger).toBe(true)
  })

  it("offers Group only for several elements and Ungroup for a group", () => {
    const core = new EditorCore()
    const a = add(core, { groupIds: ["g"] })
    const b = add(core, { x: 200, groupIds: ["g"] })
    core.selectElements([a.id, b.id])
    const list = ids(buildContextItems(core, { ...allCallbacks, target: { element: a } }))
    expect(list).toContain("group")
    expect(list).toContain("ungroup")
  })

  it("offers Unlock for a locked element under the pointer", () => {
    const core = new EditorCore()
    const locked = add(core, { locked: true })
    const opts = { ...allCallbacks, target: { element: locked } }
    expect(contextMenuKind(core, opts)).toBe("locked")
    const items = buildContextItems(core, opts)
    expect(ids(items)[0]).toBe("unlock")
    const unlock = items.find((i) => i !== "sep" && i.id === "unlock") as { run(): void }
    unlock.run()
    expect(core.scene.get(locked.id)!.locked).toBe(false)
  })

  it("is read-only in view mode", () => {
    const core = new EditorCore()
    const rect = add(core, { link: "https://example.com" })
    core.toggleViewMode()
    const items = buildContextItems(core, { ...allCallbacks, target: { element: rect } })
    const list = ids(items)
    expect(contextMenuKind(core, {})).toBe("view")
    for (const id of ["cut", "paste", "delete", "duplicate", "lock", "group", "selectAll", "tidy"]) {
      expect(list).not.toContain(id)
    }
    expect(list).toEqual(expect.arrayContaining(["openLink", "copyElementLink", "zoomFit", "exitViewMode"]))
  })

  it("offers frame actions for a selected frame", () => {
    const core = new EditorCore()
    const frame = add(core, { type: "frame", width: 400, height: 300, name: "F" })
    add(core, { x: 20, y: 20, width: 40, height: 40, frameId: frame.id })
    core.selectElements([frame.id])
    const list = ids(buildContextItems(core, { ...allCallbacks, target: { element: frame } }))
    expect(list).toEqual(
      expect.arrayContaining([
        "renameFrame",
        "selectFrameChildren",
        "presentFrom",
        "deleteFrameKeep",
        "delete",
      ]),
    )
    expect(list).not.toContain("wrapInFrame")
  })

  it("offers Crop for an image and Edit points for a line", () => {
    const core = new EditorCore()
    const img = add(core, { type: "image" })
    core.selectElements([img.id])
    expect(ids(buildContextItems(core, { ...allCallbacks, target: { element: img } }))).toContain("crop")
    const line = add(core, {
      type: "line",
      x: 300,
      points: [
        [0, 0],
        [50, 50],
      ],
    })
    core.selectElements([line.id])
    expect(ids(buildContextItems(core, { ...allCallbacks, target: { element: line } }))).toContain(
      "editPoints",
    )
  })

  it("leaves out entries whose callback the caller did not pass", () => {
    const core = new EditorCore()
    const rect = add(core)
    core.selectElements([rect.id])
    const list = ids(buildContextItems(core, { target: { element: rect } }))
    expect(list).not.toContain("cut")
    expect(list).not.toContain("copyElementLink")
    expect(list).toContain("delete")
  })

  it("never starts, ends or doubles a separator", () => {
    const core = new EditorCore()
    const items = buildContextItems(core, { target: { element: null } })
    expect(items[0]).not.toBe("sep")
    expect(items[items.length - 1]).not.toBe("sep")
    items.forEach((it, i) => {
      if (it === "sep") expect(items[i + 1]).not.toBe("sep")
    })
  })
})

describe("toMenuSections", () => {
  it("splits at separators and keeps legacy display shortcuts", () => {
    const sections = toMenuSections([
      { label: "Cut", shortcut: "⌘X", run: noop },
      "sep",
      { label: "Delete", danger: true, run: noop },
    ])
    expect(sections).toHaveLength(2)
    expect(sections[0]!.items[0]).toMatchObject({ id: "Cut", label: "Cut", shortcut: "⌘X" })
    expect(sections[1]!.isolated).toBe(true)
  })
})

describe("menu outcomes", () => {
  const entry = (items: readonly ContextEntry[], id: string) =>
    items.find((i) => i !== "sep" && i.id === id) as Exclude<ContextEntry, "sep">

  it("Lock says how to unlock, because it clears the selection with the bar", () => {
    const core = new EditorCore()
    const rect = add(core)
    core.selectElements([rect.id])
    const items = buildContextItems(core, { ...allCallbacks, target: { element: rect } })
    expect(entry(items, "lock").notice).toBe("Locked. Right-click it to unlock.")
    const notify = vi.fn()
    const lock = toMenuSections(items, notify)
      .flatMap((s) => s.items)
      .find((i) => i.id === "lock")!
    lock.onSelect()
    expect(core.scene.get(rect.id)!.locked).toBe(true)
    expect(notify).toHaveBeenCalledWith("Locked. Right-click it to unlock.")
  })

  it("fits content clear of the tray and the top row, as Shift+1 does", () => {
    const core = new EditorCore()
    core.setViewportSize(800, 442)
    const rect = add(core, { x: 0, y: 0, width: 400, height: 400 })
    const fit = (onlySelection: boolean) => {
      const items = buildContextItems(core, {
        ...allCallbacks,
        target: { element: onlySelection ? rect : null },
      })
      entry(items, onlySelection ? "zoomSelection" : "zoomFit").run()
      return core.appState.viewport
    }
    for (const onlySelection of [false, true]) {
      core.setAppState({ viewport: { zoom: 1, scrollX: 0, scrollY: 0 } })
      if (onlySelection) core.selectElements([rect.id])
      const vp = fit(onlySelection)
      // the drawing's bottom edge, on screen, stays above the tray and the style bar (132px)
      const bottom = (rect.y + rect.height + vp.scrollY) * vp.zoom
      expect(bottom).toBeLessThanOrEqual(442 - 132 + 0.5)
      expect((rect.y + vp.scrollY) * vp.zoom).toBeGreaterThanOrEqual(64 - 0.5)
    }
  })
})

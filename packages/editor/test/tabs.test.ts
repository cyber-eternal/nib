import { EditorCore, newElement, serializeNib, setTextMeasurer } from "@nib/core"
import type { RestoredSession, SaveChoice, SessionTab } from "@nib/platform"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import { TabsController, nextUntitled, untitledName } from "../src/document/tabs"
import { createFakePlatform } from "./fakePlatform"

beforeAll(() => setTextMeasurer((t) => t.length * 10))
afterEach(() => vi.useRealTimers())

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0))
}

const draw = (core: EditorCore, x = 0) =>
  core.transact(() =>
    core.scene.insert(
      newElement("rectangle", { x, y: 0, width: 40, height: 30, index: core.scene.nextIndex() }),
    ),
  )

const drawing = (x = 0) => {
  const core = new EditorCore()
  draw(core, x)
  return serializeNib(core.scene.getElements(), core.appState, {})
}

const setup = (
  opts: {
    session?: RestoredSession | null
    saveAll?: SaveChoice
    multi?: { path: string; contents: string }[]
  } = {},
) => {
  const platform = createFakePlatform()
  const saved: { tabs: SessionTab[]; active: number }[] = []
  platform.session = {
    restore: async () => opts.session ?? null,
    save: async (tabs, active) => {
      saved.push({ tabs, active })
    },
  }
  const asked: string[][] = []
  if (opts.saveAll) {
    const answer = opts.saveAll
    platform.dialogs.askSaveAll = async (names) => {
      asked.push(names)
      return answer
    }
  }
  if (opts.multi) {
    const picked = opts.multi
    platform.fs.openDocuments = async () =>
      picked.map((p) => ({ path: p.path, name: p.path.split("/").pop()!, contents: p.contents }))
  }
  const tabs = new TabsController(platform, { autosaveMs: 10, sessionDelayMs: 5 })
  const detach = tabs.attach()
  return { platform, tabs, detach, saved, asked }
}

const names = (tabs: TabsController) => tabs.getState().tabs.map((t) => t.name)

describe("tabs", () => {
  test("number untitled tabs with the lowest free number", () => {
    expect(nextUntitled([])).toBe(1)
    expect(nextUntitled([1, 3])).toBe(2)
    expect(untitledName(1)).toBe("Untitled")
    expect(untitledName(2)).toBe("Untitled 2")
  })

  test("each tab keeps its own drawing, undo history and recovery slot while another is in front", async () => {
    const { tabs, platform } = setup()
    await tabs.whenLaunched()
    const first = tabs.active
    draw(first.core)
    const second = tabs.newTab()
    expect(tabs.active).toBe(second)
    expect(names(tabs)).toEqual(["Untitled", "Untitled 2"])
    expect(second.core).not.toBe(first.core)
    expect(second.core.scene.getNonDeleted()).toHaveLength(0)
    expect(second.core.history.canUndo()).toBe(false)

    tabs.activate(first.id)
    expect(tabs.active.core.scene.getNonDeleted()).toHaveLength(1)
    expect(first.core.history.canUndo()).toBe(true)
    await new Promise((r) => setTimeout(r, 30))
    expect(platform.files.has(`/appdata/recovery/${first.id}.nibd`)).toBe(true)
    expect(platform.files.has(`/appdata/recovery/${second.id}.nibd`)).toBe(false)
    expect(platform.files.has("/appdata/recovery/current.nibd")).toBe(false)
  })

  test("the window shows the active tab's title and the edited dot while any tab is unsaved", async () => {
    const { tabs, platform } = setup()
    await tabs.whenLaunched()
    const first = tabs.active
    draw(first.core)
    await settle()
    expect(platform.title).toBe("• Untitled — Nib")
    expect(platform.edited).toBe(true)
    tabs.newTab()
    await settle()
    expect(platform.title).toBe("Untitled 2 — Nib")
    expect(platform.edited).toBe(true)
    tabs.activate(first.id)
    await settle()
    expect(platform.title).toBe("• Untitled — Nib")
  })

  test("an already open file brings its tab forward instead of opening twice", async () => {
    const { tabs, platform } = setup()
    platform.files.set("/d/a.nibd", drawing())
    await tabs.whenLaunched()
    expect(await tabs.openPath("/d/a.nibd")).toBeNull()
    const a = tabs.active
    tabs.newTab()
    expect(await tabs.openPath("/d/a.nibd")).toBeNull()
    expect(tabs.active).toBe(a)
    expect(tabs.tabs).toHaveLength(2)
  })

  test("the first file goes into an untouched Untitled; later ones get tabs of their own", async () => {
    const { tabs, platform } = setup()
    platform.files.set("/d/a.nibd", drawing())
    platform.files.set("/d/b.nibd", drawing(50))
    await tabs.whenLaunched()
    const untouched = tabs.active
    await tabs.openPath("/d/a.nibd")
    expect(tabs.active).toBe(untouched)
    expect(tabs.tabs).toHaveLength(1)
    await tabs.openPath("/d/b.nibd")
    expect(tabs.tabs).toHaveLength(2)
    expect(names(tabs)).toEqual(["a.nibd", "b.nibd"])
  })

  test("a drawn-on Untitled is never taken over", async () => {
    const { tabs, platform } = setup()
    platform.files.set("/d/a.nibd", drawing())
    await tabs.whenLaunched()
    draw(tabs.active.core)
    await tabs.openPath("/d/a.nibd")
    expect(tabs.tabs).toHaveLength(2)
  })

  test("a file that fails to open leaves no empty tab behind", async () => {
    const { tabs, platform } = setup()
    platform.files.set("/d/bad.nibd", "not a drawing")
    await tabs.whenLaunched()
    draw(tabs.active.core)
    expect(await tabs.openPath("/d/bad.nibd")).toMatch(/isn't a Nib/)
    expect(tabs.tabs).toHaveLength(1)
  })

  test("Open… opens every picked drawing in its own tab", async () => {
    const { tabs } = setup({
      multi: [
        { path: "/d/a.nibd", contents: drawing() },
        { path: "/d/b.nibd", contents: drawing(50) },
      ],
    })
    await tabs.whenLaunched()
    expect(await tabs.open()).toBeNull()
    expect(names(tabs)).toEqual(["a.nibd", "b.nibd"])
    expect(tabs.getState().tabs.map((t) => t.path)).toEqual(["/d/a.nibd", "/d/b.nibd"])
  })

  test("files opened from the OS before the session is back wait for it", async () => {
    const platform = createFakePlatform()
    platform.files.set("/d/a.nibd", drawing())
    let release = () => {}
    const tabs = new TabsController(platform)
    tabs.attach(() => new Promise<void>((r) => (release = r)))
    for (const h of platform.openFileHandlers) h("/d/a.nibd")
    await settle()
    expect(tabs.active.doc.path).toBeNull()
    release()
    await tabs.whenLaunched()
    expect(tabs.active.doc.path).toBe("/d/a.nibd")
  })

  test("closing a tab with unsaved changes asks, and Cancel keeps it", async () => {
    const { tabs, platform } = setup()
    await tabs.whenLaunched()
    const first = tabs.active
    tabs.newTab()
    draw(first.core)
    platform.askSaveResult = "cancel"
    expect(await tabs.close(first.id)).toBe(false)
    expect(tabs.tabs).toHaveLength(2)
    expect(tabs.active).toBe(first)
    platform.askSaveResult = "discard"
    expect(await tabs.close(first.id)).toBe(true)
    expect(tabs.tabs).toHaveLength(1)
    expect(platform.dialogCalls.filter((c) => c.kind === "askSave")).toHaveLength(2)
  })

  test("closing the active tab shows the one to its right, else the one to its left", async () => {
    const { tabs } = setup()
    await tabs.whenLaunched()
    const [a, b, c] = [tabs.active, tabs.newTab(), tabs.newTab()]
    for (const t of [a, b, c]) draw(t.core)
    for (const t of [a, b, c]) await t.doc.save()
    tabs.activate(b.id)
    await tabs.close(b.id)
    expect(tabs.active).toBe(c)
    await tabs.close(c.id)
    expect(tabs.active).toBe(a)
  })

  test("closing the last tab leaves an empty Untitled", async () => {
    const { tabs, platform } = setup()
    platform.files.set("/d/a.nibd", drawing())
    await tabs.whenLaunched()
    await tabs.openPath("/d/a.nibd")
    await tabs.close(tabs.active.id)
    expect(tabs.tabs).toHaveLength(1)
    expect(tabs.isUntouched(tabs.active)).toBe(true)
    expect(names(tabs)).toEqual(["Untitled"])
  })

  test("Close Others, Close to the Right and Close Saved", async () => {
    const { tabs, platform } = setup()
    for (const n of ["a", "b", "c", "d"]) platform.files.set(`/d/${n}.nibd`, drawing())
    await tabs.whenLaunched()
    for (const n of ["a", "b", "c", "d"]) await tabs.openPath(`/d/${n}.nibd`)
    const [a, b] = tabs.tabs
    await tabs.closeToTheRight(b!.id)
    expect(names(tabs)).toEqual(["a.nibd", "b.nibd"])
    await tabs.closeOthers(a!.id)
    expect(names(tabs)).toEqual(["a.nibd"])

    tabs.newTab()
    draw(tabs.active.core)
    await tabs.openPath("/d/c.nibd")
    await tabs.closeSaved()
    expect(names(tabs)).toEqual(["Untitled"])
    expect(platform.dialogCalls.filter((c) => c.kind === "askSave")).toHaveLength(0)
  })

  test("Reopen Closed Tab brings back the last closed tab in its place, slot and view", async () => {
    const { tabs, platform } = setup()
    platform.files.set("/d/a.nibd", drawing())
    platform.files.set("/d/b.nibd", drawing())
    await tabs.whenLaunched()
    await tabs.openPath("/d/a.nibd")
    await tabs.openPath("/d/b.nibd")
    const a = tabs.tabs[0]!
    a.core.setAppState({ viewport: { scrollX: 120, scrollY: -40, zoom: 2 } })
    await tabs.close(a.id)
    expect(names(tabs)).toEqual(["b.nibd"])
    expect(await tabs.reopenClosed()).toBe(true)
    expect(names(tabs)).toEqual(["a.nibd", "b.nibd"])
    expect(tabs.active.id).toBe(a.id)
    expect(tabs.active.core.appState.viewport).toEqual({ scrollX: 120, scrollY: -40, zoom: 2 })
    expect(await tabs.reopenClosed()).toBe(false)
  })

  test("tabs reorder, cycle and jump by position", async () => {
    const { tabs } = setup()
    await tabs.whenLaunched()
    const [a, b, c] = [tabs.active, tabs.newTab(), tabs.newTab()]
    tabs.move(c.id, 0)
    expect(tabs.tabs).toEqual([c, a, b])
    expect(tabs.active).toBe(c)
    tabs.cycle(1)
    expect(tabs.active).toBe(a)
    tabs.cycle(-1)
    tabs.cycle(-1)
    expect(tabs.active).toBe(b)
    tabs.goTo(2)
    expect(tabs.active).toBe(a)
    tabs.goTo(9)
    expect(tabs.active).toBe(b)
  })
})

describe("closing the window over every tab", () => {
  const twoDirty = async (saveAll: SaveChoice) => {
    const env = setup({ saveAll })
    await env.tabs.whenLaunched()
    draw(env.tabs.active.core)
    draw(env.tabs.newTab().core)
    await new Promise((r) => setTimeout(r, 30))
    return env
  }

  test("asks once about every unsaved tab, and Cancel keeps the window", async () => {
    const { tabs, platform, asked } = await twoDirty("cancel")
    expect(await platform.closeHandlers[0]!()).toBe(false)
    expect(asked).toEqual([["Untitled", "Untitled 2"]])
    expect(tabs.tabs.every((t) => t.doc.dirty)).toBe(true)
  })

  test("Don't Save drops every recovery copy and lets the window close", async () => {
    const { tabs, platform } = await twoDirty("discard")
    const slots = tabs.tabs.map((t) => t.id)
    expect(slots.every((s) => platform.files.has(`/appdata/recovery/${s}.nibd`))).toBe(true)
    expect(await platform.closeHandlers[0]!()).toBe(true)
    expect(slots.some((s) => platform.files.has(`/appdata/recovery/${s}.nibd`))).toBe(false)
  })

  test("Save All saves each tab and stops if a save is cancelled", async () => {
    const { tabs, platform } = await twoDirty("save")
    let n = 0
    platform.fs.saveDocument = async (contents, path) => {
      n++
      if (n === 2) return null
      const target = path ?? `/d/saved-${n}.nibd`
      platform.files.set(target, contents)
      return target
    }
    expect(await platform.closeHandlers[0]!()).toBe(false)
    expect(tabs.tabs[0]!.doc.dirty).toBe(false)
    expect(tabs.tabs[1]!.doc.dirty).toBe(true)
  })

  test("one unsaved tab gets the usual question", async () => {
    const { tabs, platform, asked } = setup({ saveAll: "cancel" })
    await tabs.whenLaunched()
    draw(tabs.active.core)
    platform.askSaveResult = "discard"
    expect(await platform.closeHandlers[0]!()).toBe(true)
    expect(asked).toEqual([])
    expect(platform.dialogCalls.map((c) => c.kind)).toEqual(["askSave"])
  })
})

describe("session", () => {
  test("restores files, unsaved copies, their views and the tab in front, after the launch", async () => {
    const platform = createFakePlatform()
    platform.files.set("/d/a.nibd", drawing())
    platform.files.set("/appdata/recovery/t2.nibd", drawing(80))
    platform.files.set(
      "/appdata/recovery/t2.meta.json",
      JSON.stringify({ path: null, name: "Untitled 2", dirty: true, savedAt: 1 }),
    )
    const saved: { tabs: SessionTab[]; active: number }[] = []
    platform.session = {
      restore: async () => ({
        tabs: [
          { slot: "t1", open: "/d/a.nibd", viewport: { scrollX: 10, scrollY: 20, zoom: 1.5 } },
          { slot: "t2", open: null, viewport: null },
          { slot: "t3", open: null, viewport: null },
        ],
        active: 1,
        notices: ["“gone.nibd” was moved or deleted, so it wasn't reopened."],
      }),
      save: async (tabs, active) => {
        saved.push({ tabs, active })
      },
    }
    const notices: string[] = []
    const tabs = new TabsController(platform, { sessionDelayMs: 5 })
    tabs.onNotice((m) => notices.push(m))
    tabs.attach()
    await tabs.whenLaunched()
    expect(tabs.tabs.map((t) => t.id)).toEqual(["t1", "t2"])
    expect(tabs.active.id).toBe("t2")
    expect(tabs.active.doc.dirty).toBe(true)
    expect(names(tabs)).toEqual(["a.nibd", "Untitled 2"])
    expect(tabs.tabs[0]!.core.appState.viewport).toEqual({ scrollX: 10, scrollY: 20, zoom: 1.5 })
    expect(notices).toEqual([
      "“gone.nibd” was moved or deleted, so it wasn't reopened.",
      "Recovered unsaved changes from your last session.",
    ])
    await new Promise((r) => setTimeout(r, 30))
    expect(saved.at(-1)).toMatchObject({
      active: 1,
      tabs: [
        { slot: "t1", path: "/d/a.nibd", viewport: { scrollX: 10, scrollY: 20, zoom: 1.5 } },
        { slot: "t2", path: null },
      ],
    })
  })

  test("never overwrites the session before it has been restored", async () => {
    const platform = createFakePlatform()
    const save = vi.fn(async () => {})
    let release = () => {}
    platform.session = { restore: async () => null, save }
    const tabs = new TabsController(platform, { sessionDelayMs: 1 })
    tabs.attach(() => new Promise<void>((r) => (release = r)))
    tabs.newTab()
    await new Promise((r) => setTimeout(r, 20))
    expect(save).not.toHaveBeenCalled()
    release()
    await tabs.whenLaunched()
    await new Promise((r) => setTimeout(r, 20))
    expect(save).toHaveBeenCalled()
  })

  test("records the session before the window closes", async () => {
    const { tabs, platform, saved } = setup()
    await tabs.whenLaunched()
    tabs.newTab()
    expect(await platform.closeHandlers[0]!()).toBe(true)
    expect(saved.at(-1)!.tabs).toHaveLength(2)
    expect(saved.at(-1)!.active).toBe(1)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const DATA = "/Users/u/Library/Application Support/app.nib.desktop"

const commands: Record<string, (args: Record<string, unknown>) => unknown> = {}
const events: Record<string, (e: { payload: unknown }) => unknown> = {}
const invoke = vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => commands[cmd]?.(args))
const focusHandlers: ((e: { payload: boolean }) => void)[] = []
const appWindow = {
  setTitle: vi.fn(async (_title: string) => {}),
  destroy: vi.fn(async () => {}),
  onFocusChanged: vi.fn(async (cb: (e: { payload: boolean }) => void) => {
    focusHandlers.push(cb)
    return () => {}
  }),
}
const dialog = { message: vi.fn(), open: vi.fn(), save: vi.fn() }
const fs = {
  exists: vi.fn(),
  stat: vi.fn(),
  readTextFile: vi.fn(),
  writeFile: vi.fn(async () => {}),
  writeTextFile: vi.fn(async () => {}),
}
const clipboard = {
  readText: vi.fn(),
  writeText: vi.fn(async () => {}),
  writeHtml: vi.fn(async () => {}),
  writeImage: vi.fn(async () => {}),
  readImage: vi.fn(),
}
const openUrl = vi.fn(async () => {})

class FakeChannel<T> {
  onmessage: (m: T) => void = () => {}
}
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (c: string, a?: Record<string, unknown>) => invoke(c, a),
  Channel: FakeChannel,
}))
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, cb: (e: { payload: unknown }) => unknown) => {
    events[name] = cb
    return () => {}
  },
}))
vi.mock("@tauri-apps/api/path", () => ({ appDataDir: async () => DATA }))
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => appWindow }))
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.1.0" }))
vi.mock("@tauri-apps/plugin-dialog", () => dialog)
vi.mock("@tauri-apps/plugin-fs", () => fs)
vi.mock("@tauri-apps/plugin-clipboard-manager", () => clipboard)
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (u: string) => openUrl(u) }))
const menu = {
  installAppMenu: vi.fn(async (_emit: unknown, _hooks: Record<string, unknown>) => {}),
  updateRecentMenu: vi.fn(async () => {}),
}
vi.mock("../../../apps/desktop/src/menu", () => menu)

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

const create = async (pending: string[] = []) => {
  commands.take_pending_opens = () => pending
  commands.recent_list = () => []
  commands.recent_add = (a) => [a.path]
  vi.resetModules()
  const { createTauriPlatform } = await import("../../../apps/desktop/src/tauriPlatform")
  const platform = createTauriPlatform()
  await flush()
  return platform
}

beforeEach(() => {
  for (const k of Object.keys(commands)) delete commands[k]
  for (const k of Object.keys(events)) delete events[k]
  invoke.mockClear()
  appWindow.destroy.mockClear()
  appWindow.setTitle.mockClear()
  focusHandlers.length = 0
  menu.installAppMenu.mockClear()
  for (const m of [fs.stat, fs.exists, fs.readTextFile]) m.mockReset()
  for (const m of [...Object.values(dialog), ...Object.values(fs), ...Object.values(clipboard), openUrl]) {
    m.mockClear()
  }
  vi.stubGlobal("localStorage", undefined)
})

afterEach(() => vi.unstubAllGlobals())

const invoked = (cmd: string) => invoke.mock.calls.filter((c) => c[0] === cmd).map((c) => c[1])

describe("close and quit guard", () => {
  it("tells the shell it is ready only after listening", async () => {
    await create()
    expect(events["nib://guard"]).toBeTypeOf("function")
    expect(invoked("guard_ready")).toHaveLength(1)
  })

  it("acknowledges, asks the document and keeps the window when it refuses", async () => {
    const p = await create()
    p.window.onCloseRequested(async () => false)
    await events["nib://guard"]!({ payload: { id: 7, kind: "close" } })
    expect(invoked("guard_ack")).toEqual([{ id: 7 }])
    expect(appWindow.destroy).not.toHaveBeenCalled()
  })

  it("destroys the window on close and exits on quit once allowed", async () => {
    const p = await create()
    p.window.onCloseRequested(async () => true)
    await events["nib://guard"]!({ payload: { id: 1, kind: "close" } })
    expect(appWindow.destroy).toHaveBeenCalledTimes(1)
    await events["nib://guard"]!({ payload: { id: 2, kind: "quit" } })
    expect(invoked("exit_app")).toHaveLength(1)
  })

  it("answers macOS for Dock Quit and log out, in both directions", async () => {
    const p = await create()
    let keep = true
    p.window.onCloseRequested(async () => !keep)
    await events["nib://guard"]!({ payload: { id: 3, kind: "terminate" } })
    keep = false
    await events["nib://guard"]!({ payload: { id: 4, kind: "terminate" } })
    expect(invoked("terminate_reply")).toEqual([{ allowed: false }, { allowed: true }])
    expect(invoked("exit_app")).toHaveLength(0)
    expect(appWindow.destroy).not.toHaveBeenCalled()
  })

  it("stops consulting an unsubscribed handler", async () => {
    const p = await create()
    const off = p.window.onCloseRequested(async () => false)
    off()
    off()
    await events["nib://guard"]!({ payload: { id: 1, kind: "close" } })
    expect(appWindow.destroy).toHaveBeenCalledTimes(1)
  })
})

describe("Finder opens", () => {
  it("delivers files the shell queued before the webview listened", async () => {
    const p = await create(["/Users/u/Board.NIBD"])
    const seen: string[] = []
    p.onOpenFile!((path) => seen.push(path))
    await flush()
    expect(seen).toEqual(["/Users/u/Board.NIBD"])
  })

  it("delivers later opens through the event", async () => {
    const p = await create()
    const seen: string[] = []
    const off = p.onOpenFile!((path) => seen.push(path))
    events["open-file"]!({ payload: "/x/a.nibd" })
    off()
    events["open-file"]!({ payload: "/x/b.nibd" })
    expect(seen).toEqual(["/x/a.nibd"])
  })
})

describe("native dialogs", () => {
  it("asks Save / Don't Save / Cancel through plugin-dialog message()", async () => {
    const p = await create()
    dialog.message.mockResolvedValueOnce("Save")
    await expect(p.dialogs.askSave("Plan")).resolves.toBe("save")
    expect(dialog.message.mock.calls[0]![1]).toMatchObject({
      buttons: { yes: "Save", no: "Don't Save", cancel: "Cancel" },
    })
    expect(dialog.message.mock.calls[0]![1].title).toContain('"Plan"')
    dialog.message.mockResolvedValueOnce("Don't Save")
    await expect(p.dialogs.askSave("Plan")).resolves.toBe("discard")
    dialog.message.mockResolvedValueOnce("Cancel")
    await expect(p.dialogs.askSave("Plan")).resolves.toBe("cancel")
  })

  it("confirms with custom labels", async () => {
    const p = await create()
    dialog.message.mockResolvedValueOnce("Reset")
    await expect(
      p.dialogs.confirm("Reset the canvas?", { okLabel: "Reset", destructive: true }),
    ).resolves.toBe(true)
    expect(dialog.message.mock.calls[0]![1]).toMatchObject({ kind: "warning", buttons: { ok: "Reset" } })
    dialog.message.mockResolvedValueOnce("Cancel")
    await expect(p.dialogs.confirm("Reset the canvas?", { okLabel: "Reset" })).resolves.toBe(false)
  })
})

describe("links", () => {
  it("hands only web and mail links to the opener", async () => {
    const p = await create()
    await expect(p.openExternal("javascript:alert(1)")).rejects.toThrow()
    await expect(p.openExternal("file:///Applications/Calculator.app")).rejects.toThrow()
    expect(openUrl).not.toHaveBeenCalled()
    await p.openExternal("mailto:a@b.co")
    expect(openUrl).toHaveBeenCalledWith("mailto:a@b.co")
  })
})

describe("saving", () => {
  it("offers .nibd for a drawing, explicitly or inferred from its name", async () => {
    const p = await create()
    const nib = [{ name: "Nib drawing", extensions: ["nibd"] }]
    dialog.save.mockResolvedValueOnce("/Users/u/Untitled.nibd")
    await p.fs.saveDocument("{}", null, "Untitled.nibd", nib)
    expect(dialog.save.mock.calls[0]![0]).toEqual({ defaultPath: "Untitled.nibd", filters: nib })
    dialog.save.mockResolvedValueOnce("/Users/u/Plan.nibd")
    await p.fs.saveDocument("{}", null, "Plan")
    expect(dialog.save.mock.calls[1]![0].filters).toEqual(nib)
  })

  it("opens through the native dialog with the caller's filters and remembers the file", async () => {
    const p = await create()
    const filters = [{ name: "Nib drawing", extensions: ["nibd", "excalidraw"] }]
    dialog.open.mockResolvedValueOnce("/Users/u/Old plan.excalidraw")
    fs.readTextFile.mockResolvedValueOnce('{"type":"excalidraw"}')
    await expect(p.fs.openDocument(filters)).resolves.toEqual({
      path: "/Users/u/Old plan.excalidraw",
      name: "Old plan.excalidraw",
      contents: '{"type":"excalidraw"}',
    })
    expect(dialog.open.mock.calls[0]![0]).toEqual({ multiple: false, directory: false, filters })
    expect(invoked("recent_add")).toEqual([{ path: "/Users/u/Old plan.excalidraw" }])
    dialog.open.mockResolvedValueOnce("/Users/u/New.NIBD")
    fs.readTextFile.mockResolvedValueOnce('{"type":"nib"}')
    await p.fs.openDocument(filters)
    expect(invoked("recent_add")).toEqual([
      { path: "/Users/u/Old plan.excalidraw" },
      { path: "/Users/u/New.NIBD" },
    ])
  })

  it("offers only the format being written", async () => {
    const p = await create()
    dialog.save.mockResolvedValueOnce("/Users/u/diagram.svg")
    await p.fs.saveDocument("<svg/>", null, "diagram.svg")
    expect(dialog.save.mock.calls[0]![0].filters).toEqual([{ name: "SVG image", extensions: ["svg"] }])
    dialog.save.mockResolvedValueOnce("/Users/u/board.excalidraw")
    await p.fs.saveDocument("{}", null, "board.excalidraw")
    expect(dialog.save.mock.calls[1]![0].filters).toEqual([
      { name: "Excalidraw drawing", extensions: ["excalidraw"] },
    ])
  })

  it("adds a missing extension through the shell's scoped grant", async () => {
    const p = await create()
    commands.allow_with_extension = (a) => `${a.path}.${a.ext}`
    dialog.save.mockResolvedValueOnce("/Users/u/diagram")
    await expect(p.fs.saveDocument("{}", null, "diagram.nibd")).resolves.toBe("/Users/u/diagram.nibd")
    expect(invoked("document_write")).toEqual([{ path: "/Users/u/diagram.nibd", contents: "{}" }])
  })

  it("writes documents through the shell's atomic write, never plugin-fs in place", async () => {
    const p = await create()
    await p.fs.saveDocument("{}", "/Users/u/plan.nibd", "plan.nibd")
    await p.fs.writeText("/Users/u/notes.nibd", "x")
    expect(invoked("document_write")).toEqual([
      { path: "/Users/u/plan.nibd", contents: "{}" },
      { path: "/Users/u/notes.nibd", contents: "x" },
    ])
    expect(fs.writeTextFile).not.toHaveBeenCalled()
  })

  it("asks again when a path from an earlier session lost its grant", async () => {
    const p = await create()
    let refused = false
    commands.document_write = () => {
      if (refused) return
      refused = true
      throw "forbidden path: /Users/u/plan.nibd"
    }
    dialog.save.mockResolvedValueOnce("/Users/u/plan.nibd")
    await expect(p.fs.saveDocument("{}", "/Users/u/plan.nibd", "plan.nibd")).resolves.toBe(
      "/Users/u/plan.nibd",
    )
    expect(dialog.save.mock.calls[0]![0].defaultPath).toBe("/Users/u/plan.nibd")
  })

  it("rejects instead of returning null when that re-grant is cancelled", async () => {
    const p = await create()
    commands.document_write = () => {
      throw "forbidden path: /Users/u/plan.nibd"
    }
    dialog.save.mockResolvedValueOnce(null)
    await expect(p.fs.saveDocument("{}", "/Users/u/plan.nibd", "plan.nibd")).rejects.toMatchObject({
      name: "AbortError",
    })
  })

  it("rejects a cancelled image export with an AbortError, as a document save does", async () => {
    const p = await create()
    dialog.save.mockResolvedValueOnce(null)
    await expect(p.fs.saveBinary(new Uint8Array([1]), "board.png", [])).rejects.toMatchObject({
      name: "AbortError",
    })
    expect(fs.writeFile).not.toHaveBeenCalled()
    dialog.save.mockResolvedValueOnce("/Users/u/board.png")
    await expect(p.fs.saveBinary(new Uint8Array([1]), "board.png", [])).resolves.toBe("/Users/u/board.png")
  })

  it("routes app data through the shell and refuses to delete user files", async () => {
    const p = await create()
    expect(await p.fs.appDataDir()).toBe(DATA)
    await p.fs.writeText(`${DATA}/recovery/current.nibd`, "x")
    expect(invoked("appdata_write")).toEqual([{ path: `${DATA}/recovery/current.nibd`, contents: "x" }])
    expect(fs.writeTextFile).not.toHaveBeenCalled()
    await p.fs.remove(`${DATA}/recovery/current.nibd`)
    expect(invoked("appdata_remove")).toHaveLength(1)
    await expect(p.fs.remove("/Users/u/plan.nibd")).rejects.toThrow()
  })
})

describe("clipboard image", () => {
  it("writes PNG bytes through the clipboard plugin", async () => {
    const p = await create()
    await p.clipboard.writeImage!(Promise.resolve(new Uint8Array([137, 80])))
    expect(clipboard.writeImage).toHaveBeenCalledWith(new Uint8Array([137, 80]))
  })

  it("reads no image as null", async () => {
    const p = await create()
    clipboard.readImage.mockRejectedValueOnce(new Error("The clipboard contents were not available"))
    await expect(p.clipboard.readImage!()).resolves.toBeNull()
  })
})

const stubBoot = (boot: unknown) => vi.stubGlobal("window", { __NIB_BOOT__: boot })

describe("native document window", () => {
  it("shows unsaved changes as the close button's edited dot, not a title bullet", async () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit" })
    const p = await create()
    await p.window.setTitle("• plan.nibd — Nib")
    expect(appWindow.setTitle).toHaveBeenLastCalledWith("plan.nibd — Nib")
    await p.window.setDocumentEdited(true)
    expect(invoked("set_document_edited")).toEqual([{ edited: true }])
  })

  it("sets the proxy icon only for drawings", async () => {
    const p = await create()
    await p.window.setRepresentedFile!("/Users/u/plan.nibd")
    await p.window.setRepresentedFile!("/Users/u/photo.png")
    await p.window.setRepresentedFile!(null)
    expect(invoked("set_represented_file")).toEqual([
      { path: "/Users/u/plan.nibd" },
      { path: null },
      { path: null },
    ])
  })
})

describe("external changes to the open document", () => {
  it("reports another app's edit on focus, but never Nib's own save", async () => {
    let mtime = 1000
    fs.stat.mockImplementation(async () => ({ mtime: new Date(mtime), size: 10 }))
    fs.readTextFile.mockResolvedValue("{}")
    const p = await create()
    await p.fs.readText("/Users/u/plan.nibd")
    const changes: string[] = []
    p.fs.watch!("/Users/u/plan.nibd", (c) => changes.push(c))
    expect(focusHandlers).toHaveLength(1)
    commands.document_write = () => {
      mtime = 2000
    }
    await p.fs.saveDocument("{}", "/Users/u/plan.nibd", "plan.nibd")
    focusHandlers[0]!({ payload: true })
    await flush()
    expect(changes).toEqual([])
    mtime = 3000
    focusHandlers[0]!({ payload: true })
    await flush()
    expect(changes).toEqual(["modified"])
  })

  it("refuses to save over another app's edit it hasn't reported yet, then lets a retry through", async () => {
    let mtime = 1000
    fs.stat.mockImplementation(async () => ({ mtime: new Date(mtime), size: 10 }))
    fs.readTextFile.mockResolvedValue("{}")
    const p = await create()
    await p.fs.readText("/Users/u/plan.nibd")
    mtime = 5000
    await expect(p.fs.saveDocument("mine", "/Users/u/plan.nibd", "plan.nibd")).rejects.toMatchObject({
      name: "FileChangedError",
    })
    expect(invoked("document_write")).toEqual([])
    await expect(p.fs.saveDocument("mine", "/Users/u/plan.nibd", "plan.nibd")).resolves.toBe(
      "/Users/u/plan.nibd",
    )
    expect(invoked("document_write")).toHaveLength(1)
    await expect(p.fs.stamp!("/Users/u/plan.nibd")).resolves.toBe("5000:10")
  })

  it("renames the document through the shell and watches it under its new name", async () => {
    let mtime = 1000
    fs.stat.mockImplementation(async () => ({ mtime: new Date(mtime), size: 10 }))
    fs.readTextFile.mockResolvedValue("{}")
    const p = await create()
    await p.fs.readText("/Users/u/Board A.nibd")
    commands.document_rename = (a) => `/Users/u/${a.name}`
    await expect(p.fs.renameDocument!("/Users/u/Board A.nibd", "Renamed.nibd")).resolves.toBe(
      "/Users/u/Renamed.nibd",
    )
    expect(invoked("document_rename")).toEqual([{ path: "/Users/u/Board A.nibd", name: "Renamed.nibd" }])
    commands.document_write = () => {
      mtime = 2000
    }
    await expect(p.fs.saveDocument("{}", "/Users/u/Renamed.nibd", "Renamed.nibd")).resolves.toBe(
      "/Users/u/Renamed.nibd",
    )
  })

  it("explains a rename the shell refused for a path it no longer grants", async () => {
    const p = await create()
    commands.document_rename = () => {
      throw "forbidden path: /Users/u/Board A.nibd"
    }
    await expect(p.fs.renameDocument!("/Users/u/Board A.nibd", "Renamed.nibd")).rejects.toThrow(
      "Nib no longer has access to it. Save it, then rename it.",
    )
  })

  it("reports a deleted document", async () => {
    fs.stat.mockResolvedValueOnce({ mtime: new Date(1), size: 1 })
    const p = await create()
    const changes: string[] = []
    p.fs.watch!("/Users/u/plan.nibd", (c) => changes.push(c))
    await flush()
    fs.stat.mockRejectedValue(new Error("No such file or directory (os error 2)"))
    fs.exists.mockResolvedValue(false)
    focusHandlers[0]!({ payload: true })
    await flush()
    expect(changes).toEqual(["deleted"])
  })
})

describe("prefs", () => {
  it("mirrors writes to the shell and restores them from the boot snapshot", async () => {
    stubBoot({ prefs: { rev: 2, values: { "nib.theme": "kraft" } } })
    const p = await create()
    expect(p.prefs.get("nib.theme")).toBe("kraft")
    p.prefs.set("nib.theme", "mint")
    await flush()
    expect(invoked("prefs_set")).toEqual([{ key: "nib.theme", value: "mint", rev: 3 }])
  })
})

describe("updates", () => {
  it("has no updater and no menu item unless the build has an update feed", async () => {
    const p = await create()
    await p.menu.install(() => {})
    expect(p.updater).toBeUndefined()
    expect(menu.installAppMenu.mock.calls[0]![1].checkForUpdates).toBeUndefined()
  })

  it("checks from the menu, installs, and relaunches once the guard allows", async () => {
    stubBoot({ updater: true })
    commands.updater_check = () => ({ version: "0.2.0", currentVersion: "0.1.0", notes: "Faster pencil" })
    commands.updater_install = (a) => {
      ;(a.onProgress as FakeChannel<{ downloaded: number; total: number }>).onmessage({
        downloaded: 5,
        total: 10,
      })
    }
    const p = await create()
    p.window.onCloseRequested(async () => true)
    await p.menu.install(() => {})
    dialog.message.mockResolvedValueOnce("Install and Relaunch")
    ;(menu.installAppMenu.mock.calls[0]![1].checkForUpdates as () => void)()
    await flush()
    expect(dialog.message.mock.calls[0]![0]).toContain("0.2.0")
    expect(dialog.message.mock.calls[0]![0]).toContain("Faster pencil")
    expect(invoked("updater_install")).toHaveLength(1)
    expect(invoked("relaunch_app")).toHaveLength(1)
  })

  it("does not relaunch over unsaved work the user keeps", async () => {
    stubBoot({ updater: true })
    commands.updater_check = () => ({ version: "0.2.0", currentVersion: "0.1.0" })
    const p = await create()
    p.window.onCloseRequested(async () => false)
    const progress: number[] = []
    await p.updater!.install((d) => progress.push(d))
    expect(invoked("updater_install")).toHaveLength(1)
    expect(invoked("relaunch_app")).toHaveLength(0)
  })

  it("tells the user the update waits for the next launch when they keep their work open", async () => {
    stubBoot({ updater: true })
    commands.updater_check = () => ({ version: "0.2.0", currentVersion: "0.1.0" })
    const p = await create()
    p.window.onCloseRequested(async () => false)
    await p.menu.install(() => {})
    dialog.message.mockResolvedValueOnce("Install and Relaunch")
    ;(menu.installAppMenu.mock.calls[0]![1].checkForUpdates as () => void)()
    await flush()
    expect(invoked("relaunch_app")).toHaveLength(0)
    expect(dialog.message.mock.calls[1]![0]).toMatch(/next time/)
  })

  it("checks quietly a little after launch", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      stubBoot({ updater: true })
      commands.updater_check = () => null
      await create()
      expect(invoked("updater_check")).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(15_000)
      expect(invoked("updater_check")).toHaveLength(1)
      expect(dialog.message).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("says so when there is nothing new", async () => {
    stubBoot({ updater: true })
    commands.updater_check = () => null
    const p = await create()
    await p.menu.install(() => {})
    ;(menu.installAppMenu.mock.calls[0]![1].checkForUpdates as () => void)()
    await flush()
    expect(dialog.message.mock.calls[0]![1]).toMatchObject({ title: "You're up to date" })
  })
})

describe("tabs and session", () => {
  it("hands out the tabs the shell planned once, and reports the open tabs back", async () => {
    stubBoot({
      session: {
        tabs: [
          { slot: "t1", open: "/Users/u/a.nibd", viewport: { scrollX: 1, scrollY: 2, zoom: 1 } },
          { slot: "../bad", open: null },
        ],
        active: 0,
        notices: ["“b.nibd” was moved or deleted, so it wasn't reopened."],
      },
    })
    const p = await create()
    expect(await p.session!.restore()).toEqual({
      tabs: [{ slot: "t1", open: "/Users/u/a.nibd", viewport: { scrollX: 1, scrollY: 2, zoom: 1 } }],
      active: 0,
      notices: ["“b.nibd” was moved or deleted, so it wasn't reopened."],
    })
    expect(await p.session!.restore()).toBeNull()
    const tabs = [{ slot: "t1", path: "/Users/u/a.nibd", viewport: null }]
    await p.session!.save(tabs, 0)
    expect(invoked("session_report")).toEqual([{ tabs, active: 0 }])
  })

  it("opens several drawings from one Open dialog", async () => {
    const p = await create()
    dialog.open.mockResolvedValueOnce(["/Users/u/a.nibd", "/Users/u/b.nibd"])
    fs.readTextFile.mockImplementation(async (path: string) => `{"from":"${path}"}`)
    const docs = await p.fs.openDocuments!([{ name: "Nib drawing", extensions: ["nibd"] }])
    expect(dialog.open.mock.calls[0]![0]).toMatchObject({ multiple: true })
    expect(docs.map((d) => [d.path, d.name])).toEqual([
      ["/Users/u/a.nibd", "a.nibd"],
      ["/Users/u/b.nibd", "b.nibd"],
    ])
    dialog.open.mockResolvedValueOnce(null)
    expect(await p.fs.openDocuments!([])).toEqual([])
  })

  it("asks once about several unsaved tabs with Save All / Don't Save / Cancel", async () => {
    const p = await create()
    dialog.message.mockResolvedValueOnce("Save All")
    await expect(p.dialogs.askSaveAll!(["Plan.nibd", "Untitled 2"])).resolves.toBe("save")
    expect(dialog.message.mock.calls[0]![0]).toContain("“Plan.nibd”, “Untitled 2”")
    expect(dialog.message.mock.calls[0]![1]).toMatchObject({
      title: "Do you want to save the changes to 2 drawings?",
      buttons: { yes: "Save All", no: "Don't Save", cancel: "Cancel" },
    })
    dialog.message.mockResolvedValueOnce("Don't Save")
    await expect(p.dialogs.askSaveAll!(["a", "b"])).resolves.toBe("discard")
    dialog.message.mockResolvedValueOnce("Cancel")
    await expect(p.dialogs.askSaveAll!(["a", "b"])).resolves.toBe("cancel")
  })

  it("reveals a drawing through the shell's scope-checked command", async () => {
    const p = await create()
    await p.revealPath!("/Users/u/a.nibd")
    expect(invoked("reveal_document")).toEqual([{ path: "/Users/u/a.nibd" }])
  })
})

import {
  DEFAULT_APP_STATE,
  EditorCore,
  NIB_FILE_VERSION,
  newElement,
  newerVersionWarning,
  setTextMeasurer,
  toExcalidraw,
} from "@nib/core"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import { ingestFiles } from "../src/document/clipboard"
import { DocumentController } from "../src/document/documentController"
import { createFakePlatform } from "./fakePlatform"

beforeAll(() => setTextMeasurer((t) => t.length * 10))
afterEach(() => vi.useRealTimers())

const draw = (core: EditorCore, x = 0) =>
  core.transact(() =>
    core.scene.insert(
      newElement("rectangle", { x, y: 0, width: 40, height: 30, index: core.scene.nextIndex() }),
    ),
  )

const settle = () => new Promise((r) => setTimeout(r, 0))

const RECOVERY = "/appdata/recovery/current.nibd"
const RECOVERY_META = "/appdata/recovery/current.meta.json"

const setup = (opts: { autosaveMs?: number; name?: "tauri" | "browser" } = {}) => {
  const core = new EditorCore()
  const platform = createFakePlatform({ name: opts.name })
  const doc = new DocumentController(core, platform, { autosaveMs: opts.autosaveMs })
  const detach = doc.attach()
  return { core, platform, doc, detach }
}

describe("DocumentController", () => {
  test("starts clean and becomes dirty on the first edit", async () => {
    const { core, platform, doc } = setup()
    expect(doc.dirty).toBe(false)

    draw(core)
    expect(doc.dirty).toBe(true)
    await settle()
    expect(platform.edited).toBe(true)
    expect(platform.title).toContain("•")
    doc.dispose()
  })

  test("the window title is the document name and Nib", async () => {
    const { core, platform, doc } = setup()
    await settle()
    expect(platform.title).toBe("Untitled — Nib")
    draw(core)
    await settle()
    expect(platform.title).toBe("• Untitled — Nib")
    doc.dispose()
  })

  test("save writes the scene and clears the dirty flag", async () => {
    const { core, platform, doc } = setup()
    draw(core)

    expect(await doc.save()).toBe(true)
    expect(doc.dirty).toBe(false)
    expect(doc.path).toBe("/docs/untitled.nibd")
    const written = JSON.parse(platform.files.get("/docs/untitled.nibd")!)
    expect(written.type).toBe("nib")
    expect(written.elements).toHaveLength(1)
    doc.dispose()
  })

  test("open replaces the scene and resets history", async () => {
    const { core, platform, doc } = setup()
    draw(core)
    await doc.save()
    const saved = platform.files.get("/docs/untitled.nibd")!

    const core2 = new EditorCore()
    const doc2 = new DocumentController(core2, platform)
    doc2.attach()
    platform.openResult = { path: "/docs/other.nibd", contents: saved }
    expect(await doc2.open()).toBeNull()
    expect(core2.scene.getNonDeleted()).toHaveLength(1)
    expect(doc2.name).toBe("other.nibd")
    expect(doc2.dirty).toBe(false)
    expect(core2.history.canUndo()).toBe(false)
    doc.dispose()
    doc2.dispose()
  })

  test("a damaged file reports a readable error and leaves the scene alone", async () => {
    const core = new EditorCore()
    draw(core)
    const before = core.scene.getNonDeleted().length
    const platform = createFakePlatform()
    const doc = new DocumentController(core, platform)
    doc.attach()
    platform.openResult = { path: "/docs/bad.nibd", contents: "{ not json" }
    const error = await doc.open()
    expect(error).toBe("This file isn't a Nib or Excalidraw drawing.")
    expect(doc.lastError).toBe(error)
    expect(core.scene.getNonDeleted()).toHaveLength(before)
    doc.dispose()
  })

  test("autosave writes a recovery snapshot that a later session restores", async () => {
    vi.useFakeTimers()
    const { core, platform, doc } = setup({ autosaveMs: 50 })
    draw(core)
    await vi.advanceTimersByTimeAsync(120)
    expect(platform.files.has(RECOVERY)).toBe(true)
    doc.dispose()

    const core2 = new EditorCore()
    const doc2 = new DocumentController(core2, platform, { autosaveMs: 50 })
    doc2.attach()
    await expect(doc2.recover()).resolves.toBe(true)
    expect(core2.scene.getNonDeleted()).toHaveLength(1)
    expect(doc2.dirty).toBe(true)
    doc2.dispose()
  })

  test("saving clears the recovery snapshot", async () => {
    vi.useFakeTimers()
    const { core, platform, doc } = setup({ autosaveMs: 10 })
    draw(core)
    await vi.advanceTimersByTimeAsync(40)
    expect(platform.files.has(RECOVERY)).toBe(true)
    await doc.save()
    expect(platform.files.has(RECOVERY)).toBe(false)
    doc.dispose()
  })

  test("recover returns false when there is nothing stored", async () => {
    const { doc } = setup()
    await expect(doc.recover()).resolves.toBe(false)
    doc.dispose()
  })

  test("closing is allowed when the document is clean", async () => {
    const { platform, doc } = setup()
    await expect(platform.closeHandlers[0]!()).resolves.toBe(true)
    expect(platform.dialogCalls).toHaveLength(0)
    doc.dispose()
  })
})

describe("DocumentController lifecycle", () => {
  test("attach, detach and attach again keeps tracking edits, as React StrictMode does", () => {
    const core = new EditorCore()
    const platform = createFakePlatform()
    const doc = new DocumentController(core, platform)
    const detach = doc.attach()
    expect(doc.attach()).toBe(detach)
    expect(platform.closeHandlers).toHaveLength(1)
    detach()
    detach()
    expect(platform.closeHandlers).toHaveLength(0)

    draw(core)
    expect(doc.dirty).toBe(false)

    doc.attach()
    expect(doc.dirty).toBe(true)
    expect(platform.closeHandlers).toHaveLength(1)
    draw(core, 100)
    expect(doc.dirty).toBe(true)
    doc.dispose()
    doc.dispose()
    expect(platform.closeHandlers).toHaveLength(0)
  })

  test("constructing a controller subscribes to nothing", () => {
    const core = new EditorCore()
    const platform = createFakePlatform()
    new DocumentController(core, platform)
    expect(platform.closeHandlers).toHaveLength(0)
  })

  test("undoing back to the saved state makes the document clean again", async () => {
    const { core, doc } = setup()
    draw(core)
    await doc.save()
    draw(core, 100)
    expect(doc.dirty).toBe(true)
    core.undo()
    expect(doc.dirty).toBe(false)
    core.redo()
    expect(doc.dirty).toBe(true)
    doc.dispose()
  })

  test("reverting the canvas background makes the document clean again", () => {
    const { core, doc } = setup()
    core.setAppState({ viewBackgroundColor: "#ffc9c9" })
    expect(doc.dirty).toBe(true)
    core.setAppState({ viewBackgroundColor: DEFAULT_APP_STATE.viewBackgroundColor })
    expect(doc.dirty).toBe(false)
    doc.dispose()
  })

  test("panning and selecting are not edits", () => {
    const { core, doc } = setup()
    core.setAppState({ viewport: { scrollX: 40, scrollY: 10, zoom: 2 }, selectedElementIds: {} })
    expect(doc.dirty).toBe(false)
    doc.dispose()
  })

  test("renaming is an edit, and renaming back undoes it", () => {
    const { doc } = setup()
    doc.setName("Plan")
    expect(doc.dirty).toBe(true)
    doc.setName("Untitled")
    expect(doc.dirty).toBe(false)
    doc.dispose()
  })
})

describe("DocumentController unsaved-changes guard", () => {
  test("Cancel keeps the document, and New does nothing", async () => {
    const { core, platform, doc } = setup()
    draw(core)
    platform.askSaveResult = "cancel"
    expect(await doc.newDocument()).toBe(false)
    expect(platform.dialogCalls.map((c) => c.kind)).toEqual(["askSave"])
    expect(core.scene.getNonDeleted()).toHaveLength(1)
    expect(doc.dirty).toBe(true)
    doc.dispose()
  })

  test("Save saves first, then New proceeds", async () => {
    const { core, platform, doc } = setup()
    draw(core)
    platform.askSaveResult = "save"
    expect(await doc.newDocument()).toBe(true)
    expect(JSON.parse(platform.files.get("/docs/untitled.nibd")!).elements).toHaveLength(1)
    expect(core.scene.getNonDeleted()).toHaveLength(0)
    expect(doc.name).toBe("Untitled")
    expect(doc.dirty).toBe(false)
    doc.dispose()
  })

  test("Save that is cancelled in the save dialog keeps the document", async () => {
    const { core, platform, doc } = setup()
    draw(core)
    platform.askSaveResult = "save"
    platform.savePath = null
    expect(await doc.newDocument()).toBe(false)
    expect(core.scene.getNonDeleted()).toHaveLength(1)
    doc.dispose()
  })

  test("newDocument with skipConfirm does not ask", async () => {
    const { core, platform, doc } = setup()
    draw(core)
    expect(await doc.newDocument({ skipConfirm: true })).toBe(true)
    expect(platform.dialogCalls).toHaveLength(0)
    expect(core.scene.getNonDeleted()).toHaveLength(0)
    doc.dispose()
  })

  test("openText asks before replacing a dirty document", async () => {
    const { core, platform, doc } = setup()
    draw(core)
    const other = new EditorCore()
    draw(other)
    draw(other, 60)
    const { serializeNib } = await import("@nib/core")
    const text = serializeNib(other.scene.getElements(), other.appState)

    platform.askSaveResult = "cancel"
    expect(await doc.openText(text, "other.nibd")).toBeNull()
    expect(core.scene.getNonDeleted()).toHaveLength(1)

    platform.askSaveResult = "discard"
    expect(await doc.openText(text, "other.nibd")).toBeNull()
    expect(core.scene.getNonDeleted()).toHaveLength(2)
    expect(doc.name).toBe("other.nibd")
    expect(doc.path).toBeNull()
    expect(doc.dirty).toBe(false)
    doc.dispose()
  })
})

describe("DocumentController errors and names", () => {
  test("a failed Excalidraw export resolves false with a message", async () => {
    const { core, platform, doc } = setup()
    draw(core)
    platform.fs.saveDocument = async () => {
      throw new Error("disk full")
    }
    await expect(doc.exportExcalidraw()).resolves.toBe(false)
    expect(doc.lastError).toContain("disk full")
    doc.dispose()
  })

  test("an Excalidraw export resolves the path the save picker wrote, renamed or not", async () => {
    const { core, platform, doc } = setup()
    draw(core)
    platform.fs.saveDocument = async () => "fsa:x/Renamed.excalidraw"
    await expect(doc.exportExcalidraw()).resolves.toBe("fsa:x/Renamed.excalidraw")
    expect(doc.lastError).toBeNull()
    doc.dispose()
  })

  test("a failed open resolves to a message instead of rejecting", async () => {
    const { platform, doc } = setup()
    platform.fs.openDocument = async () => {
      throw new Error("permission denied")
    }
    await expect(doc.open()).resolves.toContain("permission denied")
    await expect(doc.openPath("/nope/missing.nibd")).resolves.toContain("missing.nibd")
    doc.dispose()
  })

  test("Save As renames the document and keeps appState.name in step", async () => {
    const { core, platform, doc } = setup()
    draw(core)
    platform.savePath = "/docs/Roadmap.nibd"
    await doc.saveAs()
    expect(doc.name).toBe("Roadmap.nibd")
    expect(doc.baseName).toBe("Roadmap")
    expect(core.appState.name).toBe("Roadmap.nibd")
    doc.dispose()
  })

  test("the export base name strips any drawing extension, in any case", () => {
    const { doc } = setup()
    doc.setName("diagram.EXCALIDRAW")
    expect(doc.baseName).toBe("diagram")
    doc.setName("notes.nibd")
    expect(doc.baseName).toBe("notes")
    doc.setName("plan.NIBD")
    expect(doc.baseName).toBe("plan")
    doc.setName("old.excalidraw")
    expect(doc.baseName).toBe("old")
    doc.dispose()
  })

  test("importing an Excalidraw file names the document after it", async () => {
    const { core, platform, doc } = setup()
    platform.openResult = {
      path: "/docs/diagram.excalidraw",
      contents: toExcalidraw(
        [newElement("rectangle", { x: 0, y: 0, width: 10, height: 10, index: "a0" })],
        DEFAULT_APP_STATE,
      ),
    }
    expect(await doc.importExcalidraw()).toBeNull()
    expect(doc.baseName).toBe("diagram")
    expect(core.appState.name).toBe("diagram")
    expect(doc.format).toBe("excalidraw")
    doc.dispose()
  })

  test("opening an .excalidraw file says that saving makes a Nib copy", async () => {
    const { platform, doc } = setup()
    const notices: string[] = []
    doc.onNotice((m) => notices.push(m))
    platform.openResult = {
      path: "/docs/board.excalidraw",
      contents: toExcalidraw([], DEFAULT_APP_STATE),
    }
    expect(await doc.open()).toBeNull()
    expect(doc.path).toBeNull()
    expect(doc.name).toBe("board.nibd")
    expect(notices).toHaveLength(1)
    doc.dispose()
  })

  test("a failing autosave is reported once, not on every edit", async () => {
    vi.useFakeTimers()
    const { core, platform, doc } = setup({ autosaveMs: 10 })
    const notices: string[] = []
    doc.onNotice((m, kind) => notices.push(`${kind}:${m}`))
    platform.fs.writeText = async () => {
      const error = new Error("quota")
      error.name = "QuotaExceededError"
      throw error
    }
    draw(core)
    await vi.advanceTimersByTimeAsync(30)
    draw(core, 50)
    await vi.advanceTimersByTimeAsync(30)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatch(/^error:Storage is full/)
    doc.dispose()
  })
})

describe("DocumentController in the browser", () => {
  test("saving keeps the drawing for the next reload, because a download can't be reopened", async () => {
    vi.useFakeTimers()
    const { core, platform, doc } = setup({ autosaveMs: 10, name: "browser" })
    draw(core)
    draw(core, 60)
    await vi.advanceTimersByTimeAsync(40)
    expect(await doc.save()).toBe(true)
    expect(platform.downloads).toHaveLength(1)
    expect(doc.dirty).toBe(false)
    await vi.advanceTimersByTimeAsync(40)
    expect(platform.files.has(RECOVERY)).toBe(true)
    doc.dispose()

    const core2 = new EditorCore()
    const doc2 = new DocumentController(core2, platform)
    doc2.attach()
    await expect(doc2.recover()).resolves.toBe(true)
    expect(core2.scene.getNonDeleted()).toHaveLength(2)
    expect(doc2.dirty).toBe(false)
    expect(platform.files.has(RECOVERY_META)).toBe(true)
    doc2.dispose()
  })

  test("a new document clears the browser snapshot", async () => {
    vi.useFakeTimers()
    const { core, platform, doc } = setup({ autosaveMs: 10, name: "browser" })
    draw(core)
    await doc.save()
    await vi.advanceTimersByTimeAsync(40)
    expect(platform.files.has(RECOVERY)).toBe(true)
    await doc.newDocument()
    expect(platform.files.has(RECOVERY)).toBe(false)
    doc.dispose()
  })
})

describe("DocumentController and files from a newer Nib", () => {
  const newer = () =>
    JSON.stringify({
      type: "nib",
      version: NIB_FILE_VERSION + 1,
      elements: [newElement("rectangle", { x: 0, y: 0, width: 10, height: 10, index: "a0" })],
      appState: {},
      files: {},
    })

  test("opening one warns, and the first save asks for a new path instead of overwriting it", async () => {
    const { platform, doc } = setup()
    const notices: [string, string][] = []
    doc.onNotice((text, kind) => notices.push([text, kind]))
    const original = newer()
    platform.files.set("/docs/future.nibd", original)
    expect(await doc.openPath("/docs/future.nibd")).toBeNull()
    expect(notices).toEqual([[newerVersionWarning(NIB_FILE_VERSION + 1), "warning"]])
    expect(doc.path).toBeNull()
    expect(doc.name).toBe("future.nibd")

    platform.savePath = "/docs/future copy.nibd"
    expect(await doc.save()).toBe(true)
    expect(platform.files.get("/docs/future.nibd")).toBe(original)
    expect(doc.path).toBe("/docs/future copy.nibd")
    doc.dispose()
  })

  test("a dropped scene from a newer version carries the warning for the UI", async () => {
    const core = new EditorCore()
    const result = await ingestFiles(core, [new File([newer()], "future.nibd")], [0, 0])
    expect(result.scenes[0]!.warnings).toEqual([newerVersionWarning(NIB_FILE_VERSION + 1)])
  })
})

describe("DocumentController and the file on disk", () => {
  const nibWith = (n: number) => {
    const els = Array.from({ length: n }, (_, i) =>
      newElement("rectangle", { x: i * 50, y: 0, width: 40, height: 30, index: `a${i}` }),
    )
    const other = new EditorCore()
    other.loadScene(els)
    return JSON.stringify({
      type: "nib",
      version: NIB_FILE_VERSION,
      elements: other.scene.getElements(),
      appState: {},
    })
  }
  const openFile = async (n = 1) => {
    const ctx = setup()
    ctx.platform.files.set("/docs/plan.nibd", nibWith(n))
    expect(await ctx.doc.openPath("/docs/plan.nibd")).toBeNull()
    return ctx
  }

  test("the open file is watched while attached, and the watch follows the document", async () => {
    const { doc, platform, detach } = await openFile()
    expect([...platform.watchers.keys()]).toEqual(["/docs/plan.nibd"])
    await doc.newDocument()
    expect(platform.watchers.size).toBe(0)
    platform.files.set("/docs/other.nibd", nibWith(1))
    await doc.openPath("/docs/other.nibd")
    expect([...platform.watchers.keys()]).toEqual(["/docs/other.nibd"])
    detach()
    expect(platform.watchers.size).toBe(0)
  })

  test("a change made by another app offers a reload; Reload replaces the drawing and leaves it clean", async () => {
    const { core, doc, platform } = await openFile(1)
    platform.files.set("/docs/plan.nibd", nibWith(3))
    platform.confirmResult = true
    platform.fireChange("/docs/plan.nibd", "modified")
    await settle()
    expect(platform.dialogCalls.at(-1)).toEqual({
      kind: "confirm",
      text: expect.stringContaining("plan.nibd"),
    })
    expect(core.scene.getNonDeleted()).toHaveLength(3)
    expect(doc.dirty).toBe(false)
    expect(doc.path).toBe("/docs/plan.nibd")
  })

  test("Keep Mine keeps the drawing and marks it unsaved, so the next Save writes it back", async () => {
    const { core, doc, platform } = await openFile(1)
    draw(core, 300)
    platform.files.set("/docs/plan.nibd", nibWith(3))
    platform.confirmResult = false
    platform.fireChange("/docs/plan.nibd", "modified")
    await settle()
    expect(platform.dialogCalls.at(-1)!.text).toContain("discards your unsaved changes")
    expect(core.scene.getNonDeleted()).toHaveLength(2)
    expect(doc.dirty).toBe(true)
    expect(await doc.save()).toBe(true)
    expect(JSON.parse(platform.files.get("/docs/plan.nibd")!).elements).toHaveLength(2)
  })

  test("a file moved or deleted by another app leaves the drawing open and unsaved, with a warning", async () => {
    const { core, doc, platform } = await openFile(2)
    const notices: string[] = []
    doc.onNotice((m) => notices.push(m))
    platform.fireChange("/docs/plan.nibd", "deleted")
    await settle()
    expect(notices.join(" ")).toContain("moved or deleted")
    expect(core.scene.getNonDeleted()).toHaveLength(2)
    expect(doc.dirty).toBe(true)
  })

  test("the window represents the open file (the macOS proxy icon) and nothing for untitled ones", async () => {
    const { doc, platform } = await openFile()
    await settle()
    expect(platform.representedFile).toBe("/docs/plan.nibd")
    await doc.newDocument()
    await settle()
    expect(platform.representedFile).toBeNull()
  })

  test("a save picker the user closes is a quiet cancel, not an error", async () => {
    const { core, doc, platform } = setup()
    draw(core)
    platform.fs.saveDocument = async () => {
      throw Object.assign(new Error("The user aborted a request."), { name: "AbortError" })
    }
    expect(await doc.save()).toBe(false)
    expect(doc.lastError).toBeNull()
    expect(doc.dirty).toBe(true)
    expect(await doc.exportExcalidraw()).toBe(false)
    expect(doc.lastError).toBeNull()
  })
})

describe("DocumentController state snapshot", () => {
  test("the snapshot object is stable until path, name or dirty changes, and names may contain '|'", async () => {
    const { core, doc } = setup()
    const first = doc.state
    expect(doc.state).toBe(first)
    doc.setName("a|b.nibd")
    const renamed = doc.state
    expect(renamed).not.toBe(first)
    expect(renamed).toEqual({ path: null, name: "a|b.nibd", dirty: true })
    draw(core)
    expect(doc.state.dirty).toBe(true)
    expect(doc.state).toBe(doc.state)
    await doc.save()
    expect(doc.state).toEqual({ path: "/docs/untitled.nibd", name: "untitled.nibd", dirty: false })
  })
})

describe("DocumentController in one of several tabs", () => {
  const tabDoc = (platform: ReturnType<typeof createFakePlatform>, slot: string) => {
    const core = new EditorCore()
    const view = Object.create(platform) as typeof platform
    view.fs = { ...platform.fs, recoverySlot: slot }
    const doc = new DocumentController(core, view, { autosaveMs: 10 })
    doc.attach()
    return { core, doc }
  }

  test("each tab keeps its unsaved work in its own recovery copy", async () => {
    vi.useFakeTimers()
    const platform = createFakePlatform()
    const a = tabDoc(platform, "w1-1")
    const b = tabDoc(platform, "w1-2")
    draw(a.core)
    draw(b.core)
    draw(b.core, 60)
    await vi.advanceTimersByTimeAsync(40)
    expect(platform.files.has("/appdata/recovery/w1-1.nibd")).toBe(true)
    expect(platform.files.has("/appdata/recovery/w1-2.nibd")).toBe(true)
    expect(platform.files.has(RECOVERY)).toBe(false)

    // Don't Save in one tab drops only that tab's copy
    platform.askSaveResult = "discard"
    await expect(a.doc.confirmDiscard()).resolves.toBe(true)
    expect(platform.files.has("/appdata/recovery/w1-1.nibd")).toBe(false)
    expect(platform.files.has("/appdata/recovery/w1-2.nibd")).toBe(true)
    a.doc.dispose()
    b.doc.dispose()

    const relaunched = tabDoc(platform, "w1-2")
    await expect(relaunched.doc.recover()).resolves.toBe(true)
    expect(relaunched.core.scene.getNonDeleted()).toHaveLength(2)
    expect(relaunched.doc.dirty).toBe(true)
    relaunched.doc.dispose()
  })
})

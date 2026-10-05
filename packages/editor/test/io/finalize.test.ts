import {
  DEFAULT_APP_STATE,
  EditorCore,
  NIB_FILE_VERSION,
  type NibElement,
  type TextElement,
  createLibraryItem,
  newElement,
  parseClipboard,
  parseLibrary,
  serializeLibrary,
  serializeNib,
  setTextMeasurer,
  toExcalidraw,
} from "@nib/core"
import { fileChangedError } from "@nib/platform"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import { copySelection, cutSelection, pasteAt } from "../../src/document/clipboard"
import { DocumentController } from "../../src/document/documentController"
import { LIBRARY_FILE, LibraryStore } from "../../src/document/libraryStore"
import { type FakePlatform, createFakePlatform } from "../fakePlatform"

beforeAll(() => setTextMeasurer((t) => t.length * 10))
afterEach(() => vi.useRealTimers())

const RECOVERY = "/appdata/recovery/current.nibd"
const RECOVERY_META = "/appdata/recovery/current.meta.json"

const draw = (core: EditorCore, x = 0) =>
  core.transact(() =>
    core.scene.insert(
      newElement("rectangle", { x, y: 0, width: 40, height: 30, index: core.scene.nextIndex() }),
    ),
  )

const sceneText = (count: number): string => {
  const other = new EditorCore()
  for (let i = 0; i < count; i++) draw(other, i * 60)
  return serializeNib(other.scene.getElements(), other.appState)
}

const recoveredDrawing = (platform: FakePlatform, count: number, meta: Record<string, unknown> = {}) => {
  platform.files.set(RECOVERY, sceneText(count))
  platform.files.set(
    RECOVERY_META,
    JSON.stringify({ path: null, name: "Untitled", dirty: true, savedAt: 1, ...meta }),
  )
}

const attached = (core: EditorCore, platform: FakePlatform, opts: { autosaveMs?: number } = {}) => {
  const doc = new DocumentController(core, platform, opts)
  doc.attach()
  return doc
}

const live = (core: EditorCore) => core.scene.getNonDeleted()
const recoveredCount = (platform: FakePlatform) => JSON.parse(platform.files.get(RECOVERY)!).elements.length

const newText = (core: EditorCore): TextElement =>
  newElement("text", {
    x: 0,
    y: 200,
    width: 0,
    height: 25,
    index: core.scene.nextIndex(),
    text: "",
    originalText: "",
  }) as TextElement

describe("a file opened at launch and the last session's unsaved drawing", () => {
  test("the unsaved drawing comes back first, so the save question protects it", async () => {
    const platform = createFakePlatform()
    recoveredDrawing(platform, 2)
    platform.files.set("/docs/plan.nibd", sceneText(1))
    const core = new EditorCore()
    const doc = attached(core, platform)
    const notices: string[] = []
    doc.onNotice((m) => notices.push(m))

    platform.askSaveResult = "cancel"
    expect(await doc.openPath("/docs/plan.nibd")).toBeNull()
    expect(live(core)).toHaveLength(2)
    expect(doc.dirty).toBe(true)
    expect(notices).toContain("Recovered unsaved changes from your last session.")
    expect(platform.dialogCalls.map((c) => c.kind)).toEqual(["askSave"])
    expect(recoveredCount(platform)).toBe(2)

    platform.askSaveResult = "discard"
    expect(await doc.openPath("/docs/plan.nibd")).toBeNull()
    expect(live(core)).toHaveLength(1)
    expect(doc.path).toBe("/docs/plan.nibd")
    expect(platform.files.has(RECOVERY)).toBe(false)
  })

  test("Save keeps the restored drawing in a file of its own before the requested one opens", async () => {
    const platform = createFakePlatform()
    recoveredDrawing(platform, 3)
    platform.files.set("/docs/plan.nibd", sceneText(1))
    platform.savePath = "/docs/rescued.nibd"
    platform.askSaveResult = "save"
    const core = new EditorCore()
    const doc = attached(core, platform)
    expect(await doc.openPath("/docs/plan.nibd")).toBeNull()
    expect(JSON.parse(platform.files.get("/docs/rescued.nibd")!).elements).toHaveLength(3)
    expect(doc.path).toBe("/docs/plan.nibd")
  })

  test("a saved drawing's copy (kept by the browser) doesn't come back over the file being opened", async () => {
    const platform = createFakePlatform({ name: "browser" })
    recoveredDrawing(platform, 3, { dirty: false })
    platform.files.set("fsa:1/plan.nibd", sceneText(1))
    const core = new EditorCore()
    const doc = attached(core, platform)
    expect(await doc.openPath("fsa:1/plan.nibd")).toBeNull()
    expect(platform.dialogCalls).toEqual([])
    expect(live(core)).toHaveLength(1)
    expect(recoveredCount(platform)).toBe(1)
  })
})

describe("work done before recovery runs", () => {
  test("autosave leaves the crash copy alone, and Keep Current is asked for, not assumed", async () => {
    vi.useFakeTimers()
    const platform = createFakePlatform()
    recoveredDrawing(platform, 2)
    const core = new EditorCore()
    const doc = attached(core, platform, { autosaveMs: 10 })
    draw(core)
    await vi.advanceTimersByTimeAsync(100)
    expect(recoveredCount(platform)).toBe(2)

    platform.confirmResult = false
    await expect(doc.recover()).resolves.toBe(false)
    expect(platform.dialogCalls.at(-1)).toEqual({
      kind: "confirm",
      text: expect.stringContaining("Restoring it replaces what's on the board now."),
    })
    expect(live(core)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(recoveredCount(platform)).toBe(1)
    await expect(doc.recover()).resolves.toBe(false)
  })

  test("Restore replaces the early edit with the unsaved drawing", async () => {
    const platform = createFakePlatform()
    recoveredDrawing(platform, 2)
    const core = new EditorCore()
    const doc = attached(core, platform)
    draw(core)
    platform.confirmResult = true
    await expect(doc.recover()).resolves.toBe(true)
    expect(live(core)).toHaveLength(2)
    expect(doc.dirty).toBe(true)
  })

  test("an untouched board is restored without a question", async () => {
    const platform = createFakePlatform()
    recoveredDrawing(platform, 2)
    const doc = attached(new EditorCore(), platform)
    await expect(doc.recover()).resolves.toBe(true)
    expect(platform.dialogCalls).toEqual([])
  })
})

describe("saves run one at a time", () => {
  test("a held ⌘S and the close guard's Save never write the same file at once", async () => {
    const core = new EditorCore()
    const platform = createFakePlatform()
    const doc = attached(core, platform)
    draw(core)
    expect(await doc.save()).toBe(true)
    const write = platform.fs.saveDocument
    let active = 0
    let overlap = 0
    let calls = 0
    platform.fs.saveDocument = async (...args) => {
      calls++
      active++
      overlap = Math.max(overlap, active)
      await new Promise((r) => setTimeout(r, 5))
      try {
        return await write(...args)
      } finally {
        active--
      }
    }
    draw(core, 60)
    const first = doc.save()
    const repeats = [doc.save(), doc.save(), doc.save()]
    platform.askSaveResult = "save"
    const guard = platform.closeHandlers[0]!()
    expect(await Promise.all([first, ...repeats])).toEqual([true, true, true, true])
    await expect(guard).resolves.toBe(true)
    expect(overlap).toBe(1)
    // the repeats waiting behind the first join one save
    expect(calls).toBe(2)
    expect(JSON.parse(platform.files.get("/docs/untitled.nibd")!).elements).toHaveLength(2)
    expect(doc.dirty).toBe(false)
  })
})

describe("text typed into an open editor", () => {
  const editing = async () => {
    const core = new EditorCore()
    const platform = createFakePlatform()
    const doc = attached(core, platform)
    draw(core)
    await doc.save()
    core.startEditingText(newText(core))
    // the overlay reports its value as soon as it opens
    core.previewText("")
    return { core, platform, doc }
  }

  test("counts as unsaved work as it is typed, and an empty editor doesn't", async () => {
    const { core, doc } = await editing()
    expect(doc.dirty).toBe(false)
    core.previewText("Meeting notes")
    expect(doc.dirty).toBe(true)
    core.previewText("")
    expect(doc.dirty).toBe(false)
  })

  test("the close guard asks, after closing the editor with what was typed", async () => {
    const { core, platform, doc } = await editing()
    core.previewText("Meeting notes")
    platform.askSaveResult = "cancel"
    await expect(platform.closeHandlers[0]!()).resolves.toBe(false)
    expect(platform.dialogCalls.map((c) => c.kind)).toEqual(["askSave"])
    expect(core.appState.editingTextId).toBeNull()
    expect(live(core).some((e) => e.type === "text" && e.text === "Meeting notes")).toBe(true)
    expect(doc.dirty).toBe(true)
  })

  test("New asks instead of replacing the board", async () => {
    const { core, platform, doc } = await editing()
    core.previewText("Meeting notes")
    platform.askSaveResult = "cancel"
    expect(await doc.newDocument()).toBe(false)
    expect(platform.dialogCalls.map((c) => c.kind)).toEqual(["askSave"])
  })

  test("Save writes the text and leaves the document clean", async () => {
    const { core, platform, doc } = await editing()
    core.previewText("Agenda")
    expect(await doc.save()).toBe(true)
    const saved = JSON.parse(platform.files.get("/docs/untitled.nibd")!).elements as NibElement[]
    expect(saved.some((e) => e.type === "text" && e.text === "Agenda")).toBe(true)
    expect(doc.dirty).toBe(false)
  })

  test("autosave keeps the draft", async () => {
    vi.useFakeTimers()
    const core = new EditorCore()
    const platform = createFakePlatform()
    attached(core, platform, { autosaveMs: 10 })
    core.startEditingText(newText(core))
    core.previewText("Draft")
    await vi.advanceTimersByTimeAsync(40)
    const kept = JSON.parse(platform.files.get(RECOVERY)!).elements as NibElement[]
    expect(kept.some((e) => e.type === "text" && e.text === "Draft")).toBe(true)
  })

  test("a reload offered while typing warns that the draft is lost", async () => {
    const core = new EditorCore()
    const platform = createFakePlatform()
    const doc = attached(core, platform)
    platform.files.set("/docs/plan.nibd", sceneText(1))
    await doc.openPath("/docs/plan.nibd")
    core.startEditingText(newText(core))
    core.previewText("Mine")
    platform.confirmResult = false
    platform.fireChange("/docs/plan.nibd", "modified")
    await new Promise((r) => setTimeout(r, 0))
    expect(platform.dialogCalls.at(-1)!.text).toContain("discards your unsaved changes")
  })
})

describe("renaming the document", () => {
  const savedBoard = async (
    opts: { rename?: boolean; name?: "tauri" | "browser"; reopenByPath?: boolean } = {},
  ) => {
    const core = new EditorCore()
    const platform = createFakePlatform(opts)
    const doc = attached(core, platform)
    const notices: string[] = []
    doc.onNotice((text) => notices.push(text))
    draw(core)
    platform.savePath = "/docs/Board A.nibd"
    await doc.save()
    expect(doc.name).toBe("Board A.nibd")
    return { core, platform, doc, notices }
  }
  const settle = () => new Promise((r) => setTimeout(r, 0))

  test("on desktop a rename renames the file too, so its messages and a reopen agree", async () => {
    const { core, platform, doc } = await savedBoard({ rename: true })
    expect(await doc.setName("Renamed board.nibd")).toBe(true)
    expect(doc.path).toBe("/docs/Renamed board.nibd")
    expect(doc.name).toBe("Renamed board.nibd")
    expect(doc.dirty).toBe(false)
    expect([...platform.files.keys()].filter((p) => p.startsWith("/docs/"))).toEqual([
      "/docs/Renamed board.nibd",
    ])
    await settle()
    expect(platform.title).toBe("Renamed board.nibd — Nib")
    expect(platform.representedFile).toBe("/docs/Renamed board.nibd")
    expect(platform.watchers.has("/docs/Board A.nibd")).toBe(false)

    platform.confirmResult = false
    platform.fireChange("/docs/Renamed board.nibd", "modified")
    await settle()
    expect(platform.dialogCalls.at(-1)!.text).toMatch(/^"Renamed board\.nibd" was changed by another app/)

    draw(core, 100)
    expect(await doc.save()).toBe(true)
    expect(platform.files.has("/docs/Board A.nibd")).toBe(false)
    const reopened = attached(new EditorCore(), platform)
    expect(await reopened.openPath("/docs/Renamed board.nibd")).toBeNull()
    expect(reopened.name).toBe("Renamed board.nibd")
  })

  test("a rename to a name that's taken keeps both files and the old name", async () => {
    const { platform, doc, notices } = await savedBoard({ rename: true })
    platform.files.set("/docs/Notes.nibd", "notes")
    expect(await doc.setName("Notes.nibd")).toBe(false)
    expect(doc.name).toBe("Board A.nibd")
    expect(doc.path).toBe("/docs/Board A.nibd")
    expect(doc.dirty).toBe(false)
    expect(platform.files.get("/docs/Notes.nibd")).toBe("notes")
    expect(notices.at(-1)).toBe(
      'Couldn\'t rename "Board A.nibd": "Notes.nibd" already exists in that folder.',
    )
  })

  test("a save asked for during a rename writes to the renamed file", async () => {
    const { core, platform, doc } = await savedBoard({ rename: true })
    draw(core, 100)
    const renamed = doc.setName("Renamed board.nibd")
    const saved = doc.save()
    expect(await renamed).toBe(true)
    expect(await saved).toBe(true)
    expect(platform.files.has("/docs/Board A.nibd")).toBe(false)
    expect(JSON.parse(platform.files.get("/docs/Renamed board.nibd")!).elements).toHaveLength(2)
    expect(doc.dirty).toBe(false)
  })

  test("where the file can't be renamed, messages name the real file and Save makes the renamed one", async () => {
    // a browser with the File System Access API, whose saves go back to the file picked
    const { core, platform, doc, notices } = await savedBoard({ name: "browser", reopenByPath: true })
    const before = platform.files.get("/docs/Board A.nibd")
    expect(await doc.setName("Renamed board.nibd")).toBe(true)
    expect(doc.name).toBe("Renamed board.nibd")
    expect(doc.path).toBe("/docs/Board A.nibd")
    expect(doc.dirty).toBe(true)
    expect(notices.at(-1)).toBe(
      'The browser can\'t rename "Board A.nibd", so Save makes a copy named "Renamed board.nibd".',
    )

    platform.confirmResult = false
    platform.fireChange("/docs/Board A.nibd", "modified")
    await settle()
    expect(platform.dialogCalls.at(-1)!.text).toMatch(/^"Board A\.nibd" was changed by another app/)
    platform.fireChange("/docs/Board A.nibd", "deleted")
    await settle()
    expect(notices.at(-1)).toBe('"Board A.nibd" was moved or deleted. Save to keep it.')

    draw(core, 100)
    platform.savePath = "/docs/Renamed board.nibd"
    expect(await doc.save()).toBe(true)
    expect(doc.path).toBe("/docs/Renamed board.nibd")
    expect(doc.name).toBe("Renamed board.nibd")
    expect(doc.dirty).toBe(false)
    expect(platform.files.get("/docs/Board A.nibd")).toBe(before)
    expect(JSON.parse(platform.files.get("/docs/Renamed board.nibd")!).elements).toHaveLength(2)
  })

  test("Save As still names the document after the file it writes", async () => {
    const core = new EditorCore()
    const platform = createFakePlatform()
    const doc = attached(core, platform)
    doc.setName("Sketch.nibd")
    platform.savePath = "/docs/Final.nibd"
    expect(await doc.saveAs()).toBe(true)
    expect(doc.name).toBe("Final.nibd")
    expect(doc.dirty).toBe(false)
  })

  test("a rename alone is autosaved, so a reload brings it back", async () => {
    vi.useFakeTimers()
    const platform = createFakePlatform()
    const doc = attached(new EditorCore(), platform, { autosaveMs: 10 })
    doc.setName("Trip plan.nibd")
    await vi.advanceTimersByTimeAsync(40)
    expect(JSON.parse(platform.files.get(RECOVERY_META)!).name).toBe("Trip plan.nibd")
    doc.dispose()
    const next = attached(new EditorCore(), platform)
    await expect(next.recover()).resolves.toBe(true)
    expect(next.name).toBe("Trip plan.nibd")
  })
})

describe("opened drawings come into view", () => {
  const far = [newElement("rectangle", { x: 1500, y: 1200, width: 200, height: 100, index: "a0" })]

  const sized = () => {
    const core = new EditorCore()
    core.setViewportSize(1440, 900)
    const platform = createFakePlatform()
    return { core, platform, doc: attached(core, platform) }
  }

  test("a drawing saved without a view is fitted to its content, at no more than 100%", async () => {
    const { core, platform, doc } = sized()
    platform.files.set(
      "/docs/far.nibd",
      JSON.stringify({ type: "nib", version: NIB_FILE_VERSION, elements: far, appState: {} }),
    )
    expect(await doc.openPath("/docs/far.nibd")).toBeNull()
    expect(core.isContentOffscreen(1440, 900)).toBe(false)
    expect(core.appState.viewport.zoom).toBe(1)
    expect(doc.dirty).toBe(false)
  })

  test("an imported Excalidraw drawing far from the origin is brought into view", async () => {
    const { core, platform, doc } = sized()
    platform.openResult = { path: "/docs/far.excalidraw", contents: toExcalidraw(far, DEFAULT_APP_STATE) }
    expect(await doc.importExcalidraw()).toBeNull()
    expect(core.isContentOffscreen(1440, 900)).toBe(false)
  })

  test("a saved view that shows the content is kept", async () => {
    const { core, platform, doc } = sized()
    const viewport = { scrollX: -1400, scrollY: -1100, zoom: 1.5 }
    platform.files.set(
      "/docs/kept.nibd",
      JSON.stringify({ type: "nib", version: NIB_FILE_VERSION, elements: far, appState: { viewport } }),
    )
    await doc.openPath("/docs/kept.nibd")
    expect(core.appState.viewport).toEqual(viewport)
  })
})

describe("autosave during steady editing", () => {
  test("an edit every second still reaches the recovery copy within five seconds", async () => {
    vi.useFakeTimers()
    const core = new EditorCore()
    const platform = createFakePlatform()
    attached(core, platform, { autosaveMs: 1500 })
    for (let i = 0; i < 5; i++) {
      draw(core, i * 50)
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(platform.files.has(RECOVERY)).toBe(true)
    expect(recoveredCount(platform)).toBe(5)
  })
})

describe("a saved file changed while Nib was closed", () => {
  const PLAN = "fsa:1/plan.nibd"

  /** A clean browser copy of PLAN as it was, then another app's edit to the file. */
  const changedElsewhere = async () => {
    const platform = createFakePlatform({ name: "browser", stamps: true })
    platform.files.set(PLAN, sceneText(1))
    const stamp = await platform.fs.stamp!(PLAN)
    recoveredDrawing(platform, 1, { path: PLAN, name: "plan.nibd", dirty: false, stamp })
    platform.files.set(PLAN, sceneText(3))
    return { platform, stamp }
  }

  test("the file is reopened instead of the stale copy when it can be read", async () => {
    const { platform } = await changedElsewhere()
    const core = new EditorCore()
    const doc = attached(core, platform)
    await expect(doc.recover()).resolves.toBe(true)
    expect(live(core)).toHaveLength(3)
    expect(doc.path).toBe(PLAN)
    expect(doc.dirty).toBe(false)
  })

  test("before access is granted, the old stamp goes to the watcher and a save asks first", async () => {
    const { platform, stamp } = await changedElsewhere()
    platform.unreadable.add(PLAN)
    const core = new EditorCore()
    const doc = attached(core, platform)
    await expect(doc.recover()).resolves.toBe(true)
    expect(live(core)).toHaveLength(1)
    expect(platform.watchOptions.get(PLAN)).toEqual({ since: stamp })

    let refused = false
    platform.fs.saveDocument = async (contents, path) => {
      if (!refused) {
        refused = true
        throw fileChangedError(path!)
      }
      platform.files.set(path!, contents)
      return path
    }
    draw(core, 200)
    platform.confirmResult = false
    expect(await doc.save()).toBe(true)
    expect(platform.dialogCalls.at(-1)).toEqual({
      kind: "confirm",
      text: expect.stringContaining("Reload it?"),
    })
    expect(JSON.parse(platform.files.get(PLAN)!).elements).toHaveLength(2)
    expect(doc.dirty).toBe(false)
  })

  test("Reload at that question takes the other app's version and saves nothing", async () => {
    const { platform } = await changedElsewhere()
    platform.unreadable.add(PLAN)
    const core = new EditorCore()
    const doc = attached(core, platform)
    await doc.recover()
    platform.unreadable.delete(PLAN)
    platform.fs.saveDocument = async (_contents, path) => {
      throw fileChangedError(path!)
    }
    draw(core, 200)
    platform.confirmResult = true
    expect(await doc.save()).toBe(false)
    expect(doc.lastError).toBeNull()
    expect(live(core)).toHaveLength(3)
    expect(doc.dirty).toBe(false)
  })

  test("the recovery copy records the stamp the file had when it was opened", async () => {
    vi.useFakeTimers()
    const platform = createFakePlatform({ name: "browser", stamps: true })
    platform.files.set(PLAN, sceneText(1))
    const core = new EditorCore()
    const doc = attached(core, platform, { autosaveMs: 10 })
    await doc.openPath(PLAN)
    await vi.advanceTimersByTimeAsync(40)
    const meta = JSON.parse(platform.files.get(RECOVERY_META)!)
    expect(meta).toMatchObject({ path: PLAN, dirty: false, stamp: await platform.fs.stamp!(PLAN) })
  })
})

describe("Don't Save, then an open that doesn't happen", () => {
  test("a cancelled picker or a failed read keeps the recovery copy and autosave", async () => {
    vi.useFakeTimers()
    const core = new EditorCore()
    const platform = createFakePlatform()
    const doc = attached(core, platform, { autosaveMs: 10 })
    draw(core)
    await vi.advanceTimersByTimeAsync(40)
    platform.askSaveResult = "discard"
    platform.openResult = null
    expect(await doc.open()).toBeNull()
    expect(platform.files.has(RECOVERY)).toBe(true)
    expect(doc.dirty).toBe(true)
    draw(core, 60)
    await vi.advanceTimersByTimeAsync(40)
    expect(recoveredCount(platform)).toBe(2)
    expect(await doc.openPath("/docs/missing.nibd")).toContain("missing.nibd")
    expect(await doc.openText("not a drawing", "notes.txt")).not.toBeNull()
    expect(recoveredCount(platform)).toBe(2)
  })

  test("Don't Save on close still drops the copy", async () => {
    vi.useFakeTimers()
    const core = new EditorCore()
    const platform = createFakePlatform()
    attached(core, platform, { autosaveMs: 10 })
    draw(core)
    await vi.advanceTimersByTimeAsync(40)
    platform.askSaveResult = "discard"
    await expect(platform.closeHandlers[0]!()).resolves.toBe(true)
    await vi.advanceTimersByTimeAsync(10)
    expect(platform.files.has(RECOVERY)).toBe(false)
  })
})

describe("cut and copy", () => {
  const scene = () => {
    const core = new EditorCore()
    const a = newElement("rectangle", { x: 0, y: 0, width: 40, height: 30, index: "a0" })
    const b = newElement("rectangle", { x: 100, y: 0, width: 40, height: 30, index: "a1" })
    core.loadScene([a, b])
    core.selectElements([a.id])
    return { core, a, b }
  }
  const renderPng = async () => new Uint8Array([1])

  test("a cut deletes what was selected when it started, even after the selection moved on", async () => {
    const { core, a, b } = scene()
    const platform = createFakePlatform()
    let release!: () => void
    platform.clipboard.write = vi.fn(() => new Promise<void>((r) => (release = r)))
    const cut = cutSelection(core, platform, { renderPng })
    core.selectElements([b.id])
    release()
    expect(await cut).toBe(true)
    expect(live(core).map((e) => e.id)).toEqual([b.id])
    expect(core.appState.selectedElementIds).toEqual({ [b.id]: true })
    core.undo()
    expect(
      live(core)
        .map((e) => e.id)
        .sort(),
    ).toEqual([a.id, b.id].sort())
  })

  test("nothing is deleted when neither clipboard took the copy, unless the cut event carried it", async () => {
    const { core } = scene()
    const platform = createFakePlatform()
    platform.clipboard.write = async () => {
      throw new Error("NotAllowedError")
    }
    platform.clipboard.writeText = async () => {
      throw new Error("NotAllowedError")
    }
    expect(await cutSelection(core, platform, { renderPng })).toBe(false)
    expect(live(core)).toHaveLength(2)
    expect(await cutSelection(core, platform, { renderPng, eventWritten: true })).toBe(true)
    expect(live(core)).toHaveLength(1)
  })

  test("a frame is copied and cut with its contents and their labels, and pastes back whole", async () => {
    const core = new EditorCore()
    const frame = newElement("frame", { x: 0, y: 0, width: 300, height: 200, index: "a0" })
    const box = newElement("rectangle", {
      x: 20,
      y: 20,
      width: 100,
      height: 60,
      index: "a1",
      frameId: frame.id,
    })
    const label = newElement("text", {
      x: 30,
      y: 40,
      width: 80,
      height: 25,
      index: "a2",
      frameId: frame.id,
      containerId: box.id,
      text: "Box",
      originalText: "Box",
    })
    core.loadScene([frame, { ...box, boundElements: [{ id: label.id, type: "text" }] }, label])
    core.selectElements([frame.id])
    const platform = createFakePlatform()
    let clip = ""
    platform.clipboard.writeText = async (t) => {
      clip = t
    }
    platform.clipboard.readText = async () => clip

    await copySelection(core, platform)
    expect(
      parseClipboard(clip)!
        .elements.map((e) => e.type)
        .sort(),
    ).toEqual(["frame", "rectangle", "text"])

    expect(await cutSelection(core, platform)).toBe(true)
    expect(live(core)).toHaveLength(0)
    expect(await pasteAt(core, platform, [500, 500])).toBe(true)
    expect(
      live(core)
        .map((e) => e.type)
        .sort(),
    ).toEqual(["frame", "rectangle", "text"])
  })
})

describe("the library across tabs", () => {
  const item = (name: string) =>
    createLibraryItem([newElement("rectangle", { x: 0, y: 0, width: 40, height: 30, index: "a0" })], {}, name)
  const stored = (platform: FakePlatform) =>
    parseLibrary(platform.files.get(`/shared/${LIBRARY_FILE}`)!).map((i) => i.name)

  test("an item another tab added survives this tab's next change", async () => {
    const platform = createFakePlatform({ name: "browser", sharedDataDir: "/shared" })
    const mine = item("Mine")
    await new LibraryStore(platform).save([mine])
    const tabA = new LibraryStore(platform)
    const tabB = new LibraryStore(platform)
    const listA = await tabA.load()
    const listB = await tabB.load()
    expect(await tabB.save([item("From tab B"), ...listB])).toBe(true)
    expect(await tabA.save(listA.map((i) => ({ ...i, name: "Renamed" })))).toBe(true)
    expect(stored(platform)).toEqual(["From tab B", "Renamed"])
  })

  test("a deletion made in this tab still removes the item", async () => {
    const platform = createFakePlatform({ name: "browser", sharedDataDir: "/shared" })
    await new LibraryStore(platform).save([item("Keep"), item("Drop")])
    const tab = new LibraryStore(platform)
    const list = await tab.load()
    await tab.save(list.filter((i) => i.name !== "Drop"))
    expect(stored(platform)).toEqual(["Keep"])
  })

  test("an item added before the load finished never replaces the stored library", async () => {
    const platform = createFakePlatform({ name: "browser", sharedDataDir: "/shared" })
    platform.files.set(`/shared/${LIBRARY_FILE}`, serializeLibrary([item("Old")]))
    const tab = new LibraryStore(platform)
    const loading = tab.load()
    const saving = tab.save([item("New")])
    expect((await loading).map((i) => i.name)).toEqual(["Old"])
    expect(await saving).toBe(true)
    expect(stored(platform)).toEqual(["Old", "New"])
  })
})

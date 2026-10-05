import {
  DEFAULT_APP_STATE,
  EditorCore,
  exportToSvg,
  newElement,
  serializeNib,
  setTextMeasurer,
  toExcalidraw,
} from "@nib/core"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import { copySelection, ingestFiles, pasteAt } from "../../src/document/clipboard"
import { DocumentController } from "../../src/document/documentController"
import { createFakePlatform } from "../fakePlatform"

beforeAll(() => setTextMeasurer((t) => t.length * 10))

afterEach(() => {
  vi.useRealTimers()
})

const attached = (core: EditorCore, platform: ReturnType<typeof createFakePlatform>, autosaveMs?: number) => {
  const doc = new DocumentController(core, platform, { autosaveMs })
  doc.attach()
  return doc
}

const draw = (core: EditorCore, x = 0) =>
  core.transact(() =>
    core.scene.insert(
      newElement("rectangle", { x, y: 0, width: 40, height: 30, index: core.scene.nextIndex() }),
    ),
  )

const RECOVERY = "/appdata/recovery/current.nibd"
const RECOVERY_META = "/appdata/recovery/current.meta.json"

describe("IO document controller", () => {
  test("saving a document opened from .excalidraw never writes Nib JSON into that file", async () => {
    const core = new EditorCore()
    const platform = createFakePlatform()
    const doc = attached(core, platform)
    const original = toExcalidraw(
      [newElement("rectangle", { x: 0, y: 0, width: 10, height: 10, index: "a0" })],
      DEFAULT_APP_STATE,
    )
    platform.files.set("/docs/board.excalidraw", original)
    platform.openResult = { path: "/docs/board.excalidraw", contents: original }
    expect(await doc.open()).toBeNull()
    draw(core, 50)

    await doc.save()
    const onDisk = JSON.parse(platform.files.get("/docs/board.excalidraw")!)
    expect(onDisk.type).toBe("excalidraw")
    doc.dispose()
  })

  test("dropping a scene file onto a dirty canvas asks before replacing it", async () => {
    const core = new EditorCore()
    const platform = createFakePlatform()
    const doc = attached(core, platform)
    draw(core)
    draw(core, 100)
    expect(doc.dirty).toBe(true)
    platform.askSaveResult = "cancel"

    // a drop only hands the scene back; opening it goes through the unsaved-changes guard
    const other = serializeNib([], DEFAULT_APP_STATE)
    const dropped = await ingestFiles(core, [new File([other], "other.nibd")], [0, 0])
    expect(dropped.scenes).toHaveLength(1)
    expect(core.scene.getNonDeleted()).toHaveLength(2)
    await doc.openText(dropped.scenes[0]!.text, dropped.scenes[0]!.name)

    expect(platform.dialogCalls.map((c) => c.kind)).toEqual(["askSave"])
    expect(core.scene.getNonDeleted()).toHaveLength(2)
    expect(core.history.canUndo()).toBe(true)
    doc.dispose()
  })

  test("the Image tool never offers an exported image's scene to open", async () => {
    const core = new EditorCore()
    const elements = [newElement("rectangle", { x: 0, y: 0, width: 10, height: 10, index: "a0" })]
    const scene = serializeNib(elements, DEFAULT_APP_STATE)
    const svg = exportToSvg({
      elements,
      appState: DEFAULT_APP_STATE,
      exportBackground: false,
      exportPadding: 0,
      scale: 1,
      theme: "light",
      embedScene: scene,
    })
    const file = new File([svg], "board.svg", { type: "image/svg+xml" })
    // decoding the image needs a DOM, so only the routing is checked here
    const result = await ingestFiles(core, [file], [0, 0], { mode: "insert-image" })
    expect(result.scenes).toHaveLength(0)
  })

  test("changing the canvas background marks the document dirty", () => {
    const core = new EditorCore()
    const platform = createFakePlatform()
    const doc = attached(core, platform)
    core.setAppState({ viewBackgroundColor: "#ffc9c9" })
    expect(doc.dirty).toBe(true)
    doc.dispose()
  })

  test("a failed write resolves save() to false instead of rejecting", async () => {
    const core = new EditorCore()
    const platform = createFakePlatform()
    const doc = attached(core, platform)
    draw(core)
    platform.fs.saveDocument = async () => {
      throw new Error("EACCES: permission denied")
    }
    await expect(doc.save()).resolves.toBe(false)
    expect(doc.dirty).toBe(true)
    expect(doc.lastError).toContain("permission denied")
    doc.dispose()
  })

  test("discarding changes when the window closes also discards the recovery snapshot", async () => {
    vi.useFakeTimers()
    const core = new EditorCore()
    const platform = createFakePlatform()
    const doc = attached(core, platform, 10)
    draw(core)
    await vi.advanceTimersByTimeAsync(40)
    expect(platform.files.has(RECOVERY)).toBe(true)

    platform.askSaveResult = "discard"
    await expect(platform.closeHandlers[0]!()).resolves.toBe(true)
    await vi.advanceTimersByTimeAsync(10)
    expect(platform.files.has(RECOVERY)).toBe(false)
    expect(platform.files.has(RECOVERY_META)).toBe(false)
    doc.dispose()
  })

  test("an autosave still in flight when the user saves does not leave a stale recovery", async () => {
    const core = new EditorCore()
    const platform = createFakePlatform()
    const doc = attached(core, platform, 5)
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const write = platform.fs.writeText
    platform.fs.writeText = async (path, contents) => {
      if (path === RECOVERY) await gate
      return write(path, contents)
    }
    draw(core)
    await new Promise((r) => setTimeout(r, 20))
    await doc.save()
    release()
    await new Promise((r) => setTimeout(r, 5))

    const next = attached(new EditorCore(), platform)
    await expect(next.recover()).resolves.toBe(false)
    doc.dispose()
    next.dispose()
  })
})

describe("IO clipboard and drop", () => {
  test("a pasted copy does not stay a member of a frame that was not copied", async () => {
    const core = new EditorCore()
    const platform = createFakePlatform()
    let clip = ""
    platform.clipboard.writeText = async (t) => {
      clip = t
    }
    platform.clipboard.readText = async () => clip

    const frame = newElement("frame", { x: 0, y: 0, width: 200, height: 200, index: "a0" })
    const child = newElement("rectangle", {
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      index: "a1",
      frameId: frame.id,
    })
    core.loadScene([frame, child])
    core.setAppState({ selectedElementIds: { [child.id]: true } })
    await copySelection(core, platform)
    await pasteAt(core, platform, [900, 900])

    const pasted = core.scene.getNonDeleted().filter((e) => e.id !== frame.id && e.id !== child.id)
    expect(pasted).toHaveLength(1)
    expect(pasted[0]!.frameId).toBeNull()
  })

  test("dropping an exported SVG that carries a scene opens that scene", async () => {
    const core = new EditorCore()
    const elements = [newElement("rectangle", { x: 0, y: 0, width: 10, height: 10, index: "a0" })]
    const scene = serializeNib(elements, DEFAULT_APP_STATE)
    const svg = exportToSvg({
      elements,
      appState: DEFAULT_APP_STATE,
      exportBackground: false,
      exportPadding: 0,
      scale: 1,
      theme: "light",
      embedScene: scene,
    })
    const result = await ingestFiles(core, [new File([svg], "board.svg", { type: "image/svg+xml" })], [0, 0])
    expect(result.scenes.map((s) => [s.text, s.name])).toEqual([[scene, "board"]])
  })

  test("an SVG with an upper-case extension and no MIME type is still recognised", async () => {
    const core = new EditorCore()
    const elements = [newElement("rectangle", { x: 0, y: 0, width: 10, height: 10, index: "a0" })]
    const scene = serializeNib(elements, DEFAULT_APP_STATE)
    const svg = exportToSvg({
      elements,
      appState: DEFAULT_APP_STATE,
      exportBackground: false,
      exportPadding: 0,
      scale: 1,
      theme: "light",
      embedScene: scene,
    })
    const result = await ingestFiles(core, [new File([svg], "BOARD.SVG")], [0, 0])
    expect(result.scenes.map((s) => s.name)).toEqual(["BOARD"])
  })
})

describe("IO paste sources", () => {
  test("a paste event's own text is used, without reading the system clipboard", async () => {
    const core = new EditorCore()
    const platform = createFakePlatform()
    const readText = vi.fn(async () => "from the system clipboard")
    platform.clipboard.readText = readText
    expect(await pasteAt(core, platform, [0, 0], { text: "hello" })).toBe(true)
    expect(readText).not.toHaveBeenCalled()
    const editing = core.scene.get(core.appState.editingTextId ?? "")
    expect(editing && editing.type === "text" ? editing.text : null).toBe("hello")
  })

  test("an empty system clipboard does not paste a stale internal copy", async () => {
    const core = new EditorCore()
    const platform = createFakePlatform()
    core.loadScene([newElement("rectangle", { x: 0, y: 0, width: 10, height: 10, index: "a0" })])
    core.selectAll()
    await copySelection(core, platform)
    platform.clipboard.readText = async () => ""
    expect(await pasteAt(core, platform, [100, 100])).toBe(false)
    expect(core.scene.getNonDeleted()).toHaveLength(1)
  })

  test("the internal copy is still used when the clipboard can't be read at all", async () => {
    const core = new EditorCore()
    const platform = createFakePlatform()
    core.loadScene([newElement("rectangle", { x: 0, y: 0, width: 10, height: 10, index: "a0" })])
    core.selectAll()
    await copySelection(core, platform)
    platform.clipboard.readText = async () => {
      throw new Error("NotAllowedError")
    }
    expect(await pasteAt(core, platform, [100, 100])).toBe(true)
    expect(core.scene.getNonDeleted()).toHaveLength(2)
  })
})

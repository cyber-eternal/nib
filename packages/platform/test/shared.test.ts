import { describe, expect, it, vi } from "vitest"
import {
  DOCUMENT_EXTENSION,
  SCENE_EXTENSIONS,
  clipboardItemData,
  createFileWatcher,
  createLocalPrefs,
  createMirroredPrefs,
  filtersFor,
  isExternalUrl,
  isSceneFile,
  isTextEntry,
  mimeFor,
  toExternalUrl,
  toStorageError,
  withExtension,
} from "../src/shared"

describe("external links", () => {
  it("allows only http, https and mailto", () => {
    expect(isExternalUrl("https://example.com/a?b=1")).toBe(true)
    expect(isExternalUrl("http://example.com")).toBe(true)
    expect(isExternalUrl("mailto:someone@example.com")).toBe(true)
    expect(isExternalUrl('javascript:localStorage.setItem("x",document.domain)')).toBe(false)
    expect(isExternalUrl("JAVASCRIPT:alert(1)")).toBe(false)
    expect(isExternalUrl("file:///etc/passwd")).toBe(false)
    expect(isExternalUrl("data:text/html,<script>alert(1)</script>")).toBe(false)
    expect(isExternalUrl("#element=abc")).toBe(false)
    expect(isExternalUrl("vscode://open")).toBe(false)
    expect(isExternalUrl("")).toBe(false)
    expect(isExternalUrl("example.com")).toBe(false)
  })

  it("rejects control characters that URL() would silently strip", () => {
    expect(isExternalUrl("java\tscript:alert(1)")).toBe(false)
    expect(isExternalUrl("https://exa\nmple.com")).toBe(false)
  })

  it("returns the normalised href", () => {
    expect(toExternalUrl("  https://Example.com/a b ")).toBe("https://example.com/a%20b")
    expect(toExternalUrl("https:///nohost")).toBe("https://nohost/")
    expect(toExternalUrl("http://")).toBeNull()
  })
})

describe("scene files", () => {
  it("matches extensions case-insensitively", () => {
    expect(isSceneFile("/Users/a/Board.nibd")).toBe(true)
    expect(isSceneFile("/Users/a/Board.NIBD")).toBe(true)
    expect(isSceneFile("/Users/a/diagram.Excalidraw")).toBe(true)
    expect(isSceneFile("/Users/a/photo.png")).toBe(false)
    expect(isSceneFile("/Users/a/MainMenu.nib")).toBe(false)
    expect(isSceneFile("/Users/a/old.txt")).toBe(false)
    expect(isSceneFile("/Users/a.nibd/notes")).toBe(false)
  })

  it("saves new drawings as .nibd", () => {
    expect(DOCUMENT_EXTENSION).toBe("nibd")
    expect(SCENE_EXTENSIONS).toEqual(["nibd", "excalidraw"])
    expect(mimeFor("Board.nibd")).toBe("application/json")
  })
})

describe("save filters", () => {
  it("infers one filter from the suggested name", () => {
    expect(filtersFor("diagram.svg")).toEqual([{ name: "SVG image", extensions: ["svg"] }])
    expect(filtersFor("board.excalidraw")).toEqual([
      { name: "Excalidraw drawing", extensions: ["excalidraw"] },
    ])
    expect(filtersFor("board.nibd")).toEqual([{ name: "Nib drawing", extensions: ["nibd"] }])
    expect(filtersFor("Untitled")).toEqual([{ name: "Nib drawing", extensions: ["nibd"] }])
    expect(filtersFor("board.txt")).toEqual([{ name: "Nib drawing", extensions: ["nibd"] }])
  })

  it("keeps explicit filters", () => {
    const filters = [{ name: "Library", extensions: ["excalidrawlib"] }]
    expect(filtersFor("x.nibd", filters)).toBe(filters)
  })

  it("enforces the extension", () => {
    const svg = [{ name: "SVG image", extensions: ["svg"] }]
    expect(withExtension("diagram", svg)).toBe("diagram.svg")
    expect(withExtension("diagram.SVG", svg)).toBe("diagram.SVG")
    expect(withExtension("diagram.nibd", svg)).toBe("diagram.nibd.svg")
    expect(withExtension("diagram.", svg)).toBe("diagram.svg")
    const nib = filtersFor("Untitled")
    expect(withExtension("Plan", nib)).toBe("Plan.nibd")
    expect(withExtension("Plan.NIBD", nib)).toBe("Plan.NIBD")
  })
})

describe("prefs", () => {
  it("round-trips and removes values", () => {
    const backing = new Map<string, string>()
    const storage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    } as unknown as Storage
    const prefs = createLocalPrefs(() => storage)
    expect(prefs.get("nib.theme")).toBeNull()
    prefs.set("nib.theme", "blackboard")
    expect(prefs.get("nib.theme")).toBe("blackboard")
    expect(backing.get("nib.theme")).toBe("blackboard")
    prefs.set("nib.theme", null)
    expect(prefs.get("nib.theme")).toBeNull()
  })

  it("never throws when storage is blocked or full", () => {
    const blocked = createLocalPrefs(() => {
      throw new Error("SecurityError")
    })
    expect(() => blocked.set("k", "v")).not.toThrow()
    expect(blocked.get("k")).toBe("v")

    const full = createLocalPrefs(
      () =>
        ({
          getItem: () => null,
          setItem: () => {
            throw new DOMException("full", "QuotaExceededError")
          },
          removeItem: () => {},
        }) as unknown as Storage,
    )
    expect(() => full.set("k", "v")).not.toThrow()
  })

  // the old version returned the unsaved value only when nothing was stored yet, and the stored one
  // otherwise, so a reader (LibraryStore) could not reliably tell that a write was lost
  it("keeps returning what is stored when a write doesn't fit", () => {
    const backing = new Map([["nib.library", "old"]])
    let full = false
    const storage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (full) throw new DOMException("full", "QuotaExceededError")
        backing.set(k, v)
      },
      removeItem: (k: string) => void backing.delete(k),
    } as unknown as Storage
    const prefs = createLocalPrefs(() => storage)
    full = true
    prefs.set("nib.library", "new")
    prefs.set("nib.theme", "kraft")
    expect(prefs.get("nib.library")).toBe("old")
    expect(prefs.get("nib.theme")).toBeNull()
    full = false
    prefs.set("nib.theme", "kraft")
    expect(prefs.get("nib.theme")).toBe("kraft")
  })
})

const memoryStorage = (entries: [string, string][] = []) => {
  const backing = new Map(entries)
  return {
    backing,
    storage: {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    } as unknown as Storage,
  }
}

describe("desktop prefs mirror", () => {
  it("mirrors every write to the shell in order, with a rising revision", async () => {
    const { storage } = memoryStorage()
    const seen: [string, string | null, number][] = []
    let release!: () => void
    const first = new Promise<void>((r) => {
      release = r
    })
    const mirror = vi.fn(async (key: string, value: string | null, rev: number) => {
      if (seen.length === 0) await first
      seen.push([key, value, rev])
    })
    const prefs = createMirroredPrefs({ mirror, storage: () => storage })
    prefs.set("nib.theme", "kraft")
    prefs.set("nib.theme", "mint")
    expect(prefs.get("nib.theme")).toBe("mint")
    release()
    await new Promise((r) => setTimeout(r, 0))
    expect(seen).toEqual([
      ["nib.theme", "kraft", 1],
      ["nib.theme", "mint", 2],
    ])
  })

  it("repairs localStorage from the shell's newer copy (writes WebKit lost at quit)", () => {
    const { storage, backing } = memoryStorage([
      ["nib:prefs:rev", "3"],
      ["nib.theme", "kraft"],
      ["nib.grid", "on"],
    ])
    const prefs = createMirroredPrefs({
      boot: { rev: 5, values: { "nib.theme": "midnight", "nib.grid": null } },
      mirror: async () => {},
      storage: () => storage,
    })
    expect(prefs.get("nib.theme")).toBe("midnight")
    expect(prefs.get("nib.grid")).toBeNull()
    expect(backing.get("nib:prefs:rev")).toBe("5")
    prefs.set("nib.theme", "mint")
    expect(backing.get("nib:prefs:rev")).toBe("6")
  })

  it("ignores an older shell copy", () => {
    const { storage } = memoryStorage([
      ["nib:prefs:rev", "9"],
      ["nib.theme", "kraft"],
    ])
    const prefs = createMirroredPrefs({
      boot: { rev: 4, values: { "nib.theme": "midnight" } },
      mirror: async () => {},
      storage: () => storage,
    })
    expect(prefs.get("nib.theme")).toBe("kraft")
  })

  it("keeps working when the shell refuses a write", async () => {
    const { storage } = memoryStorage()
    const log = vi.fn()
    const prefs = createMirroredPrefs({
      mirror: async () => {
        throw new Error("the value of nib.big is larger than 64 KB")
      },
      storage: () => storage,
      log,
    })
    prefs.set("nib.big", "x")
    prefs.set("nib.theme", "kraft")
    await new Promise((r) => setTimeout(r, 0))
    expect(prefs.get("nib.theme")).toBe("kraft")
    expect(log).toHaveBeenCalledTimes(1)
  })
})

describe("external-change detection", () => {
  const setup = () => {
    const disk = new Map<string, string | null>([["/d/plan.nibd", "1"]])
    const stamp = vi.fn(async (path: string) => {
      if (!disk.has(path)) throw new Error("forbidden path")
      return disk.get(path) ?? null
    })
    const watcher = createFileWatcher(stamp, { intervalMs: 0 })
    return { disk, stamp, watcher }
  }

  it("reports another app's edit once, and a deletion", async () => {
    const { disk, watcher } = setup()
    await watcher.track("/d/plan.nibd")
    const changes: string[] = []
    watcher.watch("/d/plan.nibd", (c) => changes.push(c))
    await watcher.check()
    expect(changes).toEqual([])
    disk.set("/d/plan.nibd", "2")
    await watcher.check()
    await watcher.check()
    expect(changes).toEqual(["modified"])
    disk.set("/d/plan.nibd", null)
    await watcher.check()
    expect(changes).toEqual(["modified", "deleted"])
  })

  it("never reports Nib's own writes, even when a check overlaps them", async () => {
    const { disk, stamp, watcher } = setup()
    await watcher.track("/d/plan.nibd")
    const changes: string[] = []
    watcher.watch("/d/plan.nibd", (c) => changes.push(c))
    let finishWrite!: () => void
    const saving = watcher.writing(
      "/d/plan.nibd",
      () =>
        new Promise<void>((r) => {
          finishWrite = () => {
            disk.set("/d/plan.nibd", "saved")
            r()
          }
        }),
    )
    await watcher.check()
    finishWrite()
    await saving
    await watcher.check()
    expect(changes).toEqual([])
    expect(stamp).toHaveBeenCalled()
  })

  it("discards a check that started before Nib's own write", async () => {
    const { disk, watcher } = setup()
    await watcher.track("/d/plan.nibd")
    const changes: string[] = []
    watcher.watch("/d/plan.nibd", (c) => changes.push(c))
    const checking = watcher.check()
    await watcher.writing("/d/plan.nibd", async () => {
      disk.set("/d/plan.nibd", "saved")
    })
    await checking
    await watcher.check()
    expect(changes).toEqual([])
  })

  const rename = (disk: Map<string, string | null>, from: string, to: string) => async () => {
    disk.set(to, disk.get(from) ?? null)
    disk.set(from, null)
    return to
  }

  it("follows Nib's own rename without reporting the old path as deleted", async () => {
    const { disk, watcher } = setup()
    await watcher.track("/d/plan.nibd")
    const changes: string[] = []
    watcher.watch("/d/plan.nibd", (c) => changes.push(c))
    const to = await watcher.moving("/d/plan.nibd", rename(disk, "/d/plan.nibd", "/d/Renamed.nibd"))
    expect(to).toBe("/d/Renamed.nibd")
    await watcher.check()
    expect(changes).toEqual([])
    await expect(watcher.verify("/d/Renamed.nibd")).resolves.toBeUndefined()
  })

  it("still stops a save over another app's edit made before Nib renamed the file", async () => {
    const { disk, watcher } = setup()
    await watcher.track("/d/plan.nibd")
    disk.set("/d/plan.nibd", "theirs")
    await watcher.moving("/d/plan.nibd", rename(disk, "/d/plan.nibd", "/d/Renamed.nibd"))
    await expect(watcher.verify("/d/Renamed.nibd")).rejects.toMatchObject({ name: "FileChangedError" })
  })

  it("skips files it can't stat and stops after unsubscribe", async () => {
    const { disk, watcher } = setup()
    const changes: string[] = []
    const off = watcher.watch("/elsewhere/x.nibd", (c) => changes.push(c))
    await watcher.check()
    off()
    off()
    disk.set("/elsewhere/x.nibd", "1")
    await watcher.check()
    expect(changes).toEqual([])
  })

  it("stops an in-place write over a change it hasn't reported, once, and lets the retry through", async () => {
    const { disk, watcher } = setup()
    await watcher.track("/d/plan.nibd")
    await expect(watcher.verify("/d/plan.nibd")).resolves.toBeUndefined()
    disk.set("/d/plan.nibd", "2")
    await expect(watcher.verify("/d/plan.nibd")).rejects.toMatchObject({ name: "FileChangedError" })
    await expect(watcher.verify("/d/plan.nibd")).resolves.toBeUndefined()
    // a file that is gone, or one Nib never read, is written without asking
    disk.set("/d/plan.nibd", null)
    await expect(watcher.verify("/d/plan.nibd")).resolves.toBeUndefined()
    await expect(watcher.verify("/d/other.nibd")).resolves.toBeUndefined()
  })

  it("compares the first readable check with the stamp an earlier session saw", async () => {
    const { disk, watcher } = setup()
    const changes: string[] = []
    watcher.watch("/d/plan.nibd", (c) => changes.push(c), { since: "0" })
    await watcher.check()
    expect(changes).toEqual(["modified"])
    disk.set("/d/later.nibd", "5")
    const quiet: string[] = []
    watcher.watch("/d/later.nibd", (c) => quiet.push(c), { since: "5" })
    await watcher.check()
    expect(quiet).toEqual([])
  })

  it("keeps an earlier session's stamp while the file can't be read, for the save to check", async () => {
    const { disk, watcher } = setup()
    const changes: string[] = []
    watcher.watch("/locked/plan.nibd", (c) => changes.push(c), { since: "1" })
    await watcher.check()
    disk.set("/locked/plan.nibd", "2")
    await expect(watcher.verify("/locked/plan.nibd")).rejects.toMatchObject({ name: "FileChangedError" })
    await watcher.check()
    expect(changes).toEqual([])
  })

  it("polls only while something is watched", async () => {
    vi.useFakeTimers()
    try {
      const stamp = vi.fn(async () => "1")
      const watcher = createFileWatcher(stamp, { intervalMs: 1000 })
      const off = watcher.watch("/d/a.nibd", () => {})
      await vi.advanceTimersByTimeAsync(0)
      stamp.mockClear()
      await vi.advanceTimersByTimeAsync(3000)
      expect(stamp).toHaveBeenCalledTimes(3)
      off()
      await vi.advanceTimersByTimeAsync(3000)
      expect(stamp).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("storage errors", () => {
  it("names quota errors consistently", () => {
    const err = toStorageError(new DOMException("exceeded", "QuotaExceededError"))
    expect(err.name).toBe("QuotaExceededError")
    expect(err.message).toMatch(/storage is full/)
    const firefox = Object.assign(new Error("x"), { name: "NS_ERROR_DOM_QUOTA_REACHED" })
    expect(toStorageError(firefox).name).toBe("QuotaExceededError")
    const other = new Error("boom")
    expect(toStorageError(other)).toBe(other)
  })
})

describe("text entry detection", () => {
  it("treats editable fields as text entry", () => {
    expect(isTextEntry({ tagName: "INPUT", type: "text" })).toBe(true)
    expect(isTextEntry({ tagName: "INPUT" })).toBe(true)
    expect(isTextEntry({ tagName: "INPUT", type: "search" })).toBe(true)
    expect(isTextEntry({ tagName: "TEXTAREA" })).toBe(true)
    expect(isTextEntry({ tagName: "DIV", isContentEditable: true })).toBe(true)
  })

  it("leaves buttons, checkboxes and the canvas alone", () => {
    expect(isTextEntry({ tagName: "INPUT", type: "checkbox" })).toBe(false)
    expect(isTextEntry({ tagName: "INPUT", type: "color" })).toBe(false)
    expect(isTextEntry({ tagName: "INPUT", type: "text", readOnly: true })).toBe(false)
    expect(isTextEntry({ tagName: "CANVAS" })).toBe(false)
    expect(isTextEntry({ tagName: "BODY" })).toBe(false)
    expect(isTextEntry(null)).toBe(false)
  })
})

describe("clipboard payload", () => {
  it("puts JSON on text/plain so Nib can read its own copy from a paste event", async () => {
    const data = clipboardItemData({ json: '{"type":"nib/clipboard"}', text: "2 shapes", html: "<b>x</b>" })
    expect(await (data["text/plain"] as Blob).text()).toBe('{"type":"nib/clipboard"}')
    expect(await (data["text/html"] as Blob).text()).toBe("<b>x</b>")
  })

  it("keeps the PNG a promise so the item can be built synchronously", async () => {
    let resolve!: (b: Uint8Array) => void
    const png = new Promise<Uint8Array>((r) => {
      resolve = r
    })
    const data = clipboardItemData({ text: "hi", png })
    expect(data["image/png"]).toBeInstanceOf(Promise)
    resolve(new Uint8Array([137, 80, 78, 71]))
    const blob = await data["image/png"]!
    expect(blob.type).toBe("image/png")
    expect(blob.size).toBe(4)
  })

  it("skips SVG where ClipboardItem can't carry it", () => {
    expect(clipboardItemData({ svg: "<svg/>" })["image/svg+xml"]).toBeUndefined()
  })
})

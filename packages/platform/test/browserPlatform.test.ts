import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

class MemoryStorage {
  map = new Map<string, string>()
  failWrites = false
  get length() {
    return this.map.size
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null
  }
  getItem(k: string) {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new DOMException("The quota has been exceeded.", "QuotaExceededError")
    this.map.set(k, v)
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
}

/** Web Locks stand-in: a held name stays held until the "tab" closes. */
class FakeLocks {
  held = new Set<string>()
  async request(name: string, _opts: { ifAvailable: boolean }, cb: (lock: unknown) => unknown) {
    if (this.held.has(name)) return cb(null)
    this.held.add(name)
    return cb({ name })
  }
}

let local: MemoryStorage
let session: MemoryStorage
let locks: FakeLocks
const listeners = new Map<string, Set<(e: unknown) => void>>()
const fakeWindow = {
  addEventListener: (type: string, l: (e: unknown) => void) => {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type)!.add(l)
  },
  removeEventListener: (type: string, l: (e: unknown) => void) => listeners.get(type)?.delete(l),
  confirm: vi.fn(() => true),
  alert: vi.fn(),
  open: vi.fn(),
}
const downloads: { name: string; type: string }[] = []

/** A fresh module instance per tab, as each tab has its own page. */
const newTab = async (sessionStore = new MemoryStorage()) => {
  session = sessionStore
  vi.stubGlobal("sessionStorage", session)
  vi.resetModules()
  const { createBrowserPlatform } = await import("../src/browserPlatform")
  return createBrowserPlatform()
}

beforeEach(() => {
  local = new MemoryStorage()
  locks = new FakeLocks()
  listeners.clear()
  downloads.length = 0
  vi.stubGlobal("localStorage", local)
  vi.stubGlobal("navigator", { locks })
  vi.stubGlobal("window", fakeWindow)
  vi.stubGlobal("indexedDB", undefined)
  let lastBlob: Blob | null = null
  const createObjectURL = (b: Blob) => {
    lastBlob = b
    return "blob:x"
  }
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL }))
  vi.stubGlobal("document", {
    title: "",
    createElement: () => {
      const a = {
        href: "",
        download: "",
        click: () => downloads.push({ name: a.download, type: lastBlob!.type }),
      }
      return a
    },
  })
  fakeWindow.confirm.mockReset()
  fakeWindow.open.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("browser recovery slots", () => {
  it("gives each open tab its own slot", async () => {
    const a = await newTab()
    const b = await newTab()
    const dirA = await a.fs.appDataDir()
    const dirB = await b.fs.appDataDir()
    expect(dirA).not.toBe(dirB)
    await a.fs.writeText(`${dirA}/recovery/current.nibd`, "A")
    await b.fs.writeText(`${dirB}/recovery/current.nibd`, "B")
    expect(await a.fs.readText(`${dirA}/recovery/current.nibd`)).toBe("A")
    expect(await b.fs.readText(`${dirB}/recovery/current.nibd`)).toBe("B")
  })

  it("shares one slot between platform instances in the same page", async () => {
    const first = await newTab()
    const { createBrowserPlatform } = await import("../src/browserPlatform")
    expect(await createBrowserPlatform().fs.appDataDir()).toBe(await first.fs.appDataDir())
  })

  it("keeps the slot across a reload of the same tab", async () => {
    const tabSession = new MemoryStorage()
    const dir = await (await newTab(tabSession)).fs.appDataDir()
    locks.held.clear()
    expect(await (await newTab(tabSession)).fs.appDataDir()).toBe(dir)
  })

  it("lets a fresh tab adopt the newest slot left by a closed tab", async () => {
    const closed = await newTab()
    const dir = await closed.fs.appDataDir()
    await closed.fs.writeText(`${dir}/recovery/current.meta.json`, "{}")
    locks.held.clear()
    expect(await (await newTab()).fs.appDataDir()).toBe(dir)
  })

  it("never adopts a slot a live tab still holds", async () => {
    const live = await newTab()
    const dir = await live.fs.appDataDir()
    await live.fs.writeText(`${dir}/recovery/current.meta.json`, "{}")
    expect(await (await newTab()).fs.appDataDir()).not.toBe(dir)
  })

  it("keeps its open drawing tabs beside their copies, so a reopened browser tab brings them back", async () => {
    const closed = await newTab()
    expect(await closed.session!.restore()).toBeNull()
    await closed.session!.save(
      [
        { slot: "t1", path: "fsa:abc/Plan.nibd", viewport: { scrollX: 3, scrollY: 4, zoom: 2 } },
        { slot: "t2", path: null, viewport: null },
      ],
      1,
    )
    locks.held.clear()
    const reopened = await newTab()
    // file handles need a click before they can be read, so every tab comes back from its copy
    expect(await reopened.session!.restore()).toEqual({
      tabs: [
        { slot: "t1", open: null, viewport: { scrollX: 3, scrollY: 4, zoom: 2 } },
        { slot: "t2", open: null, viewport: null },
      ],
      active: 1,
      notices: [],
    })
  })

  it("brings back the single drawing an earlier version left as one tab", async () => {
    const closed = await newTab()
    const dir = await closed.fs.appDataDir()
    await closed.fs.writeText(`${dir}/recovery/current.meta.json`, "{}")
    locks.held.clear()
    expect(await (await newTab()).session!.restore()).toEqual({
      tabs: [{ slot: "current", open: null, viewport: null }],
      active: 0,
      notices: [],
    })
  })

  it("gives a duplicated tab (copied sessionStorage) a new slot", async () => {
    const original = new MemoryStorage()
    const dir = await (await newTab(original)).fs.appDataDir()
    const copy = new MemoryStorage()
    copy.map = new Map(original.map)
    expect(await (await newTab(copy)).fs.appDataDir()).not.toBe(dir)
  })

  it("surfaces a full storage quota as a named error", async () => {
    const tab = await newTab()
    const dir = await tab.fs.appDataDir()
    local.failWrites = true
    await expect(tab.fs.writeText(`${dir}/recovery/current.nibd`, "x")).rejects.toMatchObject({
      name: "QuotaExceededError",
    })
  })

  it("removes and reports missing files", async () => {
    const tab = await newTab()
    const dir = await tab.fs.appDataDir()
    await tab.fs.writeText(`${dir}/a`, "1")
    expect(await tab.fs.exists(`${dir}/a`)).toBe(true)
    await tab.fs.remove(`${dir}/a`)
    expect(await tab.fs.exists(`${dir}/a`)).toBe(false)
    await expect(tab.fs.readText(`${dir}/a`)).rejects.toThrow(/Not found/)
  })
})

describe("browser close guard", () => {
  const fire = () => {
    const e = { returnValue: undefined as unknown, defaultPrevented: false, preventDefault: vi.fn() }
    for (const l of listeners.get("beforeunload") ?? []) l(e)
    return e
  }

  it("asks the browser to confirm synchronously only when the document is dirty", async () => {
    const p = await newTab()
    p.window.onCloseRequested(async () => false)
    expect(fire().preventDefault).not.toHaveBeenCalled()
    await p.window.setDocumentEdited(true)
    const e = fire()
    expect(e.preventDefault).toHaveBeenCalled()
    expect(e.returnValue).toBe("")
  })

  it("prefers the caller's synchronous dirty check", async () => {
    const p = await newTab()
    let dirty = true
    p.window.onCloseRequested(async () => true, { isDirty: () => dirty })
    expect(fire().preventDefault).toHaveBeenCalled()
    dirty = false
    expect(fire().preventDefault).not.toHaveBeenCalled()
  })

  it("returns an idempotent unsubscribe", async () => {
    const p = await newTab()
    const off = p.window.onCloseRequested(async () => true, { isDirty: () => true })
    expect(listeners.get("beforeunload")?.size).toBe(1)
    off()
    off()
    expect(listeners.get("beforeunload")?.size).toBe(0)
  })
})

describe("browser links, dialogs and files", () => {
  it("opens only safe links", async () => {
    const p = await newTab()
    await expect(p.openExternal('javascript:localStorage.setItem("x",1)')).rejects.toThrow()
    await expect(p.openExternal("file:///etc/passwd")).rejects.toThrow()
    expect(fakeWindow.open).not.toHaveBeenCalled()
    await p.openExternal(" https://example.com/x ")
    expect(fakeWindow.open).toHaveBeenCalledWith("https://example.com/x", "_blank", "noopener,noreferrer")
  })

  it("maps the unsaved-changes question onto confirm", async () => {
    const p = await newTab()
    fakeWindow.confirm.mockReturnValueOnce(true)
    await expect(p.dialogs.askSave("Plan")).resolves.toBe("discard")
    expect(fakeWindow.confirm.mock.calls[0]![0]).toContain('"Plan"')
    fakeWindow.confirm.mockReturnValueOnce(false)
    await expect(p.dialogs.askSave("Plan")).resolves.toBe("cancel")
    fakeWindow.confirm.mockReturnValueOnce(true)
    await expect(p.dialogs.confirm("Reset?")).resolves.toBe(true)
  })

  it("downloads with the format's extension and MIME type", async () => {
    const p = await newTab()
    await p.fs.saveDocument("<svg/>", null, "diagram", [{ name: "SVG image", extensions: ["svg"] }])
    await p.fs.saveDocument("{}", null, "board.excalidraw")
    expect(downloads).toEqual([
      { name: "diagram.svg", type: "image/svg+xml" },
      { name: "board.excalidraw", type: "application/json" },
    ])
  })

  it("says it can't reopen saved files by path", async () => {
    expect((await newTab()).capabilities?.reopenByPath).toBe(false)
  })
})

describe("browser clipboard", () => {
  it("creates the ClipboardItem before the PNG is ready", async () => {
    const built: Record<string, unknown>[] = []
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(data: Record<string, unknown>) {
          built.push(data)
        }
      },
    )
    const write = vi.fn(async () => {})
    vi.stubGlobal("navigator", { locks, clipboard: { write } })
    let resolve!: (b: Uint8Array) => void
    const png = new Promise<Uint8Array>((r) => {
      resolve = r
    })
    const done = (await newTab()).clipboard.writeImage!(png)
    expect(built).toHaveLength(1)
    expect(write).toHaveBeenCalledTimes(1)
    resolve(new Uint8Array([1, 2, 3]))
    await done
    expect(((await built[0]!["image/png"]) as Blob).size).toBe(3)
  })

  it("rejects readText with a named error when the API is missing", async () => {
    vi.stubGlobal("navigator", { locks })
    await expect((await newTab()).clipboard.readText()).rejects.toMatchObject({ name: "NotAllowedError" })
  })
})

class FakeHandle {
  readonly kind = "file"
  permission: "granted" | "prompt" | "denied" = "granted"
  deleted = false
  writes = 0
  constructor(
    public name: string,
    public content = "",
    public lastModified = 1,
  ) {}
  async getFile() {
    if (this.deleted) throw new DOMException("gone", "NotFoundError")
    const { name, lastModified, content } = this
    return { name, lastModified, size: content.length, text: async () => content }
  }
  async createWritable() {
    let next = ""
    return {
      write: async (d: unknown) => {
        next += typeof d === "string" ? d : "[bytes]"
      },
      close: async () => {
        this.content = next
        this.lastModified++
        this.writes++
      },
    }
  }
  async isSameEntry(other: unknown) {
    return other === this
  }
  async queryPermission() {
    return this.permission
  }
  async requestPermission() {
    if (this.permission === "prompt") this.permission = "granted"
    return this.permission
  }
}

const abort = () => new DOMException("The user aborted a request.", "AbortError")

describe("File System Access save-in-place", () => {
  const withPickers = (opts: { save?: () => Promise<FakeHandle>; open?: () => Promise<FakeHandle[]> }) => {
    const save = vi.fn(opts.save ?? (async () => new FakeHandle("board.nibd")))
    const open = vi.fn(opts.open ?? (async () => [new FakeHandle("board.nibd", "{}")]))
    vi.stubGlobal("showSaveFilePicker", save)
    vi.stubGlobal("showOpenFilePicker", open)
    return { save, open }
  }

  it("saves through the picker, then writes back to the same file without asking", async () => {
    const handle = new FakeHandle("plan.nibd")
    const { save } = withPickers({ save: async () => handle })
    const p = await newTab()
    expect(p.capabilities).toMatchObject({ reopenByPath: false, saveInPlace: true })
    const path = await p.fs.saveDocument('{"v":1}', null, "plan.nibd")
    expect(path).toMatch(/^fsa:[^/]+\/plan\.nibd$/)
    expect(save.mock.calls[0]![0]).toMatchObject({
      suggestedName: "plan.nibd",
      types: [{ description: "Nib drawing", accept: { "application/json": [".nibd"] } }],
    })
    await expect(p.fs.saveDocument('{"v":2}', path, "plan.nibd")).resolves.toBe(path)
    expect(save).toHaveBeenCalledTimes(1)
    expect(handle.content).toBe('{"v":2}')
    expect(downloads).toEqual([])
  })

  it("asks for write permission again after a reload, and picks anew when refused", async () => {
    const handle = new FakeHandle("plan.nibd")
    const { save } = withPickers({ save: async () => handle })
    const p = await newTab()
    const path = (await p.fs.saveDocument("1", null, "plan.nibd"))!
    handle.permission = "prompt"
    await p.fs.saveDocument("2", path, "plan.nibd")
    expect(handle.content).toBe("2")
    handle.permission = "denied"
    save.mockResolvedValueOnce(new FakeHandle("copy.nibd"))
    const other = await p.fs.saveDocument("3", path, "plan.nibd")
    expect(other).toMatch(/copy\.nibd$/)
    expect(handle.content).toBe("2")
  })

  it("rejects a cancelled picker with an AbortError instead of reporting a download", async () => {
    withPickers({ save: async () => Promise.reject(abort()) })
    const p = await newTab()
    await expect(p.fs.saveDocument("{}", null, "plan.nibd")).rejects.toMatchObject({ name: "AbortError" })
    // an image export cancels the same way, so the Export dialog stays open
    await expect(p.fs.saveBinary(new Uint8Array([1]), "plan.png", [])).rejects.toMatchObject({
      name: "AbortError",
    })
    expect(downloads).toEqual([])
  })

  it("refuses to save over an edit another app made while the tab was closed", async () => {
    vi.stubGlobal("indexedDB", new FakeIndexedDb())
    const handle = new FakeHandle("plan.nibd", "v1")
    withPickers({ save: async () => handle })
    const first = await newTab()
    const path = (await first.fs.saveDocument("v1", null, "plan.nibd"))!
    const stamp = await first.fs.stamp!(path)
    expect(stamp).toBe(`${handle.lastModified}:2`)

    handle.permission = "prompt"
    const reloaded = await newTab()
    const changes: string[] = []
    reloaded.fs.watch!(path, (c) => changes.push(c), { since: stamp })
    await new Promise((r) => setTimeout(r, 0))
    // no permission yet: the check can't read the file and stays quiet
    await expect(reloaded.fs.stamp!(path)).rejects.toThrow()
    handle.content = "theirs"
    handle.lastModified += 5

    await expect(reloaded.fs.saveDocument("mine", path, "plan.nibd")).rejects.toMatchObject({
      name: "FileChangedError",
    })
    expect(handle.content).toBe("theirs")
    await expect(reloaded.fs.saveDocument("mine", path, "plan.nibd")).resolves.toBe(path)
    expect(handle.content).toBe("mine")
    expect(changes).toEqual([])
  })

  it("reports at the first readable check that the file changed since the stamp an earlier tab saw", async () => {
    vi.stubGlobal("indexedDB", new FakeIndexedDb())
    const handle = new FakeHandle("plan.nibd", "v1")
    withPickers({ save: async () => handle })
    const path = (await (await newTab()).fs.saveDocument("v1", null, "plan.nibd"))!
    const reloaded = await newTab()
    const changes: string[] = []
    reloaded.fs.watch!(path, (c) => changes.push(c), { since: "1:2" })
    await new Promise((r) => setTimeout(r, 0))
    expect(changes).toEqual(["modified"])
  })

  it("falls back to a download when the picker can't be shown", async () => {
    withPickers({ save: async () => Promise.reject(new DOMException("no gesture", "SecurityError")) })
    const p = await newTab()
    await expect(p.fs.saveDocument("{}", null, "plan.nibd")).resolves.toBeNull()
    expect(downloads).toEqual([{ name: "plan.nibd", type: "application/json" }])
  })

  it("downloads where the API is missing", async () => {
    const p = await newTab()
    expect(p.capabilities?.saveInPlace).toBe(false)
    await expect(p.fs.saveDocument("{}", null, "plan.nibd")).resolves.toBeNull()
    expect(downloads).toHaveLength(1)
  })

  it("opens through the picker with a path that reads back and saves in place", async () => {
    const handle = new FakeHandle("trip.nibd", '{"type":"nib"}')
    const { open } = withPickers({ open: async () => [handle] })
    const p = await newTab()
    const opened = await p.fs.openDocument([{ name: "Nib drawing", extensions: ["nibd", "excalidraw"] }])
    expect(open.mock.calls[0]![0]).toMatchObject({
      types: [{ description: "Nib drawing", accept: { "application/json": [".nibd", ".excalidraw"] } }],
    })
    expect(opened).toMatchObject({ name: "trip.nibd", contents: '{"type":"nib"}' })
    expect(opened!.path).toMatch(/^fsa:/)
    expect(await p.fs.readText(opened!.path!)).toBe('{"type":"nib"}')
    await p.fs.writeText(opened!.path!, "new")
    expect(handle.content).toBe("new")
    expect(await p.fs.exists(opened!.path!)).toBe(true)
    await expect(p.fs.remove(opened!.path!)).rejects.toThrow()
  })

  it("treats a cancelled open as no file", async () => {
    withPickers({ open: async () => Promise.reject(abort()) })
    await expect((await newTab()).fs.openDocument([])).resolves.toBeNull()
  })

  it("notices another app changing the open file when the tab regains focus", async () => {
    const handle = new FakeHandle("trip.nibd", "{}")
    withPickers({ open: async () => [handle] })
    const p = await newTab()
    const { path } = (await p.fs.openDocument([]))!
    const changes: string[] = []
    p.fs.watch!(path!, (c) => changes.push(c))
    await p.fs.saveDocument("mine", path, "trip.nibd")
    const focus = () => {
      for (const l of listeners.get("focus") ?? []) l({})
    }
    focus()
    await new Promise((r) => setTimeout(r, 0))
    expect(changes).toEqual([])
    handle.content = "theirs"
    handle.lastModified += 10
    focus()
    await new Promise((r) => setTimeout(r, 0))
    expect(changes).toEqual(["modified"])
    handle.deleted = true
    focus()
    await new Promise((r) => setTimeout(r, 0))
    expect(changes).toEqual(["modified", "deleted"])
  })

  it("delivers files the OS opened with the installed app", async () => {
    let consumer!: (params: { files: FakeHandle[] }) => void
    vi.stubGlobal("launchQueue", { setConsumer: (c: typeof consumer) => (consumer = c) })
    withPickers({})
    const p = await newTab()
    const seen: string[] = []
    p.onOpenFile!((path) => seen.push(path))
    consumer({ files: [new FakeHandle("from-finder.nibd", '{"a":1}')] })
    await new Promise((r) => setTimeout(r, 0))
    expect(seen).toHaveLength(1)
    expect(await p.fs.readText(seen[0]!)).toBe('{"a":1}')
  })
})

/**
 * Just enough IndexedDB for the platform: databases persist across "tabs" while the test runs. Writes
 * land when their transaction commits, after the request reported success, which is also where a full
 * quota aborts them (abortCommits).
 */
class FakeIndexedDb {
  dbs = new Map<string, Map<string, Map<unknown, unknown>>>()
  abortCommits: DOMException | null = null
  private static request<T>(run: () => T) {
    const req: { result?: T; error?: unknown; onsuccess?: () => void; onerror?: () => void } = {}
    queueMicrotask(() => {
      try {
        req.result = run()
        req.onsuccess?.()
      } catch (e) {
        req.error = e
        req.onerror?.()
      }
    })
    return req
  }
  open(name: string) {
    const req: { result?: unknown; onupgradeneeded?: () => void; onsuccess?: () => void } = {}
    queueMicrotask(() => {
      const fresh = !this.dbs.has(name)
      const stores = this.dbs.get(name) ?? new Map<string, Map<unknown, unknown>>()
      this.dbs.set(name, stores)
      const transaction = (n: string) => {
        const map = stores.get(n)!
        const pending: (() => void)[] = []
        const tx: {
          error: DOMException | null
          oncomplete?: () => void
          onabort?: () => void
          onerror?: () => void
          objectStore: () => unknown
        } = {
          error: null,
          objectStore: () => ({
            get: (k: unknown) => FakeIndexedDb.request(() => map.get(k)),
            put: (v: unknown, k: unknown) => {
              pending.push(() => map.set(k, v))
              return FakeIndexedDb.request(() => undefined)
            },
            delete: (k: unknown) => {
              pending.push(() => map.delete(k))
              return FakeIndexedDb.request(() => undefined)
            },
            getAllKeys: () => FakeIndexedDb.request(() => [...map.keys()]),
          }),
        }
        setTimeout(() => {
          if (pending.length > 0 && this.abortCommits) {
            tx.error = this.abortCommits
            tx.onabort?.()
            return
          }
          for (const apply of pending) apply()
          tx.oncomplete?.()
        }, 0)
        return tx
      }
      req.result = { createObjectStore: (n: string) => stores.set(n, new Map()), transaction }
      if (fresh) req.onupgradeneeded?.()
      req.onsuccess?.()
    })
    return req
  }
}

describe("IndexedDB storage", () => {
  it("keeps recovery in IndexedDB, not localStorage", async () => {
    const idb = new FakeIndexedDb()
    vi.stubGlobal("indexedDB", idb)
    const tab = await newTab()
    const dir = await tab.fs.appDataDir()
    await tab.fs.writeText(`${dir}/recovery/current.nibd`, "big drawing")
    expect([...local.map.keys()].some((k) => k.startsWith("nib:fs:"))).toBe(false)
    expect(idb.dbs.get("nib")!.get("fs")!.get(`${dir}/recovery/current.nibd`)).toBe("big drawing")
    expect(await tab.fs.readText(`${dir}/recovery/current.nibd`)).toBe("big drawing")
  })

  it("reports a full quota that aborts the commit, and keeps the old copy where it was", async () => {
    const idb = new FakeIndexedDb()
    vi.stubGlobal("indexedDB", idb)
    const tab = await newTab()
    const dir = await tab.fs.appDataDir()
    const file = `${dir}/recovery/current.nibd`
    await tab.fs.writeText(file, "first")
    idb.abortCommits = new DOMException("The quota has been exceeded.", "QuotaExceededError")
    await expect(tab.fs.writeText(file, "big drawing")).rejects.toMatchObject({ name: "QuotaExceededError" })
    expect(await tab.fs.readText(file)).toBe("first")
    idb.abortCommits = null
    await tab.fs.writeText(file, "big drawing")
    expect(await tab.fs.readText(file)).toBe("big drawing")
  })

  it("still saves a restored document back to its file after a reload", async () => {
    vi.stubGlobal("indexedDB", new FakeIndexedDb())
    const handle = new FakeHandle("plan.nibd")
    const save = vi.fn(async () => handle)
    vi.stubGlobal("showSaveFilePicker", save)
    vi.stubGlobal("showOpenFilePicker", vi.fn())
    const path = (await (await newTab()).fs.saveDocument("1", null, "plan.nibd"))!
    const reloaded = await newTab()
    await expect(reloaded.fs.saveDocument("2", path, "plan.nibd")).resolves.toBe(path)
    expect(save).toHaveBeenCalledTimes(1)
    expect(handle.content).toBe("2")
  })
})

describe("shared data (library)", () => {
  it("is one folder for every tab and never adopted as a recovery slot", async () => {
    const a = await newTab()
    const shared = await a.fs.sharedDataDir!()
    await a.fs.writeText(`${shared}/library.excalidrawlib`, "lib")
    const b = await newTab()
    expect(await b.fs.sharedDataDir!()).toBe(shared)
    expect(await b.fs.readText(`${shared}/library.excalidrawlib`)).toBe("lib")
    expect(await b.fs.appDataDir()).not.toBe(shared)
    expect(await a.fs.appDataDir()).not.toBe(shared)
  })
})

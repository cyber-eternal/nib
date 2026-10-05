import type { FileFilter, Platform } from "./index"
import { DEFAULT_RECOVERY_SLOT, readRestoredSession, recoveryFiles } from "./session"
import {
  clipboardItemData,
  createFileWatcher,
  createLocalPrefs,
  createOpenFileHub,
  filtersFor,
  mimeFor,
  pngBlob,
  toExternalUrl,
  toStorageError,
  withExtension,
} from "./shared"

const LOCAL_PREFIX = "nib:fs:"
/** Data every tab shares (the library), kept beside the per-tab recovery slots in the same store. */
const SHARED_DIR = "shared"
const SLOT_SESSION_KEY = "nib:slot"
const SLOT_INDEX_KEY = "nib:slots"
const DB_NAME = "nib"
const DB_STORE = "fs"
// a database of its own, so adding it never needs a version upgrade that an older open tab would block
const HANDLE_DB_NAME = "nib-handles"
const HANDLE_STORE = "handles"
const HANDLE_PREFIX = "fsa:"
const PICKER_ID = "nib-documents"

interface KeyValueStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}

const safeStorage = (kind: "localStorage" | "sessionStorage"): Storage | null => {
  try {
    return globalThis[kind] ?? null
  } catch {
    return null
  }
}

const localStore = (): KeyValueStore => ({
  async get(key) {
    return safeStorage("localStorage")?.getItem(LOCAL_PREFIX + key) ?? undefined
  },
  async set(key, value) {
    const storage = safeStorage("localStorage")
    if (!storage) throw new Error("Browser storage is unavailable.")
    storage.setItem(LOCAL_PREFIX + key, value)
  },
  async delete(key) {
    safeStorage("localStorage")?.removeItem(LOCAL_PREFIX + key)
  },
  async keys() {
    const storage = safeStorage("localStorage")
    if (!storage) return []
    const out: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (k?.startsWith(LOCAL_PREFIX)) out.push(k.slice(LOCAL_PREFIX.length))
    }
    return out
  },
})

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

/** Resolves once `tx` is committed. A full quota aborts the commit after the request already succeeded. */
const committed = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new DOMException("The write was aborted.", "AbortError"))
    tx.onerror = (e) => reject((e.target as IDBRequest | null)?.error ?? tx.error)
  })

const openDb = (name: string, store: string): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open(name, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(store)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error("IndexedDB is blocked"))
  })

/** One connection, or null where IndexedDB is missing or refuses to open (some private modes). */
const createDatabase = (name: string, store: string): (() => Promise<IDBDatabase | null>) => {
  let pending: Promise<IDBDatabase | null> | null = null
  return () => {
    pending ??= globalThis.indexedDB ? openDb(name, store).catch(() => null) : Promise.resolve(null)
    return pending
  }
}

/** IndexedDB holds far more than localStorage's ~5 MB, which a drawing with a pasted screenshot exceeds. */
const indexedDbStore = (db: IDBDatabase): KeyValueStore => {
  const tx = (mode: IDBTransactionMode) => db.transaction(DB_STORE, mode).objectStore(DB_STORE)
  const write = async (change: (store: IDBObjectStore) => void): Promise<void> => {
    const t = db.transaction(DB_STORE, "readwrite")
    const done = committed(t)
    change(t.objectStore(DB_STORE))
    await done
  }
  return {
    async get(key) {
      const value = await request(tx("readonly").get(key))
      return typeof value === "string" ? value : undefined
    },
    async set(key, value) {
      await write((store) => store.put(value, key))
    },
    async delete(key) {
      await write((store) => store.delete(key))
    },
    async keys() {
      return (await request(tx("readonly").getAllKeys())).map(String)
    },
  }
}

const createStore = (database: () => Promise<IDBDatabase | null>): (() => Promise<KeyValueStore>) => {
  let pending: Promise<KeyValueStore> | null = null
  return () => {
    pending ??= database().then((db) => (db ? indexedDbStore(db) : localStore()))
    return pending
  }
}

type Permission = "granted" | "denied" | "prompt"

/** The File System Access API surface Nib uses; lib.dom has only part of it. */
interface FileHandle {
  readonly kind: "file"
  readonly name: string
  getFile(): Promise<File>
  createWritable(): Promise<{
    write(data: BlobPart): Promise<void>
    close(): Promise<void>
    abort?(): Promise<void>
  }>
  isSameEntry?(other: FileHandle): Promise<boolean>
  queryPermission?(desc: { mode: "read" | "readwrite" }): Promise<Permission>
  requestPermission?(desc: { mode: "read" | "readwrite" }): Promise<Permission>
}

interface PickerType {
  description: string
  accept: Record<string, string[]>
}

interface FilePickers {
  showOpenFilePicker(opts: { types: PickerType[]; multiple: boolean; id: string }): Promise<FileHandle[]>
  showSaveFilePicker(opts: { types: PickerType[]; suggestedName: string; id: string }): Promise<FileHandle>
}

interface LaunchQueue {
  setConsumer(consumer: (params: { files?: readonly FileHandle[] }) => void): void
}

const filePickers = (): FilePickers | null => {
  const g = globalThis as Partial<FilePickers>
  return typeof g.showOpenFilePicker === "function" && typeof g.showSaveFilePicker === "function"
    ? (g as FilePickers)
    : null
}

const isHandlePath = (path: string): boolean => path.startsWith(HANDLE_PREFIX)

const errorName = (e: unknown): string | undefined => (e as { name?: string } | null)?.name

const pickerTypes = (filters: FileFilter[]): PickerType[] =>
  filters.map((f) => {
    const accept: Record<string, string[]> = {}
    for (const ext of f.extensions) {
      const mime = mimeFor(`file.${ext}`)
      accept[mime] = [...(accept[mime] ?? []), `.${ext}`]
    }
    return { description: f.name, accept }
  })

/**
 * Shows a picker. A cancel rejects with an AbortError; anything else (no user gesture left, a cross-origin
 * frame) resolves null so the caller falls back to a download or a file input.
 */
const pick = async <T>(show: () => Promise<T>): Promise<T | null> => {
  try {
    return await show()
  } catch (e) {
    if (errorName(e) === "AbortError") throw e
    return null
  }
}

const permitted = async (handle: FileHandle, mode: "read" | "readwrite", ask: boolean): Promise<boolean> => {
  if (!handle.queryPermission) return true
  try {
    if ((await handle.queryPermission({ mode })) === "granted") return true
    // asking needs a user gesture, so background checks never do
    return ask && (await handle.requestPermission?.({ mode })) === "granted"
  } catch {
    return false
  }
}

const writeHandle = async (handle: FileHandle, data: BlobPart): Promise<void> => {
  const writable = await handle.createWritable()
  try {
    await writable.write(data)
    await writable.close()
  } catch (e) {
    await writable.abort?.().catch(() => {})
    throw e
  }
}

/**
 * Files picked through the File System Access API are addressed as "fsa:<id>/<name>". The handles are kept
 * in IndexedDB, so a document restored after a reload still saves back to its file (after the browser asks
 * for permission again).
 */
const createHandleRegistry = (database: () => Promise<IDBDatabase | null>) => {
  const handles = new Map<string, FileHandle>()
  const persist = async (path: string, handle: FileHandle) => {
    try {
      const db = await database()
      if (!db) return
      const tx = db.transaction(HANDLE_STORE, "readwrite")
      const done = committed(tx)
      tx.objectStore(HANDLE_STORE).put(handle, path)
      await done
    } catch {
      // without a stored handle the file is only reachable until the page closes
    }
  }
  const load = async (path: string): Promise<FileHandle | null> => {
    try {
      const db = await database()
      if (!db) return null
      const stored = await request(
        db.transaction(HANDLE_STORE, "readonly").objectStore(HANDLE_STORE).get(path),
      )
      return stored && typeof stored === "object" ? (stored as FileHandle) : null
    } catch {
      return null
    }
  }
  return {
    async pathFor(handle: FileHandle): Promise<string> {
      for (const [path, known] of handles) {
        if (await known.isSameEntry?.(handle).catch(() => false)) return path
      }
      const path = `${HANDLE_PREFIX}${randomId()}/${handle.name}`
      handles.set(path, handle)
      await persist(path, handle)
      return path
    },
    async get(path: string): Promise<FileHandle | null> {
      const handle = handles.get(path) ?? (await load(path))
      if (handle) handles.set(path, handle)
      return handle
    },
  }
}

type LockManagerLike = {
  request(
    name: string,
    opts: { ifAvailable: boolean },
    cb: (lock: unknown) => Promise<void> | undefined,
  ): Promise<unknown>
}

const lockManager = (): LockManagerLike | null =>
  (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks ?? null

/** Resolves true and keeps the lock for the tab's lifetime, or false when another tab holds it. */
const holdSlot = (slot: string): Promise<boolean> => {
  const locks = lockManager()
  if (!locks) return Promise.resolve(true)
  return new Promise((resolve) => {
    locks
      .request(`nib:slot:${slot}`, { ifAvailable: true }, (lock) => {
        resolve(lock !== null)
        return lock === null ? undefined : new Promise<void>(() => {})
      })
      .catch(() => resolve(false))
  })
}

const readSlotIndex = (): Record<string, number> => {
  try {
    const raw = safeStorage("localStorage")?.getItem(SLOT_INDEX_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : {}
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}

const touchSlot = (slot: string): void => {
  try {
    const index = readSlotIndex()
    index[slot] = Date.now()
    safeStorage("localStorage")?.setItem(SLOT_INDEX_KEY, JSON.stringify(index))
  } catch {
    // the index only orders recovery candidates; losing it is harmless
  }
}

const randomId = (): string =>
  typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`

const newSlotId = (): string => `tab-${randomId()}`

/**
 * Each tab writes its autosave into its own slot, so two tabs never overwrite each other's recovery.
 * A fresh tab adopts the newest slot no live tab holds (a closed or crashed session), so reopening the
 * browser still restores the last drawing. Duplicated tabs inherit sessionStorage, so the session's slot
 * is only kept when its lock is free.
 */
const claimSlot = async (store: KeyValueStore): Promise<string> => {
  const session = safeStorage("sessionStorage")
  const remember = (slot: string): string => {
    try {
      session?.setItem(SLOT_SESSION_KEY, slot)
    } catch {
      // without sessionStorage a reload adopts the slot again as an orphan
    }
    return slot
  }
  let previous: string | null = null
  try {
    previous = session?.getItem(SLOT_SESSION_KEY) ?? null
  } catch {
    previous = null
  }
  if (previous && (await holdSlot(previous))) return remember(previous)

  const index = readSlotIndex()
  const withData = new Set(
    (await store.keys()).map((k) => k.split("/")[0]!).filter((slot) => slot && slot !== SHARED_DIR),
  )
  const candidates = [...withData]
    .filter((slot) => slot !== previous)
    .sort((a, b) => (index[b] ?? 0) - (index[a] ?? 0))
  for (const slot of candidates) {
    if (await holdSlot(slot)) return remember(slot)
  }
  const fresh = newSlotId()
  await holdSlot(fresh)
  return remember(fresh)
}

/** One per page: a second platform instance in the same tab must not claim a second slot. */
let tabSlot: Promise<string> | null = null

const download = (blob: Blob, name: string): void => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const pickFiles = (filters: FileFilter[], multiple: boolean): Promise<File[]> =>
  new Promise((resolve) => {
    const input = document.createElement("input")
    input.type = "file"
    input.multiple = multiple
    input.accept = filters.flatMap((f) => f.extensions.map((e) => `.${e}`)).join(",")
    input.onchange = () => resolve(Array.from(input.files ?? []))
    input.oncancel = () => resolve([])
    input.click()
  })

const pickFile = async (filters: FileFilter[]): Promise<File | null> =>
  (await pickFiles(filters, false))[0] ?? null

const clipboardApi = (): Clipboard => {
  const clipboard = globalThis.navigator?.clipboard
  if (!clipboard) {
    const err = new Error("This browser does not allow pages to use the clipboard.")
    err.name = "NotAllowedError"
    throw err
  }
  return clipboard
}

/** Re-checks watched files when the user comes back to the tab, where outside edits usually happen. */
const onReturn = (check: () => void): void => {
  window.addEventListener?.("focus", check)
  document.addEventListener?.("visibilitychange", () => {
    if (document.visibilityState === "visible") check()
  })
}

/**
 * The web platform. Documents save in place through the File System Access API where the browser has it
 * and download otherwise; the crash-recovery snapshot lives in IndexedDB (localStorage when that is
 * unavailable), one slot per tab.
 */
export const createBrowserPlatform = (): Platform => {
  const store = createStore(createDatabase(DB_NAME, DB_STORE))
  const handles = createHandleRegistry(createDatabase(HANDLE_DB_NAME, HANDLE_STORE))
  const launched = createOpenFileHub()
  let edited = false
  let listeningForReturn = false
  let consumingLaunches = false
  const slotOf = (path: string): string => path.split("/")[0]!

  const handleAt = async (path: string, mode: "read" | "readwrite"): Promise<FileHandle> => {
    const handle = await handles.get(path)
    if (!handle) throw new Error(`${path.slice(path.lastIndexOf("/") + 1)} is no longer available.`)
    if (!(await permitted(handle, mode, true))) {
      const err = new Error(`The browser did not allow access to ${handle.name}.`)
      err.name = "NotAllowedError"
      throw err
    }
    return handle
  }

  const watcher = createFileWatcher(async (path) => {
    const handle = await handles.get(path)
    if (!handle || !(await permitted(handle, "read", false))) throw new Error("not readable")
    try {
      const file = await handle.getFile()
      return `${file.lastModified}:${file.size}`
    } catch (e) {
      if (errorName(e) === "NotFoundError") return null
      throw e
    }
  })

  const saveViaPicker = async (
    data: BlobPart,
    name: string,
    filters: FileFilter[],
  ): Promise<string | null> => {
    const pickers = filePickers()
    if (!pickers) return null
    const handle = await pick(() =>
      pickers.showSaveFilePicker({ suggestedName: name, types: pickerTypes(filters), id: PICKER_ID }),
    )
    if (!handle) return null
    const path = await handles.pathFor(handle)
    await watcher.writing(path, () => writeHandle(handle, data))
    return path
  }

  const platform: Platform = {
    name: "browser",
    capabilities: { reopenByPath: false, saveInPlace: filePickers() !== null },
    fs: {
      async openDocument(filters) {
        const pickers = filePickers()
        if (pickers) {
          let picked: FileHandle[] | null
          try {
            picked = await pick(() =>
              pickers.showOpenFilePicker({ types: pickerTypes(filters), multiple: false, id: PICKER_ID }),
            )
          } catch {
            return null
          }
          const handle = picked?.[0]
          if (handle) {
            const file = await handle.getFile()
            const path = await handles.pathFor(handle)
            const contents = await file.text()
            await watcher.track(path)
            return { path, name: file.name, contents }
          }
        }
        const file = await pickFile(filters)
        if (!file) return null
        return { path: null, name: file.name, contents: await file.text() }
      },

      async openDocuments(filters) {
        const pickers = filePickers()
        if (pickers) {
          let picked: FileHandle[] | null
          try {
            picked = await pick(() =>
              pickers.showOpenFilePicker({ types: pickerTypes(filters), multiple: true, id: PICKER_ID }),
            )
          } catch {
            return []
          }
          return Promise.all(
            (picked ?? []).map(async (handle) => {
              const file = await handle.getFile()
              const path = await handles.pathFor(handle)
              const contents = await file.text()
              await watcher.track(path)
              return { path, name: file.name, contents }
            }),
          )
        }
        const files = await pickFiles(filters, true)
        return Promise.all(
          files.map(async (file) => ({ path: null, name: file.name, contents: await file.text() })),
        )
      },
      async saveDocument(contents, path, suggestedName, filters) {
        const formats = filtersFor(suggestedName, filters)
        const name = withExtension(suggestedName, formats)
        if (path && isHandlePath(path) && filePickers()) {
          const handle = await handles.get(path)
          if (handle && (await permitted(handle, "readwrite", true))) {
            // after a reload this is the first moment the file can be read, so outside edits show up here
            await watcher.verify(path)
            await watcher.writing(path, () => writeHandle(handle, contents))
            return path
          }
        }
        const saved = await saveViaPicker(contents, name, formats)
        if (saved) return saved
        download(new Blob([contents], { type: mimeFor(name) }), name)
        return null
      },
      async saveBinary(data, suggestedName, filters) {
        const name = withExtension(suggestedName, filters)
        const saved = await saveViaPicker(data as BlobPart, name, filters)
        if (saved) return saved
        download(new Blob([data as BlobPart], { type: mimeFor(name) }), name)
        return null
      },
      async readText(path) {
        if (isHandlePath(path)) {
          const text = await (await (await handleAt(path, "read")).getFile()).text()
          await watcher.track(path)
          return text
        }
        const value = await (await store()).get(path)
        if (value === undefined) throw new Error(`Not found: ${path}`)
        return value
      },
      async writeText(path, contents) {
        if (isHandlePath(path)) {
          const handle = await handleAt(path, "readwrite")
          await watcher.writing(path, () => writeHandle(handle, contents))
          return
        }
        try {
          await (await store()).set(path, contents)
        } catch (e) {
          throw toStorageError(e)
        }
        touchSlot(slotOf(path))
      },
      async exists(path) {
        if (isHandlePath(path)) {
          const handle = await handles.get(path)
          if (!handle) return false
          try {
            await handle.getFile()
            return true
          } catch (e) {
            return errorName(e) !== "NotFoundError"
          }
        }
        return (await (await store()).get(path)) !== undefined
      },
      async remove(path) {
        if (isHandlePath(path)) throw new Error("Nib only deletes what it stores in the browser itself.")
        await (await store()).delete(path)
      },
      async appDataDir() {
        tabSlot ??= store().then(claimSlot)
        return tabSlot
      },
      async sharedDataDir() {
        return SHARED_DIR
      },
      watch(path, onChange, opts) {
        if (!isHandlePath(path)) return () => {}
        if (!listeningForReturn) {
          listeningForReturn = true
          onReturn(() => void watcher.check())
        }
        return watcher.watch(path, onChange, opts)
      },
      async stamp(path) {
        if (!isHandlePath(path)) throw new Error("Only files picked from disk have a stamp.")
        return watcher.stamp(path)
      },
    },
    menu: {
      async install() {},
    },
    window: {
      async setTitle(title) {
        document.title = title
      },
      async setDocumentEdited(next) {
        edited = next
      },
      onCloseRequested(_handler, opts) {
        // beforeunload can't await a prompt, so the browser's own leave-page sheet stands in for it
        const listener = (e: BeforeUnloadEvent) => {
          if (!(opts?.isDirty ? opts.isDirty() : edited)) return
          e.preventDefault()
          e.returnValue = ""
        }
        window.addEventListener("beforeunload", listener)
        let attached = true
        return () => {
          if (!attached) return
          attached = false
          window.removeEventListener("beforeunload", listener)
        }
      },
    },
    clipboard: {
      async writeText(text) {
        await clipboardApi().writeText(text)
      },
      async readText() {
        const clipboard = clipboardApi()
        if (typeof clipboard.readText !== "function") {
          const err = new Error("This browser only pastes through the paste shortcut.")
          err.name = "NotAllowedError"
          throw err
        }
        return clipboard.readText()
      },
      write(items) {
        try {
          const item = new ClipboardItem(clipboardItemData(items))
          return clipboardApi().write([item])
        } catch (e) {
          return Promise.reject(e)
        }
      },
      writeImage(png) {
        try {
          const item = new ClipboardItem({ "image/png": pngBlob(png) })
          return clipboardApi().write([item])
        } catch (e) {
          return Promise.reject(e)
        }
      },
      async readImage() {
        const clipboard = clipboardApi()
        if (typeof clipboard.read !== "function") return null
        for (const item of await clipboard.read()) {
          if (item.types.includes("image/png")) {
            return new Uint8Array(await (await item.getType("image/png")).arrayBuffer())
          }
        }
        return null
      },
    },
    dialogs: {
      async confirm(message) {
        return typeof window.confirm === "function" ? window.confirm(message) : false
      },
      async askSave(documentName) {
        // a browser "save" is a download that can't be reopened, so the only real choice is discard or stay
        if (typeof window.confirm !== "function") return "cancel"
        return window.confirm(`"${documentName}" has unsaved changes. Discard them?`) ? "discard" : "cancel"
      },
      async message(message) {
        if (typeof window.alert === "function") window.alert(message)
      },
    },
    prefs: createLocalPrefs(),
    async openExternal(url) {
      const href = toExternalUrl(url)
      if (!href) throw new Error("Only web and email links can be opened.")
      window.open(href, "_blank", "noopener,noreferrer")
    },
    /** Files the OS opened with the installed web app (the manifest's file_handlers). */
    onOpenFile(cb) {
      if (!consumingLaunches) {
        consumingLaunches = true
        const queue = (globalThis as { launchQueue?: LaunchQueue }).launchQueue
        queue?.setConsumer(({ files }) => {
          for (const handle of files ?? []) {
            void handles.pathFor(handle).then((path) => launched.push(path))
          }
        })
      }
      return launched.subscribe(cb)
    },
  }
  const tabsFile = async () => `${await platform.fs.appDataDir()}/tabs.json`
  platform.session = {
    // a browser tab keeps its tabs beside their recovery copies, so a reopened browser brings them back
    // the way it brings back a closed tab's drawing; each comes back from its copy, as handles need a click
    async restore() {
      let saved: unknown = null
      try {
        saved = JSON.parse(await platform.fs.readText(await tabsFile()))
      } catch {
        saved = null
      }
      if (saved && typeof saved === "object" && Array.isArray((saved as { tabs?: unknown }).tabs)) {
        const { tabs, active } = saved as { tabs: { slot?: unknown; viewport?: unknown }[]; active?: unknown }
        return readRestoredSession({
          tabs: tabs.map((t) => ({ slot: t.slot, viewport: t.viewport })),
          active,
        })
      }
      const legacy = `${await platform.fs.appDataDir()}/${recoveryFiles().meta}`
      if (!(await platform.fs.exists(legacy).catch(() => false))) return null
      return { tabs: [{ slot: DEFAULT_RECOVERY_SLOT, open: null, viewport: null }], active: 0, notices: [] }
    },
    async save(tabs, active) {
      await platform.fs.writeText(await tabsFile(), JSON.stringify({ version: 1, tabs, active }))
    },
  }
  return platform
}

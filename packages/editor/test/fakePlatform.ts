import type { FileChange, FileFilter, Platform, WatchOptions } from "@nib/platform"

type SaveChoice = "save" | "discard" | "cancel"

export interface FakePlatform extends Platform {
  files: Map<string, string>
  prefsStore: Map<string, string>
  title: string
  edited: boolean
  savePath: string | null
  openResult: { path: string; contents: string } | null
  closeHandlers: (() => Promise<boolean>)[]
  openFileHandlers: ((path: string) => void)[]
  /** What a browser-like host "downloaded" instead of writing to a path. */
  downloads: { name: string; contents: string }[]
  /** Every saveDocument call, with the path, suggested name and dialog filters it was given. */
  saveCalls: { path: string | null; suggestedName: string; filters?: FileFilter[] }[]
  /** The dialog filters each openDocument call offered. */
  openFilters: FileFilter[][]
  /** What askSave answers; tests flip it to drive the unsaved-changes guard. */
  askSaveResult: SaveChoice
  confirmResult: boolean
  dialogCalls: { kind: "askSave" | "confirm" | "message"; text: string }[]
  /** The path the window currently represents (the macOS proxy icon); undefined until first set. */
  representedFile: string | null | undefined
  /** Paths with an fs.watch subscription, and their listeners. */
  watchers: Map<string, Set<(change: FileChange) => void>>
  /** The options each path was last watched with. */
  watchOptions: Map<string, WatchOptions | undefined>
  /** With `stamps`, paths whose stamp can't be read yet (no permission). */
  unreadable: Set<string>
  /** Simulates another app changing or removing a watched file. */
  fireChange(path: string, change: FileChange): void
}

/** A stamp that changes whenever the file's contents do. */
const contentStamp = (contents: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < contents.length; i++) h = Math.imul(h ^ contents.charCodeAt(i), 0x01000193)
  return `${contents.length}:${(h >>> 0).toString(36)}`
}

/** In-memory stand-in so document behaviour can be tested without a real host. */
export const createFakePlatform = (
  opts: {
    name?: Platform["name"]
    reopenByPath?: boolean
    sharedDataDir?: string
    stamps?: boolean
    /** Gives fs a renameDocument, as the desktop host has. */
    rename?: boolean
  } = {},
): FakePlatform => {
  const files = new Map<string, string>()
  const prefsStore = new Map<string, string>()
  const watchers = new Map<string, Set<(change: FileChange) => void>>()
  const watchOptions = new Map<string, WatchOptions | undefined>()
  const unreadable = new Set<string>()
  const name = opts.name ?? "tauri"
  const shared = opts.sharedDataDir
  const platform: FakePlatform = {
    name,
    capabilities: { reopenByPath: opts.reopenByPath ?? name === "tauri" },
    files,
    prefsStore,
    title: "",
    edited: false,
    savePath: "/docs/untitled.nibd",
    openResult: null,
    closeHandlers: [],
    openFileHandlers: [],
    downloads: [],
    saveCalls: [],
    openFilters: [],
    askSaveResult: "discard",
    confirmResult: true,
    dialogCalls: [],
    representedFile: undefined,
    watchers,
    watchOptions,
    unreadable,
    fireChange(path, change) {
      for (const cb of [...(watchers.get(path) ?? [])]) cb(change)
    },
    fs: {
      async openDocument(filters) {
        platform.openFilters.push(filters)
        if (!platform.openResult) return null
        const { path, contents } = platform.openResult
        return { path, name: path.split("/").pop() ?? path, contents }
      },
      async saveDocument(contents, path, suggestedName, filters) {
        platform.saveCalls.push({ path, suggestedName, filters })
        if (!(platform.capabilities?.reopenByPath ?? true)) {
          platform.downloads.push({ name: suggestedName, contents })
          return null
        }
        const target = path ?? platform.savePath
        if (!target) return null
        files.set(target, contents)
        return target
      },
      async saveBinary() {
        return null
      },
      ...(opts.rename
        ? {
            async renameDocument(path: string, fileName: string) {
              const contents = files.get(path)
              if (contents === undefined) throw new Error("It was moved or deleted.")
              const target = `${path.slice(0, path.lastIndexOf("/") + 1)}${fileName}`
              if (files.has(target)) throw new Error(`"${fileName}" already exists in that folder.`)
              files.delete(path)
              files.set(target, contents)
              return target
            },
          }
        : {}),
      async readText(path) {
        const value = files.get(path)
        if (value === undefined) throw new Error(`missing ${path}`)
        return value
      },
      async writeText(path, contents) {
        files.set(path, contents)
      },
      async exists(path) {
        return files.has(path)
      },
      async remove(path) {
        files.delete(path)
      },
      async appDataDir() {
        return "/appdata"
      },
      ...(shared === undefined ? {} : { sharedDataDir: async () => shared }),
      ...(opts.stamps
        ? {
            async stamp(path: string) {
              if (unreadable.has(path)) throw new Error("not allowed to read the file yet")
              const contents = files.get(path)
              return contents === undefined ? null : contentStamp(contents)
            },
          }
        : {}),
      watch(path, onChange, watchOpts) {
        watchOptions.set(path, watchOpts)
        const set = watchers.get(path) ?? new Set()
        set.add(onChange)
        watchers.set(path, set)
        return () => {
          set.delete(onChange)
          if (set.size === 0) watchers.delete(path)
        }
      },
    },
    menu: { async install() {} },
    window: {
      async setTitle(title) {
        platform.title = title
      },
      async setDocumentEdited(edited) {
        platform.edited = edited
      },
      async setRepresentedFile(path) {
        platform.representedFile = path
      },
      onCloseRequested(handler) {
        platform.closeHandlers.push(handler)
        return () => {
          platform.closeHandlers = platform.closeHandlers.filter((h) => h !== handler)
        }
      },
    },
    clipboard: {
      async writeText() {},
      async readText() {
        return ""
      },
    },
    dialogs: {
      async confirm(text) {
        platform.dialogCalls.push({ kind: "confirm", text })
        return platform.confirmResult
      },
      async askSave(documentName) {
        platform.dialogCalls.push({ kind: "askSave", text: documentName })
        return platform.askSaveResult
      },
      async message(text) {
        platform.dialogCalls.push({ kind: "message", text })
      },
    },
    prefs: {
      get(key) {
        return prefsStore.get(key) ?? null
      },
      set(key, value) {
        if (value === null) prefsStore.delete(key)
        else prefsStore.set(key, value)
      },
    },
    onOpenFile(cb) {
      platform.openFileHandlers.push(cb)
      return () => {
        platform.openFileHandlers = platform.openFileHandlers.filter((h) => h !== cb)
      }
    },
    async openExternal() {},
  }
  return platform
}

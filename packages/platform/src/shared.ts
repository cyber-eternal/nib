import type { ClipboardPayload, FileChange, FileFilter, PlatformPrefs, WatchOptions } from "./index"

/** The extension new drawings are saved with. */
export const DOCUMENT_EXTENSION = "nibd"
export const SCENE_EXTENSIONS = [DOCUMENT_EXTENSION, "excalidraw"] as const

const extensionOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf("/") + 1)
  const dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ""
}

/** True for paths Nib opens as documents; Finder hands over "Board.NIBD" as readily as lowercase. */
export const isSceneFile = (path: string): boolean =>
  (SCENE_EXTENSIONS as readonly string[]).includes(extensionOf(path))

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"])

const hasControlChars = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return true
  }
  return false
}

/**
 * The normalised href of a link the OS may open (http, https, mailto), or null. Everything else
 * (javascript:, file:, custom schemes) is refused.
 */
export const toExternalUrl = (url: string): string | null => {
  if (typeof url !== "string") return null
  const trimmed = url.trim()
  // URL() silently drops tabs and newlines, which can disguise a scheme such as "java\tscript:"
  if (!trimmed || hasControlChars(trimmed)) return null
  try {
    const parsed = new URL(trimmed)
    if (!EXTERNAL_PROTOCOLS.has(parsed.protocol)) return null
    if (parsed.protocol !== "mailto:" && !parsed.hostname) return null
    return parsed.href
  } catch {
    return null
  }
}

export const isExternalUrl = (url: string): boolean => toExternalUrl(url) !== null

const KNOWN_FILTERS: Record<string, FileFilter> = {
  nibd: { name: "Nib drawing", extensions: [DOCUMENT_EXTENSION] },
  excalidraw: { name: "Excalidraw drawing", extensions: ["excalidraw"] },
  excalidrawlib: { name: "Excalidraw library", extensions: ["excalidrawlib"] },
  svg: { name: "SVG image", extensions: ["svg"] },
  png: { name: "PNG image", extensions: ["png"] },
  json: { name: "JSON", extensions: ["json"] },
}

/** The save-dialog filter matching the suggested file name, so a .svg export doesn't offer .nibd. */
export const filtersFor = (suggestedName: string, filters?: FileFilter[]): FileFilter[] => {
  if (filters && filters.length > 0) return filters
  const known = KNOWN_FILTERS[extensionOf(suggestedName)]
  return known ? [known] : [KNOWN_FILTERS.nibd!]
}

/** Appends the first filter extension when the name has none of them (case-insensitive). */
export const withExtension = (name: string, filters: FileFilter[]): string => {
  const allowed = filters.flatMap((f) => f.extensions.map((e) => e.toLowerCase()))
  if (allowed.length === 0 || allowed.includes(extensionOf(name))) return name
  return `${name.replace(/\.+$/, "")}.${allowed[0]}`
}

const MIME_BY_EXTENSION: Record<string, string> = {
  nibd: "application/json",
  nib: "application/json",
  excalidraw: "application/json",
  excalidrawlib: "application/json",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
}

export const mimeFor = (name: string): string =>
  MIME_BY_EXTENSION[extensionOf(name)] ?? "application/octet-stream"

/**
 * localStorage-backed prefs. `get` returns what is stored, so after a write that didn't fit (storage full)
 * it still returns the previous value and a caller can read back to notice. Only when there is no storage
 * at all (blocked, some private windows) do values live in memory for the session.
 */
export const createLocalPrefs = (
  storage: () => Storage | null | undefined = () => globalThis.localStorage,
): PlatformPrefs => {
  const memory = new Map<string, string>()
  const store = (): Storage | null => {
    try {
      return storage() ?? null
    } catch {
      return null
    }
  }
  return {
    get(key) {
      const s = store()
      try {
        if (s) return s.getItem(key)
      } catch {
        // an unreadable store behaves like a missing one
      }
      return memory.get(key) ?? null
    },
    set(key, value) {
      const s = store()
      if (!s) {
        if (value === null) memory.delete(key)
        else memory.set(key, value)
        return
      }
      try {
        if (value === null) s.removeItem(key)
        else s.setItem(key, value)
      } catch {
        // a full store keeps its previous value
      }
    },
  }
}

export interface PrefsSnapshot {
  rev: number
  values: Record<string, string | null>
}

const PREFS_REV_KEY = "nib:prefs:rev"

/**
 * Desktop prefs: localStorage answers reads synchronously, and every write is mirrored to a file the shell
 * owns, because WebKit can drop the last localStorage writes when the app quits right after them. The
 * shell hands its copy back at boot, and a newer copy there repairs localStorage.
 */
export const createMirroredPrefs = (opts: {
  boot?: PrefsSnapshot | null
  mirror: (key: string, value: string | null, rev: number) => Promise<unknown>
  storage?: () => Storage | null | undefined
  log?: (error: unknown) => void
}): PlatformPrefs => {
  const local = createLocalPrefs(opts.storage)
  let rev = Number(local.get(PREFS_REV_KEY)) || 0
  const boot = opts.boot
  if (boot && Number.isFinite(boot.rev) && boot.rev > rev) {
    for (const [key, value] of Object.entries(boot.values ?? {})) local.set(key, value)
    rev = boot.rev
    local.set(PREFS_REV_KEY, String(rev))
  }
  // one write at a time, so the shell can never store an older value after a newer one
  let chain: Promise<unknown> = Promise.resolve()
  let warned = false
  return {
    get: (key) => local.get(key),
    set(key, value) {
      local.set(key, value)
      rev += 1
      local.set(PREFS_REV_KEY, String(rev))
      const at = rev
      chain = chain
        .then(() => opts.mirror(key, value, at))
        .catch((e) => {
          if (warned) return
          warned = true
          ;(opts.log ?? console.warn)(e)
        })
    },
  }
}

const isQuotaError = (e: unknown): boolean =>
  e instanceof Error &&
  (e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    (e as { code?: number }).code === 22 ||
    (e as { code?: number }).code === 1014)

/** Normalises storage-full errors to one recognisable name so callers can tell the user. */
export const toStorageError = (e: unknown): Error => {
  if (isQuotaError(e)) {
    const err = new Error("Browser storage is full, so the autosave could not be written.")
    err.name = "QuotaExceededError"
    return err
  }
  return e instanceof Error ? e : new Error(String(e))
}

/** Element-like check without DOM types, so the module also loads in node tests. */
export const isTextEntry = (el: unknown): boolean => {
  if (!el || typeof el !== "object") return false
  const node = el as { tagName?: string; isContentEditable?: boolean; type?: string; readOnly?: boolean }
  if (node.isContentEditable) return true
  const tag = node.tagName?.toUpperCase()
  if (tag === "TEXTAREA") return !node.readOnly
  if (tag !== "INPUT") return false
  const type = (node.type ?? "text").toLowerCase()
  return (
    !node.readOnly &&
    !["button", "checkbox", "radio", "range", "color", "file", "submit", "reset"].includes(type)
  )
}

const supportsType = (type: string): boolean => {
  const supports = (globalThis.ClipboardItem as { supports?: (t: string) => boolean } | undefined)?.supports
  return typeof supports === "function"
    ? supports(type)
    : ["text/plain", "text/html", "image/png"].includes(type)
}

export const pngBlob = (png: Uint8Array | Promise<Uint8Array>): Promise<Blob> =>
  Promise.resolve(png).then((bytes) => new Blob([bytes as BlobPart], { type: "image/png" }))

/**
 * The ClipboardItem flavours for a payload. Build the item synchronously in the gesture handler: WebKit
 * drops the user activation at the first await. `json` takes text/plain when given, because paste events
 * never expose custom formats and Nib must be able to read its own copy back.
 */
export const clipboardItemData = (items: ClipboardPayload): Record<string, Blob | Promise<Blob>> => {
  const data: Record<string, Blob | Promise<Blob>> = {}
  const plain = items.json ?? items.text
  if (items.json !== undefined && supportsType("web application/json")) {
    data["web application/json"] = new Blob([items.json], { type: "application/json" })
  }
  if (plain !== undefined) data["text/plain"] = new Blob([plain], { type: "text/plain" })
  if (items.html !== undefined) data["text/html"] = new Blob([items.html], { type: "text/html" })
  if (items.svg !== undefined && supportsType("image/svg+xml")) {
    data["image/svg+xml"] = new Blob([items.svg], { type: "image/svg+xml" })
  }
  if (items.png) data["image/png"] = pngBlob(items.png)
  return data
}

export type Unsubscribe = () => void

/** Wraps `fn` so only the first call runs it. */
export const once = (fn: () => void): Unsubscribe => {
  let done = false
  return () => {
    if (done) return
    done = true
    fn()
  }
}

export interface OpenFileHub {
  push(path: string): void
  subscribe(cb: (path: string) => void): Unsubscribe
}

/**
 * Holds OS file opens until someone listens. StrictMode subscribes, unsubscribes and subscribes again in
 * one tick, so buffered paths are delivered a microtask later, to whoever is still subscribed.
 */
export const createOpenFileHub = (): OpenFileHub => {
  const subscribers = new Set<(path: string) => void>()
  const buffer: string[] = []
  const flush = () => {
    if (subscribers.size === 0) return
    for (const path of buffer.splice(0)) for (const cb of [...subscribers]) cb(path)
  }
  return {
    push(path) {
      buffer.push(path)
      flush()
    },
    subscribe(cb) {
      subscribers.add(cb)
      queueMicrotask(flush)
      return once(() => subscribers.delete(cb))
    },
  }
}

const FILE_CHANGED = "FileChangedError"

/** What an in-place save rejects with when another app changed the file since Nib last saw it. */
export const fileChangedError = (path: string): Error => {
  const name = path.slice(path.lastIndexOf("/") + 1)
  const err = new Error(`${name} was changed by another app.`)
  err.name = FILE_CHANGED
  return err
}

export const isFileChanged = (e: unknown): boolean => e instanceof Error && e.name === FILE_CHANGED

export interface FileWatcher {
  watch(path: string, onChange: (change: FileChange) => void, opts?: WatchOptions): Unsubscribe
  /** Notes the file's state after Nib itself read or wrote it, so that is never reported as a change. */
  track(path: string): Promise<void>
  /** Runs one of Nib's own writes with checks of `path` paused, then notes the result. */
  writing<T>(path: string, write: () => Promise<T>): Promise<T>
  /**
   * Runs Nib's own rename of `path`, which resolves the new path. The file is then known there as it was
   * last seen, so another app's edit made before the rename is still reported, and the old path never
   * reports it as deleted.
   */
  moving(path: string, move: () => Promise<string>): Promise<string>
  /**
   * Call before overwriting `path` in place. Rejects with a FileChangedError when another app changed the
   * file since Nib last read, wrote or checked it; that change then counts as seen, so a retry writes.
   */
  verify(path: string): Promise<void>
  /** Compares every watched file with its last known state. */
  check(): Promise<void>
  /** The file's stamp now; null once it is gone, and rejects when it can't tell. */
  stamp(path: string): Promise<string | null>
}

/**
 * Notices other apps changing an open document. `stamp` resolves a version string for a file (mtime and
 * size), null once it is gone, and throws when it can't tell (no permission), which skips that check.
 * Watched files are checked every `intervalMs` (0 turns polling off) and whenever check() is called.
 */
export const createFileWatcher = (
  stamp: (path: string) => Promise<string | null>,
  opts: { intervalMs?: number } = {},
): FileWatcher => {
  const intervalMs = opts.intervalMs ?? 3000
  const watchers = new Map<string, Set<(change: FileChange) => void>>()
  const known = new Map<string, string | null>()
  // bumped by Nib's own reads and writes; a check that overlaps one throws its result away
  const generation = new Map<string, number>()
  const busy = new Map<string, number>()
  let timer: ReturnType<typeof setInterval> | null = null
  let checking: Promise<void> | null = null

  const genOf = (path: string) => generation.get(path) ?? 0
  const isBusy = (path: string) => (busy.get(path) ?? 0) > 0

  const track = async (path: string): Promise<void> => {
    const gen = genOf(path) + 1
    generation.set(path, gen)
    let next: string | null
    try {
      next = await stamp(path)
    } catch {
      if (genOf(path) === gen) known.delete(path)
      return
    }
    if (genOf(path) === gen) known.set(path, next)
  }

  const checkOne = async (path: string): Promise<void> => {
    if (isBusy(path)) return
    const gen = genOf(path)
    let now: string | null
    try {
      now = await stamp(path)
    } catch {
      return
    }
    if (genOf(path) !== gen || isBusy(path)) return
    if (!known.has(path)) {
      known.set(path, now)
      return
    }
    if (known.get(path) === now) return
    known.set(path, now)
    for (const cb of [...(watchers.get(path) ?? [])]) cb(now === null ? "deleted" : "modified")
  }

  const check = (): Promise<void> => {
    checking ??= Promise.all([...watchers.keys()].map(checkOne))
      .then(() => undefined)
      .finally(() => {
        checking = null
      })
    return checking
  }

  return {
    watch(path, onChange, opts = {}) {
      const set = watchers.get(path) ?? new Set()
      if (!watchers.has(path)) {
        watchers.set(path, set)
        if (opts.since !== undefined && !known.has(path)) {
          known.set(path, opts.since)
          void checkOne(path)
        } else if (!known.has(path)) void track(path)
      }
      set.add(onChange)
      if (!timer && intervalMs > 0) timer = setInterval(() => void check(), intervalMs)
      return once(() => {
        set.delete(onChange)
        if (set.size === 0 && watchers.get(path) === set) watchers.delete(path)
        if (watchers.size === 0 && timer) {
          clearInterval(timer)
          timer = null
        }
      })
    },
    track,
    async writing(path, write) {
      busy.set(path, (busy.get(path) ?? 0) + 1)
      generation.set(path, genOf(path) + 1)
      try {
        return await write()
      } finally {
        try {
          await track(path)
        } finally {
          busy.set(path, (busy.get(path) ?? 1) - 1)
        }
      }
    },
    async moving(path, move) {
      busy.set(path, (busy.get(path) ?? 0) + 1)
      generation.set(path, genOf(path) + 1)
      const seen = known.get(path)
      try {
        const to = await move()
        generation.set(to, genOf(to) + 1)
        if (seen === undefined) known.delete(to)
        else known.set(to, seen)
        if (to !== path) known.set(path, null)
        return to
      } finally {
        busy.set(path, (busy.get(path) ?? 1) - 1)
      }
    },
    async verify(path) {
      if (!known.has(path)) return
      const gen = genOf(path)
      let now: string | null
      try {
        now = await stamp(path)
      } catch {
        return
      }
      // a write of a file that is gone recreates it, which overwrites nobody's work
      if (genOf(path) !== gen || now === null || now === known.get(path)) return
      known.set(path, now)
      generation.set(path, gen + 1)
      throw fileChangedError(path)
    },
    check,
    stamp,
  }
}

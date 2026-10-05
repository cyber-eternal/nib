import { type LibraryItem, parseLibrary, parseLibraryFile, serializeLibrary } from "@nib/core"
import type { Platform } from "@nib/platform"

/** Where the web build keeps the library (localStorage through platform.prefs). */
export const LIBRARY_PREF_KEY = "nib.library"
export const LIBRARY_FILE = "library.excalidrawlib"
const BACKUP_FILE = "library.unreadable.excalidrawlib"

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Keeps the user's library between sessions: a file in the folder every window and tab shares
 * (the app data folder on desktop, IndexedDB in the browser), or platform.prefs on a host without
 * one, since the browser's app data folder is per tab. Loads and writes run one at a time, and each
 * write merges with what is stored, so items another tab added survive this tab's next change.
 */
export class LibraryStore {
  /** Why the last load or save failed, or null. */
  lastError: string | null = null

  private chain: Promise<unknown> = Promise.resolve()
  // an unreadable library file is never overwritten until it has been copied aside
  private blocked = false
  private keptAside: string | null = null
  // ids this tab has listed: a stored item it listed and no longer has was deleted here, any other came from elsewhere
  private listed = new Set<string>()

  constructor(private readonly platform: Platform) {}

  private get useFile(): boolean {
    if (this.platform.fs.sharedDataDir) return true
    return this.platform.capabilities?.reopenByPath ?? this.platform.name !== "browser"
  }

  private async dir(): Promise<string> {
    const fs = this.platform.fs
    return (await (fs.sharedDataDir?.() ?? fs.appDataDir())).replace(/\/+$/, "")
  }

  private readPrefs(): string | null {
    return this.platform.prefs.get(LIBRARY_PREF_KEY)
  }

  private queue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.chain.then(run, run)
    this.chain = next
    return next
  }

  /** The stored library's text, or null when there is none. Rejects when it can't be read. */
  private async readStored(): Promise<string | null> {
    let text: string | null = null
    if (this.useFile) {
      const path = `${await this.dir()}/${LIBRARY_FILE}`
      if (await this.platform.fs.exists(path)) text = await this.platform.fs.readText(path)
    }
    return text ?? this.readPrefs()
  }

  load(): Promise<LibraryItem[]> {
    return this.queue(async () => {
      this.lastError = null
      let text: string | null
      try {
        text = await this.readStored()
      } catch (e) {
        this.blocked = true
        this.lastError = `Couldn't read your library: ${message(e)}`
        return []
      }
      if (text === null) return []
      const parsed = parseLibraryFile(text)
      if (parsed.ok) {
        for (const item of parsed.items) this.listed.add(item.id)
        return parsed.items
      }
      this.lastError = `Your saved library couldn't be read (${parsed.error}). It was kept aside.`
      await this.keepAside(text)
      return []
    })
  }

  private async keepAside(text: string): Promise<void> {
    try {
      if (this.useFile) await this.platform.fs.writeText(`${await this.dir()}/${BACKUP_FILE}`, text)
      else this.platform.prefs.set(`${LIBRARY_PREF_KEY}.unreadable`, text)
      this.keptAside = text
    } catch {
      this.blocked = true
    }
  }

  /** This tab's items, plus the stored ones it had never listed (added by another tab or window). */
  private async mergeWithStored(
    own: readonly LibraryItem[],
    known: ReadonlySet<string>,
  ): Promise<LibraryItem[]> {
    const text = await this.readStored()
    if (text === null) return [...own]
    const parsed = parseLibraryFile(text)
    if (!parsed.ok) {
      if (text !== this.keptAside) await this.keepAside(text)
      return [...own]
    }
    const mine = new Set(own.map((i) => i.id))
    const added = parsed.items.filter((i) => !mine.has(i.id) && !known.has(i.id))
    return [...added, ...own]
  }

  /** Resolves false (with lastError set) when the library could not be stored. */
  save(items: readonly LibraryItem[]): Promise<boolean> {
    const own = [...items]
    // what this tab had listed when it made the change: a load still in flight can't count as seen
    const known = new Set(this.listed)
    for (const item of own) this.listed.add(item.id)
    return this.queue(async (): Promise<boolean> => {
      if (this.blocked) {
        this.lastError = "Your library isn't being saved because the stored copy couldn't be read."
        return false
      }
      let text: string
      try {
        text = serializeLibrary(await this.mergeWithStored(own, known), { target: "nib" })
      } catch (e) {
        this.lastError = `Couldn't read your library before saving it: ${message(e)}`
        return false
      }
      if (this.blocked) {
        this.lastError = "Your library isn't being saved because the stored copy couldn't be read."
        return false
      }
      try {
        if (this.useFile) {
          await this.platform.fs.writeText(`${await this.dir()}/${LIBRARY_FILE}`, text)
          // a copy migrated from prefs would otherwise keep using the small localStorage quota
          this.platform.prefs.set(LIBRARY_PREF_KEY, null)
        } else {
          this.platform.prefs.set(LIBRARY_PREF_KEY, text)
          // prefs never throw, so a store that refused the write shows up as the old value
          if (this.platform.prefs.get(LIBRARY_PREF_KEY) !== text)
            throw new Error("browser storage is full; remove some items or export the library")
        }
        this.lastError = null
        return true
      } catch (e) {
        this.lastError =
          e instanceof Error && e.name === "QuotaExceededError"
            ? "Couldn't save your library: storage is full. Remove some items or export the library."
            : `Couldn't save your library: ${message(e)}`
        return false
      }
    })
  }
}

/** The drag payload for library tiles (put it under LIBRARY_MIME): the items with their image files. */
export const libraryDragData = (items: readonly LibraryItem[]): string =>
  serializeLibrary(items, { target: "nib" })

/** Items from a LIBRARY_MIME drop (or a dropped .excalidrawlib's text); [] when it holds none. */
export const libraryItemsFromDrop = (text: string): LibraryItem[] => parseLibrary(text)

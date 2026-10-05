import {
  type AppState,
  DOCUMENT_STATE_KEYS,
  type EditorCore,
  type NibElement,
  parseExcalidraw,
  parseNib,
  parseScene,
  serializeNib,
  toExcalidraw,
} from "@nib/core"
import {
  DOCUMENT_EXTENSION,
  type FileChange,
  type Platform,
  isFileChanged,
  recoveryFiles,
} from "@nib/platform"
import { fitWithin } from "../ui/shell/viewport"

export const OPEN_FILTER = [{ name: "Nib drawing", extensions: [DOCUMENT_EXTENSION, "excalidraw"] }]
const SAVE_FILTER = [{ name: "Nib drawing", extensions: [DOCUMENT_EXTENSION] }]
const EXCALIDRAW_FILTER = [{ name: "Excalidraw drawing", extensions: ["excalidraw"] }]

export const NOT_A_DRAWING = "This file isn't a Nib or Excalidraw drawing."

export type DocumentFormat = "nib" | "excalidraw"

export interface DocumentState {
  path: string | null
  name: string
  dirty: boolean
}

export type DocumentNoticeKind = "info" | "warning" | "error"

interface RecoveryMeta {
  path: string | null
  name: string
  dirty: boolean
  savedAt: number
  /** The file's stamp when Nib last read or wrote it, so a restored copy notices edits made since. */
  stamp?: string | null
}

type GuardAnswer = "clean" | "saved" | "discard" | "cancel"

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))
// a save picker the user closed rejects with AbortError where null already means "downloaded"
const isAbort = (e: unknown): boolean => e instanceof Error && e.name === "AbortError"
const abortError = (): Error => Object.assign(new Error("The save was cancelled."), { name: "AbortError" })
const basename = (path: string): string => path.split(/[/\\]/).pop() || path
const stripSceneExtension = (name: string): string => name.replace(/\.(nibd|excalidraw)$/i, "")
const asDocumentName = (name: string): string =>
  `${stripSceneExtension(name) || "Untitled"}.${DOCUMENT_EXTENSION}`

// the canvas reports its size from its draw loop, which a hidden window or background tab doesn't run yet
const windowSize = (): { width: number; height: number } | null =>
  typeof window !== "undefined" && window.innerWidth > 0 && window.innerHeight > 0
    ? { width: window.innerWidth, height: window.innerHeight }
    : null

const elementHashes = new WeakMap<NibElement, readonly [number, number]>()

const fnv = (s: string, seed: number): number => {
  let h = seed
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h >>> 0
}
const mix = (h: number, x: number): number => {
  const m = Math.imul(h ^ x, 0x01000193) >>> 0
  return (m ^ (m >>> 15)) >>> 0
}

// version bookkeeping is left out: undo and redo may rewrite it without changing what is drawn
const elementHash = (el: NibElement): readonly [number, number] => {
  let cached = elementHashes.get(el)
  if (!cached) {
    const { version: _version, versionNonce: _nonce, updated: _updated, ...content } = el
    const json = JSON.stringify(content)
    cached = [fnv(json, 0x811c9dc5), fnv(json, 0x050c5d1f)]
    elementHashes.set(el, cached)
  }
  return cached
}

// elements are immutable, so the per-element hashes cache by identity and a commit rehashes only what changed
const sceneKeyOf = (elements: readonly NibElement[]): string => {
  let a = 0x811c9dc5
  let b = 0x050c5d1f
  let count = 0
  for (const el of elements) {
    if (el.isDeleted) continue
    const [h1, h2] = elementHash(el)
    a = mix(a, h1)
    b = mix(b, h2)
    count++
  }
  return `${count}:${a.toString(36)}:${b.toString(36)}`
}

const stateKeyOf = (state: AppState): string => JSON.stringify(DOCUMENT_STATE_KEYS.map((k) => state[k]))

/**
 * Owns everything about "the file on disk": its name, whether it has unsaved
 * changes, and the crash-recovery snapshot written a couple of seconds after
 * the last edit. Call attach() once mounted; it returns the matching detach.
 */
export class DocumentController {
  path: string | null = null
  name = "Untitled"
  dirty = false
  /** The format the open document was read from. Excalidraw files are never overwritten with Nib JSON. */
  format: DocumentFormat = "nib"
  /** Message of the last operation that failed (null after one that succeeded or was cancelled). */
  lastError: string | null = null

  private readonly autosaveMs: number
  private readonly autosaveMaxMs: number
  private timer: ReturnType<typeof setTimeout> | null = null
  // when the oldest edit the recovery copy doesn't have yet was made
  private unsyncedSince: number | null = null
  private listeners = new Set<() => void>()
  private noticeListeners = new Set<(message: string, kind: DocumentNoticeKind) => void>()
  private detachFn: (() => void) | null = null
  private quiet = false

  // the scene as of the last undoable step; typing into an open editor records none until it closes
  private sceneKey: string
  private draftKey: string | null = null
  private draftVersion = -1
  private stateKey: string
  private lastAppState: AppState
  // null means "never saved in this form", so the document stays dirty until it is
  private savedSceneKey: string | null
  private savedStateKey: string
  private savedName: string

  private recoveryGen = 0
  private lastRecoveryOp: "write" | "clear" = "clear"
  private writeChain: Promise<void> = Promise.resolve()
  private recoveryFailed = false

  // a recovery copy the last session left stays untouched until it is restored or set aside
  private inherited: Promise<boolean> | null = null
  private holding = false
  private syncHeld = false
  private recovering: Promise<boolean> | null = null

  private saveChain: Promise<unknown> = Promise.resolve()
  private queuedSave: Promise<boolean> | null = null

  private diskStamp: string | null = null
  private watchSince: { path: string; stamp: string | null } | null = null
  private watchedPath: string | null = null
  private unwatch: (() => void) | null = null
  private changeQuestion: Promise<boolean> | null = null
  // undefined until first told to the host, so the first sync always goes through
  private representedPath: string | null | undefined = undefined
  private stateSnapshot: DocumentState | null = null

  constructor(
    private readonly core: EditorCore,
    private readonly platform: Platform,
    opts: { autosaveMs?: number; autosaveMaxMs?: number; name?: string } = {},
  ) {
    if (opts.name) this.name = opts.name
    this.autosaveMs = opts.autosaveMs ?? 1500
    this.autosaveMaxMs = Math.max(this.autosaveMs, opts.autosaveMaxMs ?? 5000)
    this.lastAppState = core.appState
    this.sceneKey = sceneKeyOf(core.scene.getElements())
    this.stateKey = stateKeyOf(core.appState)
    this.savedSceneKey = this.sceneKey
    this.savedStateKey = this.stateKey
    this.savedName = this.name
  }

  /** Starts tracking edits, autosave and the close guard. Idempotent; returns the function that undoes it. */
  attach(): () => void {
    if (this.detachFn) return this.detachFn
    const unsubscribers = [
      this.core.history.subscribe(() => this.onHistory()),
      this.core.subscribe(() => this.onCoreChange()),
      this.platform.window.onCloseRequested(() => this.confirmDiscard(), { isDirty: () => this.dirty }),
    ]
    const detach = () => {
      if (this.detachFn !== detach) return
      this.detachFn = null
      for (const off of unsubscribers) off()
      this.cancelTimer()
      this.syncWatch()
    }
    this.detachFn = detach
    void this.inheritedCopy()
    this.syncWatch()
    this.rekey()
    this.setDirty(this.computeDirty())
    void this.syncWindow()
    return detach
  }

  dispose(): void {
    this.detachFn?.()
    this.cancelTimer()
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /**
   * Background news the UI should show: an Excalidraw file opened as a copy, a file from a newer
   * version of Nib, or autosave failing.
   */
  onNotice(cb: (message: string, kind: DocumentNoticeKind) => void): () => void {
    this.noticeListeners.add(cb)
    return () => this.noticeListeners.delete(cb)
  }

  /**
   * Path, name and dirty flag as one object that is replaced only when one of them changes, so it
   * can be a useSyncExternalStore snapshot.
   */
  get state(): DocumentState {
    const s = this.stateSnapshot
    if (s && s.path === this.path && s.name === this.name && s.dirty === this.dirty) return s
    this.stateSnapshot = { path: this.path, name: this.name, dirty: this.dirty }
    return this.stateSnapshot
  }

  /** The document name without its .nibd or .excalidraw extension, for export file names. */
  get baseName(): string {
    return stripSceneExtension(this.name) || "Untitled"
  }

  private emit(): void {
    for (const l of this.listeners) l()
  }
  private notice(text: string, kind: DocumentNoticeKind): void {
    for (const l of this.noticeListeners) l(text, kind)
  }
  private fail(error: string): string {
    this.lastError = error
    return error
  }

  private onHistory(): void {
    if (this.quiet) return
    this.sceneKey = sceneKeyOf(this.core.scene.getElements())
    this.refresh()
  }

  private onCoreChange(): void {
    if (this.quiet) return
    let changed = this.trackDraft()
    const state = this.core.appState
    if (state !== this.lastAppState) {
      this.lastAppState = state
      const key = stateKeyOf(state)
      if (key !== this.stateKey) {
        this.stateKey = key
        changed = true
      }
    }
    if (changed) this.refresh()
  }

  /** Follows the text being typed, which reaches the scene without an undoable step. True when it changed. */
  private trackDraft(): boolean {
    const id = this.core.appState.editingTextId
    if (!id && this.draftKey === null) return false
    const version = this.core.staticVersion
    if (id && version === this.draftVersion) return false
    this.draftVersion = id ? version : -1
    const el = id ? this.core.scene.get(id) : undefined
    // an editor with nothing in it closes into nothing, so it leaves the drawing as it was
    const typed = el && el.type === "text" && !el.isDeleted && el.text.trim() !== ""
    const next = typed ? sceneKeyOf(this.core.scene.getElements()) : null
    if (next === this.draftKey) return false
    this.draftKey = next
    return true
  }

  private computeDirty(): boolean {
    return (
      this.savedSceneKey === null ||
      (this.draftKey ?? this.sceneKey) !== this.savedSceneKey ||
      this.stateKey !== this.savedStateKey ||
      this.name !== this.savedName
    )
  }

  private refresh(): void {
    this.setDirty(this.computeDirty())
    const now = Date.now()
    this.unsyncedSince ??= now
    // a plain debounce never fires during steady pen work, so the copy is written at least this often
    const wait = Math.max(0, Math.min(this.autosaveMs, this.unsyncedSince + this.autosaveMaxMs - now))
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.unsyncedSince = null
      void this.syncRecovery()
    }, wait)
  }

  private setDirty(next: boolean): void {
    if (this.dirty === next) return
    this.dirty = next
    void this.syncWindow()
    this.emit()
  }

  /** Re-reads the scene and the document settings, keeping what was last saved. */
  private rekey(): void {
    this.sceneKey = sceneKeyOf(this.core.scene.getElements())
    this.draftKey = null
    this.draftVersion = -1
    this.trackDraft()
    this.lastAppState = this.core.appState
    this.stateKey = stateKeyOf(this.core.appState)
  }

  private markSaved(): void {
    this.rekey()
    this.markWritten(this.draftKey ?? this.sceneKey, this.stateKey, this.name)
  }

  private markWritten(sceneKey: string, stateKey: string, name: string): void {
    this.savedSceneKey = sceneKey
    this.savedStateKey = stateKey
    this.savedName = name
    this.setDirty(this.computeDirty())
  }

  private markUnsaved(): void {
    this.markSaved()
    this.savedSceneKey = null
    this.setDirty(true)
  }

  /** Closes an open text editor with what was typed, before the document is saved, replaced or closed. */
  settleText(): void {
    const id = this.core.appState.editingTextId
    if (!id) return
    const el = this.core.scene.get(id)
    // the editor writes every keystroke into the element (previewText), so its text is the draft
    if (el && el.type === "text") this.core.commitText(id, el.originalText)
  }

  private async syncWindow(): Promise<void> {
    try {
      await this.platform.window.setTitle(`${this.dirty ? "• " : ""}${this.name} — Nib`)
      await this.platform.window.setDocumentEdited(this.dirty)
    } catch {
      // the title is cosmetic; a host that refuses it must not break editing
    }
    // the macOS proxy icon needs a real path; browser file handles ("fsa:…") have none
    const represented = this.path && !this.path.startsWith("fsa:") ? this.path : null
    if (represented === this.representedPath) return
    this.representedPath = represented
    try {
      await this.platform.window.setRepresentedFile?.(represented)
    } catch {
      // cosmetic, like the title
    }
  }

  /** Watches the open file for changes made by other apps, while attached. */
  private syncWatch(): void {
    const path = this.detachFn ? this.path : null
    if (path === this.watchedPath) return
    this.unwatch?.()
    this.unwatch = null
    this.watchedPath = path
    if (!path || !this.platform.fs.watch) return
    const since = this.watchSince?.path === path ? this.watchSince : null
    this.watchSince = null
    this.unwatch = this.platform.fs.watch(
      path,
      (change) => void this.onExternalChange(path, change),
      since ? { since: since.stamp } : undefined,
    )
  }

  private async onExternalChange(path: string, change: FileChange): Promise<void> {
    if (path !== this.path || this.changeQuestion) return
    if (change === "deleted") {
      this.notice(`"${basename(path)}" was moved or deleted. Save to keep it.`, "warning")
      this.markUnsaved()
      await this.syncRecovery()
      return
    }
    await this.askAboutChange(path)
  }

  /** Reload or Keep Mine, for another app's change to the open file. Resolves true when this version stays. */
  private askAboutChange(path: string): Promise<boolean> {
    this.changeQuestion ??= this.askReload(path).finally(() => {
      this.changeQuestion = null
    })
    return this.changeQuestion
  }

  // names the file, not the document: until a rename the browser couldn't apply is saved, they differ
  private async askReload(path: string): Promise<boolean> {
    const file = basename(path)
    try {
      const dirty = this.dirty
      const reload = await this.platform.dialogs.confirm(
        `"${file}" was changed by another app. Reload it?${dirty ? " Reloading discards your unsaved changes." : ""}`,
        { title: "File changed", okLabel: "Reload", cancelLabel: "Keep Mine", destructive: dirty },
      )
      if (path !== this.path) return false
      if (!reload) {
        // the next Save then writes this version over the other app's
        this.markUnsaved()
        await this.syncRecovery()
        return true
      }
      const error = this.load(await this.platform.fs.readText(path), path, file)
      if (error) {
        this.notice(`Couldn't reload ${file}: ${error}`, "error")
        return false
      }
      await this.noteStamp(path)
      await this.syncRecovery()
    } catch (e) {
      this.notice(`Couldn't reload ${file}: ${message(e)}`, "error")
    }
    return false
  }

  /** Remembers the file's stamp as Nib just read or wrote it, for the recovery copy. */
  private async noteStamp(path: string): Promise<void> {
    if (!this.platform.fs.stamp) return
    let stamp: string | null
    try {
      stamp = await this.platform.fs.stamp(path)
    } catch {
      return
    }
    if (this.path === path) this.diskStamp = stamp
  }

  private get canReopenByPath(): boolean {
    return this.platform.capabilities?.reopenByPath ?? this.platform.name !== "browser"
  }

  private serialize(): string {
    return serializeNib(
      this.core.scene.getElements(),
      { ...this.core.appState, name: this.name },
      this.core.scene.files,
    )
  }

  private setDocument(path: string | null, name: string, format: DocumentFormat): void {
    if (path !== this.path) this.diskStamp = null
    this.path = path
    this.name = name
    this.format = format
    if (this.core.appState.name !== name) this.core.setAppState({ name })
    this.syncWatch()
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.unsyncedSince = null
  }

  /** A drawing saved without a view (Excalidraw files, hand-written ones) or away from its content opens fitted. */
  private bringIntoView(saved: Partial<AppState>): void {
    const size = this.core.viewportSize?.width ? this.core.viewportSize : windowSize()
    if (!size) return
    if (saved.viewport && !this.core.isContentOffscreen(size.width, size.height)) return
    const fitted = fitWithin(this.core.scene.getNonDeleted(), size.width, size.height)
    this.core.setAppState({ viewport: fitted ?? { scrollX: 0, scrollY: 0, zoom: 1 } })
  }

  private async recoveryPaths(): Promise<{ file: string; meta: string }> {
    const dir = await this.platform.fs.appDataDir()
    const base = dir.replace(/\/+$/, "")
    const { file, meta } = recoveryFiles(this.platform.fs.recoverySlot)
    return { file: `${base}/${file}`, meta: `${base}/${meta}` }
  }

  // a clean drawing is kept too when the host can't reopen it by path: a download is gone after a reload
  private syncRecovery(): Promise<void> {
    if (this.holding) {
      this.syncHeld = true
      return Promise.resolve()
    }
    const keep =
      this.dirty || (!this.canReopenByPath && this.core.scene.getElements().some((e) => !e.isDeleted))
    return keep ? this.writeRecovery() : this.clearRecovery()
  }

  private writeRecovery(): Promise<void> {
    const gen = ++this.recoveryGen
    this.lastRecoveryOp = "write"
    const contents = this.serialize()
    const meta: RecoveryMeta = {
      path: this.path,
      name: this.name,
      dirty: this.dirty,
      savedAt: Date.now(),
      stamp: this.path ? this.diskStamp : null,
    }
    // a write that finishes after a newer clear removes what it wrote, so a slow autosave can't resurrect it
    const stale = () => gen !== this.recoveryGen
    const run = async () => {
      if (stale()) return
      let paths: { file: string; meta: string } | null = null
      try {
        paths = await this.recoveryPaths()
        if (stale()) return
        await this.platform.fs.writeText(paths.file, contents)
        if (!stale()) await this.platform.fs.writeText(paths.meta, JSON.stringify(meta))
        if (!stale()) this.recoveryFailed = false
      } catch (e) {
        if (!stale()) this.reportRecoveryFailure(e)
      }
      if (paths && stale() && this.lastRecoveryOp === "clear") await this.removeRecovery(paths)
    }
    this.writeChain = this.writeChain.then(run)
    return this.writeChain
  }

  private async clearRecovery(): Promise<void> {
    this.cancelTimer()
    if (this.holding) {
      this.syncHeld = true
      return
    }
    this.recoveryGen++
    this.lastRecoveryOp = "clear"
    try {
      await this.removeRecovery(await this.recoveryPaths())
    } catch {
      // nothing to clear
    }
  }

  private async removeRecovery(paths: { file: string; meta: string }): Promise<void> {
    try {
      await this.platform.fs.remove(paths.meta)
      await this.platform.fs.remove(paths.file)
    } catch {
      // nothing to clear
    }
  }

  private reportRecoveryFailure(e: unknown): void {
    if (this.recoveryFailed) return
    this.recoveryFailed = true
    const full = e instanceof Error && e.name === "QuotaExceededError"
    this.notice(
      full
        ? "Storage is full, so unsaved changes can't be kept for recovery. Save the drawing to keep it."
        : `Couldn't keep a recovery copy of unsaved changes: ${message(e)}`,
      "error",
    )
  }

  /** Whether the last session left a recovery copy that hasn't been restored or set aside yet. */
  private async inheritedCopy(): Promise<boolean> {
    if (!this.inherited) {
      this.holding = true
      this.inherited = this.recoveryPaths()
        .then((paths) => this.platform.fs.exists(paths.meta))
        .catch(() => false)
        .then((found) => {
          if (!found) this.release()
          return found
        })
    }
    return (await this.inherited) && this.holding
  }

  /** Lets autosave use the recovery slot again, catching up on what it held back. */
  private release(): void {
    if (!this.holding) return
    this.holding = false
    if (!this.syncHeld) return
    this.syncHeld = false
    void this.syncRecovery()
  }

  /**
   * Restores the last autosave after a crash or reload. Returns true when it
   * restored; `dirty` then says whether the restored work was ever saved. When
   * the board already holds other work, it asks before replacing it.
   */
  recover(): Promise<boolean> {
    this.recovering ??= this.recoverInherited().finally(() => {
      this.recovering = null
    })
    return this.recovering
  }

  private async recoverInherited(): Promise<boolean> {
    if (!(await this.inheritedCopy())) return false
    try {
      return await this.restoreCopy()
    } catch {
      return false
    } finally {
      this.release()
    }
  }

  private async restoreCopy(): Promise<boolean> {
    const paths = await this.recoveryPaths()
    const meta = JSON.parse(await this.platform.fs.readText(paths.meta)) as Partial<RecoveryMeta>
    const parsed = parseNib(await this.platform.fs.readText(paths.file))
    if (!parsed.ok) return false
    const clean = meta.dirty === false
    const name = typeof meta.name === "string" && meta.name ? meta.name : "Untitled"
    const path = typeof meta.path === "string" && !parsed.newerVersion ? meta.path : null
    const stamp = typeof meta.stamp === "string" ? meta.stamp : null
    const ownWork = this.dirty || this.path !== null || this.core.scene.getNonDeleted().length > 0
    if (ownWork) {
      // a copy of a saved drawing is no loss; unsaved work is never replaced without asking
      if (clean) return false
      const restore = await this.platform.dialogs.confirm(
        `Nib closed before “${stripSceneExtension(name) || "Untitled"}” was saved. Restoring it replaces what's on the board now.`,
        {
          title: "Restore your unsaved drawing?",
          okLabel: "Restore",
          cancelLabel: "Keep Current",
          destructive: true,
        },
      )
      if (!restore) return false
    }
    // a clean copy only mirrors its file, so the file wins when it changed since
    const now = clean && path && stamp !== null ? await this.stampNow(path) : undefined
    const changed = typeof now === "string" && now !== stamp
    if (path && changed && (await this.reopen(path, name))) return true
    this.loadQuietly(parsed.elements, parsed.appState, parsed.files)
    // until the file can be read, its old stamp lets the first check or the next save see edits made since
    if (path && stamp !== null && (now === undefined || changed)) this.watchSince = { path, stamp }
    this.setDocument(path, name, "nib")
    if (path) this.diskStamp = stamp
    for (const warning of parsed.warnings ?? []) this.notice(warning, "warning")
    if (path && now === null) {
      this.notice(`"${basename(path)}" was moved or deleted. Save to keep it.`, "warning")
      this.markUnsaved()
    } else if (clean) this.markSaved()
    else this.markUnsaved()
    this.bringIntoView(parsed.appState)
    void this.syncWindow()
    this.emit()
    return true
  }

  /** The file's stamp, or undefined when the host can't read it without asking. */
  private async stampNow(path: string): Promise<string | null | undefined> {
    if (!this.platform.fs.stamp) return undefined
    try {
      return await this.platform.fs.stamp(path)
    } catch {
      return undefined
    }
  }

  private async reopen(path: string, name: string): Promise<boolean> {
    let contents: string
    try {
      contents = await this.platform.fs.readText(path)
    } catch {
      return false
    }
    if (this.load(contents, path, name)) return false
    await this.noteStamp(path)
    return true
  }

  /** At launch, a drawing the last session never saved comes back before another one replaces it. */
  private async restoreBeforeReplacing(): Promise<void> {
    if (!(await this.inheritedCopy())) return
    let unsaved = true
    try {
      const meta = JSON.parse(
        await this.platform.fs.readText((await this.recoveryPaths()).meta),
      ) as Partial<RecoveryMeta>
      unsaved = meta.dirty !== false
    } catch {
      // unreadable metadata: try the copy itself
    }
    if (!unsaved) {
      this.release()
      return
    }
    if ((await this.recover()) && this.dirty)
      this.notice("Recovered unsaved changes from your last session.", "info")
  }

  private loadQuietly(...args: Parameters<EditorCore["loadScene"]>): void {
    this.cancelTimer()
    this.quiet = true
    try {
      this.core.loadScene(...args)
    } finally {
      this.quiet = false
    }
  }

  private load(contents: string, path: string | null, name: string): string | null {
    const result = parseScene(contents)
    if (!result.ok) return NOT_A_DRAWING
    this.loadQuietly(result.elements, result.appState, result.files)
    if (result.format === "excalidraw") {
      // saving would replace the .excalidraw with Nib JSON, so the first save becomes Save As
      this.setDocument(null, asDocumentName(basename(name)), "excalidraw")
      if (path)
        this.notice(
          `Opened ${basename(name)} as a copy. Saving creates a Nib drawing; use Export to Excalidraw to update the original.`,
          "info",
        )
    } else {
      // an older reader drops what it doesn't understand, so a newer file is never saved over in place
      this.setDocument(result.newerVersion ? null : path, basename(name), "nib")
    }
    for (const warning of result.warnings ?? []) this.notice(warning, "warning")
    this.markSaved()
    this.bringIntoView(result.appState)
    void this.syncWindow()
    this.emit()
    return null
  }

  /** Clears the canvas into a new untitled document. `skipConfirm` is for callers that already asked. */
  async newDocument(opts: { skipConfirm?: boolean } = {}): Promise<boolean> {
    this.lastError = null
    if (!opts.skipConfirm) {
      await this.restoreBeforeReplacing()
      if ((await this.guard()) === "cancel") return false
    }
    this.quiet = true
    try {
      this.core.resetScene()
    } finally {
      this.quiet = false
    }
    this.setDocument(null, "Untitled", "nib")
    this.markSaved()
    void this.syncWindow()
    this.emit()
    await this.clearRecovery()
    return true
  }

  /** Asks to save unsaved work, then lets the user pick a drawing. Resolves to an error message or null. */
  async open(): Promise<string | null> {
    this.lastError = null
    await this.restoreBeforeReplacing()
    if ((await this.guard()) === "cancel") return null
    let picked: Awaited<ReturnType<Platform["fs"]["openDocument"]>>
    try {
      picked = await this.platform.fs.openDocument(OPEN_FILTER)
    } catch (e) {
      return this.fail(`Couldn't open the file: ${message(e)}`)
    }
    if (!picked) return null
    return this.finishOpen(picked.contents, picked.path, picked.name)
  }

  async openPath(path: string): Promise<string | null> {
    this.lastError = null
    await this.restoreBeforeReplacing()
    if ((await this.guard()) === "cancel") return null
    let contents: string
    try {
      contents = await this.platform.fs.readText(path)
    } catch (e) {
      return this.fail(`Couldn't open ${basename(path)}: ${message(e)}`)
    }
    return this.finishOpen(contents, path, basename(path))
  }

  /** Opens a drawing whose contents were already read (a file picked in a multi-select Open), after the guard. */
  async openContents(contents: string, path: string | null, name: string): Promise<string | null> {
    this.lastError = null
    await this.restoreBeforeReplacing()
    if ((await this.guard()) === "cancel") return null
    return this.finishOpen(contents, path, name)
  }

  /** Opens a drawing that arrived as text (a dropped file or a scene PNG), after the unsaved-changes guard. */
  async openText(contents: string, name: string): Promise<string | null> {
    this.lastError = null
    await this.restoreBeforeReplacing()
    if ((await this.guard()) === "cancel") return null
    return this.finishOpen(contents, null, name)
  }

  /** Replaces the document without asking about unsaved changes. Prefer openText. */
  loadText(contents: string, name: string): string | null {
    this.lastError = null
    const error = this.load(contents, null, name)
    return error ? this.fail(error) : null
  }

  // a failed open leaves the document and its recovery copy as they were, even after Don't Save
  private async finishOpen(contents: string, path: string | null, name: string): Promise<string | null> {
    const error = this.load(contents, path, name)
    if (error) return this.fail(error)
    if (path && this.path === path) await this.noteStamp(path)
    await this.syncRecovery()
    return null
  }

  /**
   * Resolves false when the user cancelled or the write failed (then `lastError` says why). Saves run one
   * at a time; a Save asked for while another is still waiting to start joins that one.
   */
  save(): Promise<boolean> {
    if (this.queuedSave) return this.queuedSave
    const run = () => {
      this.queuedSave = null
      return this.writeDocument(this.path)
    }
    const next = this.saveChain.then(run, run)
    this.queuedSave = next
    this.saveChain = next
    return next
  }

  saveAs(): Promise<boolean> {
    const run = () => this.writeDocument(null)
    const next = this.saveChain.then(run, run)
    this.saveChain = next
    return next
  }

  private async writeDocument(path: string | null): Promise<boolean> {
    this.lastError = null
    this.settleText()
    // a rename the file itself didn't take is saved as a new file of that name, never into the old one
    const into = path && this.renamedAway(path) ? null : path
    let written = { sceneKey: "", stateKey: "", name: "" }
    const attempt = () => {
      written = { sceneKey: this.draftKey ?? this.sceneKey, stateKey: this.stateKey, name: this.name }
      return this.platform.fs.saveDocument(this.serialize(), into, asDocumentName(this.name), SAVE_FILTER)
    }
    let target: string | null
    try {
      try {
        target = await attempt()
      } catch (e) {
        if (!into || !isFileChanged(e)) throw e
        // another app saved over the file since Nib last read it: Keep Mine writes over it, Reload takes theirs
        if (!(await this.askAboutChange(into))) throw abortError()
        target = await attempt()
      }
    } catch (e) {
      if (!isAbort(e)) this.fail(`Couldn't save ${into ? basename(into) : this.name}: ${message(e)}`)
      return false
    }
    if (target === null && this.canReopenByPath) return false
    // a new file is named after itself
    const moved = target !== null && target !== into
    this.setDocument(target ?? this.path, moved ? basename(target!) : this.name, "nib")
    this.markWritten(written.sceneKey, written.stateKey, moved ? this.name : written.name)
    if (target) await this.noteStamp(target)
    void this.syncWindow()
    this.emit()
    await this.syncRecovery()
    return true
  }

  async importExcalidraw(): Promise<string | null> {
    this.lastError = null
    await this.restoreBeforeReplacing()
    if ((await this.guard()) === "cancel") return null
    let picked: Awaited<ReturnType<Platform["fs"]["openDocument"]>>
    try {
      picked = await this.platform.fs.openDocument(EXCALIDRAW_FILTER)
    } catch (e) {
      return this.fail(`Couldn't open the file: ${message(e)}`)
    }
    if (!picked) return null
    const parsed = parseExcalidraw(picked.contents)
    if (!parsed.ok) return this.fail(NOT_A_DRAWING)
    this.loadQuietly(parsed.elements, parsed.appState, parsed.files)
    this.setDocument(null, stripSceneExtension(basename(picked.name)), "excalidraw")
    this.markUnsaved()
    this.bringIntoView(parsed.appState)
    void this.syncWindow()
    this.emit()
    await this.syncRecovery()
    return null
  }

  /**
   * Resolves the path written (a desktop path or a browser "fsa:<id>/<name>", where the user may have
   * renamed the file), true for a browser download, and false when the user cancelled or the write failed
   * (then `lastError` says why).
   */
  async exportExcalidraw(): Promise<string | boolean> {
    this.lastError = null
    const text = toExcalidraw(this.core.scene.getElements(), this.core.appState, this.core.scene.files)
    try {
      const target = await this.platform.fs.saveDocument(
        text,
        null,
        `${this.baseName}.excalidraw`,
        EXCALIDRAW_FILTER,
      )
      return target ?? !this.canReopenByPath
    } catch (e) {
      if (!isAbort(e)) this.fail(`Couldn't export ${this.baseName}.excalidraw: ${message(e)}`)
      return false
    }
  }

  /** Don't Save, answered elsewhere (one prompt for several tabs): drops the recovery copy. */
  async discard(): Promise<void> {
    await this.clearRecovery()
  }

  /**
   * The Save / Don't Save / Cancel guard. Resolves true when it is fine to
   * replace or close the document; "Don't Save" also drops the recovery copy.
   */
  async confirmDiscard(): Promise<boolean> {
    const answer = await this.guard()
    if (answer === "discard") await this.clearRecovery()
    return answer !== "cancel"
  }

  /** Asks about unsaved work. A discard is left to the caller, so a cancelled open keeps the recovery copy. */
  private async guard(): Promise<GuardAnswer> {
    this.settleText()
    if (!this.dirty) return "clean"
    let choice: "save" | "discard" | "cancel"
    try {
      choice = await this.platform.dialogs.askSave(this.name)
    } catch (e) {
      this.fail(`Couldn't ask about unsaved changes: ${message(e)}`)
      return "cancel"
    }
    if (choice === "save") return (await this.save()) ? "saved" : "cancel"
    return choice
  }

  /**
   * Renames the document. A saved drawing's file is renamed with it where the host can do that safely
   * (desktop), so the two never disagree; elsewhere the next Save makes a file of the new name. Resolves
   * false, keeping the old name, when the file couldn't be renamed (a notice says why).
   */
  setName(name: string): Promise<boolean> {
    if (name === this.name) return Promise.resolve(true)
    const path = this.path
    if (path && this.platform.fs.renameDocument) {
      this.queuedSave = null
      // in line with saves, so none of them writes to the old path while the file is being renamed
      const run = () => this.renameFile(path, name)
      const next = this.saveChain.then(run, run)
      this.saveChain = next
      return next
    }
    this.applyName(name)
    if (path && this.renamedAway(path)) {
      const host = this.platform.name === "browser" ? "The browser" : "Nib"
      this.notice(
        `${host} can't rename "${basename(path)}", so Save makes a copy named "${this.name}".`,
        "info",
      )
    }
    return Promise.resolve(true)
  }

  private async renameFile(path: string, name: string): Promise<boolean> {
    const { fs } = this.platform
    // another document replaced this one while the rename waited for a save
    if (this.path !== path || !fs.renameDocument) return false
    const file = asDocumentName(name)
    if (file === basename(path)) {
      if (file !== this.name) this.applyName(file)
      return true
    }
    let target: string
    try {
      target = await fs.renameDocument(path, file)
    } catch (e) {
      this.notice(`Couldn't rename "${basename(path)}": ${message(e)}`, "error")
      return false
    }
    if (this.path !== path) return true
    // the file carries the new name now, so a rename alone leaves nothing unsaved
    const nameSaved = this.savedName === this.name
    const stamp = this.diskStamp
    this.setDocument(target, basename(target), this.format)
    this.diskStamp = stamp
    if (nameSaved) this.savedName = this.name
    this.setDirty(this.computeDirty())
    void this.syncWindow()
    this.emit()
    await this.syncRecovery()
    return true
  }

  /** The name is part of the document, so a rename is an edit that autosave keeps. */
  private applyName(name: string): void {
    this.setDocument(this.path, name, this.format)
    void this.syncWindow()
    this.emit()
    this.refresh()
  }

  /** True when the document's name is no longer its file's, so the next save makes a file of that name. */
  private renamedAway(path: string): boolean {
    return stripSceneExtension(this.name) !== stripSceneExtension(basename(path))
  }
}

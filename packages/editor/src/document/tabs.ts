import { EditorCore } from "@nib/core"
import {
  type OpenedDocument,
  type Platform,
  type PlatformWindow,
  type RestoredTab,
  type SessionTab,
  newRecoverySlot,
  recoveryFiles,
} from "@nib/platform"
import { DocumentController, type DocumentNoticeKind, OPEN_FILTER } from "./documentController"

/** One open document: its own editor, undo history, file, dirty state and recovery copy. */
export interface DocumentTab {
  readonly id: string
  readonly core: EditorCore
  readonly doc: DocumentController
}

export interface TabView {
  id: string
  name: string
  path: string | null
  dirty: boolean
}

export interface TabsState {
  tabs: readonly TabView[]
  activeId: string
}

export interface TabsOptions {
  createCore?: () => EditorCore
  autosaveMs?: number
  autosaveMaxMs?: number
  /** How long tab changes may settle before the session is written. */
  sessionDelayMs?: number
}

interface Tab {
  id: string
  core: EditorCore
  doc: DocumentController
  untitled: number
  title: string | null
  edited: boolean
  represented: string | null | undefined
  off: (() => void)[]
}

interface ClosedTab {
  slot: string
  path: string | null
  name: string
  index: number
  viewport: EditorCore["appState"]["viewport"]
}

const MAX_CLOSED = 20

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const basename = (path: string): string => path.split(/[/\\]/).pop() || path

/** "Untitled", then "Untitled 2", "Untitled 3": the lowest number no open untitled tab is using. */
export const nextUntitled = (used: readonly number[]): number => {
  let n = 1
  while (used.includes(n)) n++
  return n
}

export const untitledName = (n: number): string => (n === 1 ? "Untitled" : `Untitled ${n}`)

/**
 * The open documents of one window. Each tab has its own EditorCore and DocumentController, and keeps
 * them in memory while another tab is in front. The controller owns their lifetimes, routes opened
 * files to tabs, merges the per-document window state (title, edited dot, proxy icon) into the real
 * window's, guards closing the window over every tab, and keeps the session for the next launch.
 */
export class TabsController {
  private list: Tab[] = []
  private activeId = ""
  private closed: ClosedTab[] = []
  private listeners = new Set<() => void>()
  private noticeListeners = new Set<(message: string, kind: DocumentNoticeKind) => void>()
  private snapshot: TabsState | null = null
  private attached = false
  private detachFns: (() => void)[] = []
  private launched = false
  private launching: Promise<void> | null = null
  private pendingOpens: string[] = []
  private sessionTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly platform: Platform,
    private readonly opts: TabsOptions = {},
  ) {
    this.activeId = this.create({}).id
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Notices from every tab's document, so a background tab's news still reaches the user. */
  onNotice(cb: (message: string, kind: DocumentNoticeKind) => void): () => void {
    this.noticeListeners.add(cb)
    return () => this.noticeListeners.delete(cb)
  }

  /** Replaced only when something shown changes, so it can be a useSyncExternalStore snapshot. */
  getState = (): TabsState => {
    this.snapshot ??= {
      activeId: this.activeId,
      tabs: this.list.map((t) => ({ id: t.id, name: t.doc.name, path: t.doc.path, dirty: t.doc.dirty })),
    }
    return this.snapshot
  }

  get tabs(): readonly DocumentTab[] {
    return this.list
  }

  get active(): DocumentTab {
    return this.find(this.activeId) ?? this.list[0]!
  }

  tab(id: string): DocumentTab | undefined {
    return this.find(id)
  }

  private find(id: string): Tab | undefined {
    return this.list.find((t) => t.id === id)
  }

  private changed(): void {
    this.snapshot = null
    for (const l of this.listeners) l()
    this.scheduleSession()
  }

  private notice(text: string, kind: DocumentNoticeKind): void {
    for (const l of this.noticeListeners) l(text, kind)
  }

  /**
   * Starts every tab's document, guards closing the window, takes files opened from the OS, and (once)
   * restores the last session after `ready`. Returns the matching detach; attach again is harmless.
   */
  attach(ready: () => Promise<void> = () => Promise.resolve()): () => void {
    if (!this.attached) {
      this.attached = true
      for (const t of this.list) this.start(t)
      this.detachFns = [
        this.platform.window.onCloseRequested(() => this.confirmCloseAll(), {
          isDirty: () => this.list.some((t) => t.doc.dirty),
        }),
        this.platform.onOpenFile?.((path) => {
          if (this.launched) void this.reportOpen(this.openPath(path))
          else this.pendingOpens.push(path)
        }) ?? (() => {}),
        this.watchPageHide(),
      ]
      this.launching ??= this.launch(ready)
    }
    return () => this.detach()
  }

  private detach(): void {
    if (!this.attached) return
    this.attached = false
    for (const off of this.detachFns) off()
    this.detachFns = []
    for (const t of this.list) this.stop(t)
  }

  /** Resolves once the session is restored and files opened at launch are open. */
  whenLaunched(): Promise<void> {
    return this.launching ?? Promise.resolve()
  }

  private watchPageHide(): () => void {
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") return () => {}
    // a browser tab can be closed without waiting, so the session is written as soon as the page hides
    const onHide = () => {
      if (document.visibilityState === "hidden") void this.flushSession()
    }
    document.addEventListener("visibilitychange", onHide)
    return () => document.removeEventListener("visibilitychange", onHide)
  }

  private async launch(ready: () => Promise<void>): Promise<void> {
    try {
      await ready()
    } catch {
      // fonts that never load still leave a usable editor
    }
    try {
      await this.restore()
    } catch (e) {
      this.notice(`Couldn't reopen your last session: ${message(e)}`, "error")
    }
    this.launched = true
    const opens = this.pendingOpens.splice(0)
    for (const path of opens) await this.reportOpen(this.openPath(path))
    this.changed()
  }

  private async reportOpen(result: Promise<string | null>): Promise<void> {
    const error = await result
    if (error) this.notice(error, "error")
  }

  private create(opts: { slot?: string; at?: number }): Tab {
    const untitled = nextUntitled(this.list.filter((t) => t.doc.path === null).map((t) => t.untitled))
    const core = this.opts.createCore?.() ?? new EditorCore()
    const tab = {
      id: opts.slot ?? newRecoverySlot(),
      core,
      untitled,
      title: null,
      edited: false,
      represented: undefined,
      off: [],
    } as unknown as Tab
    tab.doc = new DocumentController(core, this.tabPlatform(tab), {
      autosaveMs: this.opts.autosaveMs,
      autosaveMaxMs: this.opts.autosaveMaxMs,
      name: untitledName(untitled),
    })
    const at = opts.at ?? this.list.length
    this.list.splice(Math.max(0, Math.min(at, this.list.length)), 0, tab)
    if (this.attached) this.start(tab)
    return tab
  }

  private start(tab: Tab): void {
    if (tab.off.length > 0) return
    let viewport = tab.core.appState.viewport
    tab.off = [
      tab.doc.attach(),
      tab.doc.subscribe(() => this.changed()),
      tab.doc.onNotice((m, kind) => this.notice(m, kind)),
      tab.core.subscribe(() => {
        if (tab.core.appState.viewport === viewport) return
        viewport = tab.core.appState.viewport
        this.scheduleSession()
      }),
    ]
  }

  private stop(tab: Tab): void {
    for (const off of tab.off) off()
    tab.off = []
    tab.doc.dispose()
  }

  /** Each document talks to its own view of the window; the controller decides what the real one shows. */
  private tabPlatform(tab: Tab): Platform {
    const host = this.platform
    const isActive = () => this.activeId === tab.id
    const window: PlatformWindow = {
      setTitle: async (title) => {
        tab.title = title
        if (isActive()) await host.window.setTitle(title)
      },
      setDocumentEdited: async (edited) => {
        tab.edited = edited
        await host.window.setDocumentEdited(this.list.some((t) => t.edited))
      },
      setRepresentedFile: async (path) => {
        tab.represented = path
        if (isActive()) await host.window.setRepresentedFile?.(path)
      },
      // the controller asks each document itself (close, confirmCloseAll), in an order it chooses
      onCloseRequested: () => () => {},
    }
    const fs = new Proxy(host.fs, {
      get: (target, key) => (key === "recoverySlot" ? tab.id : Reflect.get(target, key)),
    })
    return new Proxy(host, {
      get: (target, key) => (key === "window" ? window : key === "fs" ? fs : Reflect.get(target, key)),
    })
  }

  private async showWindowState(tab: Tab): Promise<void> {
    try {
      if (tab.title) await this.platform.window.setTitle(tab.title)
      if (tab.represented !== undefined) await this.platform.window.setRepresentedFile?.(tab.represented)
    } catch {
      // cosmetic, as in DocumentController
    }
  }

  /** An empty Untitled nobody has drawn on: the next opened file may take its place. */
  isUntouched(tab: DocumentTab): boolean {
    return tab.doc.path === null && !tab.doc.dirty && tab.core.scene.getNonDeleted().length === 0
  }

  activate(id: string): void {
    const tab = this.find(id)
    if (!tab || id === this.activeId) return
    this.activeId = id
    void this.showWindowState(tab)
    this.changed()
  }

  newTab(): DocumentTab {
    const tab = this.create({})
    this.activate(tab.id)
    return tab
  }

  /** Ctrl+Tab and Ctrl+Shift+Tab, wrapping around. */
  cycle(step: 1 | -1): void {
    const i = this.list.findIndex((t) => t.id === this.activeId)
    const n = this.list.length
    this.activate(this.list[(i + step + n) % n]!.id)
  }

  /** ⌘1 to ⌘8 go to that tab; ⌘9 goes to the last, as in browsers. */
  goTo(position: number): void {
    const tab = position >= 9 ? this.list.at(-1) : this.list[position - 1]
    if (tab) this.activate(tab.id)
  }

  move(id: string, to: number): void {
    const from = this.list.findIndex((t) => t.id === id)
    if (from < 0) return
    const target = Math.max(0, Math.min(to, this.list.length - 1))
    if (from === target) return
    const [tab] = this.list.splice(from, 1)
    this.list.splice(target, 0, tab!)
    this.changed()
  }

  /** Closes a tab after its Save / Don't Save / Cancel; resolves false when the user kept it open. */
  async close(id: string): Promise<boolean> {
    const tab = this.find(id)
    if (!tab) return true
    if (tab.doc.dirty) this.activate(id)
    if (!(await tab.doc.confirmDiscard())) return false
    this.remove(tab)
    return true
  }

  /** Closes tabs one after another and stops at the first the user keeps. */
  async closeMany(ids: readonly string[]): Promise<boolean> {
    for (const id of ids) if (!(await this.close(id))) return false
    return true
  }

  closeOthers(id: string): Promise<boolean> {
    return this.closeMany(this.list.filter((t) => t.id !== id).map((t) => t.id))
  }

  closeToTheRight(id: string): Promise<boolean> {
    const i = this.list.findIndex((t) => t.id === id)
    return this.closeMany(this.list.slice(i + 1).map((t) => t.id))
  }

  /** Closes every tab without unsaved changes; none of them asks anything. */
  closeSaved(): Promise<boolean> {
    return this.closeMany(this.list.filter((t) => !t.doc.dirty).map((t) => t.id))
  }

  private remove(tab: Tab): void {
    const index = this.list.indexOf(tab)
    if (index < 0) return
    // the last tab never goes: closing it leaves an empty Untitled, as an editor window always holds one
    if (this.list.length === 1 && this.isUntouched(tab)) return
    if (!this.isUntouched(tab)) this.remember(tab, index)
    this.list.splice(index, 1)
    this.stop(tab)
    if (this.list.length === 0) this.create({})
    // the tab to the right takes its place, else the one to the left
    if (this.activeId === tab.id) this.activeId = (this.list[index] ?? this.list[index - 1])!.id
    void this.showWindowState(this.find(this.activeId)!)
    void this.platform.window.setDocumentEdited(this.list.some((t) => t.edited)).catch(() => {})
    this.changed()
  }

  private remember(tab: Tab, index: number): void {
    this.closed.push({
      slot: tab.id,
      path: tab.doc.path,
      name: tab.doc.name,
      index,
      viewport: tab.core.appState.viewport,
    })
    for (const gone of this.closed.splice(0, Math.max(0, this.closed.length - MAX_CLOSED))) {
      void this.dropCopy(gone.slot)
    }
  }

  private async dropCopy(slot: string): Promise<void> {
    if (this.list.some((t) => t.id === slot)) return
    try {
      const dir = (await this.platform.fs.appDataDir()).replace(/\/+$/, "")
      const { file, meta } = recoveryFiles(slot)
      await this.platform.fs.remove(`${dir}/${meta}`)
      await this.platform.fs.remove(`${dir}/${file}`)
    } catch {
      // nothing to drop
    }
  }

  /**
   * ⇧⌘T: the last closed tab comes back where it was, in its own recovery slot, from its file or from
   * the copy that slot still holds. Work the user chose Don't Save for stays discarded.
   */
  async reopenClosed(): Promise<boolean> {
    const entry = this.closed.pop()
    if (!entry) return false
    const open = entry.path ? this.byPath(entry.path) : undefined
    if (open) {
      this.activate(open.id)
      return true
    }
    const tab = this.create({ slot: entry.slot, at: entry.index })
    this.activate(tab.id)
    const loaded = entry.path ? (await tab.doc.openPath(entry.path)) === null : await tab.doc.recover()
    if (loaded) tab.core.setAppState({ viewport: entry.viewport })
    else if (entry.path) this.notice(`Couldn't reopen ${basename(entry.path)}.`, "error")
    return true
  }

  private byPath(path: string): Tab | undefined {
    return this.list.find((t) => t.doc.path === path)
  }

  /** The tab a newly opened drawing goes into: the active one when untouched, else a new one. */
  private target(): { tab: Tab; fresh: boolean } {
    const active = this.find(this.activeId)
    if (active && this.isUntouched(active)) return { tab: active, fresh: false }
    const tab = this.create({})
    this.activate(tab.id)
    return { tab, fresh: true }
  }

  /** A tab that was made for a drawing that then failed to open goes away again. */
  private abandon(tab: Tab, fresh: boolean): void {
    if (fresh && this.isUntouched(tab) && this.list.length > 1) {
      this.list.splice(this.list.indexOf(tab), 1)
      this.stop(tab)
      if (this.activeId === tab.id) this.activeId = this.list.at(-1)!.id
      void this.showWindowState(this.find(this.activeId)!)
      this.changed()
    }
  }

  /** Finder, Open Recent, the command line: the tab that has it, else an untouched or new tab. */
  async openPath(path: string): Promise<string | null> {
    const existing = this.byPath(path)
    if (existing) {
      this.activate(existing.id)
      return null
    }
    const { tab, fresh } = this.target()
    const error = await tab.doc.openPath(path)
    if (error) this.abandon(tab, fresh)
    return error
  }

  /** A drawing whose text is already here (a picked or dropped file), with its path when it has one. */
  async openContents(contents: string, path: string | null, name: string): Promise<string | null> {
    const existing = path ? this.byPath(path) : undefined
    if (existing) {
      this.activate(existing.id)
      return null
    }
    const { tab, fresh } = this.target()
    const error = await tab.doc.openContents(contents, path, name)
    if (error) this.abandon(tab, fresh)
    return error
  }

  /** Open…: every picked drawing in its own tab. Resolves the first error, or null. */
  async open(): Promise<string | null> {
    const { fs } = this.platform
    let picked: OpenedDocument[]
    try {
      picked = fs.openDocuments
        ? await fs.openDocuments(OPEN_FILTER)
        : [await fs.openDocument(OPEN_FILTER)].filter((d): d is OpenedDocument => d !== null)
    } catch (e) {
      return `Couldn't open the file: ${message(e)}`
    }
    let first: string | null = null
    for (const d of picked) first ??= await this.openContents(d.contents, d.path, d.name)
    return first
  }

  /** Import from Excalidraw: into the untouched tab in front, else a new one. */
  async importExcalidraw(): Promise<string | null> {
    const { tab, fresh } = this.target()
    const error = await tab.doc.importExcalidraw()
    if (error || this.isUntouched(tab)) this.abandon(tab, fresh)
    return error
  }

  /**
   * The window's (and the app's) close guard over every tab: one Save All / Don't Save / Cancel when
   * several tabs have unsaved changes, the usual question when one does.
   */
  async confirmCloseAll(): Promise<boolean> {
    for (const t of this.list) t.doc.settleText()
    const dirty = this.list.filter((t) => t.doc.dirty)
    const askAll = this.platform.dialogs.askSaveAll
    if (dirty.length < 2 || !askAll) {
      for (const t of dirty) {
        this.activate(t.id)
        if (!(await t.doc.confirmDiscard())) return false
      }
    } else {
      let choice: Awaited<ReturnType<typeof askAll>>
      try {
        choice = await askAll(dirty.map((t) => t.doc.name))
      } catch (e) {
        this.notice(`Couldn't ask about unsaved changes: ${message(e)}`, "error")
        return false
      }
      if (choice === "cancel") return false
      for (const t of dirty) {
        if (choice === "discard") {
          await t.doc.discard()
          continue
        }
        this.activate(t.id)
        if (!(await t.doc.save())) {
          if (t.doc.lastError) this.notice(t.doc.lastError, "error")
          return false
        }
      }
    }
    await this.flushSession()
    return true
  }

  private scheduleSession(): void {
    if (!this.launched || !this.platform.session) return
    if (this.sessionTimer) return
    this.sessionTimer = setTimeout(() => {
      this.sessionTimer = null
      void this.flushSession()
    }, this.opts.sessionDelayMs ?? 1000)
  }

  /** The open tabs as the next launch should bring them back. */
  sessionTabs(): { tabs: SessionTab[]; active: number } {
    return {
      tabs: this.list.map((t) => {
        const { scrollX, scrollY, zoom } = t.core.appState.viewport
        return { slot: t.id, path: t.doc.path, viewport: { scrollX, scrollY, zoom } }
      }),
      active: Math.max(
        0,
        this.list.findIndex((t) => t.id === this.activeId),
      ),
    }
  }

  async flushSession(): Promise<void> {
    if (this.sessionTimer) clearTimeout(this.sessionTimer)
    this.sessionTimer = null
    if (!this.launched || !this.platform.session) return
    const { tabs, active } = this.sessionTabs()
    try {
      await this.platform.session.save(tabs, active)
    } catch {
      // the session is a convenience; the recovery copies still hold the work
    }
  }

  private async restore(): Promise<void> {
    const saved = await this.platform.session?.restore()
    for (const n of saved?.notices ?? []) this.notice(n, "info")
    if (!saved || saved.tabs.length === 0) return
    const placeholder = this.find(this.activeId)
    const restored: Tab[] = []
    let front: Tab | undefined
    for (const [i, entry] of saved.tabs.entries()) {
      const tab = await this.restoreTab(entry)
      if (!tab) continue
      restored.push(tab)
      if (i <= saved.active) front = tab
    }
    if (restored.length === 0) return
    if (placeholder && this.isUntouched(placeholder) && !restored.includes(placeholder)) {
      this.list.splice(this.list.indexOf(placeholder), 1)
      this.stop(placeholder)
    }
    this.activeId = ""
    this.activate((front ?? restored[0]!).id)
    if (restored.some((t) => t.doc.dirty))
      this.notice("Recovered unsaved changes from your last session.", "info")
  }

  private async restoreTab(entry: RestoredTab): Promise<Tab | null> {
    const tab = this.create({ slot: entry.slot })
    const loaded = entry.open ? (await tab.doc.openPath(entry.open)) === null : await tab.doc.recover()
    if (!loaded || this.isUntouched(tab)) {
      if (entry.open) this.notice(`Couldn't reopen ${basename(entry.open)}.`, "error")
      this.list.splice(this.list.indexOf(tab), 1)
      this.stop(tab)
      return null
    }
    if (entry.viewport) tab.core.setAppState({ viewport: entry.viewport })
    return tab
  }
}

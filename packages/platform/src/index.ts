export interface FileFilter {
  name: string
  extensions: string[]
}

export interface OpenedDocument {
  path: string | null
  name: string
  contents: string
}

export type FileChange = "modified" | "deleted"

export interface WatchOptions {
  /**
   * The file's stamp (see PlatformFs.stamp) as an earlier session last saw it. A different stamp at the
   * first check that can read the file is reported as a change, so edits made while Nib was closed
   * aren't missed.
   */
  since?: string | null
}

export interface PlatformFs {
  openDocument(filters: FileFilter[]): Promise<OpenedDocument | null>
  /** Like openDocument, but the user may pick several; resolves an empty list when they cancel. */
  openDocuments?(filters: FileFilter[]): Promise<OpenedDocument[]>
  /**
   * Writes to `path`, or asks for a path when it is null. `filters` limits the save dialog to the formats
   * the caller is writing; without it the filter is inferred from `suggestedName`'s extension. On desktop
   * it resolves null when the user cancels the dialog; when `path` was given but can no longer be written
   * without asking, a cancelled dialog rejects with an AbortError. In the browser, null means the file was
   * downloaded; with the File System Access API it resolves an opaque "fsa:<id>/<name>" path that later
   * saves write back to, and a cancelled picker rejects with an AbortError.
   *
   * An in-place write to `path` rejects with an Error named "FileChangedError" (see isFileChanged), and
   * writes nothing, when another app changed the file since Nib last read or wrote it; calling again
   * overwrites it. A desktop write replaces the file in one step, so a failed save never truncates it.
   */
  saveDocument(
    contents: string,
    path: string | null,
    suggestedName: string,
    filters?: FileFilter[],
  ): Promise<string | null>
  /**
   * Asks where to save `data`. Resolves the path written, or null when the browser downloaded it instead;
   * a cancelled dialog rejects with an AbortError, as saveDocument's does.
   */
  saveBinary(data: Uint8Array, suggestedName: string, filters: FileFilter[]): Promise<string | null>
  /**
   * Renames the document at `path` to `name` (a file name with its extension) in the same folder, and
   * resolves the new path. Rejects, renaming nothing, when a file of that name is already there or the
   * file can't be renamed. Only hosts that can rename a file without risking another one have it.
   */
  renameDocument?(path: string, name: string): Promise<string>
  readText(path: string): Promise<string>
  /** Rejects with an Error named "QuotaExceededError" when browser storage is full. */
  writeText(path: string, contents: string): Promise<void>
  exists(path: string): Promise<boolean>
  remove(path: string): Promise<void>
  /** On the web this is unique per browser tab, so tabs never share a recovery slot. */
  appDataDir(): Promise<string>
  /**
   * Names the document's recovery copy in appDataDir (see recoveryFiles). Each tab has its own; without
   * one the copy is "current".
   */
  recoverySlot?: string
  /**
   * A folder every tab and window shares, for data such as the library (IndexedDB on the web, with a
   * localStorage fallback). On desktop it is the app data folder.
   */
  sharedDataDir?(): Promise<string>
  /**
   * Reports changes other apps make to the document at `path`; Nib's own writes through this platform
   * never count. Checked when the window regains focus and every few seconds. Returns an unsubscribe.
   */
  watch?(path: string, onChange: (change: FileChange) => void, opts?: WatchOptions): () => void
  /**
   * A version stamp (modification time and size) of the document at `path`, read without asking for
   * access: null once the file is gone, and rejects when the host can't tell (no permission yet).
   */
  stamp?(path: string): Promise<string | null>
}

export type MenuCommand =
  | "file.new"
  | "file.open"
  | "file.save"
  | "file.saveAs"
  | "file.exportImage"
  | "file.importExcalidraw"
  | "file.exportExcalidraw"
  | "file.clearRecent"
  | "file.closeTab"
  | "file.reopenClosedTab"
  | "view.nextTab"
  | "view.previousTab"
  | "edit.undo"
  | "edit.redo"
  | "edit.cut"
  | "edit.copy"
  | "edit.paste"
  | "edit.selectAll"
  | "edit.delete"
  | "edit.duplicate"
  | "edit.group"
  | "edit.ungroup"
  | "edit.copyStyle"
  | "edit.pasteStyle"
  | "view.zoomIn"
  | "view.zoomOut"
  | "view.zoomReset"
  | "view.zoomFit"
  | "view.zoomSelection"
  | "view.toggleGrid"
  | "view.toggleSnap"
  | "view.toggleTheme"
  | "view.toggleZen"
  | "view.toggleViewMode"
  | "view.toggleStats"
  | "arrange.bringForward"
  | "arrange.bringToFront"
  | "arrange.sendBackward"
  | "arrange.sendToBack"
  | "arrange.alignLeft"
  | "arrange.alignRight"
  | "arrange.alignTop"
  | "arrange.alignBottom"
  | "arrange.alignCenterX"
  | "arrange.alignCenterY"
  | "arrange.flipH"
  | "arrange.flipV"
  | "arrange.lock"
  | "help.shortcuts"
  | "app.preferences"

export interface PlatformMenu {
  /** Idempotent: a second call only swaps the command handler, it never rebuilds the native menu. */
  install(onCommand: (cmd: MenuCommand) => void): Promise<void>
}

export interface CloseRequestOptions {
  /** Synchronous dirty check for hosts that must decide without awaiting (browser beforeunload). */
  isDirty?: () => boolean
}

export interface PlatformWindow {
  setTitle(title: string): Promise<void>
  setDocumentEdited(edited: boolean): Promise<void>
  /**
   * `handler` resolves true to let the window (or app, on quit) close. Returns an unsubscribe function;
   * calling it more than once is harmless.
   */
  onCloseRequested(handler: () => Promise<boolean>, opts?: CloseRequestOptions): () => void
  /** The title bar's proxy icon for the open document (macOS); null removes it. */
  setRepresentedFile?(path: string | null): Promise<void>
}

export interface SessionViewport {
  scrollX: number
  scrollY: number
  zoom: number
}

export interface SessionViewport {
  scrollX: number
  scrollY: number
  zoom: number
}

/** One open tab as the session records it. */
export interface SessionTab {
  slot: string
  path: string | null
  viewport: SessionViewport | null
}

/** A tab to bring back at launch: open `open`, or else restore the recovery copy in `slot`. */
export interface RestoredTab {
  slot: string
  open: string | null
  viewport: SessionViewport | null
}

export interface RestoredSession {
  tabs: RestoredTab[]
  /** Index into `tabs` of the tab that was in front. */
  active: number
  /** One-line notices, such as documents that were moved or deleted since. */
  notices: string[]
}

export interface PlatformSession {
  /** The tabs the last session left, or null when there is nothing to restore. */
  restore(): Promise<RestoredSession | null>
  /** Records the open tabs; called whenever they change and before quitting. */
  save(tabs: SessionTab[], active: number): Promise<void>
}

export interface ClipboardPayload {
  text?: string
  html?: string
  svg?: string
  json?: string
  png?: Promise<Uint8Array>
}

export interface PlatformClipboard {
  writeText(text: string): Promise<void>
  readText(): Promise<string>
  /**
   * Writes every given flavour at once. Call it synchronously from the user gesture: the PNG is a promise
   * so WebKit keeps the user activation while it renders.
   */
  write?(items: ClipboardPayload): Promise<void>
  writeImage?(png: Uint8Array | Promise<Uint8Array>): Promise<void>
  /** PNG bytes of the image on the clipboard, or null when it holds none. */
  readImage?(): Promise<Uint8Array | null>
}

export interface DialogConfirmOptions {
  title?: string
  okLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

export interface DialogMessageOptions {
  title?: string
  kind?: "info" | "warning" | "error"
}

export type SaveChoice = "save" | "discard" | "cancel"

export interface PlatformDialogs {
  confirm(message: string, opts?: DialogConfirmOptions): Promise<boolean>
  /** The Save / Don't Save / Cancel question for a document with unsaved changes. */
  askSave(documentName: string): Promise<SaveChoice>
  /** Save All / Don't Save / Cancel for several documents at once, as when quitting with unsaved tabs. */
  askSaveAll?(documentNames: string[]): Promise<SaveChoice>
  message(message: string, opts?: DialogMessageOptions): Promise<void>
}

/**
 * Small synchronous key/value store for user preferences; never throws. `get` returns what is stored, so
 * after a write that didn't fit it still returns the previous value (read back to detect that).
 */
export interface PlatformPrefs {
  get(key: string): string | null
  /** `null` removes the key. */
  set(key: string, value: string | null): void
}

export interface PlatformRecentFiles {
  list(): Promise<string[]>
  add(path: string): Promise<void>
  clear(): Promise<void>
}

export interface PlatformCapabilities {
  /** False when a saved document can't be read back by its path (browser downloads). */
  reopenByPath: boolean
  /** True when Save writes back to the file the user opened or picked; false when it downloads a copy. */
  saveInPlace?: boolean
}

export interface UpdateInfo {
  version: string
  currentVersion: string
  notes?: string | null
}

export interface PlatformUpdater {
  /** Resolves null when this is the newest version. */
  check(): Promise<UpdateInfo | null>
  /**
   * Downloads and installs the update the last check found, then relaunches once the unsaved-changes
   * guard allows it (otherwise the update applies on the next launch).
   */
  install(onProgress?: (downloaded: number, total: number | null) => void): Promise<void>
}

export interface Platform {
  name: "tauri" | "browser"
  capabilities?: PlatformCapabilities
  fs: PlatformFs
  menu: PlatformMenu
  window: PlatformWindow
  clipboard: PlatformClipboard
  dialogs: PlatformDialogs
  prefs: PlatformPrefs
  /** Opens http, https and mailto links only; rejects for anything else. */
  openExternal(url: string): Promise<void>
  /** Files opened from the OS (Finder, Open With, Open Recent). Returns an unsubscribe function. */
  onOpenFile?(cb: (path: string) => void): () => void
  /** Desktop only. Documents opened or saved through the platform are added automatically. */
  recentFiles?: PlatformRecentFiles
  appVersion?(): Promise<string>
  /** Only on desktop builds that were given an update feed; the app menu's Check for Updates uses it too. */
  updater?: PlatformUpdater
  /** Where the open tabs are kept for the next launch. */
  session?: PlatformSession
  /** Desktop: shows a drawing the user opened or saved in Finder or the file manager. */
  revealPath?(path: string): Promise<void>
}

export { createBrowserPlatform } from "./browserPlatform"
export {
  DEFAULT_RECOVERY_SLOT,
  isRecoverySlot,
  newRecoverySlot,
  readRestoredSession,
  recoveryFiles,
  sanitizeViewport,
} from "./session"
export {
  clipboardItemData,
  createFileWatcher,
  createLocalPrefs,
  createMirroredPrefs,
  createOpenFileHub,
  DOCUMENT_EXTENSION,
  fileChangedError,
  type FileWatcher,
  filtersFor,
  isExternalUrl,
  isFileChanged,
  isSceneFile,
  isTextEntry,
  mimeFor,
  once,
  type OpenFileHub,
  pngBlob,
  type PrefsSnapshot,
  SCENE_EXTENSIONS,
  toExternalUrl,
  toStorageError,
  type Unsubscribe,
  withExtension,
} from "./shared"

import {
  EditorCore,
  LIBRARY_MIME,
  type LibraryItem,
  type Point,
  parseLibrary,
  screenToScene,
  serializeClipboard,
  serializeNib,
  usedFiles,
} from "@nib/core"
import type { MenuCommand, Platform } from "@nib/platform"
import {
  type DragEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { type CanvasContextTarget, CanvasHost } from "./canvas/CanvasHost"
import { EmbedOverlay } from "./canvas/EmbedOverlay"
import { FrameNameOverlay } from "./canvas/FrameNameOverlay"
import { TextEditorOverlay } from "./canvas/TextEditorOverlay"
import { elementPicker } from "./canvas/elementPicker"
import { requestEmbedAddress } from "./canvas/embedState"
import { ImageCache } from "./canvas/imageCache"
import { canvasFontsReady, installTextMeasurer } from "./canvas/measure"
import { buildCommands } from "./commands"
import {
  type CopyOptions,
  type DroppedScene,
  clipboardElements,
  copySelection,
  copyStyle,
  cutSelection,
  ingestFiles,
  insertElements,
  pasteContent,
  pasteStyle,
} from "./document/clipboard"
import type { DocumentController } from "./document/documentController"
import { LibraryStore, libraryItemsFromDrop } from "./document/libraryStore"
import { TabsController, type TabsState } from "./document/tabs"
import { exportToPngBlob, exportToSvgString } from "./export/exportImage"
import { elementCountOf, shallowEqual, useCoreSelector } from "./hooks/useEditor"
import { isModalOpen, layerController } from "./hooks/useLayer"
import { isMacPlatform, isTypingTarget, useShortcuts } from "./hooks/useShortcuts"
import "./theme/styles.css"
import { CommandPalette } from "./ui/CommandPalette"
import { ContextMenu, type ContextMenuKind, buildContextItems, contextMenuKind } from "./ui/ContextMenu"
import { ExportDialog } from "./ui/ExportDialog"
import { HelpDialog } from "./ui/HelpDialog"
import { LibraryPanel } from "./ui/LibraryPanel"
import { LinkPopup } from "./ui/LinkPopup"
import { MainMenu, type MenuActions } from "./ui/MainMenu"
import { MermaidDialog } from "./ui/MermaidDialog"
import { PreferencesDialog } from "./ui/PreferencesDialog"
import { SearchPanel } from "./ui/SearchPanel"
import { StatsPanel } from "./ui/StatsPanel"
import { addSelectionToLibrary } from "./ui/panels/libraryModel"
import { applyMotionPreference, pencilHintsEnabled, reduceMotionForced } from "./ui/panels/preferences"
import {
  LayerProvider,
  type MenuItem,
  MenuPopover,
  type ToastKind,
  ToastProvider,
  useToast,
} from "./ui/primitives"
import { BottomStack, StackBar } from "./ui/shell/BottomStack"
import { CornerHelp } from "./ui/shell/CornerHelp"
import { LedgeEnd, ZOOM_STEP } from "./ui/shell/LedgeEnd"
import { ModePill } from "./ui/shell/ModePill"
import { PresentationBar } from "./ui/shell/PresentationBar"
import { SelectionAnnouncer } from "./ui/shell/SelectionAnnouncer"
import { ShellDialogsProvider, useShellDialogs } from "./ui/shell/ShellDialogs"
import { TabBar } from "./ui/shell/TabBar"
import { ThemeDeck } from "./ui/shell/ThemeDeck"
import { TopActions } from "./ui/shell/TopActions"
import { dropChoiceRequest } from "./ui/shell/choiceQueue"
import { type Reveal, chromeMode, chromeParts, contextMenuLabel, zenReveal } from "./ui/shell/chrome"
import { whenDecoded } from "./ui/shell/crop"
import { displayName } from "./ui/shell/docName"
import { type PickTarget, applyPickedColor, sampleColor } from "./ui/shell/eyedropper"
import {
  EMPTY_HINT,
  type Hint,
  HintCounter,
  PENCIL_SNAP_HINT_ID,
  contextualHint,
  correctionKind,
  correctionMessage,
  showEmptyHint,
} from "./ui/shell/hints"
import { withInAppDialogs } from "./ui/shell/inAppDialogs"
import {
  CUT_REFUSED,
  TOOL_ERROR,
  exportedMessage,
  importIntoLibrary,
  refusedLinkMessage,
  throttle,
} from "./ui/shell/notices"
import { selectionWithFrames } from "./ui/shell/selectionExport"
import { type ShellCommandSet, buildShortcutHandlers } from "./ui/shell/shortcutHandlers"
import { NARROW_QUERY, useMediaQuery } from "./ui/shell/useMediaQuery"
import { useThemeController } from "./ui/shell/useThemeController"
import { SLIDE_INSETS, pastePoint, selectionScreenRect, zoomToFitChrome } from "./ui/shell/viewport"
import { StyleBar, openStyleGroup, setBoardColorPicker, useStyleBarShown } from "./ui/style"
import { MarkerTray, armFreehand, armPen, armPencil, penHoldsPencil } from "./ui/tray"

interface Props {
  platform: Platform
}

type DialogKind = "none" | "export" | "help" | "palette" | "mermaid" | "preferences"
type Sheet = "none" | "library" | "search"

const SAVED_FLASH_MS = 2000
const TOOL_ERROR_GAP_MS = 4000

const READ_ONLY_EDITS = new Set<MenuCommand>([
  "edit.copy",
  "edit.selectAll",
  "help.shortcuts",
  "app.preferences",
])

/** Menu commands that change the drawing; file and view commands never do. */
const menuCommandEdits = (cmd: MenuCommand): boolean =>
  !cmd.startsWith("file.") && !cmd.startsWith("view.") && !READ_ONLY_EDITS.has(cmd)

const isAbort = (e: unknown): boolean => e instanceof Error && e.name === "AbortError"

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const COPY_REFUSED = "The system wouldn't allow copying an image."
const LIBRARY_CHANNEL = "nib-library"

/** The Nib editor: the board, the marker tray and the chrome around it. */
export function NibApp({ platform }: Props) {
  return (
    <div className="nib" data-testid="app" data-platform={platform.name}>
      <LayerProvider>
        <ToastProvider>
          <ShellDialogsProvider>
            <Shell platform={platform} />
          </ShellDialogsProvider>
        </ToastProvider>
      </LayerProvider>
    </div>
  )
}

/** Owns the open tabs; the workspace below shows the one in front and is rebuilt when another comes forward. */
function Shell({ platform: hostPlatform }: Props) {
  const toast = useToast()
  const dialogs = useShellDialogs()
  const platform = useMemo(() => withInAppDialogs(hostPlatform, dialogs), [hostPlatform, dialogs])
  const mac = useMemo(isMacPlatform, [])
  const tabs = useMemo(() => {
    installTextMeasurer()
    return new TabsController(platform, {
      createCore: () => {
        const c = new EditorCore()
        c.macKeys = mac
        c.slideInsets = SLIDE_INSETS
        return c
      },
    })
  }, [platform, mac])
  // decoded images are shared, so switching back to a tab doesn't decode its images again
  const images = useMemo(() => new ImageCache(), [])

  useEffect(() => tabs.attach(canvasFontsReady), [tabs])
  useEffect(
    () => tabs.onNotice((m, kind) => toast.notify(m, { kind: kind === "error" ? "error" : "info" })),
    [tabs, toast],
  )

  const tabState = useSyncExternalStore(tabs.subscribe, tabs.getState)
  const active = tabs.tab(tabState.activeId) ?? tabs.active
  return (
    <Workspace
      key={active.id}
      platform={platform}
      tabs={tabs}
      tabState={tabState}
      core={active.core}
      doc={active.doc}
      images={images}
      mac={mac}
    />
  )
}

interface WorkspaceProps {
  platform: Platform
  tabs: TabsController
  tabState: TabsState
  core: EditorCore
  doc: DocumentController
  images: ImageCache
  mac: boolean
}

function Workspace({ platform, tabs, tabState, core, doc, images, mac }: WorkspaceProps) {
  const toast = useToast()
  const dialogs = useShellDialogs()
  const library = useMemo(() => new LibraryStore(platform), [platform])
  const hints = useMemo(() => new HintCounter(platform.prefs), [platform])
  const theme = useThemeController(platform.prefs, core)
  const narrow = useMediaQuery(NARROW_QUERY)

  const ui = useCoreSelector(
    core,
    (c) => ({
      tool: c.appState.activeTool,
      viewMode: c.appState.viewMode,
      zen: c.appState.zenMode,
      presenting: c.presentation !== null,
      cropping: c.appState.croppingElementId !== null,
      editingText: c.appState.editingTextId !== null,
      editingLinear: c.appState.editingLinearElementId !== null,
      selection: Object.keys(c.appState.selectedElementIds).join(","),
      elementCount: elementCountOf(c),
      canUndo: c.history.canUndo(),
    }),
    shallowEqual,
  )

  const [dialog, setDialog] = useState<DialogKind>("none")
  const [mermaidSource, setMermaidSource] = useState<string | undefined>(undefined)
  const [sheet, setSheet] = useState<Sheet>("none")
  const [menuOpen, setMenuOpen] = useState(false)
  const [deckOpen, setDeckOpen] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [linkFor, setLinkFor] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    kind: ContextMenuKind
    items: ReturnType<typeof buildContextItems>
  } | null>(null)
  const [picking, setPicking] = useState<PickTarget | null>(null)
  const [reveal, setReveal] = useState<Reveal>("none")
  const [justSaved, setJustSaved] = useState(false)
  const [recentFiles, setRecentFiles] = useState<string[] | null>(platform.recentFiles ? [] : null)
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([])
  const [searchMatches, setSearchMatches] = useState<readonly string[]>([])
  const [activeMatch, setActiveMatch] = useState<string | null>(null)
  const [renamingFrame, setRenamingFrame] = useState<string | null>(null)
  const [hint, setHint] = useState<Hint | null>(null)
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null)

  const menuButtonRef = useRef<HTMLButtonElement | null>(null)
  const searchButtonRef = useRef<HTMLButtonElement | null>(null)
  const libraryButtonRef = useRef<HTMLButtonElement | null>(null)
  const themeButtonRef = useRef<HTMLButtonElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const pendingImageAt = useRef<Point | null>(null)
  const imagePickerOpen = useRef(false)
  // in window pixels, not scene units: the board may scroll or zoom under a resting pointer
  const pointerScreen = useRef<Point | null>(null)
  const cropWait = useRef<(() => void) | null>(null)
  const savedTimer = useRef(0)
  const libraryRef = useRef(libraryItems)
  libraryRef.current = libraryItems

  const notify = useCallback(
    (message: string, kind: ToastKind = "info") => {
      toast.notify(message, { kind })
    },
    [toast],
  )

  const cut = useCallback(
    (opts?: CopyOptions) => {
      const taken = clipboardElements(core)
      void cutSelection(core, platform, opts).then((deleted) => {
        const stillThere = taken.some((el) => core.scene.get(el.id)?.isDeleted === false)
        if (!deleted && stillThere && !core.appState.viewMode) notify(CUT_REFUSED, "error")
      })
    },
    [core, platform, notify],
  )

  const reportOpen = useCallback(
    (error: string | null) => {
      if (error) notify(error, "error")
    },
    [notify],
  )

  const flashSaved = useCallback(() => {
    window.clearTimeout(savedTimer.current)
    setJustSaved(true)
    savedTimer.current = window.setTimeout(() => setJustSaved(false), SAVED_FLASH_MS)
  }, [])

  useEffect(() => () => window.clearTimeout(savedTimer.current), [])

  const afterWrite = useCallback(
    (ok: boolean) => {
      if (ok) flashSaved()
      else if (doc.lastError) notify(doc.lastError, "error")
    },
    [doc, flashSaved, notify],
  )

  useEffect(() => {
    let live = true
    void library.load().then((items) => {
      if (!live) return
      setLibraryItems(items)
      if (library.lastError) notify(library.lastError, "error")
    })
    return () => {
      live = false
    }
  }, [library, notify])

  const libraryEdits = useRef(0)
  const libraryChannel = useRef<BroadcastChannel | null>(null)

  // tabs and windows share one stored library; a save elsewhere reloads this one's list
  useEffect(() => {
    if (typeof BroadcastChannel !== "function") return
    const channel = new BroadcastChannel(LIBRARY_CHANNEL)
    libraryChannel.current = channel
    channel.onmessage = () => {
      const edits = libraryEdits.current
      void library.load().then((items) => {
        // an edit made here while the load ran is newer than what it read; a failed read keeps the list
        if (libraryChannel.current !== channel || edits !== libraryEdits.current || library.lastError) return
        setLibraryItems(items)
      })
    }
    return () => {
      channel.close()
      if (libraryChannel.current === channel) libraryChannel.current = null
    }
  }, [library])

  const updateLibrary = useCallback(
    (items: LibraryItem[]) => {
      libraryEdits.current++
      setLibraryItems(items)
      void library.save(items).then((ok) => {
        if (ok) libraryChannel.current?.postMessage("saved")
        else if (library.lastError) notify(library.lastError, "error")
      })
    },
    [library, notify],
  )

  useEffect(() => {
    applyMotionPreference(document.documentElement, reduceMotionForced(platform.prefs))
  }, [platform])

  // a console handle for development only; the literal lets the bundler drop it from builds
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { nib?: unknown }
    w.nib = core
    return () => {
      if (w.nib === core) w.nib = undefined
    }
  }, [core])

  const saveText = useCallback(
    async (text: string, filename: string) => {
      try {
        await platform.fs.saveDocument(text, null, filename)
      } catch (e) {
        if (!isAbort(e)) notify(`Couldn't save the file: ${errorText(e)}`, "error")
      }
    },
    [platform, notify],
  )

  const copyText = useCallback(
    (text: string) => {
      platform.clipboard.writeText(text).then(
        () => notify("Copied to the clipboard."),
        () => notify("The system wouldn't allow writing to the clipboard.", "error"),
      )
    },
    [platform, notify],
  )

  /**
   * Writes a PNG without awaiting first, so WebKit keeps the copying gesture. Rejects when the
   * PNG could not be made (its own error) or the system refused it (COPY_REFUSED).
   */
  const writePng = useCallback(
    (png: Promise<Uint8Array>): Promise<void> => {
      const clip = platform.clipboard
      const done = clip.writeImage
        ? clip.writeImage(png)
        : navigator.clipboard.write([
            new ClipboardItem({
              "image/png": png.then((bytes) => new Blob([bytes as BlobPart], { type: "image/png" })),
            }),
          ])
      return Promise.resolve(done).then(
        () => notify("Copied as PNG."),
        async () => {
          await png
          throw new Error(COPY_REFUSED)
        },
      )
    },
    [platform, notify],
  )

  // exports use white or the Graphite board, never the theme's own board (brief, "The 10 themes")
  const copyAsPng = useCallback(() => {
    const selected = selectionWithFrames(core)
    const elements = selected.length > 0 ? selected : core.scene.getNonDeleted()
    if (elements.length === 0) return
    const png = exportToPngBlob({
      elements,
      appState: core.appState,
      files: core.scene.files,
      scale: 2,
      exportBackground: true,
      theme: core.appState.theme,
    })
      .then((b) => b.arrayBuffer())
      .then((buf) => new Uint8Array(buf))
    writePng(png).catch((e) =>
      notify(
        e instanceof Error && e.message === COPY_REFUSED
          ? `${COPY_REFUSED} Use Export instead.`
          : `Couldn't copy the image: ${errorText(e)}`,
        "error",
      ),
    )
  }, [core, notify, writePng])

  const copyAsSvg = useCallback(() => {
    const elements = selectionWithFrames(core)
    if (elements.length === 0) return
    copyText(
      exportToSvgString({
        elements,
        appState: core.appState,
        files: core.scene.files,
        scale: 1,
        exportBackground: true,
        theme: core.appState.theme,
      }),
    )
  }, [core, copyText])

  const tidyUp = useCallback(() => {
    const changed = core.tidyUp()
    notify(
      changed === 0
        ? "Nothing to straighten here."
        : `Tidied ${changed} ${changed === 1 ? "connector" : "connectors"}.`,
    )
  }, [core, notify])

  // the sheet's own add path, so frame children and labels come along and duplicates are skipped
  const addToLibrary = useCallback(() => {
    if (core.selectedElements().length === 0) return
    const next = addSelectionToLibrary(core, libraryRef.current)
    setSheet("library")
    if (!next) {
      notify("That's already in your library.")
      return
    }
    updateLibrary(next)
    notify("Added to your library.")
  }, [core, notify, updateLibrary])

  const openMermaid = useCallback((source?: string) => {
    setMermaidSource(source)
    setDialog("mermaid")
  }, [])

  const offerScenes = useCallback(
    async (scenes: readonly DroppedScene[], at: Point) => {
      for (const scene of scenes) {
        for (const w of scene.warnings) notify(w)
        const answer = await dialogs.choose(
          dropChoiceRequest({ name: displayName(scene.name), canvasEmpty: elementCountOf(core) === 0 }),
        )
        if (answer === "insert") core.insertScene(scene.elements, scene.files, at)
        // each dropped drawing opened gets a tab of its own
        else if (answer === "open") reportOpen(await tabs.openContents(scene.text, null, scene.name))
      }
    },
    [core, dialogs, tabs, notify, reportOpen],
  )

  const ingest = useCallback(
    async (files: readonly File[], at: Point) => {
      const r = await ingestFiles(core, files, at)
      for (const e of r.errors) notify(e, "error")
      if (r.scenes.length > 0) await offerScenes(r.scenes, at)
    },
    [core, notify, offerScenes],
  )

  const pasteTarget = useCallback((): Point => pastePoint(core, pointerScreen.current), [core])

  const pasteAtPointer = useCallback(
    async (data?: { text?: string; html?: string; files?: readonly File[] }, at: Point = pasteTarget()) => {
      const r = await pasteContent(core, platform, at, data, {
        onMermaid: (src) => {
          openMermaid(src)
          return true
        },
      })
      for (const e of r.errors) notify(e, "error")
      if (r.warnings.length > 0)
        notify(
          `Skipped ${r.warnings.length} ${r.warnings.length === 1 ? "line" : "lines"} the diagram couldn't use.`,
        )
    },
    [core, platform, notify, openMermaid, pasteTarget],
  )

  const openImagePicker = useCallback((at: Point) => {
    if (imagePickerOpen.current) return
    imagePickerOpen.current = true
    pendingImageAt.current = at
    imageInputRef.current?.click()
  }, [])

  const closeImagePicker = useCallback(
    (picked: boolean) => {
      if (!imagePickerOpen.current) return
      imagePickerOpen.current = false
      if (!picked) core.cancelImageInsert()
    },
    [core],
  )

  // the picker has no reliable cancel event everywhere: focus returning without a change means cancel
  useEffect(() => {
    const input = imageInputRef.current
    if (!input) return
    const onCancel = () => closeImagePicker(false)
    const onFocus = () =>
      window.setTimeout(() => {
        if (imagePickerOpen.current && !input.files?.length) closeImagePicker(false)
      }, 400)
    input.addEventListener("cancel", onCancel)
    window.addEventListener("focus", onFocus)
    return () => {
      input.removeEventListener("cancel", onCancel)
      window.removeEventListener("focus", onFocus)
    }
  }, [closeImagePicker])

  const resetCanvas = useCallback(async () => {
    const ok = await dialogs.confirm(
      `Every shape on this board is removed. ${mac ? "⌘Z" : "Ctrl+Z"} brings them back.`,
      { title: "Reset the canvas?", okLabel: "Reset canvas", destructive: true },
    )
    if (ok) core.resetCanvas()
  }, [core, dialogs, mac])

  const openExternal = useCallback(
    (url: string) => {
      platform.openExternal(url).catch(() => notify("Couldn't open that link.", "error"))
    },
    [platform, notify],
  )

  // the eyedropper (I) borrows the canvas element picker: the next click on a shape is the pick
  const startPicking = useCallback(
    (target: PickTarget) => {
      if (core.appState.viewMode) return
      setPicking(target)
      elementPicker.start({
        accepts: (el) => sampleColor(el, target) !== null,
        onPick: (el) => {
          setPicking(null)
          if (applyPickedColor(core, el, target)) notify("Colour picked.")
        },
      })
    },
    [core, notify],
  )

  const stopPicking = useCallback(() => {
    elementPicker.cancel()
    setPicking(null)
  }, [])

  useEffect(
    () =>
      elementPicker.subscribe(() => {
        if (!elementPicker.active) setPicking(null)
      }),
    [],
  )

  // the colour panels' eyedropper button takes the same path as I
  useEffect(() => setBoardColorPicker(startPicking), [startPicking])

  // an image that has not decoded yet is cropped once it has; one that cannot decode says so
  const requestCrop = useCallback(
    (id: string, fileId: string) => {
      cropWait.current?.()
      cropWait.current = whenDecoded(images, fileId, core.scene.files, {
        ready: (bitmap) => {
          cropWait.current = null
          const el = core.scene.get(id)
          if (el && !el.isDeleted && !core.appState.viewMode)
            core.startCropping(id, bitmap.width, bitmap.height)
        },
        failed: () => {
          cropWait.current = null
          notify("This image couldn't be read.", "error")
        },
      })
    },
    [core, images, notify],
  )

  useEffect(() => () => cropWait.current?.(), [])

  const latest = useRef({ openImagePicker, openExternal, requestCrop, notify })
  latest.current = { openImagePicker, openExternal, requestCrop, notify }

  useEffect(() => {
    const errorToastDue = throttle(TOOL_ERROR_GAP_MS)
    core.host = {
      ...core.host,
      onRequestImage: (at) => latest.current.openImagePicker(at),
      onRequestCrop: (id) => {
        const el = core.scene.get(id)
        if (el?.type === "image" && el.fileId) latest.current.requestCrop(id, el.fileId)
      },
      // inline, on the frame's drawn name, instead of window.prompt
      onRenameFrame: (frame) => setRenamingFrame(frame.id),
      onEditEmbed: (el) => requestEmbedAddress(el.id),
      onOpenLink: (url) => latest.current.openExternal(url),
      onError: (error) => {
        console.error(error)
        if (errorToastDue()) latest.current.notify(TOOL_ERROR, "error")
      },
    }
  }, [core])

  // the link editor follows one element and closes when the selection moves on
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-checked whenever the selection key changes
  useEffect(() => {
    if (!linkFor) return
    const sel = core.selectedElements()
    if (sel.length !== 1 || sel[0]!.id !== linkFor) setLinkFor(null)
  }, [core, linkFor, ui.selection])

  const requestLink = useCallback(() => {
    if (core.appState.viewMode) return
    const sel = core.selectedElements()
    if (sel.length === 1) setLinkFor(sel[0]!.id)
    else if (sel.length === 0) notify("Select a shape to link it.")
    else notify("Links go on one shape at a time.")
  }, [core, notify])

  const zoomBy = useCallback(
    (factor: number) => {
      const s = core.viewportSize ?? { width: 0, height: 0 }
      core.zoomTo(core.appState.viewport.zoom * factor, [s.width / 2, s.height / 2])
    },
    [core],
  )

  const present = useCallback(() => {
    if (!core.startPresentation()) notify("Draw a frame (F) around each slide first, then present.")
  }, [core, notify])

  const openRecent = useCallback(
    (path: string) => void tabs.openPath(path).then(reportOpen),
    [tabs, reportOpen],
  )

  const tabMenuItems = (id: string): MenuItem[] => {
    const index = tabState.tabs.findIndex((t) => t.id === id)
    const path = tabState.tabs[index]?.path ?? null
    // a browser file handle ("fsa:…") is no path anyone could use
    const realPath = path && !path.startsWith("fsa:") ? path : null
    const reveal = platform.revealPath
    return [
      { id: "close", label: "Close", shortcut: "Mod+W", onSelect: () => void tabs.close(id) },
      {
        id: "closeOthers",
        label: "Close Others",
        disabled: tabState.tabs.length < 2,
        onSelect: () => void tabs.closeOthers(id),
      },
      {
        id: "closeRight",
        label: "Close to the Right",
        disabled: index === tabState.tabs.length - 1,
        onSelect: () => void tabs.closeToTheRight(id),
      },
      { id: "closeSaved", label: "Close Saved", onSelect: () => void tabs.closeSaved() },
      ...(reveal && realPath
        ? [
            {
              id: "reveal",
              label: mac ? "Reveal in Finder" : "Show in File Manager",
              onSelect: () =>
                void reveal(realPath).catch((e) =>
                  notify(`Couldn't show the file: ${errorText(e)}`, "error"),
                ),
            },
          ]
        : []),
      ...(realPath
        ? [
            {
              id: "copyPath",
              label: "Copy Path",
              onSelect: () =>
                void platform.clipboard
                  .writeText(realPath)
                  .catch(() => notify("Couldn't copy the path.", "error")),
            },
          ]
        : []),
    ]
  }

  const menuActions: MenuActions = useMemo(
    () => ({
      newDocument: () => void tabs.newTab(),
      open: () => void tabs.open().then(reportOpen),
      closeTab: () => void tabs.close(tabs.active.id),
      reopenClosedTab: () => void tabs.reopenClosed(),
      nextTab: () => tabs.cycle(1),
      previousTab: () => tabs.cycle(-1),
      save: () => void doc.save().then(afterWrite),
      saveAs: () => void doc.saveAs().then(afterWrite),
      exportImage: () => setDialog("export"),
      importExcalidraw: () => void tabs.importExcalidraw().then(reportOpen),
      // an export is not a save, so it gets its own word instead of the label's "Saved"
      exportExcalidraw: () =>
        void doc.exportExcalidraw().then((written) => {
          if (written) notify(exportedMessage(written, doc.baseName))
          else if (doc.lastError) notify(doc.lastError, "error")
        }),
      toggleLibrary: () => setSheet((s) => (s === "library" ? "none" : "library")),
      toggleStats: () => setShowStats((v) => !v),
      showShortcuts: () => setDialog("help"),
      openMermaid: () => openMermaid(),
      tidyUp,
      resetCanvas: () => void resetCanvas(),
      insertImage: () => core.setTool("image"),
      openPalette: () => setDialog("palette"),
      openPreferences: () => setDialog("preferences"),
      present,
      zoomToFit: () => zoomToFitChrome(core),
      openRecent,
      clearRecent: () => {
        void platform.recentFiles?.clear().then(() => setRecentFiles([]))
      },
    }),
    [
      core,
      doc,
      tabs,
      platform,
      notify,
      afterWrite,
      reportOpen,
      openMermaid,
      tidyUp,
      resetCanvas,
      present,
      openRecent,
    ],
  )

  const shellCommands: ShellCommandSet = {
    newDocument: menuActions.newDocument,
    open: menuActions.open,
    save: menuActions.save,
    saveAs: menuActions.saveAs,
    exportImage: menuActions.exportImage,
    togglePalette: () => setDialog((d) => (d === "palette" ? "none" : "palette")),
    toggleSearch: () => setSheet((s) => (s === "search" ? "none" : "search")),
    showHelp: () => setDialog("help"),
    openPreferences: () => setDialog("preferences"),
    copyStyle: () => {
      if (copyStyle(core)) notify("Copied styles.")
    },
    pasteStyle: () => void pasteStyle(core),
    copyPng: copyAsPng,
    addLink: requestLink,
    toggleLock: () => core.toggleLock(),
    openStrokePicker: () => void openStyleGroup("strokeColor"),
    openBackgroundPicker: () => void openStyleGroup("fill"),
    startEyedropper: () => startPicking("stroke"),
    flipH: () => core.flip("horizontal"),
    flipV: () => core.flip("vertical"),
    tidy: tidyUp,
    zoomIn: () => zoomBy(ZOOM_STEP),
    zoomOut: () => zoomBy(1 / ZOOM_STEP),
    zoomReset: () => {
      const s = core.viewportSize ?? { width: 0, height: 0 }
      core.zoomTo(1, [s.width / 2, s.height / 2])
    },
    zoomFit: () => zoomToFitChrome(core),
    zoomSelection: () => zoomToFitChrome(core, true),
    toggleZen: () => core.toggleZen(),
    toggleViewMode: () => core.toggleViewMode(),
    toggleThemeMode: theme.toggleMode,
    toggleStats: () => setShowStats((v) => !v),
    armPen: () => armPen(core, platform.prefs),
    armPencil: () => armPencil(core),
    closeTab: () => menuActions.closeTab?.(),
    reopenClosedTab: () => menuActions.reopenClosedTab?.(),
    nextTab: () => tabs.cycle(1),
    previousTab: () => tabs.cycle(-1),
    goToTab: (position) => tabs.goTo(position),
  }

  const menuCommands: Record<MenuCommand, () => void> = {
    "file.new": menuActions.newDocument,
    "file.open": menuActions.open,
    "file.save": menuActions.save,
    "file.saveAs": menuActions.saveAs,
    "file.exportImage": menuActions.exportImage,
    "file.importExcalidraw": menuActions.importExcalidraw,
    "file.exportExcalidraw": menuActions.exportExcalidraw,
    "file.clearRecent": () => menuActions.clearRecent?.(),
    "file.closeTab": shellCommands.closeTab,
    "file.reopenClosedTab": shellCommands.reopenClosedTab,
    "view.nextTab": shellCommands.nextTab,
    "view.previousTab": shellCommands.previousTab,
    "edit.undo": () => core.undo(),
    "edit.redo": () => core.redo(),
    "edit.cut": () => cut(),
    "edit.copy": () => void copySelection(core, platform),
    "edit.paste": () => void pasteAtPointer(),
    "edit.selectAll": () => core.selectAll(),
    "edit.delete": () => core.deleteSelected(),
    "edit.duplicate": () => core.duplicateSelected(),
    "edit.group": () => core.group(),
    "edit.ungroup": () => core.ungroup(),
    "edit.copyStyle": shellCommands.copyStyle,
    "edit.pasteStyle": shellCommands.pasteStyle,
    "view.zoomIn": shellCommands.zoomIn,
    "view.zoomOut": shellCommands.zoomOut,
    "view.zoomReset": shellCommands.zoomReset,
    "view.zoomFit": shellCommands.zoomFit,
    "view.zoomSelection": shellCommands.zoomSelection,
    "view.toggleGrid": () => core.toggleGrid(),
    "view.toggleSnap": () => core.toggleSnap(),
    "view.toggleTheme": theme.toggleMode,
    "view.toggleZen": () => core.toggleZen(),
    "view.toggleViewMode": () => core.toggleViewMode(),
    "view.toggleStats": shellCommands.toggleStats,
    "arrange.bringForward": () => core.moveZ("forward"),
    "arrange.bringToFront": () => core.moveZ("front"),
    "arrange.sendBackward": () => core.moveZ("backward"),
    "arrange.sendToBack": () => core.moveZ("back"),
    "arrange.alignLeft": () => core.align("left"),
    "arrange.alignRight": () => core.align("right"),
    "arrange.alignTop": () => core.align("top"),
    "arrange.alignBottom": () => core.align("bottom"),
    "arrange.alignCenterX": () => core.align("centerX"),
    "arrange.alignCenterY": () => core.align("centerY"),
    "arrange.flipH": shellCommands.flipH,
    "arrange.flipV": shellCommands.flipV,
    "arrange.lock": shellCommands.toggleLock,
    "help.shortcuts": shellCommands.showHelp,
    "app.preferences": shellCommands.openPreferences,
  }

  // view mode is read-only, so native-menu edits are dropped here as well
  const runCommand = (cmd: MenuCommand): void => {
    if (core.appState.viewMode && menuCommandEdits(cmd)) return
    menuCommands[cmd]?.()
  }

  const cmdRef = useRef({ shellCommands, runCommand })
  cmdRef.current = { shellCommands, runCommand }

  // installed once: the desktop host only swaps the handler, never rebuilds the native menu
  useEffect(() => {
    void platform.menu.install((cmd) => cmdRef.current.runCommand(cmd))
  }, [platform])

  const handlers = useMemo(
    () =>
      buildShortcutHandlers(() => cmdRef.current.shellCommands, {
        viewMode: () => core.appState.viewMode,
        presenting: () => core.presentation !== null,
        keyEdit: (run) => core.runKeyCommand(run),
      }),
    [core],
  )

  useShortcuts(handlers, {
    isMac: mac,
    fallback: (e) => core.keyDown(e),
    onKeyUp: (e) => core.keyUp(e),
  })

  // the browser's own copy, cut and paste events carry the clipboard, on desktop too
  useEffect(() => {
    const ownsEvent = (e: ClipboardEvent): boolean => {
      if (e.defaultPrevented || isTypingTarget(e.target) || isModalOpen()) return false
      const sel = window.getSelection()
      return !sel || sel.isCollapsed || sel.rangeCount === 0
    }
    // ⌘X and ⌘V from inside a menu or popover must not change the drawing behind it
    const inLayer = (e: ClipboardEvent): boolean =>
      e.target instanceof Node && layerController.layerIndexOf(e.target) >= 0
    const writeScene = (e: ClipboardEvent): boolean => {
      const selection = clipboardElements(core)
      if (selection.length === 0) return false
      e.clipboardData?.setData(
        "text/plain",
        serializeClipboard(selection, usedFiles(selection, core.scene.files)),
      )
      e.preventDefault()
      return true
    }
    const onCopy = (e: ClipboardEvent) => {
      if (!ownsEvent(e) || !writeScene(e)) return
      void copySelection(core, platform)
    }
    const onCut = (e: ClipboardEvent) => {
      if (!ownsEvent(e) || inLayer(e) || core.appState.viewMode || !writeScene(e)) return
      cut({ eventWritten: true })
    }
    const onPaste = (e: ClipboardEvent) => {
      if (!ownsEvent(e) || inLayer(e)) return
      e.preventDefault()
      if (core.appState.viewMode) return
      const data = e.clipboardData
      const files = Array.from(data?.files ?? [])
      const images = files.filter((f) => f.type.startsWith("image/"))
      const others = files.filter((f) => !f.type.startsWith("image/"))
      if (others.length > 0) void ingest(others, pasteTarget())
      if (others.length > 0 && images.length === 0) return
      void pasteAtPointer({
        text: data?.getData("text/plain") ?? "",
        html: data?.getData("text/html") ?? "",
        files: images,
      })
    }
    document.addEventListener("copy", onCopy)
    document.addEventListener("cut", onCut)
    document.addEventListener("paste", onPaste)
    return () => {
      document.removeEventListener("copy", onCopy)
      document.removeEventListener("cut", onCut)
      document.removeEventListener("paste", onPaste)
    }
  }, [core, platform, cut, ingest, pasteAtPointer, pasteTarget])

  const sceneAt = (clientX: number, clientY: number, el: HTMLElement): Point => {
    const rect = el.getBoundingClientRect()
    return screenToScene([clientX - rect.left, clientY - rect.top], core.appState.viewport)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (isModalOpen() || core.appState.viewMode) return
    const at = sceneAt(e.clientX, e.clientY, e.currentTarget)
    const lib = e.dataTransfer.getData(LIBRARY_MIME)
    if (lib) {
      for (const item of libraryItemsFromDrop(lib)) insertElements(core, item.elements, item.files ?? {}, at)
      return
    }
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) void ingest(files, at)
  }

  useEffect(() => {
    let last = core.lastCorrection?.at ?? 0
    return core.subscribe(() => {
      const c = core.lastCorrection
      if (!c || c.at === last) return
      last = c.at
      if (!pencilHintsEnabled(platform.prefs) || !hints.canShow(PENCIL_SNAP_HINT_ID)) return
      const kind = correctionKind(core.scene.get(c.elementId))
      if (!kind) return
      hints.use(PENCIL_SNAP_HINT_ID)
      notify(correctionMessage(kind, mac))
    })
  }, [core, platform, hints, notify, mac])

  const wanted = useMemo(
    () =>
      contextualHint({
        activeTool: ui.tool,
        selection: ui.selection ? core.selectedElements() : [],
        editingLinear: ui.editingLinear,
        editingText: ui.editingText,
        viewMode: ui.viewMode,
        mac,
      }),
    [core, ui.tool, ui.selection, ui.editingLinear, ui.editingText, ui.viewMode, mac],
  )

  // one showing per activation, so a re-run effect (StrictMode, a re-render) never spends a second one
  const shownHint = useRef<string | null>(null)
  useEffect(() => {
    if (!wanted) {
      shownHint.current = null
      setHint(null)
      return
    }
    if (shownHint.current === wanted.id) return
    shownHint.current = wanted.id
    setHint(hints.use(wanted.id) ? wanted : null)
  }, [wanted, hints])

  const emptyHint = showEmptyHint({
    elementCount: ui.elementCount,
    canUndo: ui.canUndo,
    viewMode: ui.viewMode,
    presenting: ui.presenting,
    editingText: ui.editingText,
  })

  const mode = chromeMode({ zenMode: ui.zen, viewMode: ui.viewMode, presenting: ui.presenting })
  const parts = chromeParts(mode)
  const styleShown = useStyleBarShown(core) && parts.styleBar
  // read only while a hint shows: this selector runs on every pointer frame
  const hintAvoid = useCoreSelector(core, (c) => (hint ? selectionScreenRect(c) : null), shallowEqual)

  useEffect(() => {
    if (mode !== "zen") setReveal("none")
    if (mode === "present") setContextMenu(null)
  }, [mode])

  const zoomFit = useCallback(() => zoomToFitChrome(core), [core])
  const showHelp = useCallback(() => setDialog("help"), [])
  const insertImage = useCallback(() => openImagePicker(core.viewportCenter()), [core, openImagePicker])
  const openMermaidDialog = useCallback(() => openMermaid(), [openMermaid])
  const refuseLink = useCallback((link: string) => notify(refusedLinkMessage(link), "error"), [notify])

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    // over the tray or a panel the pointer says nothing about where a paste should land
    const overBoard = e.target instanceof Element && e.target.closest(".sc-canvas") !== null
    const rect = e.currentTarget.getBoundingClientRect()
    pointerScreen.current = overBoard ? [e.clientX - rect.left, e.clientY - rect.top] : null
    if (mode === "zen") setReveal(e.buttons ? "none" : zenReveal(e.clientY, e.currentTarget.clientHeight))
  }

  const onContextMenu = (_e: React.MouseEvent, target: CanvasContextTarget) => {
    const opts = {
      target,
      hasSelection: core.selectedElements().length > 0,
      onCopy: () => void copySelection(core, platform),
      onCut: () => cut(),
      onPaste: () => void pasteAtPointer(undefined, target.scene),
      onCopyStyle: () => copyStyle(core),
      onPasteStyle: () => pasteStyle(core),
      onCopyAsPng: copyAsPng,
      onCopyAsSvg: copyAsSvg,
      onAddToLibrary: addToLibrary,
      onLink: requestLink,
      onTidy: tidyUp,
      onCopyText: copyText,
      onOpenLink: openExternal,
      onToggleStats: () => setShowStats((v) => !v),
    }
    setContextMenu({
      x: target.x,
      y: target.y,
      kind: contextMenuKind(core, opts),
      items: buildContextItems(core, opts),
    })
  }

  const recentRefresh = () => {
    if (!platform.recentFiles) return
    platform.recentFiles.list().then(setRecentFiles, () => setRecentFiles([]))
  }

  const commands = useMemo(
    () =>
      dialog === "palette"
        ? buildCommands(core, (cmd) => cmdRef.current.runCommand(cmd), menuActions, requestLink, {
            theme: {
              current: theme.def.id,
              matchSystem: theme.matchSystem,
              apply: theme.select,
              setMatchSystem: theme.setMatchSystem,
            },
            armPen: () => armPen(core, platform.prefs),
            armPencil: () => armPencil(core),
            copyAsPng,
            copy: () => void copySelection(core, platform),
            cut: () => cut(),
            paste: () => void pasteAtPointer(),
            eyedropper: () => startPicking("stroke"),
            toggleSearch: () => setSheet((s) => (s === "search" ? "none" : "search")),
          })
        : [],
    [dialog, core, platform, menuActions, requestLink, theme, copyAsPng, cut, pasteAtPointer, startPicking],
  )

  const linkEditing = linkFor !== null
  const caps = useMemo(() => [...theme.def.caps], [theme.def])

  const pngBytes = (blob: Promise<Blob>): Promise<Uint8Array> =>
    blob.then((b) => b.arrayBuffer()).then((buf) => new Uint8Array(buf))

  // the dialog awaits this, so a refused copy keeps it open with the reason inline (T3-11b)
  const copyPngFromDialog = (png: Promise<Blob>): Promise<void> =>
    writePng(pngBytes(png)).catch((e) => {
      throw e instanceof Error && e.message === COPY_REFUSED
        ? new Error(`${COPY_REFUSED} Save the PNG instead.`)
        : e
    })

  const importLibrary = async () => {
    try {
      const file = await platform.fs.openDocument([
        { name: "Excalidraw library", extensions: ["excalidrawlib", "json"] },
      ])
      if (!file) return
      const items = parseLibrary(file.contents)
      if (items.length === 0) {
        notify("That file has no library items.")
        return
      }
      const merged = importIntoLibrary(libraryRef.current, items)
      if (merged.added > 0) updateLibrary(merged.items)
      notify(merged.message)
    } catch (e) {
      if (!isAbort(e)) notify(`Couldn't import the library: ${errorText(e)}`, "error")
    }
  }

  const closeSearch = () => {
    setSheet("none")
    setSearchMatches([])
    setActiveMatch(null)
  }

  // a pen in hand follows a new pen default at once; a pencil picked as the Pencil stays one
  const followPencilDefault = (on: boolean) => {
    const tool = core.appState.activeTool
    if (on && tool === "freedraw") armFreehand(core, "pencil", true)
    else if (!on && penHoldsPencil(core)) armFreehand(core, "freedraw", true)
  }

  return (
    <div
      className="nib-board"
      data-chrome={mode}
      data-reveal={reveal}
      data-stylebar={styleShown || undefined}
      data-picking={picking ?? undefined}
      onDrop={onDrop}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = "copy"
      }}
      onPointerMove={onPointerMove}
    >
      <CanvasHost
        core={core}
        images={images}
        palette={theme.palette}
        searchMatches={searchMatches}
        activeSearchMatch={activeMatch}
        renamingFrameId={renamingFrame}
        onContextMenu={onContextMenu}
        onOpenLink={openExternal}
        onLinkRefused={refuseLink}
      >
        <TextEditorOverlay core={core} palette={theme.palette} />
        {renamingFrame ? (
          <FrameNameOverlay core={core} frameId={renamingFrame} onClose={() => setRenamingFrame(null)} />
        ) : null}
        <EmbedOverlay core={core} />
      </CanvasHost>

      {parts.top ? (
        <div className="shell-zone" data-zone="top">
          <TabBar
            tabs={tabState.tabs}
            activeId={tabState.activeId}
            justSaved={justSaved}
            menuOpen={menuOpen}
            menuButtonRef={menuButtonRef}
            readOnly={ui.viewMode}
            onToggleMenu={() => {
              if (!menuOpen) recentRefresh()
              setMenuOpen((v) => !v)
            }}
            onActivate={(id) => tabs.activate(id)}
            onClose={(id) => void tabs.close(id)}
            onNew={() => void tabs.newTab()}
            onMove={(id, index) => tabs.move(id, index)}
            onRename={(id, name) => void tabs.tab(id)?.doc.setName(name)}
            onTabMenu={(id, at) => setTabMenu({ id, ...at })}
          />
          {tabMenu ? (
            <MenuPopover
              open
              label="Tab actions"
              anchor={{ x: tabMenu.x, y: tabMenu.y }}
              items={tabMenuItems(tabMenu.id)}
              isMac={mac}
              onClose={() => setTabMenu(null)}
            />
          ) : null}
          <TopActions
            narrow={narrow}
            searchOpen={sheet === "search"}
            libraryOpen={sheet === "library"}
            themeOpen={deckOpen}
            searchButtonRef={searchButtonRef}
            libraryButtonRef={libraryButtonRef}
            themeButtonRef={themeButtonRef}
            onSearch={shellCommands.toggleSearch}
            onLibrary={menuActions.toggleLibrary}
            onTheme={() => setDeckOpen((v) => !v)}
            onExport={menuActions.exportImage}
          />
        </div>
      ) : null}

      {mode === "zen" || mode === "view" ? (
        <ModePill mode={mode} onExit={() => (mode === "zen" ? core.toggleZen() : core.toggleViewMode())} />
      ) : null}

      {parts.ledge ? (
        <div className="shell-zone" data-zone="bottom">
          <LedgeEnd core={core} onZoomFit={zoomFit} />
          <BottomStack status={hint?.text ?? (emptyHint ? EMPTY_HINT : null)} avoid={hintAvoid}>
            {ui.cropping ? (
              <StackBar text="Drag the handles to crop.">
                <button type="button" className="sc-button" onClick={() => core.resetCrop()}>
                  Reset
                </button>
                <button
                  type="button"
                  className="sc-button"
                  data-variant="primary"
                  onClick={() => core.stopCropping()}
                >
                  Done
                </button>
              </StackBar>
            ) : null}
            {picking ? (
              <StackBar text="Click a shape to take its colour." onDismiss={stopPicking}>
                <button type="button" className="sc-button" onClick={stopPicking}>
                  Cancel
                </button>
              </StackBar>
            ) : null}
          </BottomStack>
          {parts.styleBar ? (
            <StyleBar core={core} theme={theme.def} onRequestLink={requestLink} onTidy={tidyUp} />
          ) : null}
          {parts.tray ? (
            <MarkerTray
              core={core}
              caps={caps}
              prefs={platform.prefs}
              theme={theme.def}
              onInsertImage={insertImage}
              onOpenMermaid={openMermaidDialog}
            />
          ) : null}
          {/* after the style bar and the tray, so Tab reaches them before the far corner */}
          <CornerHelp core={core} onHelp={showHelp} onBackToContent={zoomFit} />
        </div>
      ) : null}

      {parts.presentation ? <PresentationBar core={core} /> : null}
      <SelectionAnnouncer core={core} />

      <MainMenu
        open={menuOpen}
        core={core}
        actions={menuActions}
        showStats={showStats}
        anchor={menuButtonRef}
        onClose={() => setMenuOpen(false)}
        recentFiles={recentFiles}
        saveLabel={platform.capabilities?.saveInPlace === false ? "Download" : "Save"}
        theme={{
          current: theme.def.id,
          matchSystem: theme.matchSystem,
          onSelect: theme.select,
          onMatchSystem: theme.setMatchSystem,
        }}
      />

      <ThemeDeck
        open={deckOpen}
        onClose={() => setDeckOpen(false)}
        anchor={themeButtonRef}
        current={theme.def.id}
        matchSystem={theme.matchSystem}
        onSelect={theme.select}
        onMatchSystem={theme.setMatchSystem}
      />

      {showStats && parts.panels ? <StatsPanel core={core} onClose={() => setShowStats(false)} /> : null}
      {sheet === "library" && parts.panels ? (
        <LibraryPanel
          core={core}
          items={libraryItems}
          palette={theme.palette}
          onChange={updateLibrary}
          onClose={() => setSheet("none")}
          onImport={() => void importLibrary()}
          onExport={(text) => void saveText(text, "library.excalidrawlib")}
          centreScene={() => core.viewportCenter()}
          notify={(message, opts) => toast.notify(message, opts)}
          onNotify={notify}
        />
      ) : null}
      {sheet === "search" && parts.panels ? (
        <SearchPanel
          core={core}
          onClose={closeSearch}
          onMatchesChange={setSearchMatches}
          onActiveMatchChange={setActiveMatch}
        />
      ) : null}

      {parts.top ? (
        <LinkPopup
          core={core}
          open={linkEditing}
          onClose={() => setLinkFor(null)}
          onEdit={requestLink}
          onOpen={openExternal}
        />
      ) : null}

      {contextMenu && parts.panels ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          label={contextMenuLabel(contextMenu.kind)}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {dialog === "export" ? (
        <ExportDialog
          core={core}
          baseName={doc.baseName}
          platform={platform}
          palette={theme.palette}
          onClose={() => setDialog("none")}
          onSaveBlob={(blob, name) =>
            blob
              .arrayBuffer()
              .then((buf) =>
                platform.fs.saveBinary(new Uint8Array(buf), name, [
                  { name: "Image", extensions: [name.split(".").pop() ?? "png"] },
                ]),
              )
          }
          onSaveText={(text, name) => platform.fs.saveDocument(text, null, name)}
          onCopyPng={(blob) => copyPngFromDialog(Promise.resolve(blob))}
          onCopyPngPromise={copyPngFromDialog}
          onCopyText={copyText}
          onError={(m) => notify(m, "error")}
        />
      ) : null}
      {dialog === "mermaid" ? (
        <MermaidDialog
          core={core}
          source={mermaidSource}
          palette={theme.palette}
          onClose={() => setDialog("none")}
          onInsert={(elements) => core.insertScene(elements, {}, core.viewportCenter())}
        />
      ) : null}
      {dialog === "preferences" ? (
        <PreferencesDialog
          core={core}
          prefs={platform.prefs}
          theme={theme.def}
          matchSystem={theme.matchSystem}
          onThemeChange={theme.select}
          onMatchSystemChange={theme.setMatchSystem}
          onPencilDefaultChange={followPencilDefault}
          sessionRestore={platform.name === "tauri"}
          onClose={() => setDialog("none")}
        />
      ) : null}
      {dialog === "help" ? <HelpDialog onClose={() => setDialog("none")} isMac={mac} /> : null}
      {dialog === "palette" ? (
        <CommandPalette commands={commands} onClose={() => setDialog("none")} isMac={mac} />
      ) : null}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          const at = pendingImageAt.current ?? core.viewportCenter()
          pendingImageAt.current = null
          closeImagePicker(!!file)
          if (!file) return
          void ingestFiles(core, [file], at, { mode: "insert-image" }).then((r) => {
            for (const err of r.errors) notify(err, "error")
            if (r.images === 0) core.cancelImageInsert()
          })
        }}
      />
    </div>
  )
}

export const serializeCurrentScene = serializeNib

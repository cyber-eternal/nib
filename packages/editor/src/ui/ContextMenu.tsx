import { type EditorCore, type NibElement, elementLink, isLinearElement } from "@nib/core"
import { useMemo } from "react"
import "../canvas/overlays.css"
import { requestEmbedAddress } from "../canvas/embedState"
import { followLink } from "../canvas/links"
import { isMacPlatform, shortcutFor } from "../hooks/useShortcuts"
import { Menu, type MenuItem, type MenuSection } from "./primitives/Menu"
import { Popover } from "./primitives/Popover"
import { useOptionalToast } from "./primitives/Toast"
import { zoomToFitChrome } from "./shell/viewport"
import { lockedNotice } from "./style/moreMenu"

export interface ContextAction {
  id?: string
  label: string
  /** A chord such as "Mod+C" (formatted for the platform), or display text. */
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  /** Toasted after it runs, when the menu's own result is not visible (Lock clears the selection). */
  notice?: string
  run(): void
}

export type ContextEntry = ContextAction | "sep"

interface Props {
  /** Window coordinates of the press; the menu opens there and stays on-screen near the edges. */
  x: number
  y: number
  items: readonly ContextEntry[]
  onClose(): void
  label?: string
}

/** Splits entries at separators; a run of destructive entries is set apart by a deliberate gap. */
export const toMenuSections = (
  items: readonly ContextEntry[],
  notify?: (message: string) => void,
): MenuSection[] => {
  const sections: MenuSection[] = []
  let current: MenuItem[] = []
  const flush = () => {
    if (current.length === 0) return
    const isolated = sections.length > 0 && current.every((i) => i.danger)
    sections.push({ id: `section-${sections.length}`, items: current, isolated })
    current = []
  }
  for (const entry of items) {
    if (entry === "sep") {
      flush()
      continue
    }
    current.push({
      id: entry.id ?? entry.label,
      label: entry.label,
      shortcut: entry.shortcut,
      disabled: entry.disabled,
      danger: entry.danger,
      onSelect: () => {
        entry.run()
        if (entry.notice) notify?.(entry.notice)
      },
    })
  }
  flush()
  return sections
}

/** Right-click and Shift+F10 menu, on the Menu primitive: menuitem roles, arrow keys, typeahead. */
export function ContextMenu({ x, y, items, onClose, label = "Board actions" }: Props) {
  const toast = useOptionalToast()
  const notify = toast?.notify
  const sections = useMemo(() => toMenuSections(items, notify), [items, notify])
  return (
    <Popover
      open
      anchor={{ x, y }}
      side="bottom"
      align="start"
      offset={2}
      contentRole="none"
      initialFocus="first"
      onClose={() => onClose()}
      className="sc-menu-popover sc-context-menu"
    >
      <div className="sc-context-menu-body" data-testid="context-menu">
        <Menu label={label} sections={sections} autoFocus="none" onClose={onClose} />
      </div>
    </Popover>
  )
}

export interface ContextMenuOptions {
  /** For callers that predate `target`: whether to show the selection's menu. */
  hasSelection?: boolean
  /** What CanvasHost reported under the pointer; the selection already follows it. */
  target?: { element: NibElement | null } | null
  onCopy?(): void
  onCut?(): void
  onPaste?(): void
  onCopyStyle?(): void
  onPasteStyle?(): void
  onCopyAsPng?(): void
  onCopyAsSvg?(): void
  onAddToLibrary?(): void
  /** Opens the link editor for the selection. */
  onLink?(): void
  onTidy?(): void
  /** Writes text to the clipboard; enables "Copy link to element". */
  onCopyText?(text: string): void
  /** Opens a web link when the core host has no opener. */
  onOpenLink?(url: string): void
  onToggleStats?(): void
}

export type ContextMenuKind = "view" | "locked" | "element" | "canvas"

/** View mode gets the read-only set; a locked element its Unlock menu; otherwise selection or board. */
export const contextMenuKind = (core: EditorCore, opts: ContextMenuOptions): ContextMenuKind => {
  if (core.appState.viewMode) return "view"
  if (opts.target?.element?.locked) return "locked"
  const hasSelection = opts.target !== undefined ? core.selectedElements().length > 0 : !!opts.hasSelection
  return hasSelection ? "element" : "canvas"
}

type Maybe = ContextEntry | false | null | undefined | ""

/** Drops absent entries and the separators they leave doubled or dangling. */
const compact = (entries: readonly Maybe[]): ContextEntry[] => {
  const out: ContextEntry[] = []
  for (const e of entries) {
    if (!e) continue
    if (e === "sep" && (out.length === 0 || out[out.length - 1] === "sep")) continue
    out.push(e)
  }
  while (out[out.length - 1] === "sep") out.pop()
  return out
}

const key = (id: string): string | undefined => shortcutFor(id)

const deleteKey = (): string => (isMacPlatform() ? "Backspace" : "Delete")

// the same fit as Shift+1 and the ledge's button: content lands clear of the tray and the top row
const zoomToFit = (core: EditorCore, onlySelection = false) => zoomToFitChrome(core, onlySelection)

const linkEntries = (core: EditorCore, el: NibElement | null, opts: ContextMenuOptions): Maybe[] => [
  el?.link && {
    id: "openLink",
    label: "Open link",
    run: () => void followLink(core, el.link!, opts.onOpenLink),
  },
  el &&
    opts.onCopyText && {
      id: "copyElementLink",
      label: "Copy link to element",
      run: () => opts.onCopyText!(elementLink(el.id)),
    },
]

const boardEntries = (core: EditorCore, opts: ContextMenuOptions): Maybe[] => {
  const a = core.appState
  const els = core.scene.getNonDeleted()
  const hasContent = els.length > 0
  const hasFrames = els.some((e) => e.type === "frame")
  const hasLocked = els.some((e) => e.locked)
  return [
    opts.onPaste && { id: "paste", label: "Paste", shortcut: key("edit.paste"), run: opts.onPaste },
    "sep",
    {
      id: "selectAll",
      label: "Select all",
      shortcut: key("selection.all"),
      disabled: !hasContent,
      run: () => core.selectAll(),
    },
    hasContent && {
      id: "zoomFit",
      label: "Zoom to fit",
      shortcut: key("view.zoomFit"),
      run: () => zoomToFit(core),
    },
    "sep",
    {
      id: "grid",
      label: a.gridSize ? "Hide grid" : "Show grid",
      shortcut: key("view.grid"),
      run: () => core.toggleGrid(),
    },
    {
      id: "snap",
      label: a.objectsSnapMode ? "Turn off object snapping" : "Turn on object snapping",
      shortcut: key("view.snap"),
      run: () => core.toggleSnap(),
    },
    {
      id: "zen",
      label: a.zenMode ? "Exit zen mode" : "Zen mode",
      shortcut: key("view.zen"),
      run: () => core.toggleZen(),
    },
    { id: "viewMode", label: "View mode", shortcut: key("view.viewMode"), run: () => core.toggleViewMode() },
    opts.onToggleStats && {
      id: "stats",
      label: "Stats",
      shortcut: key("view.stats"),
      run: opts.onToggleStats,
    },
    "sep",
    hasContent &&
      opts.onTidy && {
        id: "tidy",
        label: "Tidy up connectors",
        shortcut: key("arrange.tidy"),
        run: opts.onTidy,
      },
    hasFrames && { id: "present", label: "Present frames", run: () => core.startPresentation() },
    hasLocked && { id: "unlockAll", label: "Unlock all", run: () => core.unlockAll() },
  ]
}

const lockedEntries = (core: EditorCore, el: NibElement, opts: ContextMenuOptions): Maybe[] => [
  { id: "unlock", label: "Unlock", run: () => core.unlockElement(el.id) },
  ...linkEntries(core, el, opts),
  "sep",
  ...boardEntries(core, opts),
]

const viewEntries = (core: EditorCore, el: NibElement | null, opts: ContextMenuOptions): Maybe[] => {
  const a = core.appState
  const frame = el?.type === "frame" ? el : null
  const hasFrames = core.scene.getNonDeleted().some((e) => e.type === "frame")
  return [
    ...linkEntries(core, el, opts),
    "sep",
    { id: "zoomFit", label: "Zoom to fit", shortcut: key("view.zoomFit"), run: () => zoomToFit(core) },
    {
      id: "grid",
      label: a.gridSize ? "Hide grid" : "Show grid",
      shortcut: key("view.grid"),
      run: () => core.toggleGrid(),
    },
    {
      id: "zen",
      label: a.zenMode ? "Exit zen mode" : "Zen mode",
      shortcut: key("view.zen"),
      run: () => core.toggleZen(),
    },
    opts.onToggleStats && {
      id: "stats",
      label: "Stats",
      shortcut: key("view.stats"),
      run: opts.onToggleStats,
    },
    "sep",
    frame && {
      id: "presentFrom",
      label: "Present from this frame",
      run: () => core.startPresentation(frame.id),
    },
    !frame && hasFrames && { id: "present", label: "Present frames", run: () => core.startPresentation() },
    {
      id: "exitViewMode",
      label: "Exit view mode",
      shortcut: key("view.viewMode"),
      run: () => core.toggleViewMode(),
    },
  ]
}

const selectionEntries = (core: EditorCore, opts: ContextMenuOptions): Maybe[] => {
  const sel = core.selectedElements()
  const single = sel.length === 1 ? sel[0]! : null
  const many = sel.length > 1
  const frame = single?.type === "frame" ? single : null
  const cropping = core.appState.croppingElementId
  const allLocked = sel.length > 0 && sel.every((e) => e.locked)
  return [
    opts.onCut && { id: "cut", label: "Cut", shortcut: key("edit.cut"), run: opts.onCut },
    opts.onCopy && { id: "copy", label: "Copy", shortcut: key("edit.copy"), run: opts.onCopy },
    opts.onPaste && { id: "paste", label: "Paste", shortcut: key("edit.paste"), run: opts.onPaste },
    "sep",
    opts.onCopyStyle && {
      id: "copyStyle",
      label: "Copy styles",
      shortcut: key("edit.copyStyle"),
      run: opts.onCopyStyle,
    },
    opts.onPasteStyle && {
      id: "pasteStyle",
      label: "Paste styles",
      shortcut: key("edit.pasteStyle"),
      run: opts.onPasteStyle,
    },
    opts.onCopyAsPng && {
      id: "copyPng",
      label: "Copy as PNG",
      shortcut: key("edit.copyPng"),
      run: opts.onCopyAsPng,
    },
    opts.onCopyAsSvg && { id: "copySvg", label: "Copy as SVG", run: opts.onCopyAsSvg },
    "sep",
    single?.type === "image" &&
      !cropping && { id: "crop", label: "Crop image", run: () => core.requestCrop(single.id) },
    cropping && { id: "cropDone", label: "Finish cropping", run: () => core.stopCropping() },
    cropping && { id: "cropReset", label: "Reset crop", run: () => core.resetCrop() },
    single?.type === "embeddable" &&
      !single.locked && {
        id: "editEmbed",
        label: single.link ? "Change embed address" : "Set embed address",
        run: () => requestEmbedAddress(single.id),
      },
    single &&
      isLinearElement(single) && {
        id: "editPoints",
        label: "Edit points",
        shortcut: key("edit.points"),
        run: () => core.setAppState({ editingLinearElementId: single.id }),
      },
    core.canBindText() && {
      id: "bindText",
      label: "Bind text to shape",
      run: () => core.bindTextToContainer(),
    },
    core.canUnbindText() && { id: "unbindText", label: "Unbind text", run: () => core.unbindText() },
    core.canWrapText() && {
      id: "wrapText",
      label: "Wrap text in a box",
      run: () => core.wrapTextInContainer(),
    },
    "sep",
    frame && { id: "renameFrame", label: "Rename frame", run: () => core.startRenamingFrame(frame) },
    frame && {
      id: "selectFrameChildren",
      label: "Select frame contents",
      disabled: core.frameChildren(frame.id).length === 0,
      run: () => core.selectFrameChildren(frame.id),
    },
    frame && {
      id: "presentFrom",
      label: "Present from this frame",
      run: () => core.startPresentation(frame.id),
    },
    !sel.some((e) => e.type === "frame") && {
      id: "wrapInFrame",
      label: "Wrap in frame",
      run: () => core.wrapSelectionInFrame(),
    },
    sel.some((e) => e.frameId && e.type !== "frame") && {
      id: "removeFromFrame",
      label: "Remove from frame",
      run: () => core.removeSelectionFromFrame(),
    },
    "sep",
    many && { id: "group", label: "Group", shortcut: key("arrange.group"), run: () => core.group() },
    sel.some((e) => e.groupIds.length > 0) && {
      id: "ungroup",
      label: "Ungroup",
      shortcut: key("arrange.ungroup"),
      run: () => core.ungroup(),
    },
    opts.onAddToLibrary && { id: "addToLibrary", label: "Add to library", run: opts.onAddToLibrary },
    opts.onTidy && {
      id: "tidy",
      label: "Tidy up connectors",
      shortcut: key("arrange.tidy"),
      run: opts.onTidy,
    },
    "sep",
    {
      id: "backward",
      label: "Send backward",
      shortcut: key("arrange.backward"),
      run: () => core.moveZ("backward"),
    },
    {
      id: "forward",
      label: "Bring forward",
      shortcut: key("arrange.forward"),
      run: () => core.moveZ("forward"),
    },
    { id: "back", label: "Send to back", shortcut: key("arrange.back"), run: () => core.moveZ("back") },
    { id: "front", label: "Bring to front", shortcut: key("arrange.front"), run: () => core.moveZ("front") },
    "sep",
    {
      id: "flipH",
      label: "Flip horizontal",
      shortcut: key("arrange.flipH"),
      run: () => core.flip("horizontal"),
    },
    { id: "flipV", label: "Flip vertical", shortcut: key("arrange.flipV"), run: () => core.flip("vertical") },
    "sep",
    opts.onLink && {
      id: "link",
      label: single?.link ? "Edit link" : "Add link",
      shortcut: key("edit.link"),
      run: opts.onLink,
    },
    ...linkEntries(core, single, opts),
    single?.link && { id: "removeLink", label: "Remove link", run: () => core.setLink(null) },
    "sep",
    {
      id: "duplicate",
      label: "Duplicate",
      shortcut: key("edit.duplicate"),
      run: () => core.duplicateSelected(),
    },
    allLocked
      ? { id: "lock", label: "Unlock", shortcut: key("edit.lock"), run: () => core.toggleLock() }
      : {
          id: "lock",
          label: "Lock",
          shortcut: key("edit.lock"),
          notice: lockedNotice(sel.length),
          run: () => core.toggleLock(),
        },
    {
      id: "zoomSelection",
      label: "Zoom to selection",
      shortcut: key("view.zoomSelection"),
      run: () => zoomToFit(core, true),
    },
    "sep",
    frame && {
      id: "deleteFrameKeep",
      label: "Delete frame, keep contents",
      danger: true,
      run: () => core.deleteSelected({ frameChildren: "release" }),
    },
    { id: "delete", label: "Delete", shortcut: deleteKey(), danger: true, run: () => core.deleteSelected() },
  ]
}

/**
 * The context menu's entries for what was right-clicked: the selection, a locked element (Unlock), the
 * empty board, or the read-only set in view mode. Entries a callback is missing for are left out.
 */
export const buildContextItems = (core: EditorCore, opts: ContextMenuOptions): ContextEntry[] => {
  const el = opts.target?.element ?? null
  switch (contextMenuKind(core, opts)) {
    case "view":
      return compact(viewEntries(core, el, opts))
    case "locked":
      return compact(lockedEntries(core, el!, opts))
    case "element":
      return compact(selectionEntries(core, opts))
    default:
      return compact(boardEntries(core, opts))
  }
}

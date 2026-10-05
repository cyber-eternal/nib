import {
  type CanvasPalette,
  type EditorCore,
  LIBRARY_MIME,
  type LibraryItem,
  type Point,
  exportToSvg,
  mergeLibraryItems,
  parseLibrary,
  parseLibraryFile,
  serializeLibrary,
} from "@nib/core"
import { type DragEvent, type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react"
import { libraryDragData } from "../document/libraryStore"
import { shallowEqual, useCoreSelector } from "../hooks/useEditor"
import { SideSheet } from "./panels/SideSheet"
import { PanelIcons } from "./panels/icons"
import {
  type RemovedItem,
  addSelectionToLibrary,
  filterLibraryItems,
  insertLibraryItem,
  isLibraryFileName,
  libraryItemLabel,
  removeLibraryItem,
  renameLibraryItem,
  restoreLibraryItem,
} from "./panels/libraryModel"
import { sheetBox, unmountedByShow } from "./panels/sheetParking"
import { Button, IconButton } from "./primitives/IconButton"
import { MenuPopover } from "./primitives/Menu"
import { Popover } from "./primitives/Popover"
import { type NotifyOptions, useOptionalToast } from "./primitives/Toast"
import { isImeKey } from "./primitives/ime"
import type { ToastKind } from "./primitives/toastQueue"

export interface LibraryPanelProps {
  core: EditorCore
  items: LibraryItem[]
  onChange(items: LibraryItem[]): void
  onClose(): void
  onImport(): void
  onExport(text: string): void
  /** Where a clicked item lands, in scene coordinates; defaults to the middle of the view. */
  centreScene?(): Point
  /** Places an item; defaults to insertElements(core, item.elements, item.files, at). */
  onInsert?(item: LibraryItem, at: Point): void
  /** Shows a toast with an Undo action after a removal; without it the sheet shows its own undo line. */
  notify?(message: string, opts?: NotifyOptions): void
  /** A plain toast for the outcome of a file dropped on the sheet; the sheet also says it inline. */
  onNotify?(message: string, kind?: ToastKind): void
  /** The theme's canvas palette, so thumbnails match the board. */
  palette?: CanvasPalette
}

const FILTER_FROM = 7
const UNDO_MS = 8000

/** Rendered through an <img> data URL: library files are user-supplied, and an image never runs script. */
const thumbnail = (
  core: EditorCore,
  item: LibraryItem,
  theme: "light" | "dark",
  palette?: CanvasPalette,
): string | null => {
  try {
    const svg = exportToSvg({
      elements: item.elements,
      appState: core.appState,
      files: item.files ?? {},
      exportBackground: false,
      exportPadding: 4,
      scale: 1,
      theme,
      palette,
    })
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  } catch {
    return null
  }
}

type MenuState = { id: string; anchor: { x: number; y: number } }

/** Where focus goes once a tile leaves or stops being renamed: a tile by id, or Add selection. */
type FocusTarget = { tile: string } | "add"

/** What the sheet shows from the core; it re-renders only when one of these changes. */
const sheetState = (core: EditorCore) => ({
  theme: core.appState.theme,
  viewMode: core.appState.viewMode,
  hasSelection:
    Object.keys(core.appState.selectedElementIds).length > 0 && core.selectedElements().length > 0,
})

/** Reusable drawings: click or drag an item onto the canvas, name it, and import or export .excalidrawlib. */
export function LibraryPanel({
  core,
  items,
  onChange,
  onClose,
  onImport,
  onExport,
  centreScene,
  onInsert,
  notify,
  onNotify,
  palette,
}: LibraryPanelProps) {
  const { theme, viewMode, hasSelection } = useCoreSelector(core, sheetState, shallowEqual)
  const toast = useOptionalToast()
  const howtoId = useId()
  const [filter, setFilter] = useState("")
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [confirm, setConfirm] = useState<MenuState | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [undo, setUndo] = useState<RemovedItem | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  const [refocus, setRefocus] = useState<FocusTarget | null>(null)
  // per core, not per mount: an Undo toast that outlives a slide show restores against the current list
  const latest = sheetBox(core, "library.items", () => items)
  latest.current = items
  const tiles = useRef(new Map<string, HTMLButtonElement>())
  const addRef = useRef<HTMLButtonElement>(null)
  const undoToasts = sheetBox(core, "library.undoToasts", () => ({ ids: new Set<string>(), mounted: 0 }))

  const thumbs = useMemo(() => {
    const map = new Map<string, string | null>()
    for (const item of items) map.set(item.id, thumbnail(core, item, theme, palette))
    return map
  }, [items, theme, palette, core])

  useEffect(() => {
    if (!undo) return
    const timer = window.setTimeout(() => setUndo(null), UNDO_MS)
    return () => window.clearTimeout(timer)
  }, [undo])

  // an Undo toast restores against the sheet's list; once the sheet is closed that list goes stale.
  // A slide show only unmounts it until the show ends, and StrictMode remounts it at once: both keep them.
  useEffect(() => {
    const held = undoToasts.current
    held.mounted++
    return () => {
      held.mounted--
      if (unmountedByShow(core)) return
      queueMicrotask(() => {
        if (held.mounted > 0) return
        for (const id of held.ids) toast?.dismiss(id)
        held.ids.clear()
      })
    }
  }, [toast, core, undoToasts])

  // a renamed or removed tile takes focus with it; hand it to its neighbour so Escape still closes the sheet
  useEffect(() => {
    if (!refocus) return
    setRefocus(null)
    const el = refocus === "add" ? addRef.current : tiles.current.get(refocus.tile)
    if (el && !el.disabled) el.focus({ preventScroll: true })
    else addRef.current?.closest<HTMLElement>(".sc-sheet")?.focus({ preventScroll: true })
  }, [refocus])

  const shown = filterLibraryItems(items, items.length >= FILTER_FROM ? filter : "")

  const insert = (item: LibraryItem) => {
    const at = centreScene?.() ?? core.viewportCenter()
    if (onInsert) onInsert(item, at)
    else insertLibraryItem(core, item, at)
  }

  const add = () => {
    const next = addSelectionToLibrary(core, latest.current)
    if (!next) {
      setStatus(hasSelection ? "That selection is already in your library." : null)
      return
    }
    setStatus(null)
    setFilter("")
    onChange(next)
    setRenaming(next[0]!.id)
  }

  const remove = (id: string) => {
    const { items: next, removed } = removeLibraryItem(latest.current, id)
    if (!removed) return
    onChange(next)
    const neighbour = next[Math.min(removed.index, next.length - 1)]
    setRefocus(neighbour ? { tile: neighbour.id } : "add")
    const label = libraryItemLabel(removed.item, removed.index)
    const restore = () => onChange(restoreLibraryItem(latest.current, removed))
    if (notify) {
      const toastId = `library-undo-${removed.item.id}`
      undoToasts.current.ids.add(toastId)
      notify(`Removed “${label}” from the library`, {
        id: toastId,
        duration: UNDO_MS,
        action: { label: "Undo", run: restore },
      })
    } else setUndo(removed)
  }

  const rename = (id: string, name: string) => {
    onChange(renameLibraryItem(latest.current, id, name))
    setRenaming(null)
  }

  /** Enter or Escape in the name field: back to the tile, where the keyboard user left off. */
  const finishRenaming = (id: string) => {
    setRenaming(null)
    setRefocus({ tile: id })
  }

  const openMenuAt = (id: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setMenu({ id, anchor: { x: r.left, y: r.bottom } })
  }

  const onTileKeyDown = (e: KeyboardEvent<HTMLButtonElement>, item: LibraryItem) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault()
      e.stopPropagation()
      const r = e.currentTarget.getBoundingClientRect()
      setConfirm({ id: item.id, anchor: { x: r.left, y: r.bottom } })
    } else if (e.key === "F2") {
      e.preventDefault()
      setRenaming(item.id)
    } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault()
      openMenuAt(item.id, e.currentTarget)
    }
  }

  const acceptsDrop = (e: DragEvent) =>
    e.dataTransfer.types.includes("Files") && !e.dataTransfer.types.includes(LIBRARY_MIME)

  const onDrop = async (e: DragEvent<HTMLElement>) => {
    if (!acceptsDrop(e)) return
    e.preventDefault()
    e.stopPropagation()
    setDropping(false)
    const files = [...e.dataTransfer.files].filter(
      (f) => isLibraryFileName(f.name) || f.type === "application/json",
    )
    if (files.length === 0) {
      setStatus("Drop an .excalidrawlib file to add its items.")
      return
    }
    let next = latest.current
    const problems: string[] = []
    for (const file of files) {
      const parsed = parseLibraryFile(await file.text())
      if (parsed.ok) next = mergeLibraryItems(next, parsed.items)
      else problems.push(`${file.name}: ${parsed.error}`)
    }
    const added = next.length - latest.current.length
    if (added > 0) onChange(next)
    const outcome = problems.length
      ? problems.join(" ")
      : added > 0
        ? `Added ${added} ${added === 1 ? "item" : "items"} to the library.`
        : "Those items are already in your library."
    setStatus(outcome)
    onNotify?.(outcome, problems.length ? "error" : "info")
  }

  const menuItem = menu ? items.find((i) => i.id === menu.id) : undefined
  const menuIndex = menuItem ? items.indexOf(menuItem) : -1
  const confirmItem = confirm ? items.find((i) => i.id === confirm.id) : undefined
  const confirmIndex = confirmItem ? items.indexOf(confirmItem) : -1

  return (
    <SideSheet
      title="Library"
      closeLabel="Close library"
      onClose={onClose}
      initialFocus="sheet"
      className="sc-library"
      data-testid="library-panel"
      data-dropping={dropping || undefined}
      onDragOver={(e) => {
        if (!acceptsDrop(e)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = "copy"
        setDropping(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={(e) => void onDrop(e)}
      footer={
        <>
          <Button icon={PanelIcons.upload} onClick={onImport}>
            Import
          </Button>
          <Button
            icon={PanelIcons.download}
            disabled={items.length === 0}
            onClick={() => onExport(serializeLibrary(items))}
          >
            Export
          </Button>
        </>
      }
    >
      <div className="sc-library-toolbar">
        <Button ref={addRef} icon={PanelIcons.plus} disabled={!hasSelection || viewMode} onClick={add}>
          Add selection
        </Button>
      </div>

      {items.length >= FILTER_FROM ? (
        <label className="sc-search-field">
          {PanelIcons.search}
          <span className="sc-visually-hidden">Filter the library by name</span>
          <input
            type="search"
            className="sc-input"
            placeholder="Filter by name"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
      ) : null}

      <p className="sc-visually-hidden" role="status">
        {status ?? ""}
      </p>
      {status ? <p className="sc-hint">{status}</p> : null}
      {viewMode ? <p className="sc-hint">View mode is on, so items can't be placed on the canvas.</p> : null}

      {items.length === 0 ? (
        <div className="sc-library-empty">
          {PanelIcons.library}
          <p>
            Keep shapes you reuse here. Select something on the canvas, then choose Add selection. You can
            also import an .excalidrawlib file, or drop one on this panel.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <p className="sc-hint">No item is named “{filter.trim()}”.</p>
      ) : (
        <>
          <ul className="sc-library-grid" aria-label="Library items">
            {shown.map(({ item, index }) => {
              const label = libraryItemLabel(item, index)
              const thumb = thumbs.get(item.id) ?? null
              return (
                <li className="sc-lib-cell" key={item.id}>
                  <button
                    ref={(el) => {
                      if (el) tiles.current.set(item.id, el)
                      else tiles.current.delete(item.id)
                    }}
                    type="button"
                    className="sc-lib-tile lib-item"
                    aria-label={label}
                    aria-describedby={howtoId}
                    disabled={viewMode}
                    draggable={!viewMode}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(LIBRARY_MIME, libraryDragData([item]))
                      e.dataTransfer.effectAllowed = "copy"
                    }}
                    onClick={() => insert(item)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu({ id: item.id, anchor: { x: e.clientX, y: e.clientY } })
                    }}
                    onKeyDown={(e) => onTileKeyDown(e, item)}
                  >
                    {thumb ? (
                      <img src={thumb} alt="" draggable={false} />
                    ) : (
                      <span className="sc-lib-tile-empty">No preview</span>
                    )}
                  </button>
                  <div className="sc-lib-more" data-open={menu?.id === item.id || undefined}>
                    <IconButton
                      label={`More for ${label}`}
                      icon={PanelIcons.more}
                      size="s"
                      tooltip={false}
                      aria-haspopup="menu"
                      aria-expanded={menu?.id === item.id}
                      onClick={(e) => openMenuAt(item.id, e.currentTarget)}
                    />
                  </div>
                  {renaming === item.id ? (
                    <RenameField
                      initial={item.name ?? ""}
                      label={`Name for ${label}`}
                      onCommit={(name) => rename(item.id, name)}
                      onCancel={() => setRenaming(null)}
                      onDone={() => finishRenaming(item.id)}
                    />
                  ) : (
                    <span className="sc-lib-name" data-named={item.name ? "" : undefined} aria-hidden="true">
                      {label}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          <p id={howtoId} className="sc-hint">
            Click an item to place it in the middle of the view, or drag it where you want it.
          </p>
        </>
      )}

      {undo ? (
        <div className="sc-row" role="status">
          <span className="sc-hint">Removed “{libraryItemLabel(undo.item, undo.index)}”.</span>
          <Button
            onClick={() => {
              onChange(restoreLibraryItem(latest.current, undo))
              setUndo(null)
            }}
          >
            Undo
          </Button>
        </div>
      ) : null}

      <MenuPopover
        open={!!menu && !!menuItem}
        onClose={() => setMenu(null)}
        anchor={menu?.anchor ?? { x: 0, y: 0 }}
        label={menuItem ? `${libraryItemLabel(menuItem, menuIndex)} options` : "Item options"}
        sections={[
          {
            id: "use",
            items: [
              {
                id: "insert",
                label: "Place on canvas",
                disabled: viewMode,
                onSelect: () => menuItem && insert(menuItem),
              },
              { id: "rename", label: "Rename", shortcut: "F2", onSelect: () => menu && setRenaming(menu.id) },
            ],
          },
          {
            id: "remove",
            isolated: true,
            items: [
              {
                id: "remove",
                label: "Remove from library…",
                danger: true,
                onSelect: () => menu && setConfirm(menu),
              },
            ],
          },
        ]}
      />

      <Popover
        open={!!confirm && !!confirmItem}
        onClose={() => setConfirm(null)}
        anchor={confirm?.anchor ?? { x: 0, y: 0 }}
        side="bottom"
        align="start"
        label="Remove library item"
        initialFocus="first"
      >
        <div className="sc-confirm">
          <p>
            Remove “{confirmItem ? libraryItemLabel(confirmItem, confirmIndex) : ""}” from your library?
            Drawings already on the canvas stay.
          </p>
          <div className="sc-confirm-actions">
            <Button onClick={() => setConfirm(null)}>Keep</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirm) remove(confirm.id)
                setConfirm(null)
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      </Popover>
    </SideSheet>
  )
}

function RenameField({
  initial,
  label,
  onCommit,
  onCancel,
  onDone,
}: {
  initial: string
  label: string
  onCommit(name: string): void
  onCancel(): void
  /** After Enter or Escape, which leave focus nowhere once the field is gone. */
  onDone(): void
}) {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const finish = (fn: () => void) => {
    if (done.current) return
    done.current = true
    fn()
  }
  return (
    <input
      className="sc-input"
      data-size="s"
      aria-label={label}
      placeholder="Name it"
      maxLength={200}
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(() => onCommit(value))}
      onKeyDown={(e) => {
        if (isImeKey(e)) return
        if (e.key === "Enter") {
          e.preventDefault()
          finish(() => onCommit(value))
          onDone()
        } else if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          finish(onCancel)
          onDone()
        }
      }}
    />
  )
}

export const readLibraryFile = (text: string): LibraryItem[] => parseLibrary(text)

import type { EditorCore } from "@nib/core"
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { shallowEqual, useCoreSelector } from "../hooks/useEditor"
import { type ThemeId, getTheme, themes } from "../theme/themes"
import { Menu, type MenuItem, MenuPopover, type MenuSection, Popover, type PopoverAnchor } from "./primitives"
import { ShellIcons } from "./shell/icons"
import { opensSubmenu, themeRowMove } from "./shell/menuRow"
import { CanvasBackgroundPopover } from "./style/CanvasBackgroundPicker"
import "./shell/shell.css"

export interface MenuActions {
  newDocument(): void
  open(): void
  save(): void
  saveAs(): void
  exportImage(): void
  importExcalidraw(): void
  exportExcalidraw(): void
  toggleLibrary(): void
  toggleStats(): void
  showShortcuts(): void
  openMermaid(): void
  tidyUp(): void
  resetCanvas(): void
  insertImage?(): void
  openPalette?(): void
  openPreferences?(): void
  present?(): void
  zoomToFit?(): void
  openRecent?(path: string): void
  clearRecent?(): void
  closeTab?(): void
  reopenClosedTab?(): void
  nextTab?(): void
  previousTab?(): void
}

export interface MainMenuTheme {
  current: ThemeId
  matchSystem: boolean
  onSelect(id: ThemeId): void
  onMatchSystem(on: boolean): void
}

interface Props {
  core: EditorCore
  actions: MenuActions
  onClose(): void
  showStats: boolean
  /** Defaults to true, so mounting the menu shows it (the old shell mounted it only while open). */
  open?: boolean
  /** The menu button; without it the menu opens at the top-left corner. */
  anchor?: PopoverAnchor
  ignore?: readonly RefObject<HTMLElement | null>[]
  theme?: MainMenuTheme
  /** Recent documents (desktop); null or undefined hides Open Recent. */
  recentFiles?: readonly string[] | null
  /** "Download" where Save can't write back to the file (the browser without file access). */
  saveLabel?: string
}

const fileName = (path: string): string => path.split(/[\\/]/).pop() || path

/** The theme's board with a dot of its course ink, so pale boards still tell apart in a row. */
const chip = (board: string, course: string) => (
  <span
    className="shell-theme-chip"
    style={{ "--chip": board, "--chip-dot": course } as CSSProperties}
    aria-hidden="true"
  />
)

type Sub = "recent" | "background" | null

/** Marks an item as a submenu opener: CSS draws its chevron, and an effect gives it aria-haspopup. */
const submenuIcon = (icon: ReactNode, popup: "menu" | "dialog") => <span data-submenu={popup}>{icon}</span>

/** The main menu: File, View, Insert, Theme and Help, with Reset canvas set apart at the end. */
export function MainMenu({
  core,
  actions,
  onClose,
  showStats,
  open = true,
  anchor,
  ignore,
  theme,
  recentFiles,
  saveLabel = "Save",
}: Props) {
  const state = useCoreSelector(
    core,
    (c) => ({
      grid: c.appState.gridSize !== null,
      snap: c.appState.objectsSnapMode,
      zen: c.appState.zenMode,
      viewMode: c.appState.viewMode,
    }),
    shallowEqual,
  )
  const [sub, setSub] = useState<Sub>(null)
  const subAnchor = useRef<HTMLElement | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const fallbackAnchor = useMemo(() => ({ x: 12, y: 56 }), [])

  // the menu stays mounted while closed; a submenu left open must not come back with it
  useEffect(() => {
    if (!open) setSub(null)
  }, [open])

  useEffect(() => {
    for (const marker of body.current?.querySelectorAll<HTMLElement>("[data-submenu]") ?? []) {
      const item = marker.closest("button")
      if (!item) continue
      item.setAttribute("aria-haspopup", marker.dataset.submenu ?? "menu")
      item.setAttribute("aria-expanded", String(subAnchor.current === item && sub !== null))
    }
  })

  const openSub = (which: Exclude<Sub, null>) => {
    subAnchor.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSub(which)
  }

  const run = (fn?: () => void) => () => fn?.()

  const sections: MenuSection[] = [
    {
      id: "file",
      label: "File",
      items: [
        {
          id: "new",
          label: "New tab",
          shortcut: "Mod+N",
          icon: ShellIcons.file,
          onSelect: actions.newDocument,
        },
        { id: "open", label: "Open…", shortcut: "Mod+O", icon: ShellIcons.folder, onSelect: actions.open },
        ...(recentFiles
          ? [
              {
                id: "recent",
                label: "Open Recent",
                icon: submenuIcon(ShellIcons.recent, "menu"),
                keepOpen: true,
                disabled: recentFiles.length === 0,
                onSelect: () => openSub("recent"),
              } satisfies MenuItem,
            ]
          : []),
        ...(actions.closeTab
          ? [{ id: "closeTab", label: "Close tab", shortcut: "Mod+W", onSelect: actions.closeTab }]
          : []),
        ...(actions.reopenClosedTab
          ? [
              {
                id: "reopenTab",
                label: "Reopen closed tab",
                shortcut: "Mod+Shift+T",
                onSelect: actions.reopenClosedTab,
              },
            ]
          : []),
        { id: "save", label: saveLabel, shortcut: "Mod+S", icon: ShellIcons.save, onSelect: actions.save },
        { id: "saveAs", label: "Save as (.nibd)…", shortcut: "Mod+Shift+S", onSelect: actions.saveAs },
      ],
    },
    {
      id: "importExport",
      label: "Import / Export",
      items: [
        {
          id: "exportImage",
          label: "Export image (PNG, SVG)…",
          shortcut: "Mod+Shift+E",
          icon: ShellIcons.image,
          onSelect: actions.exportImage,
        },
        {
          id: "import",
          label: "Import from Excalidraw (.excalidraw)…",
          icon: ShellIcons.importFile,
          onSelect: actions.importExcalidraw,
        },
        {
          id: "exportExcalidraw",
          label: "Export to Excalidraw (.excalidraw)…",
          icon: ShellIcons.exportFile,
          onSelect: actions.exportExcalidraw,
        },
      ],
    },
    {
      id: "view",
      label: "View",
      items: [
        {
          id: "grid",
          label: "Grid",
          kind: "checkbox",
          checked: state.grid,
          shortcut: "Mod+'",
          keepOpen: true,
          onSelect: () => core.toggleGrid(),
        },
        {
          id: "snap",
          label: "Object snapping",
          kind: "checkbox",
          checked: state.snap,
          shortcut: "Alt+S",
          keepOpen: true,
          onSelect: () => core.toggleSnap(),
        },
        {
          id: "zen",
          label: "Zen mode",
          kind: "checkbox",
          checked: state.zen,
          shortcut: "Alt+Z",
          onSelect: () => core.toggleZen(),
        },
        {
          id: "viewMode",
          label: "View mode",
          kind: "checkbox",
          checked: state.viewMode,
          shortcut: "Alt+R",
          onSelect: () => core.toggleViewMode(),
        },
        {
          id: "stats",
          label: "Stats",
          kind: "checkbox",
          checked: showStats,
          shortcut: "Alt+/",
          onSelect: actions.toggleStats,
        },
        {
          id: "fit",
          label: "Zoom to fit",
          shortcut: "Shift+1",
          icon: ShellIcons.fit,
          onSelect:
            actions.zoomToFit ??
            (() => core.viewportSize && core.zoomToFit(core.viewportSize.width, core.viewportSize.height)),
        },
        ...(actions.present
          ? [
              {
                id: "present",
                label: "Present frames",
                icon: ShellIcons.present,
                onSelect: run(actions.present),
              },
            ]
          : []),
        {
          id: "background",
          label: "Canvas colour",
          icon: submenuIcon(ShellIcons.swatch, "dialog"),
          keepOpen: true,
          disabled: state.viewMode,
          onSelect: () => openSub("background"),
        },
      ],
    },
    {
      id: "insert",
      label: "Insert",
      items: [
        ...(actions.insertImage
          ? [
              {
                id: "image",
                label: "Image…",
                shortcut: "9",
                icon: ShellIcons.image,
                disabled: state.viewMode,
                onSelect: run(actions.insertImage),
              },
            ]
          : []),
        {
          id: "mermaid",
          label: "Mermaid diagram…",
          icon: ShellIcons.diagram,
          disabled: state.viewMode,
          onSelect: actions.openMermaid,
        },
        { id: "library", label: "Library", icon: ShellIcons.library, onSelect: actions.toggleLibrary },
      ],
    },
    ...(theme
      ? [
          {
            id: "theme",
            label: `Theme · ${getTheme(theme.current).name}`,
            items: [
              ...themes.map(
                (t): MenuItem => ({
                  id: `theme-${t.id}`,
                  label: t.name,
                  kind: "radio",
                  checked: !theme.matchSystem && theme.current === t.id,
                  icon: chip(t.board, t.course),
                  keepOpen: true,
                  onSelect: () => theme.onSelect(t.id),
                }),
              ),
              {
                id: "matchSystem",
                label: "Match system",
                kind: "checkbox",
                checked: theme.matchSystem,
                keepOpen: true,
                onSelect: () => theme.onMatchSystem(!theme.matchSystem),
              } satisfies MenuItem,
            ],
          },
        ]
      : []),
    {
      id: "help",
      label: "Help",
      items: [
        {
          id: "shortcuts",
          label: "Keyboard shortcuts",
          shortcut: "?",
          icon: ShellIcons.keyboard,
          onSelect: actions.showShortcuts,
        },
        ...(actions.openPalette
          ? [
              {
                id: "palette",
                label: "Command palette",
                shortcut: "Mod+/",
                icon: ShellIcons.terminal,
                onSelect: run(actions.openPalette),
              },
            ]
          : []),
        ...(actions.openPreferences
          ? [
              {
                id: "prefs",
                label: "Preferences…",
                shortcut: "Mod+,",
                icon: ShellIcons.sliders,
                onSelect: run(actions.openPreferences),
              },
            ]
          : []),
      ],
    },
    {
      id: "danger",
      isolated: true,
      items: [
        {
          id: "reset",
          label: "Reset canvas…",
          icon: ShellIcons.trash,
          danger: true,
          disabled: state.viewMode,
          onSelect: actions.resetCanvas,
        },
      ],
    },
  ]

  // the inline theme row and submenu openers need two-dimensional keys the vertical menu lacks
  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (!target.matches?.(".sc-menu-item")) return
    if (opensSubmenu(e.key) && target.querySelector("[data-submenu]")) {
      e.preventDefault()
      e.stopPropagation()
      target.click()
      return
    }
    if (!target.querySelector(".shell-theme-chip")) return
    const row = Array.from(target.parentElement?.querySelectorAll<HTMLElement>(".sc-menu-item") ?? [])
    const chips = row.filter((el) => el.querySelector(".shell-theme-chip"))
    const move = themeRowMove(e.key, chips.indexOf(target), chips.length)
    if (!move) return
    const all = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(".sc-menu-item")).filter(
      (el) => el.getAttribute("aria-disabled") !== "true",
    )
    const next =
      move.to === "chip"
        ? chips[move.index]
        : move.to === "after"
          ? all[all.indexOf(chips[chips.length - 1]!) + 1]
          : all[all.indexOf(chips[0]!) - 1]
    if (!next) return
    e.preventDefault()
    e.stopPropagation()
    next.focus()
  }

  return (
    <Popover
      open={open}
      onClose={() => onClose()}
      anchor={anchor ?? fallbackAnchor}
      side="bottom"
      align="start"
      contentRole="none"
      initialFocus="first"
      ignore={ignore}
      className="sc-menu-popover shell-main-menu"
    >
      <div ref={body} onKeyDownCapture={onKeyDownCapture} data-testid="main-menu">
        <Menu label="Main menu" sections={sections} autoFocus="none" onClose={onClose} />
      </div>
      {sub === "recent" && recentFiles ? (
        <MenuPopover
          open
          onClose={() => setSub(null)}
          anchor={subAnchor}
          side="right"
          align="start"
          label="Open Recent"
          sections={[
            {
              id: "files",
              items: recentFiles.map((path) => ({
                id: path,
                label: fileName(path),
                onSelect: () => {
                  onClose()
                  actions.openRecent?.(path)
                },
              })),
            },
            {
              id: "clear",
              items: [
                {
                  id: "clear",
                  label: "Clear Recent",
                  onSelect: () => {
                    onClose()
                    actions.clearRecent?.()
                  },
                },
              ],
            },
          ]}
        />
      ) : null}
      {sub === "background" ? (
        <CanvasBackgroundPopover
          core={core}
          theme={getTheme(theme?.current)}
          open
          onClose={() => setSub(null)}
          anchor={subAnchor}
          side="right"
        />
      ) : null}
    </Popover>
  )
}

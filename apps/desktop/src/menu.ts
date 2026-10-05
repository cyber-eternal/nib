import { type MenuCommand, isTextEntry } from "@nib/platform"
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu"

type Emit = (cmd: MenuCommand) => void

export type MenuPlatform = "macos" | "linux" | "windows"

export const detectMenuPlatform = (
  userAgent: string = typeof navigator !== "undefined" ? (navigator.userAgent ?? "") : "",
): MenuPlatform =>
  /Macintosh|Mac OS X/.test(userAgent) ? "macos" : /Windows/.test(userAgent) ? "windows" : "linux"

export interface AppMenuHooks {
  /** Defaults to the one the user agent names. */
  platform?: MenuPlatform
  version?: string
  recent?: string[]
  openRecent?: (path: string) => void
  clearRecent?: () => void
  /** Only builds with an update feed get Check for Updates. */
  checkForUpdates?: () => void
}

/** Handled in Rust (lib.rs), so Cmd+Q still reaches the unsaved-changes guard with a hung webview. */
const QUIT_ID = "app.quit"
/**
 * Also handled in Rust: GTK has no predefined Close Window or Full Screen, ⌘W closes a tab rather than the
 * window, and close keeps the guard.
 */
const CLOSE_ID = "window.close"
const FULLSCREEN_ID = "window.fullscreen"

let emitCurrent: Emit = () => {}
let installed: Promise<InstalledMenu> | null = null

interface InstalledMenu {
  menu: Menu
  recent: Submenu
  hooks: AppMenuHooks
}

const route = (cmd: MenuCommand) => () => emitCurrent(cmd)

const item = (id: MenuCommand, text: string, accelerator?: string, idPrefix = "") =>
  MenuItem.new({ id: idPrefix + id, text, accelerator, action: route(id) })

const sep = () => PredefinedMenuItem.new({ item: "Separator" })

const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1)

/** macOS-style labels: the file name, plus the folder when two recent files share a name. */
export const recentLabels = (paths: string[]): string[] => {
  const counts = new Map<string, number>()
  for (const p of paths) counts.set(baseName(p), (counts.get(baseName(p)) ?? 0) + 1)
  return paths.map((p) => {
    const name = baseName(p)
    if ((counts.get(name) ?? 0) < 2) return name
    const dir = p.slice(0, p.lastIndexOf("/"))
    return `${name} — ${baseName(dir) || "/"}`
  })
}

const recentItems = async (paths: string[], hooks: AppMenuHooks) => {
  const labels = recentLabels(paths)
  const items = await Promise.all(
    paths.map((path, i) =>
      MenuItem.new({ id: `recent:${i}`, text: labels[i]!, action: () => hooks.openRecent?.(path) }),
    ),
  )
  return [
    ...items,
    ...(items.length > 0 ? [await sep()] : []),
    await MenuItem.new({
      id: "file.clearRecent",
      text: "Clear Menu",
      enabled: items.length > 0,
      action: () => {
        hooks.clearRecent?.()
        emitCurrent("file.clearRecent")
      },
    }),
  ]
}

/**
 * Two Edit menus, swapped as focus moves. In a text field every editing item is the native selector, so
 * the field undoes, selects and pastes natively. On the canvas, Undo, Redo and Select All drive the
 * editor. Cut, Copy and Paste are native in both, so WebKit fires DOM clipboard events (the only route
 * for pasted images) and the editor handles them there.
 */
const buildEditMenus = async (preferences: boolean): Promise<{ canvas: Submenu; field: Submenu }> => {
  const clipboard = async () => [
    await PredefinedMenuItem.new({ item: "Cut" }),
    await PredefinedMenuItem.new({ item: "Copy" }),
    await PredefinedMenuItem.new({ item: "Paste" }),
  ]
  const canvas = await Submenu.new({
    text: "Edit",
    items: [
      await item("edit.undo", "Undo", "CmdOrCtrl+Z"),
      await item("edit.redo", "Redo", "CmdOrCtrl+Shift+Z"),
      await sep(),
      ...(await clipboard()),
      await item("edit.copyStyle", "Copy Styles", "CmdOrCtrl+Alt+C"),
      await item("edit.pasteStyle", "Paste Styles", "CmdOrCtrl+Alt+V"),
      await sep(),
      await item("edit.duplicate", "Duplicate", "CmdOrCtrl+D"),
      await item("edit.delete", "Delete"),
      await item("edit.selectAll", "Select All", "CmdOrCtrl+A"),
      await sep(),
      await item("edit.group", "Group Selection", "CmdOrCtrl+G"),
      await item("edit.ungroup", "Ungroup Selection", "CmdOrCtrl+Shift+G"),
      ...(preferences ? [await sep(), await item("app.preferences", "Preferences…", "CmdOrCtrl+,")] : []),
    ],
  })
  // canvas-only commands keep their menu entries but drop their shortcuts while a field has focus
  const field = await Submenu.new({
    text: "Edit",
    items: [
      await PredefinedMenuItem.new({ item: "Undo" }),
      await PredefinedMenuItem.new({ item: "Redo" }),
      await sep(),
      ...(await clipboard()),
      await item("edit.copyStyle", "Copy Styles", undefined, "field:"),
      await item("edit.pasteStyle", "Paste Styles", undefined, "field:"),
      await sep(),
      await item("edit.duplicate", "Duplicate", undefined, "field:"),
      await item("edit.delete", "Delete", undefined, "field:"),
      await PredefinedMenuItem.new({ item: "SelectAll" }),
      await sep(),
      await item("edit.group", "Group Selection", undefined, "field:"),
      await item("edit.ungroup", "Ungroup Selection", undefined, "field:"),
      // not a canvas command, so it keeps its shortcut in a field
      ...(preferences
        ? [await sep(), await item("app.preferences", "Preferences…", "CmdOrCtrl+,", "field:")]
        : []),
    ],
  })
  return { canvas, field }
}

const followFocus = (menu: Menu, edit: { canvas: Submenu; field: Submenu }, editIndex: number): void => {
  let mode: "canvas" | "field" = "canvas"
  let chain: Promise<void> = Promise.resolve()
  const sync = () => {
    chain = chain
      .then(async () => {
        const want = isTextEntry(document.activeElement) ? "field" : "canvas"
        if (want === mode) return
        mode = want
        await menu.removeAt(editIndex)
        await menu.insert(want === "field" ? edit.field : edit.canvas, editIndex)
      })
      .catch((e) => console.error("Could not update the Edit menu", e))
  }
  document.addEventListener("focusin", sync)
  // activeElement only settles after focusout has finished dispatching
  document.addEventListener("focusout", () => setTimeout(sync, 0))

  // WebKit enables native Cut/Copy/Paste on non-editable content only when these are cancelled
  const enable = (e: Event) => {
    if (!isTextEntry(document.activeElement)) e.preventDefault()
  }
  for (const type of ["beforecopy", "beforecut", "beforepaste"]) document.addEventListener(type, enable)
  sync()
}

const checkForUpdatesItem = async (hooks: AppMenuHooks) =>
  hooks.checkForUpdates
    ? [
        await MenuItem.new({
          id: "app.checkForUpdates",
          text: "Check for Updates…",
          action: hooks.checkForUpdates,
        }),
      ]
    : []

const fileItems = async (recent: Submenu) => [
  await item("file.new", "New Tab", "CmdOrCtrl+N"),
  await item("file.open", "Open…", "CmdOrCtrl+O"),
  recent,
  await sep(),
  await item("file.closeTab", "Close Tab", "CmdOrCtrl+W"),
  await item("file.reopenClosedTab", "Reopen Closed Tab", "CmdOrCtrl+Shift+T"),
  await sep(),
  await item("file.save", "Save", "CmdOrCtrl+S"),
  await item("file.saveAs", "Save As (.nibd)…", "CmdOrCtrl+Shift+S"),
  await sep(),
  await item("file.exportImage", "Export Image (PNG, SVG)…", "CmdOrCtrl+Shift+E"),
  await item("file.importExcalidraw", "Import from Excalidraw (.excalidraw)…"),
  await item("file.exportExcalidraw", "Export to Excalidraw (.excalidraw)…"),
  await sep(),
]

// shortcuts without Cmd stay in the editor's keymap: as menu accelerators they would eat keystrokes
// (Option+S types ß) before a focused text field sees them
const viewItems = async () => [
  await item("view.zoomIn", "Zoom In", "CmdOrCtrl+="),
  await item("view.zoomOut", "Zoom Out", "CmdOrCtrl+-"),
  await item("view.zoomReset", "Actual Size", "CmdOrCtrl+0"),
  await item("view.zoomFit", "Zoom to Fit"),
  await item("view.zoomSelection", "Zoom to Selection"),
  await sep(),
  await item("view.toggleGrid", "Show Grid", "CmdOrCtrl+'"),
  await item("view.toggleSnap", "Object Snapping"),
  await item("view.toggleTheme", "Toggle Dark Mode"),
  await item("view.toggleZen", "Zen Mode"),
  await item("view.toggleViewMode", "View Mode"),
  await item("view.toggleStats", "Show Stats"),
  await sep(),
]

const tabItems = async () => [
  await item("view.nextTab", "Show Next Tab", "CmdOrCtrl+Shift+]"),
  await item("view.previousTab", "Show Previous Tab", "CmdOrCtrl+Shift+["),
]

const closeWindowItem = () =>
  MenuItem.new({ id: CLOSE_ID, text: "Close Window", accelerator: "CmdOrCtrl+Shift+W" })

const buildArrange = async () =>
  Submenu.new({
    text: "Arrange",
    items: [
      await item("arrange.bringToFront", "Bring to Front", "CmdOrCtrl+Alt+]"),
      await item("arrange.bringForward", "Bring Forward", "CmdOrCtrl+]"),
      await item("arrange.sendBackward", "Send Backward", "CmdOrCtrl+["),
      await item("arrange.sendToBack", "Send to Back", "CmdOrCtrl+Alt+["),
      await sep(),
      await item("arrange.alignLeft", "Align Left"),
      await item("arrange.alignCenterX", "Align Centre Horizontally"),
      await item("arrange.alignRight", "Align Right"),
      await item("arrange.alignTop", "Align Top"),
      await item("arrange.alignCenterY", "Align Centre Vertically"),
      await item("arrange.alignBottom", "Align Bottom"),
      await sep(),
      await item("arrange.flipH", "Flip Horizontally"),
      await item("arrange.flipV", "Flip Vertically"),
      await item("arrange.lock", "Lock / Unlock", "CmdOrCtrl+Shift+L"),
    ],
  })

const buildMac = async (hooks: AppMenuHooks, recent: Submenu) => {
  const app = await Submenu.new({
    text: "Nib",
    items: [
      await PredefinedMenuItem.new({
        item: { About: { name: "Nib", version: hooks.version } },
        text: "About Nib",
      }),
      ...(await checkForUpdatesItem(hooks)),
      await sep(),
      await PredefinedMenuItem.new({ item: "Services" }),
      await sep(),
      // the default names the running process, which under `tauri dev` is the crate's binary, not Nib
      await PredefinedMenuItem.new({ item: "Hide", text: "Hide Nib" }),
      await PredefinedMenuItem.new({ item: "HideOthers" }),
      await PredefinedMenuItem.new({ item: "ShowAll" }),
      await sep(),
      await MenuItem.new({ id: QUIT_ID, text: "Quit Nib", accelerator: "CmdOrCtrl+Q" }),
    ],
  })
  const file = await Submenu.new({
    text: "File",
    items: [...(await fileItems(recent)), await closeWindowItem()],
  })
  const edit = await buildEditMenus(false)
  const view = await Submenu.new({
    text: "View",
    items: [...(await viewItems()), await PredefinedMenuItem.new({ item: "Fullscreen" })],
  })
  const windowMenu = await Submenu.new({
    text: "Window",
    items: [
      await PredefinedMenuItem.new({ item: "Minimize" }),
      await PredefinedMenuItem.new({ item: "Maximize" }),
      await sep(),
      ...(await tabItems()),
      await sep(),
      await PredefinedMenuItem.new({ item: "BringAllToFront" }),
    ],
  })
  const help = await Submenu.new({
    text: "Help",
    items: [await item("help.shortcuts", "Keyboard Shortcuts")],
  })
  const menu = await Menu.new({
    items: [app, file, edit.canvas, view, await buildArrange(), windowMenu, help],
  })
  await menu.setAsAppMenu()
  await windowMenu.setAsWindowsMenuForNSApp().catch(() => {})
  await help.setAsHelpMenuForNSApp().catch(() => {})
  return { menu, edit, editIndex: 2 }
}

/** Linux and Windows: no app menu, so Quit ends File, Preferences ends Edit and About sits in Help. */
const buildOther = async (hooks: AppMenuHooks, recent: Submenu) => {
  const file = await Submenu.new({
    text: "File",
    items: [
      ...(await fileItems(recent)),
      await closeWindowItem(),
      await MenuItem.new({ id: QUIT_ID, text: "Quit", accelerator: "CmdOrCtrl+Q" }),
    ],
  })
  const edit = await buildEditMenus(true)
  const view = await Submenu.new({
    text: "View",
    items: [
      ...(await viewItems()),
      ...(await tabItems()),
      await sep(),
      await MenuItem.new({ id: FULLSCREEN_ID, text: "Full Screen", accelerator: "F11" }),
    ],
  })
  const help = await Submenu.new({
    text: "Help",
    items: [
      await item("help.shortcuts", "Keyboard Shortcuts"),
      ...(await checkForUpdatesItem(hooks)),
      await sep(),
      await PredefinedMenuItem.new({
        item: {
          About: { name: "Nib", version: hooks.version, comments: "An infinite hand-drawn whiteboard" },
        },
        text: "About Nib",
      }),
    ],
  })
  const menu = await Menu.new({ items: [file, edit.canvas, view, await buildArrange(), help] })
  await menu.setAsAppMenu()
  return { menu, edit, editIndex: 1 }
}

const build = async (hooks: AppMenuHooks): Promise<InstalledMenu> => {
  const recent = await Submenu.new({
    text: "Open Recent",
    items: await recentItems(hooks.recent ?? [], hooks),
  })
  const platform = hooks.platform ?? detectMenuPlatform()
  const { menu, edit, editIndex } = await (platform === "macos" ? buildMac : buildOther)(hooks, recent)
  followFocus(menu, edit, editIndex)
  return { menu, recent, hooks }
}

/**
 * Installs the native menubar once. Later calls only swap the command handler, so re-rendering callers
 * (React effects) never rebuild the menu or leave an item bound to a stale closure.
 */
export const installAppMenu = (emit: Emit, hooks: AppMenuHooks = {}): Promise<void> => {
  emitCurrent = emit
  if (!installed) {
    const pending = build(hooks)
    installed = pending
    pending.catch(() => {
      if (installed === pending) installed = null
    })
  }
  return installed.then(() => undefined)
}

/** Rebuilds File › Open Recent; a no-op until the menu is installed. */
export const updateRecentMenu = async (paths: string[]): Promise<void> => {
  if (!installed) return
  const { recent, hooks } = await installed
  for (const old of await recent.items()) {
    await recent.remove(old)
    await old.close()
  }
  await recent.append(await recentItems(paths, hooks))
}

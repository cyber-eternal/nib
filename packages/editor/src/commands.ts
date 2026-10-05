import { type EditorCore, SHORTCUTS, SHORTCUT_TOOLS, type ToolType } from "@nib/core"
import type { MenuCommand } from "@nib/platform"
import type { MenuActions } from "./ui/MainMenu"
import { type ThemeCommandOptions, themeCommands } from "./ui/panels/commandModel"

export type { MenuActions }

/** A command palette row. `shortcut` is a chord spec ("Mod+Shift+E") the palette lays out per platform. */
export interface ShellCommand {
  id: string
  label: string
  group: string
  shortcut?: string
  keywords?: readonly string[]
  disabled?: boolean
  run(): void
}

/** What the palette can do beyond the menu actions; every member is optional for older callers. */
export interface CommandExtras {
  /** The theme rows know the current theme and Match system, so none of them is a blind toggle. */
  theme?: ThemeCommandOptions
  /** The Pen row arms the pen as the user left it, the pencil when "Correct shapes" is remembered. */
  armPen?(): void
  armPencil?(): void
  copyAsPng?(): void
  copy?(): void
  cut?(): void
  paste?(): void
  eyedropper?(): void
  toggleSearch?(): void
}

const TOOL_LABELS: Partial<Record<ToolType, { label: string; keywords?: string[] }>> = {
  selection: { label: "Select", keywords: ["pointer", "move"] },
  parallelogram: { label: "Parallelogram", keywords: ["input", "output", "flowchart", "slanted", "skewed"] },
  freedraw: { label: "Pen: freehand", keywords: ["draw", "freehand", "ink", "raw"] },
  pencil: { label: "Pencil: draw and correct shapes", keywords: ["snap", "recognise", "freehand"] },
  image: { label: "Insert image", keywords: ["picture", "photo"] },
  laser: { label: "Laser pointer", keywords: ["present", "point"] },
  lasso: { label: "Lasso select", keywords: ["freeform selection"] },
  embeddable: { label: "Embed a web page", keywords: ["youtube", "figma", "iframe", "video"] },
}

const first = (id: string): string | undefined => SHORTCUTS.find((s) => s.id === id)?.keys[0]

/** Every tool row of the shortcut table. */
const toolCommands = (core: EditorCore, viewMode: boolean, extras: CommandExtras): ShellCommand[] => {
  const rows = SHORTCUTS.filter((s) => s.group === "tools" && SHORTCUT_TOOLS[s.id])
  const arm: Partial<Record<ToolType, () => void>> = { freedraw: extras.armPen, pencil: extras.armPencil }
  return rows.map((s) => {
    const tool = SHORTCUT_TOOLS[s.id]!
    const meta = TOOL_LABELS[tool]
    return {
      id: s.id,
      label: meta?.label ?? s.label,
      group: "Tools",
      shortcut: s.keys[0],
      keywords: meta?.keywords,
      disabled: viewMode && !["selection", "hand", "laser"].includes(tool),
      run: arm[tool] ?? (() => core.setTool(tool)),
    }
  })
}

/** Everything the command palette can run, in one flat searchable list. */
export const buildCommands = (
  core: EditorCore,
  run: (cmd: MenuCommand) => void,
  actions: MenuActions,
  openLink: () => void,
  extras: CommandExtras = {},
): ShellCommand[] => {
  const a = core.appState
  const view = a.viewMode
  const hasSelection = Object.keys(a.selectedElementIds).length > 0
  const hasFrames = core.scene.getNonDeleted().some((el) => el.type === "frame")
  const cmd = (
    id: string,
    label: string,
    group: string,
    fn: () => void,
    opts: { shortcut?: string; keywords?: string[]; disabled?: boolean } = {},
  ): ShellCommand => ({ id, label, group, run: fn, ...opts, shortcut: opts.shortcut ?? first(id) })
  const edit = { disabled: view }
  const editSel = { disabled: view || !hasSelection }

  const list: ShellCommand[] = [
    ...toolCommands(core, view, extras),

    cmd("file.new", "New tab", "File", actions.newDocument, { keywords: ["new drawing", "untitled"] }),
    cmd("file.open", "Open…", "File", actions.open),
    ...(actions.closeTab ? [cmd("tab.close", "Close tab", "File", actions.closeTab)] : []),
    ...(actions.reopenClosedTab
      ? [
          cmd("tab.reopen", "Reopen closed tab", "File", actions.reopenClosedTab, {
            keywords: ["undo close"],
          }),
        ]
      : []),
    ...(actions.nextTab ? [cmd("tab.next", "Next tab", "File", actions.nextTab)] : []),
    ...(actions.previousTab ? [cmd("tab.previous", "Previous tab", "File", actions.previousTab)] : []),
    cmd("file.save", "Save", "File", actions.save),
    cmd("file.saveAs", "Save as (.nibd)…", "File", actions.saveAs),
    cmd("file.export", "Export image (PNG, SVG)…", "File", actions.exportImage, { keywords: ["png", "svg"] }),
    cmd("file.importExcalidraw", "Import from Excalidraw (.excalidraw)…", "File", actions.importExcalidraw),
    cmd("file.exportExcalidraw", "Export to Excalidraw (.excalidraw)…", "File", actions.exportExcalidraw),
    cmd("file.reset", "Reset canvas…", "File", actions.resetCanvas, {
      keywords: ["clear", "erase all"],
      ...edit,
    }),

    cmd("history.undo", "Undo", "Edit", () => run("edit.undo"), edit),
    cmd("history.redo", "Redo", "Edit", () => run("edit.redo"), edit),
    cmd("edit.cut", "Cut", "Edit", extras.cut ?? (() => run("edit.cut")), editSel),
    cmd("edit.copy", "Copy", "Edit", extras.copy ?? (() => run("edit.copy")), { disabled: !hasSelection }),
    cmd("edit.paste", "Paste", "Edit", extras.paste ?? (() => run("edit.paste")), edit),
    cmd("edit.copyPng", "Copy as PNG", "Edit", extras.copyAsPng ?? (() => {}), {
      disabled: !extras.copyAsPng || !hasSelection,
    }),
    cmd("edit.copyStyle", "Copy styles", "Edit", () => run("edit.copyStyle"), { disabled: !hasSelection }),
    cmd("edit.pasteStyle", "Paste styles", "Edit", () => run("edit.pasteStyle"), editSel),
    cmd("selection.all", "Select all", "Edit", () => run("edit.selectAll"), edit),
    cmd("edit.duplicate", "Duplicate", "Edit", () => run("edit.duplicate"), editSel),
    cmd("edit.delete", "Delete selection", "Edit", () => run("edit.delete"), editSel),
    cmd("arrange.group", "Group selection", "Edit", () => run("edit.group"), editSel),
    cmd("arrange.ungroup", "Ungroup selection", "Edit", () => run("edit.ungroup"), editSel),
    cmd("edit.lock", "Lock or unlock selection", "Edit", () => run("arrange.lock"), editSel),
    cmd("edit.link", "Add link", "Edit", openLink, { keywords: ["url", "hyperlink"], ...editSel }),
    cmd("edit.unlockAll", "Unlock all elements", "Edit", () => core.unlockAll(), edit),
    cmd("arrange.tidy", "Tidy up arrows and lines", "Edit", actions.tidyUp, {
      keywords: ["straighten"],
      ...edit,
    }),
    ...(extras.eyedropper
      ? [cmd("style.eyedropper", "Pick a colour from the canvas", "Edit", extras.eyedropper, edit)]
      : []),

    cmd("arrange.front", "Bring to front", "Arrange", () => run("arrange.bringToFront"), editSel),
    cmd("arrange.forward", "Bring forward", "Arrange", () => run("arrange.bringForward"), editSel),
    cmd("arrange.backward", "Send backward", "Arrange", () => run("arrange.sendBackward"), editSel),
    cmd("arrange.back", "Send to back", "Arrange", () => run("arrange.sendToBack"), editSel),
    cmd("arrange.alignLeft", "Align left", "Arrange", () => run("arrange.alignLeft"), editSel),
    cmd(
      "arrange.alignCenterX",
      "Align centre horizontally",
      "Arrange",
      () => run("arrange.alignCenterX"),
      editSel,
    ),
    cmd("arrange.alignRight", "Align right", "Arrange", () => run("arrange.alignRight"), editSel),
    cmd("arrange.alignTop", "Align top", "Arrange", () => run("arrange.alignTop"), editSel),
    cmd(
      "arrange.alignCenterY",
      "Align centre vertically",
      "Arrange",
      () => run("arrange.alignCenterY"),
      editSel,
    ),
    cmd("arrange.alignBottom", "Align bottom", "Arrange", () => run("arrange.alignBottom"), editSel),
    cmd(
      "arrange.distributeH",
      "Distribute horizontally",
      "Arrange",
      () => core.distribute("horizontal"),
      editSel,
    ),
    cmd(
      "arrange.distributeV",
      "Distribute vertically",
      "Arrange",
      () => core.distribute("vertical"),
      editSel,
    ),
    cmd("arrange.flipH", "Flip horizontally", "Arrange", () => run("arrange.flipH"), editSel),
    cmd("arrange.flipV", "Flip vertically", "Arrange", () => run("arrange.flipV"), editSel),

    cmd("view.zoomIn", "Zoom in", "View", () => run("view.zoomIn")),
    cmd("view.zoomOut", "Zoom out", "View", () => run("view.zoomOut")),
    cmd("view.zoomReset", "Reset zoom to 100%", "View", () => run("view.zoomReset")),
    cmd("view.zoomFit", "Zoom to fit", "View", actions.zoomToFit ?? (() => run("view.zoomFit"))),
    cmd("view.zoomSelection", "Zoom to selection", "View", () => run("view.zoomSelection"), {
      disabled: !hasSelection,
    }),
    cmd("view.grid", a.gridSize ? "Hide grid" : "Show grid", "View", () => core.toggleGrid(), {
      keywords: ["snap to grid"],
    }),
    cmd("view.snap", a.objectsSnapMode ? "Turn off object snapping" : "Turn on object snapping", "View", () =>
      core.toggleSnap(),
    ),
    cmd("view.zen", a.zenMode ? "Exit zen mode" : "Zen mode", "View", () => core.toggleZen()),
    cmd("view.viewMode", view ? "Exit view mode" : "View mode", "View", () => core.toggleViewMode(), {
      keywords: ["read only"],
    }),
    cmd("view.stats", "Toggle stats", "View", actions.toggleStats),
    cmd("view.library", "Toggle library", "View", actions.toggleLibrary),
    ...(extras.toggleSearch ? [cmd("app.search", "Find on canvas", "View", extras.toggleSearch)] : []),
    cmd(
      "view.toolLock",
      a.toolLocked ? "Let tools go after drawing" : "Keep tool active after drawing",
      "View",
      () => core.toggleToolLock(),
    ),

    ...(actions.insertImage
      ? [
          cmd("insert.image", "Image…", "Insert", actions.insertImage, {
            shortcut: first("tool.image"),
            ...edit,
          }),
        ]
      : []),
    cmd("insert.mermaid", "Mermaid to diagram…", "Insert", actions.openMermaid, {
      keywords: ["flowchart", "sequence"],
      ...edit,
    }),

    ...(actions.present
      ? [
          cmd("present.start", "Present frames as slides", "Present", actions.present, {
            keywords: ["slides", "slideshow"],
            disabled: !hasFrames,
          }),
        ]
      : []),

    cmd("app.help", "Keyboard shortcuts", "Help", actions.showShortcuts),
    ...(actions.openPreferences
      ? [cmd("app.preferences", "Preferences…", "Help", actions.openPreferences, { keywords: ["settings"] })]
      : []),
  ]

  if (extras.theme) list.push(...themeCommands(extras.theme))
  return list
}

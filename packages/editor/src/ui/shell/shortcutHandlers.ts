import type { ShortcutHandlerSpec, ShortcutHandlers } from "../../hooks/useShortcuts"

/** What the shell itself runs from the keyboard; everything else falls through to core.keyDown. */
export interface ShellCommandSet {
  newDocument(): void
  open(): void
  save(): void
  saveAs(): void
  exportImage(): void
  togglePalette(): void
  toggleSearch(): void
  showHelp(): void
  openPreferences(): void
  copyStyle(): void
  pasteStyle(): void
  copyPng(): void
  addLink(): void
  toggleLock(): void
  openStrokePicker(): void
  openBackgroundPicker(): void
  startEyedropper(): void
  flipH(): void
  flipV(): void
  tidy(): void
  zoomIn(): void
  zoomOut(): void
  zoomReset(): void
  zoomFit(): void
  zoomSelection(): void
  toggleZen(): void
  toggleViewMode(): void
  toggleThemeMode(): void
  toggleStats(): void
  /** 7: the pen as the user left it, so a remembered "Correct shapes" arms the pencil. */
  armPen(): void
  armPencil(): void
  closeTab(): void
  reopenClosedTab(): void
  nextTab(): void
  previousTab(): void
  /** ⌘1 to ⌘9; 9 is the last tab. */
  goToTab(position: number): void
}

export interface ShellShortcutState {
  viewMode(): boolean
  presenting(): boolean
  /** Runs a row that edits as a keyboard step of its own (core.runKeyCommand), not inside a slider drag. */
  keyEdit?(run: () => void): void
}

type Entry = [
  id: string,
  command: Exclude<keyof ShellCommandSet, "goToTab">,
  opts?: { edits?: boolean; repeat?: boolean },
]

/** Shortcut rows the shell runs. Rows marked `edits` change the drawing and are dead in view mode. */
export const SHELL_SHORTCUTS: readonly Entry[] = [
  ["tool.pen", "armPen", { edits: true }],
  ["tool.pencil", "armPencil", { edits: true }],
  ["file.new", "newDocument"],
  ["file.open", "open"],
  ["file.save", "save"],
  ["file.saveAs", "saveAs"],
  ["file.export", "exportImage"],
  ["app.palette", "togglePalette"],
  ["app.search", "toggleSearch"],
  ["app.help", "showHelp"],
  ["app.preferences", "openPreferences"],
  ["edit.copyStyle", "copyStyle"],
  ["edit.pasteStyle", "pasteStyle", { edits: true }],
  ["edit.copyPng", "copyPng"],
  ["edit.link", "addLink", { edits: true }],
  ["edit.lock", "toggleLock", { edits: true }],
  ["style.stroke", "openStrokePicker", { edits: true }],
  ["style.background", "openBackgroundPicker", { edits: true }],
  ["style.eyedropper", "startEyedropper", { edits: true }],
  ["arrange.flipH", "flipH", { edits: true }],
  ["arrange.flipV", "flipV", { edits: true }],
  ["arrange.tidy", "tidy", { edits: true }],
  ["view.zoomIn", "zoomIn", { repeat: true }],
  ["view.zoomOut", "zoomOut", { repeat: true }],
  ["view.zoomReset", "zoomReset"],
  ["view.zoomFit", "zoomFit"],
  ["view.zoomSelection", "zoomSelection"],
  ["view.zen", "toggleZen"],
  ["view.viewMode", "toggleViewMode"],
  ["view.theme", "toggleThemeMode"],
  ["view.stats", "toggleStats"],
  ["tab.close", "closeTab"],
  ["tab.reopen", "reopenClosedTab"],
  ["tab.next", "nextTab", { repeat: true }],
  ["tab.previous", "previousTab", { repeat: true }],
]

/** The tab ⌘1 to ⌘9 name, read from the physical digit key so every layout agrees. */
export const tabPosition = (e: { code?: string; key: string }): number | null => {
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code ?? "")?.[1] ?? (/^[1-9]$/.test(e.key) ? e.key : null)
  return digit ? Number(digit) : null
}

/**
 * Copy, cut and paste never get a keydown handler: the browser's own copy/cut/paste events carry the
 * clipboard (and on desktop the native Edit menu raises them), so a plain ⌘V must stay unprevented.
 */
export const NATIVE_CLIPBOARD_SHORTCUTS: readonly string[] = ["edit.copy", "edit.cut", "edit.paste"]

/**
 * Handlers for useShortcuts. While a slide show runs every row falls through, so core gets the slide
 * keys (and K for the laser). In view mode, rows that edit are swallowed instead of run.
 */
export const buildShortcutHandlers = (
  commands: () => ShellCommandSet,
  state: ShellShortcutState,
): ShortcutHandlers => {
  const handlers: Record<string, ShortcutHandlerSpec> = {}
  for (const [id, command, opts] of SHELL_SHORTCUTS) {
    handlers[id] = {
      allowRepeat: opts?.repeat ?? false,
      run: () => {
        if (state.presenting()) return false
        if (opts?.edits && state.viewMode()) return undefined
        const run = () => commands()[command]()
        if (opts?.edits && state.keyEdit) state.keyEdit(run)
        else run()
        return undefined
      },
    }
  }
  handlers["tab.goTo"] = {
    run: (e) => {
      const position = tabPosition(e)
      if (state.presenting() || position === null) return false
      commands().goToTab(position)
      return undefined
    },
  }
  return handlers
}

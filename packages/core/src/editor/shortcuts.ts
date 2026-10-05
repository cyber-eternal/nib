import type { ToolType } from "../model/types"
import type { KeyInput } from "../tools/types"

export type ShortcutGroup = "tools" | "edit" | "arrange" | "view" | "file" | "help"

export interface Shortcut {
  readonly id: string
  readonly label: string
  /**
   * Chords such as "Mod+Shift+Z", "Alt+S", "R" or "Shift+1". `Mod` is Cmd on
   * macOS and Ctrl elsewhere; `Ctrl` is the Control key everywhere. Letters, digits and punctuation match on the
   * physical key (`KeyboardEvent.code`), so Option chords and non-Latin layouts work.
   */
  readonly keys: readonly string[]
  readonly group: ShortcutGroup
}

/** The one shortcut table: core keyboard handling, the help sheet, tooltips and menus all read it. */
export const SHORTCUTS: readonly Shortcut[] = [
  { id: "tool.selection", label: "Select", keys: ["V", "1"], group: "tools" },
  { id: "tool.hand", label: "Hand", keys: ["H"], group: "tools" },
  { id: "tool.rectangle", label: "Rectangle", keys: ["R", "2"], group: "tools" },
  { id: "tool.diamond", label: "Diamond", keys: ["D", "3"], group: "tools" },
  { id: "tool.parallelogram", label: "Parallelogram", keys: ["G"], group: "tools" },
  { id: "tool.ellipse", label: "Ellipse", keys: ["O", "4"], group: "tools" },
  { id: "tool.arrow", label: "Arrow", keys: ["A", "5"], group: "tools" },
  { id: "tool.line", label: "Line", keys: ["L", "6"], group: "tools" },
  { id: "tool.pen", label: "Pen", keys: ["7"], group: "tools" },
  { id: "tool.pencil", label: "Pencil", keys: ["P"], group: "tools" },
  { id: "tool.text", label: "Text", keys: ["T", "8"], group: "tools" },
  { id: "tool.image", label: "Image", keys: ["9"], group: "tools" },
  { id: "tool.eraser", label: "Eraser", keys: ["E", "0"], group: "tools" },
  { id: "tool.frame", label: "Frame", keys: ["F"], group: "tools" },
  { id: "tool.laser", label: "Laser pointer", keys: ["K"], group: "tools" },
  { id: "tool.lasso", label: "Lasso", keys: ["Q"], group: "tools" },
  { id: "tool.embed", label: "Embed a web page", keys: ["W"], group: "tools" },
  { id: "view.pan", label: "Pan (hold)", keys: ["Space"], group: "tools" },

  { id: "history.undo", label: "Undo", keys: ["Mod+Z"], group: "edit" },
  { id: "history.redo", label: "Redo", keys: ["Mod+Shift+Z", "Mod+Y"], group: "edit" },
  { id: "selection.all", label: "Select all", keys: ["Mod+A"], group: "edit" },
  { id: "selection.clear", label: "Deselect / cancel", keys: ["Escape"], group: "edit" },
  { id: "edit.enter", label: "Edit text or label", keys: ["Enter"], group: "edit" },
  { id: "edit.points", label: "Edit line points", keys: ["Mod+Enter"], group: "edit" },
  { id: "edit.delete", label: "Delete", keys: ["Delete", "Backspace"], group: "edit" },
  { id: "edit.duplicate", label: "Duplicate", keys: ["Mod+D"], group: "edit" },
  { id: "edit.copy", label: "Copy", keys: ["Mod+C"], group: "edit" },
  { id: "edit.cut", label: "Cut", keys: ["Mod+X"], group: "edit" },
  { id: "edit.paste", label: "Paste", keys: ["Mod+V"], group: "edit" },
  { id: "edit.copyStyle", label: "Copy styles", keys: ["Mod+Alt+C"], group: "edit" },
  { id: "edit.copyPng", label: "Copy as PNG", keys: ["Shift+Alt+C"], group: "edit" },
  { id: "edit.pasteStyle", label: "Paste styles", keys: ["Mod+Alt+V"], group: "edit" },
  { id: "edit.link", label: "Add link", keys: ["Mod+K"], group: "edit" },
  { id: "edit.lock", label: "Lock or unlock", keys: ["Mod+Shift+L"], group: "edit" },
  { id: "style.stroke", label: "Stroke colour", keys: ["Shift+S"], group: "edit" },
  { id: "style.background", label: "Background colour", keys: ["Shift+G"], group: "edit" },
  { id: "style.eyedropper", label: "Pick a colour from the canvas", keys: ["I"], group: "edit" },
  { id: "style.fontSizeUp", label: "Larger text", keys: ["Mod+Shift+."], group: "edit" },
  { id: "style.fontSizeDown", label: "Smaller text", keys: ["Mod+Shift+,"], group: "edit" },
  {
    id: "flow.addNode",
    label: "Add a connected shape",
    keys: ["Mod+ArrowRight", "Mod+ArrowDown", "Mod+ArrowLeft", "Mod+ArrowUp"],
    group: "edit",
  },
  {
    id: "flow.navigate",
    label: "Go to a connected shape",
    keys: ["Alt+ArrowRight", "Alt+ArrowDown", "Alt+ArrowLeft", "Alt+ArrowUp"],
    group: "edit",
  },
  {
    id: "edit.nudge",
    label: "Nudge",
    keys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
    group: "edit",
  },
  {
    id: "edit.nudgeFar",
    label: "Nudge further",
    keys: ["Shift+ArrowUp", "Shift+ArrowDown", "Shift+ArrowLeft", "Shift+ArrowRight"],
    group: "edit",
  },

  { id: "arrange.group", label: "Group", keys: ["Mod+G"], group: "arrange" },
  { id: "arrange.ungroup", label: "Ungroup", keys: ["Mod+Shift+G"], group: "arrange" },
  { id: "arrange.forward", label: "Bring forward", keys: ["Mod+]"], group: "arrange" },
  { id: "arrange.backward", label: "Send backward", keys: ["Mod+["], group: "arrange" },
  { id: "arrange.front", label: "Bring to front", keys: ["Mod+Alt+]"], group: "arrange" },
  { id: "arrange.back", label: "Send to back", keys: ["Mod+Alt+["], group: "arrange" },
  { id: "arrange.flipH", label: "Flip horizontal", keys: ["Shift+H"], group: "arrange" },
  { id: "arrange.flipV", label: "Flip vertical", keys: ["Shift+V"], group: "arrange" },
  { id: "arrange.tidy", label: "Tidy up connectors", keys: ["Alt+T"], group: "arrange" },
  { id: "arrange.alignLeft", label: "Align left", keys: ["Mod+Shift+ArrowLeft"], group: "arrange" },
  { id: "arrange.alignRight", label: "Align right", keys: ["Mod+Shift+ArrowRight"], group: "arrange" },
  { id: "arrange.alignTop", label: "Align top", keys: ["Mod+Shift+ArrowUp"], group: "arrange" },
  { id: "arrange.alignBottom", label: "Align bottom", keys: ["Mod+Shift+ArrowDown"], group: "arrange" },

  { id: "view.zoomIn", label: "Zoom in", keys: ["Mod+="], group: "view" },
  { id: "view.zoomOut", label: "Zoom out", keys: ["Mod+-"], group: "view" },
  { id: "view.zoomReset", label: "Reset zoom", keys: ["Mod+0"], group: "view" },
  { id: "view.zoomFit", label: "Zoom to fit", keys: ["Shift+1"], group: "view" },
  { id: "view.zoomSelection", label: "Zoom to selection", keys: ["Shift+2"], group: "view" },
  { id: "view.grid", label: "Toggle grid", keys: ["Mod+'"], group: "view" },
  { id: "view.snap", label: "Toggle object snapping", keys: ["Alt+S"], group: "view" },
  { id: "view.zen", label: "Zen mode", keys: ["Alt+Z"], group: "view" },
  { id: "view.viewMode", label: "View mode", keys: ["Alt+R"], group: "view" },
  { id: "view.theme", label: "Toggle dark canvas", keys: ["Alt+Shift+D"], group: "view" },
  { id: "view.stats", label: "Stats", keys: ["Alt+/"], group: "view" },
  { id: "view.pageUp", label: "Scroll up a page", keys: ["PageUp"], group: "view" },
  { id: "view.pageDown", label: "Scroll down a page", keys: ["PageDown"], group: "view" },
  { id: "view.pageLeft", label: "Scroll left a page", keys: ["Shift+PageUp"], group: "view" },
  { id: "view.pageRight", label: "Scroll right a page", keys: ["Shift+PageDown"], group: "view" },

  { id: "file.new", label: "New tab", keys: ["Mod+N", "Mod+T"], group: "file" },
  { id: "file.open", label: "Open", keys: ["Mod+O"], group: "file" },
  { id: "file.save", label: "Save", keys: ["Mod+S"], group: "file" },
  { id: "file.saveAs", label: "Save as", keys: ["Mod+Shift+S"], group: "file" },
  { id: "file.export", label: "Export image", keys: ["Mod+Shift+E"], group: "file" },
  { id: "tab.close", label: "Close tab", keys: ["Mod+W"], group: "file" },
  { id: "tab.reopen", label: "Reopen closed tab", keys: ["Mod+Shift+T"], group: "file" },
  // the macOS menu adds ⇧⌘] and ⇧⌘[; in the table they would shadow ⌘] and ⌘[ on layouts that type ] with Shift
  { id: "tab.next", label: "Next tab", keys: ["Ctrl+Tab", "Ctrl+PageDown"], group: "file" },
  { id: "tab.previous", label: "Previous tab", keys: ["Ctrl+Shift+Tab", "Ctrl+PageUp"], group: "file" },
  {
    id: "tab.goTo",
    label: "Go to tab 1–9",
    keys: ["Mod+1", "Mod+2", "Mod+3", "Mod+4", "Mod+5", "Mod+6", "Mod+7", "Mod+8", "Mod+9"],
    group: "file",
  },

  { id: "app.palette", label: "Command palette", keys: ["Mod+/"], group: "help" },
  { id: "app.search", label: "Find on canvas", keys: ["Mod+F"], group: "help" },
  { id: "app.help", label: "Keyboard shortcuts", keys: ["?"], group: "help" },
  { id: "app.preferences", label: "Preferences", keys: ["Mod+,"], group: "help" },
]

/** What each tool shortcut arms. */
export const SHORTCUT_TOOLS: Readonly<Record<string, ToolType>> = {
  "tool.selection": "selection",
  "tool.hand": "hand",
  "tool.rectangle": "rectangle",
  "tool.diamond": "diamond",
  "tool.parallelogram": "parallelogram",
  "tool.ellipse": "ellipse",
  "tool.arrow": "arrow",
  "tool.line": "line",
  "tool.pen": "freedraw",
  "tool.pencil": "pencil",
  "tool.text": "text",
  "tool.image": "image",
  "tool.eraser": "eraser",
  "tool.frame": "frame",
  "tool.laser": "laser",
  "tool.lasso": "lasso",
  "tool.embed": "embeddable",
}

interface Chord {
  mod: boolean
  ctrl: boolean
  shift: boolean
  alt: boolean
  key: string
}

const parseChord = (spec: string): Chord => {
  const parts = spec.split("+")
  const key = parts[parts.length - 1]!
  const mods = new Set(parts.slice(0, -1))
  return { mod: mods.has("Mod"), ctrl: mods.has("Ctrl"), shift: mods.has("Shift"), alt: mods.has("Alt"), key }
}

const PUNCTUATION_CODES: Record<string, string> = {
  "[": "BracketLeft",
  "]": "BracketRight",
  "/": "Slash",
  "'": "Quote",
  "=": "Equal",
  "-": "Minus",
  ";": "Semicolon",
  ",": "Comma",
  ".": "Period",
}

const isLatinLetter = (s: string): boolean => /^[a-z]$/i.test(s)

/** What Shift turns these keys into on the layouts the table is written for, as labels and as typed keys. */
const SHIFTED_LABELS: Readonly<Record<string, string>> = { ",": "<", ".": ">" }

const isPrintableAscii = (key: string): boolean => /^[!-~]$/.test(key)

/**
 * How punctuation is matched: "key" by the character the layout types (German "+" sits on the US "]"
 * key), "code" by the physical key, which only applies when the character can't decide.
 */
type PunctuationPass = "key" | "code"

// a typed ASCII character is the layout's own answer, except that Shift and Option move characters
// around between layouts; non-ASCII characters (ü, х, Option glyphs) say nothing about the chord
const physicalKeyMayDecide = (e: KeyInput): boolean => !isPrintableAscii(e.key) || e.altKey || e.shiftKey

const keyMatches = (token: string, e: KeyInput, pass: PunctuationPass): boolean => {
  if (token === "Space") return e.key === " " || e.code === "Space"
  if (token === "?") return e.key === "?" || (e.shiftKey && e.code === "Slash")
  if (token.length === 1 && isLatinLetter(token)) {
    // the layout's own letter wins; Option glyphs and non-Latin layouts fall back to the physical key
    if (isLatinLetter(e.key)) return e.key.toLowerCase() === token.toLowerCase()
    return e.code === `Key${token.toUpperCase()}`
  }
  if (token.length === 1 && token >= "0" && token <= "9") {
    if (e.code) return e.code === `Digit${token}` || e.code === `Numpad${token}`
    return e.key === token
  }
  const punct = PUNCTUATION_CODES[token]
  if (punct) {
    // AltGr reports Ctrl+Alt: a character it types is text, so only the physical key can name a Ctrl+Alt chord
    if (pass === "key")
      return (
        !(e.ctrlKey && e.altKey) &&
        (e.key === token ||
          (token === "=" && e.key === "+") ||
          (e.shiftKey && e.key === SHIFTED_LABELS[token]))
      )
    if (!e.code || !physicalKeyMayDecide(e)) return false
    return e.code === punct || (token === "=" && e.code === "NumpadAdd")
  }
  return pass === "key" && e.key === token
}

const chordMatches = (spec: string, e: KeyInput, mac: boolean | null, pass: PunctuationPass): boolean => {
  const c = parseChord(spec)
  // on a Mac, Ctrl+Z is not Undo; when the platform is unknown either key counts
  const mod = mac === null ? e.metaKey || e.ctrlKey : mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  // a Control chord (Ctrl+Tab) is the Control key on a Mac too, where it is not Mod
  if (c.ctrl && mac === true) {
    if (!e.ctrlKey || e.metaKey || c.mod) return false
  } else if ((c.mod || c.ctrl) !== mod) return false
  if (c.alt !== e.altKey) return false
  // "?" is Shift+/ on most layouts, so its shift state is part of the key itself
  if (c.key !== "?" && c.shift !== e.shiftKey) return false
  return keyMatches(c.key, e, pass)
}

/**
 * The id of the first shortcut whose chord matches `e`, or null. `mac` says what `Mod` is:
 * Cmd (true), Ctrl (false), or either when the platform is unknown (null, the default).
 * The whole table is tried by typed character before any punctuation falls back to its physical key,
 * so a character one row names never runs the row another layout puts on that key.
 */
export const matchShortcut = (
  e: KeyInput,
  table: readonly Shortcut[] = SHORTCUTS,
  mac: boolean | null = null,
): string | null => {
  for (const pass of ["key", "code"] as const)
    for (const s of table) {
      for (const spec of s.keys) if (chordMatches(spec, e, mac, pass)) return s.id
    }
  return null
}

/** Display string for a chord on the given platform, e.g. "⇧⌘Z" on macOS (Apple's ⌃⌥⇧⌘ order) or "Ctrl+Shift+Z" elsewhere. */
export const formatChord = (spec: string, mac: boolean): string => {
  const c = parseChord(spec)
  const keyLabel = c.key.startsWith("Arrow")
    ? { Up: "↑", Down: "↓", Left: "←", Right: "→" }[c.key.slice(5)]!
    : ((c.shift ? SHIFTED_LABELS[c.key] : undefined) ?? c.key)
  if (mac) return `${c.ctrl ? "⌃" : ""}${c.alt ? "⌥" : ""}${c.shift ? "⇧" : ""}${c.mod ? "⌘" : ""}${keyLabel}`
  return [c.mod || c.ctrl ? "Ctrl" : null, c.alt ? "Alt" : null, c.shift ? "Shift" : null, keyLabel]
    .filter(Boolean)
    .join("+")
}

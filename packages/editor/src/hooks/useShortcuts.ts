import { SHORTCUTS } from "@nib/core"
import { useEffect, useMemo, useRef } from "react"
import { isModalOpen, layerController } from "./useLayer"

/**
 * A parsed chord. `mod` is Cmd on macOS and Ctrl elsewhere; `ctrl` is the physical Control key on macOS
 * only. Letters match the layout's Latin letter, falling back to the physical key (e.code) when the layout
 * or Option produces another character; digits match on e.code; punctuation matches the typed character
 * first and e.code only as core's matchShortcut allows (R-UI-12b).
 */
export interface Chord {
  code: string
  /** Extra physical keys that count as the same chord, such as NumpadAdd for Equal. */
  altCodes: readonly string[]
  kind: "letter" | "digit" | "punct" | "named"
  /** Character the key produces, for layout-aware matching of letters and shifted punctuation. */
  char: string | null
  /** e.key value for named keys (Escape, Delete, ArrowUp, " "). */
  key: string | null
  mod: boolean
  ctrl: boolean
  shift: boolean
  alt: boolean
  /** The chord names a shifted character ("?", "+"); the layout decides which keys make it. */
  shiftImplied: boolean
}

/** A row of the shortcut table; core SHORTCUTS rows fit it. */
export interface ShortcutDef {
  id: string
  label?: string
  group?: string
  keys: string | readonly string[]
  whileTyping?: boolean
  whileModal?: boolean
}

export interface KeyLike {
  key: string
  code: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  repeat?: boolean
  isComposing?: boolean
  /** 229 while an IME owns the key; WebKit's confirming keydown says so only here (R-UI-13b). */
  keyCode?: number
  defaultPrevented?: boolean
  target?: unknown
}

/** A keydown that belongs to an IME composition, including WebKit's confirm and cancel keys. */
export const isImeKey = (e: Pick<KeyLike, "key" | "isComposing" | "keyCode">): boolean =>
  e.isComposing === true || e.key === "Process" || e.keyCode === 229

/** App commands that still run while a text field has focus. Undo, select-all and copy stay native. */
export const FIELD_SAFE_CHORDS: readonly string[] = [
  "Mod+S",
  "Mod+Shift+S",
  "Mod+O",
  "Mod+N",
  "Mod+/",
  "Mod+Shift+E",
]

const SHIFTED: Record<string, [code: string, base: string]> = {
  "?": ["Slash", "/"],
  "!": ["Digit1", "1"],
  "@": ["Digit2", "2"],
  "#": ["Digit3", "3"],
  $: ["Digit4", "4"],
  "%": ["Digit5", "5"],
  "^": ["Digit6", "6"],
  "&": ["Digit7", "7"],
  "*": ["Digit8", "8"],
  "(": ["Digit9", "9"],
  ")": ["Digit0", "0"],
  _: ["Minus", "-"],
  "+": ["Equal", "="],
  "{": ["BracketLeft", "["],
  "}": ["BracketRight", "]"],
  ":": ["Semicolon", ";"],
  '"': ["Quote", "'"],
  "<": ["Comma", ","],
  ">": ["Period", "."],
  "~": ["Backquote", "`"],
  "|": ["Backslash", "\\"],
}

const PUNCT: Record<string, string> = {
  "/": "Slash",
  "\\": "Backslash",
  "[": "BracketLeft",
  "]": "BracketRight",
  "-": "Minus",
  "=": "Equal",
  ",": "Comma",
  ".": "Period",
  ";": "Semicolon",
  "'": "Quote",
  "`": "Backquote",
}

const PUNCT_BY_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(PUNCT).map(([c, k]) => [k, c]),
)

const NUMPAD_ALIASES: Record<string, readonly string[]> = {
  Equal: ["NumpadAdd"],
  Minus: ["NumpadSubtract"],
  Slash: ["NumpadDivide"],
  Period: ["NumpadDecimal"],
}

const NAMED: Record<string, [key: string, code: string]> = {
  space: [" ", "Space"],
  enter: ["Enter", "Enter"],
  return: ["Enter", "Enter"],
  esc: ["Escape", "Escape"],
  escape: ["Escape", "Escape"],
  tab: ["Tab", "Tab"],
  backspace: ["Backspace", "Backspace"],
  delete: ["Delete", "Delete"],
  del: ["Delete", "Delete"],
  up: ["ArrowUp", "ArrowUp"],
  down: ["ArrowDown", "ArrowDown"],
  left: ["ArrowLeft", "ArrowLeft"],
  right: ["ArrowRight", "ArrowRight"],
  arrowup: ["ArrowUp", "ArrowUp"],
  arrowdown: ["ArrowDown", "ArrowDown"],
  arrowleft: ["ArrowLeft", "ArrowLeft"],
  arrowright: ["ArrowRight", "ArrowRight"],
  home: ["Home", "Home"],
  end: ["End", "End"],
  pageup: ["PageUp", "PageUp"],
  pagedown: ["PageDown", "PageDown"],
  plus: ["+", "Equal"],
  "⌫": ["Backspace", "Backspace"],
  "⌦": ["Delete", "Delete"],
  "↩": ["Enter", "Enter"],
  "⏎": ["Enter", "Enter"],
  "⎋": ["Escape", "Escape"],
  "⇥": ["Tab", "Tab"],
  "␣": [" ", "Space"],
  "↑": ["ArrowUp", "ArrowUp"],
  "↓": ["ArrowDown", "ArrowDown"],
  "←": ["ArrowLeft", "ArrowLeft"],
  "→": ["ArrowRight", "ArrowRight"],
}

const MODIFIERS: Record<string, "mod" | "ctrl" | "shift" | "alt"> = {
  mod: "mod",
  cmdorctrl: "mod",
  commandorcontrol: "mod",
  cmd: "mod",
  command: "mod",
  meta: "mod",
  super: "mod",
  "⌘": "mod",
  ctrl: "ctrl",
  control: "ctrl",
  "⌃": "ctrl",
  alt: "alt",
  option: "alt",
  opt: "alt",
  "⌥": "alt",
  shift: "shift",
  "⇧": "shift",
}

const GLYPH_MODS = new Set(["⌘", "⌃", "⌥", "⇧"])

const splitTokens = (text: string): string[] => {
  const s = text.trim()
  if (s === "+") return ["+"]
  if (!s.includes("+") || s.length === 1) {
    // glyph form such as "⌘⇧E"
    const out: string[] = []
    let rest = s
    while (rest.length > 1 && GLYPH_MODS.has(rest[0]!)) {
      out.push(rest[0]!)
      rest = rest.slice(1)
    }
    out.push(rest)
    return out
  }
  const parts = s.split("+")
  // "Mod++" splits into [..., "", ""]: the key is "+"
  if (s.endsWith("++")) return [...parts.slice(0, -2).filter(Boolean), "+"]
  return parts.map((p) => p.trim()).filter(Boolean)
}

/** Parses "Mod+Shift+E", "Alt+/", "?", "Shift+1", "Delete", "⌘D" or a raw code like "KeyV". */
export const parseChord = (text: string): Chord | null => {
  const tokens = splitTokens(text)
  if (tokens.length === 0) return null
  const keyToken = tokens[tokens.length - 1]!
  const chord: Chord = {
    code: "",
    altCodes: [],
    kind: "named",
    char: null,
    key: null,
    mod: false,
    ctrl: false,
    shift: false,
    alt: false,
    shiftImplied: false,
  }
  for (const t of tokens.slice(0, -1)) {
    const m = MODIFIERS[t.toLowerCase()]
    if (!m) return null
    chord[m] = true
  }

  const lower = keyToken.toLowerCase()
  if (/^[a-z]$/i.test(keyToken)) {
    chord.kind = "letter"
    chord.char = lower
    chord.code = `Key${keyToken.toUpperCase()}`
  } else if (/^Key[A-Z]$/.test(keyToken)) {
    chord.kind = "letter"
    chord.char = keyToken.slice(3).toLowerCase()
    chord.code = keyToken
  } else if (/^[0-9]$/.test(keyToken) || /^Digit[0-9]$/.test(keyToken)) {
    const d = keyToken.slice(-1)
    chord.kind = "digit"
    chord.char = d
    chord.code = `Digit${d}`
    chord.altCodes = [`Numpad${d}`]
  } else if (SHIFTED[keyToken] && keyToken !== "+") {
    const [code] = SHIFTED[keyToken]!
    chord.kind = "punct"
    chord.char = keyToken
    chord.code = code
    chord.shift = true
    chord.shiftImplied = true
  } else if (keyToken === "+" || lower === "plus") {
    chord.kind = "punct"
    chord.char = "+"
    chord.code = "Equal"
    chord.altCodes = ["NumpadAdd"]
    chord.shift = true
    chord.shiftImplied = true
  } else if (PUNCT[keyToken] || PUNCT_BY_CODE[keyToken]) {
    chord.kind = "punct"
    chord.code = PUNCT[keyToken] ?? keyToken
    chord.char = PUNCT_BY_CODE[chord.code] ?? null
    chord.altCodes = NUMPAD_ALIASES[chord.code] ?? []
  } else if (NAMED[lower] || NAMED[keyToken]) {
    const [key, code] = (NAMED[lower] ?? NAMED[keyToken])!
    chord.kind = "named"
    chord.key = key
    chord.code = code
    if (code === "Enter") chord.altCodes = ["NumpadEnter"]
  } else if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(keyToken)) {
    chord.kind = "named"
    chord.key = keyToken.toUpperCase()
    chord.code = keyToken.toUpperCase()
  } else {
    return null
  }
  return chord
}

const latinLetter = (e: KeyLike): string | null => {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase()
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase()
  return null
}

const sameCode = (chord: Chord, code: string): boolean => chord.code === code || chord.altCodes.includes(code)

/**
 * How punctuation is matched, as in core's matchShortcut: "key" by the character the layout types, "code"
 * by the physical key, which a router tries only when no row of the table matched by character.
 */
export type MatchPass = "key" | "code"

/** What Shift turns these keys into on the layouts the table is written for, as core reads them. */
const SHIFTED_TYPED: Readonly<Record<string, string>> = { ",": "<", ".": ">" }

// a typed ASCII character is the layout's own answer, except that Shift and Option move characters around
// between layouts; non-ASCII characters (ü, х, Option glyphs) say nothing about the chord
const physicalKeyMayDecide = (e: KeyLike): boolean => !/^[!-~]$/.test(e.key) || e.altKey || e.shiftKey

const punctMatches = (chord: Chord, e: KeyLike, pass: MatchPass): boolean => {
  if (pass === "code") return physicalKeyMayDecide(e) && sameCode(chord, e.code) && e.shiftKey === chord.shift
  // AltGr reports Ctrl+Alt: a character it types is text, so only the physical key can name a Ctrl+Alt chord
  if (chord.char === null || (e.ctrlKey && e.altKey)) return false
  if (chord.shiftImplied) return e.key === chord.char
  if (e.key === chord.char || (chord.char === "=" && e.key === "+"))
    // German and other layouts need Shift to type "/" or "=" at all (⇧7, ⇧0), so only an explicit Shift counts
    return !chord.shift || e.shiftKey
  return chord.shift && e.shiftKey && e.key === SHIFTED_TYPED[chord.char]
}

/** Whether `e` is `chord`, in one punctuation pass, or in either when `pass` is left out. */
export const matchChord = (chord: Chord, e: KeyLike, isMac: boolean, pass?: MatchPass): boolean => {
  // off macOS the Control key is the command modifier, so "Ctrl" and "Mod" collapse into one
  const wantMod = isMac ? chord.mod : chord.mod || chord.ctrl
  if ((isMac ? e.metaKey : e.ctrlKey) !== wantMod) return false
  if (isMac ? e.ctrlKey !== chord.ctrl : e.metaKey) return false
  if (e.altKey !== chord.alt) return false

  if (chord.kind === "punct")
    return pass
      ? punctMatches(chord, e, pass)
      : punctMatches(chord, e, "key") || punctMatches(chord, e, "code")
  if (pass === "code") return false
  if (chord.kind === "letter") return latinLetter(e) === chord.char && e.shiftKey === chord.shift
  if (chord.kind === "named") {
    if (e.shiftKey !== chord.shift) return false
    return e.key === chord.key || sameCode(chord, e.code)
  }
  return sameCode(chord, e.code) && e.shiftKey === chord.shift
}

const MAC_NAMED: Record<string, string> = {
  Escape: "Esc",
  Enter: "↩",
  Backspace: "⌫",
  Delete: "⌦",
  Tab: "⇥",
  " ": "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  PageUp: "PgUp",
  PageDown: "PgDn",
}

const OTHER_NAMED: Record<string, string> = {
  Escape: "Esc",
  Delete: "Del",
  " ": "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  PageUp: "PgUp",
  PageDown: "PgDn",
}

const keyLabel = (chord: Chord, isMac: boolean): string => {
  if (chord.kind === "letter") return chord.char!.toUpperCase()
  if (chord.kind === "digit" || chord.kind === "punct") return chord.char ?? chord.code
  const key = chord.key ?? chord.code
  return (isMac ? MAC_NAMED[key] : OTHER_NAMED[key]) ?? key
}

const toChord = (c: string | Chord): Chord | null => (typeof c === "string" ? parseChord(c) : c)

/** "⇧⌘E" on macOS (Apple's ⌃⌥⇧⌘ order), "Ctrl+Shift+E" elsewhere. */
export const formatChord = (c: string | Chord, isMac: boolean = isMacPlatform()): string => {
  const chord = toChord(c)
  if (!chord) return typeof c === "string" ? c : ""
  const shift = chord.shift && !chord.shiftImplied
  const key = keyLabel(chord, isMac)
  if (isMac) {
    return `${chord.ctrl ? "⌃" : ""}${chord.alt ? "⌥" : ""}${shift ? "⇧" : ""}${chord.mod ? "⌘" : ""}${key}`
  }
  return [chord.mod || chord.ctrl ? "Ctrl" : "", chord.alt ? "Alt" : "", shift ? "Shift" : "", key]
    .filter(Boolean)
    .join("+")
}

/** Value for aria-keyshortcuts, such as "Meta+Shift+E". */
export const chordToAria = (c: string | Chord, isMac: boolean = isMacPlatform()): string => {
  const chord = toChord(c)
  if (!chord) return ""
  const parts: string[] = []
  if (chord.ctrl && isMac) parts.push("Control")
  if (chord.mod || (chord.ctrl && !isMac)) parts.push(isMac ? "Meta" : "Control")
  if (chord.alt) parts.push("Alt")
  if (chord.shift && !chord.shiftImplied) parts.push("Shift")
  const key =
    chord.kind === "named"
      ? chord.key === " "
        ? "Space"
        : (chord.key ?? chord.code)
      : keyLabel(chord, isMac)
  parts.push(key)
  return parts.join("+")
}

export const isMacPlatform = (): boolean => {
  if (typeof navigator === "undefined") return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const p = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent ?? ""
  return /mac|iphone|ipad|ipod/i.test(p)
}

const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
])

interface ElementLike {
  tagName?: string
  type?: string
  isContentEditable?: boolean
  getAttribute?(name: string): string | null
  closest?(selector: string): unknown
}

const targetOf = (x: unknown): ElementLike | null => {
  if (!x || typeof x !== "object") return null
  if ("tagName" in x || "isContentEditable" in x) return x as ElementLike
  if ("target" in x) return targetOf((x as { target: unknown }).target)
  return null
}

/**
 * True when keys go into text: text-like inputs, textareas, contenteditable and custom textboxes.
 * Range, checkbox, radio, button, colour inputs and selects are not typing.
 */
export const isTypingTarget = (eventOrTarget: unknown): boolean => {
  const el = targetOf(eventOrTarget)
  if (!el) return false
  if (el.isContentEditable) return true
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : ""
  if (tag === "TEXTAREA") return true
  if (tag === "INPUT") {
    const type = (el.type || el.getAttribute?.("type") || "text").toLowerCase()
    return TEXT_INPUT_TYPES.has(type)
  }
  const role = el.getAttribute?.("role")
  return role === "textbox" || role === "searchbox" || role === "combobox"
}

const CONTROL_TAGS = new Set(["BUTTON", "SELECT", "SUMMARY", "OPTION", "INPUT", "A"])

const CONTROL_ROLES = new Set([
  "button",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "checkbox",
  "switch",
  "slider",
  "spinbutton",
  "tab",
  "treeitem",
  "gridcell",
  "scrollbar",
])

const CONTROL_KEYS = new Set([
  " ",
  "Enter",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
])

/**
 * True when an unmodified Space, Enter, arrow, Home, End or Page key belongs to the focused control
 * (activates a button, moves a slider, select or menu) rather than to the canvas.
 */
export const isControlKeyTarget = (e: KeyLike): boolean => {
  if (!CONTROL_KEYS.has(e.key) || e.metaKey || e.ctrlKey || e.altKey) return false
  const el = targetOf(e)
  if (!el) return false
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : ""
  if (tag === "A") return el.getAttribute?.("href") != null
  if (CONTROL_TAGS.has(tag)) return true
  const role = el.getAttribute?.("role")
  return role != null && CONTROL_ROLES.has(role)
}

export interface CompiledShortcut {
  def: ShortcutDef
  chord: Chord
  text: string
  fieldSafe: boolean
}

const FIELD_SAFE = FIELD_SAFE_CHORDS.map((c) => parseChord(c)!)

const sameChord = (a: Chord, b: Chord): boolean =>
  a.code === b.code && a.mod === b.mod && a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt

export const compileShortcuts = (table: readonly ShortcutDef[]): CompiledShortcut[] => {
  const out: CompiledShortcut[] = []
  for (const def of table) {
    const keys = typeof def.keys === "string" ? [def.keys] : def.keys
    for (const text of keys) {
      const chord = parseChord(text)
      if (!chord) continue
      out.push({ def, chord, text, fieldSafe: FIELD_SAFE.some((f) => sameChord(f, chord)) })
    }
  }
  return out
}

/** Return false to let the key fall through to the next match or the fallback. */
export type ShortcutRun = (e: KeyboardEvent, def: ShortcutDef) => unknown

export interface ShortcutHandlerSpec {
  run: ShortcutRun
  /** Runs while a text field has focus; defaults to the row's flag or FIELD_SAFE_CHORDS. */
  whileTyping?: boolean
  /** Runs while a modal layer is open; defaults to the row's flag or false. */
  whileModal?: boolean
  /** Runs again on key repeat; repeats are otherwise swallowed. */
  allowRepeat?: boolean
  preventDefault?: boolean
}

export type ShortcutHandlers = Readonly<Record<string, ShortcutRun | ShortcutHandlerSpec | undefined>>

export interface RouteContext {
  isMac: boolean
  modalOpen: boolean
  /** Focus is inside an open menu, popover or sheet: only tool keys and non-editing rows run. */
  inLayer?: boolean
  fallback?: (e: KeyboardEvent) => boolean
}

/** Rows that change the drawing, which a key pressed inside a menu or popover must never reach. */
const EDITING_GROUPS = new Set(["edit", "arrange"])

/** Chords whose browser events (copy, cut, paste) the app listens for, so they are never prevented. */
const NATIVE_EVENT_ROWS = new Set(["edit.copy", "edit.cut", "edit.paste"])

export type RouteResult = { action: "handled"; id: string } | { action: "fallback" } | { action: "pass" }

/**
 * The pass every row is tried in: by typed character while any row names it, else by physical key, so French
 * ⌘- (on the US "=" key) zooms out rather than in (R-UI-12b).
 */
export const matchPass = (compiled: readonly CompiledShortcut[], e: KeyLike, isMac: boolean): MatchPass =>
  compiled.some((c) => matchChord(c.chord, e, isMac, "key")) ? "key" : "code"

/** The row `e` resolves to, as core's matchShortcut resolves it. */
export const findShortcut = (
  compiled: readonly CompiledShortcut[],
  e: KeyLike,
  isMac: boolean,
): CompiledShortcut | undefined => {
  const pass = matchPass(compiled, e, isMac)
  return compiled.find((c) => matchChord(c.chord, e, isMac, pass))
}

const specOf = (h: ShortcutRun | ShortcutHandlerSpec): ShortcutHandlerSpec =>
  typeof h === "function" ? { run: h } : h

/**
 * Decides what a keydown does, in this order: shortcut table rows that have a handler, then the fallback
 * (core.keyDown). Typing targets, modal layers and keys owned by the focused control gate both.
 */
export const routeKeyDown = (
  e: KeyLike,
  compiled: readonly CompiledShortcut[],
  handlers: ShortcutHandlers,
  ctx: RouteContext,
): RouteResult => {
  if (e.defaultPrevented || isImeKey(e)) return { action: "pass" }
  const typing = isTypingTarget(e)
  const controlKey = isControlKeyTarget(e)
  const inLayer = ctx.inLayer ?? false
  const ev = e as unknown as KeyboardEvent
  const pass = matchPass(compiled, e, ctx.isMac)

  for (const entry of compiled) {
    const handler = handlers[entry.def.id]
    if (!handler || !matchChord(entry.chord, e, ctx.isMac, pass)) continue
    const spec = specOf(handler)
    const whileTyping = spec.whileTyping ?? entry.def.whileTyping ?? entry.fieldSafe
    const whileModal = spec.whileModal ?? entry.def.whileModal ?? false
    if (typing && !whileTyping) continue
    if (ctx.modalOpen && !whileModal) continue
    if (inLayer && EDITING_GROUPS.has(entry.def.group ?? "")) continue
    if (controlKey && !entry.chord.mod && !entry.chord.ctrl && !entry.chord.alt) continue
    if (e.repeat && !spec.allowRepeat) {
      ev.preventDefault?.()
      return { action: "handled", id: entry.def.id }
    }
    if (spec.run(ev, entry.def) === false) continue
    if (spec.preventDefault !== false) ev.preventDefault?.()
    return { action: "handled", id: entry.def.id }
  }

  if (typing || ctx.modalOpen || controlKey || !ctx.fallback) return { action: "pass" }
  if (inLayer) {
    // tool letters still work from chrome; everything else core runs would edit or move the drawing
    const match = compiled.find((c) => matchChord(c.chord, e, ctx.isMac, pass))
    if (match?.def.group !== "tools") {
      // the app owns the chord, so the browser's ⌘D or ⌘[ (Back) must not run in its place either
      if (match && (match.chord.mod || match.chord.ctrl) && !NATIVE_EVENT_ROWS.has(match.def.id))
        ev.preventDefault?.()
      return { action: "pass" }
    }
  }
  if (ctx.fallback(ev)) {
    ev.preventDefault?.()
    return { action: "fallback" }
  }
  return { action: "pass" }
}

/** The single shortcut table from core. */
export const coreShortcuts = (): readonly ShortcutDef[] => SHORTCUTS

/** The first chord of a row, for tooltips and menu shortcut columns. */
export const shortcutFor = (
  id: string,
  table: readonly ShortcutDef[] = coreShortcuts(),
): string | undefined => {
  const def = table.find((d) => d.id === id)
  if (!def) return undefined
  return typeof def.keys === "string" ? def.keys : def.keys[0]
}

const released = (key: string, code: string): KeyLike => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
})

/** Key-ups a window that lost focus never receives: Space ends a temporary pan, the modifiers end chords. */
export const RELEASE_KEYS: readonly KeyLike[] = [
  released(" ", "Space"),
  released("Meta", "MetaLeft"),
  released("Control", "ControlLeft"),
  released("Alt", "AltLeft"),
]

const RELEASE_KEY_NAMES = new Set([" ", "Meta", "Control", "Alt"])

/** Space and the modifiers are released whatever has focus, or a pan or chord started on the board sticks. */
export const isReleaseKey = (e: Pick<KeyLike, "key" | "code">): boolean =>
  RELEASE_KEY_NAMES.has(e.key) || e.code === "Space"

export interface UseShortcutsOptions {
  table?: readonly ShortcutDef[]
  /** Called for keys no row handled, under the same gating; return true when it consumed the key. */
  fallback?: (e: KeyboardEvent) => boolean
  /** Called on keyup outside text fields, for Space and the modifiers everywhere, and for those again on blur. */
  onKeyUp?: (e: KeyLike) => void
  enabled?: boolean
  isMac?: boolean
  /** Extra gate on top of the layer stack's modal check. */
  blocked?: () => boolean
}

/**
 * The keyboard router. Listens on window once; handlers and options are read through refs so re-renders
 * never re-bind the listeners.
 */
export const useShortcuts = (handlers: ShortcutHandlers, opts: UseShortcutsOptions = {}): void => {
  const table = opts.table
  const compiled = useMemo(() => compileShortcuts(table ?? coreShortcuts()), [table])
  const state = useRef({ handlers, opts, compiled })
  state.current = { handlers, opts, compiled }
  const enabled = opts.enabled ?? true

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return
    const onKeyDown = (e: KeyboardEvent) => {
      const { handlers: h, opts: o, compiled: c } = state.current
      routeKeyDown(e, c, h, {
        isMac: o.isMac ?? isMacPlatform(),
        modalOpen: isModalOpen() || (o.blocked?.() ?? false),
        inLayer: e.target instanceof Node && layerController.layerIndexOf(e.target) >= 0,
        fallback: o.fallback,
      })
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (!isTypingTarget(e) || isReleaseKey(e)) state.current.opts.onKeyUp?.(e)
    }
    // Cmd+Tab away while Space is held: the keyup goes to another app, so release here
    const releaseAll = () => {
      for (const k of RELEASE_KEYS) state.current.opts.onKeyUp?.(k)
    }
    const onVisibility = () => {
      if (document.visibilityState === "hidden") releaseAll()
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("blur", releaseAll)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", releaseAll)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [enabled])
}

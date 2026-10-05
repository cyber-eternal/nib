import { SHORTCUTS, matchShortcut } from "@nib/core"
import { describe, expect, it, vi } from "vitest"
import {
  type KeyLike,
  type ShortcutDef,
  chordToAria,
  compileShortcuts,
  findShortcut,
  formatChord,
  isControlKeyTarget,
  isTypingTarget,
  matchChord,
  parseChord,
  routeKeyDown,
} from "../../src/hooks/useShortcuts"

const key = (k: Partial<KeyLike> & { key: string; code: string }): KeyLike => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...k,
})

const matches = (chord: string, e: KeyLike, isMac = true) => matchChord(parseChord(chord)!, e, isMac)

const el = (tagName: string, attrs: Record<string, string> = {}, extra: Record<string, unknown> = {}) => ({
  tagName,
  type: attrs.type,
  isContentEditable: false,
  getAttribute: (n: string) => attrs[n] ?? null,
  ...extra,
})

describe("parseChord", () => {
  it("reads modifier words, glyphs and raw codes", () => {
    expect(parseChord("Mod+Shift+E")).toMatchObject({ code: "KeyE", mod: true, shift: true, alt: false })
    expect(parseChord("⌘⇧E")).toMatchObject({ code: "KeyE", mod: true, shift: true })
    expect(parseChord("Alt+/")).toMatchObject({ code: "Slash", alt: true, kind: "punct" })
    expect(parseChord("KeyV")).toMatchObject({ code: "KeyV", kind: "letter", char: "v" })
    expect(parseChord("?")).toMatchObject({ code: "Slash", shift: true, shiftImplied: true, char: "?" })
    expect(parseChord("Mod++")).toMatchObject({ code: "Equal", mod: true, char: "+" })
    expect(parseChord("Delete")).toMatchObject({ kind: "named", key: "Delete" })
    expect(parseChord("Space")).toMatchObject({ kind: "named", key: " ", code: "Space" })
    expect(parseChord("Hyper+X")).toBeNull()
  })
})

describe("punctuation that needs Shift on the layout", () => {
  it("matches the character a German ⇧7 types, for chords that name no Shift", () => {
    expect(matches("Mod+/", key({ key: "/", code: "Digit7", metaKey: true, shiftKey: true }))).toBe(true)
    expect(matches("Mod+=", key({ key: "=", code: "Digit0", metaKey: true, shiftKey: true }))).toBe(true)
    expect(matches("Alt+/", key({ key: "/", code: "Digit7", altKey: true, shiftKey: true }), false)).toBe(
      true,
    )
  })

  it("still tells an explicit Shift chord apart", () => {
    expect(matches("Mod+Shift+.", key({ key: ".", code: "Period", metaKey: true }))).toBe(false)
    expect(matches("Mod+Shift+.", key({ key: ":", code: "Period", metaKey: true, shiftKey: true }))).toBe(
      true,
    )
    expect(matches("Mod+/", key({ key: "?", code: "Slash", metaKey: true, shiftKey: true }))).toBe(false)
  })
})

describe("chord matching on macOS key/code pairs", () => {
  it("Option chords match on e.code although e.key is a symbol", () => {
    expect(matches("Alt+Z", key({ key: "Ω", code: "KeyZ", altKey: true }))).toBe(true)
    expect(matches("Alt+R", key({ key: "®", code: "KeyR", altKey: true }))).toBe(true)
    expect(matches("Alt+S", key({ key: "ß", code: "KeyS", altKey: true }))).toBe(true)
    expect(matches("Alt+T", key({ key: "†", code: "KeyT", altKey: true }))).toBe(true)
    expect(matches("Alt+Shift+D", key({ key: "Î", code: "KeyD", altKey: true, shiftKey: true }))).toBe(true)
    expect(matches("Alt+/", key({ key: "÷", code: "Slash", altKey: true }))).toBe(true)
    expect(matches("Mod+Alt+C", key({ key: "ç", code: "KeyC", altKey: true, metaKey: true }))).toBe(true)
    expect(matches("Mod+Alt+]", key({ key: "‘", code: "BracketRight", altKey: true, metaKey: true }))).toBe(
      true,
    )
  })

  it("Shift+digit matches on e.code whatever the layout prints", () => {
    expect(matches("Shift+1", key({ key: "!", code: "Digit1", shiftKey: true }))).toBe(true)
    expect(matches("Shift+2", key({ key: '"', code: "Digit2", shiftKey: true }))).toBe(true)
    expect(matches("1", key({ key: "!", code: "Digit1", shiftKey: true }))).toBe(false)
    expect(matches("1", key({ key: "1", code: "Numpad1" }))).toBe(true)
  })

  it("tool letters work on non-Latin layouts through the physical key", () => {
    expect(matches("R", key({ key: "к", code: "KeyR" }))).toBe(true)
    expect(matches("R", key({ key: "ր", code: "KeyR" }))).toBe(true)
  })

  it("Latin layouts keep their own letters (AZERTY A is on KeyQ)", () => {
    expect(matches("A", key({ key: "a", code: "KeyQ" }))).toBe(true)
    expect(matches("Q", key({ key: "a", code: "KeyQ" }))).toBe(false)
  })

  it("modifiers must match exactly", () => {
    expect(matches("Mod+Z", key({ key: "z", code: "KeyZ", metaKey: true }))).toBe(true)
    expect(matches("Mod+Shift+Z", key({ key: "z", code: "KeyZ", metaKey: true, shiftKey: true }))).toBe(true)
    expect(matches("Mod+Z", key({ key: "z", code: "KeyZ", metaKey: true, shiftKey: true }))).toBe(false)
    expect(matches("Mod+Z", key({ key: "z", code: "KeyZ", ctrlKey: true }))).toBe(false)
    expect(matches("Z", key({ key: "z", code: "KeyZ", metaKey: true }))).toBe(false)
    expect(matches("H", key({ key: "H", code: "KeyH", shiftKey: true }))).toBe(false)
    expect(matches("Shift+H", key({ key: "H", code: "KeyH", shiftKey: true }))).toBe(true)
  })

  it("Mod is Ctrl off macOS, and the Windows key never matches", () => {
    expect(matches("Mod+S", key({ key: "s", code: "KeyS", ctrlKey: true }), false)).toBe(true)
    expect(matches("Ctrl+S", key({ key: "s", code: "KeyS", ctrlKey: true }), false)).toBe(true)
    expect(matches("Mod+S", key({ key: "s", code: "KeyS", metaKey: true }), false)).toBe(false)
  })

  it("shifted characters match the character on any layout", () => {
    expect(matches("?", key({ key: "?", code: "Slash", shiftKey: true }))).toBe(true)
    expect(matches("?", key({ key: "?", code: "Comma", shiftKey: true }))).toBe(true)
    expect(matches("Mod+=", key({ key: "=", code: "Equal", metaKey: true }))).toBe(true)
    expect(matches("Mod+=", key({ key: "+", code: "NumpadAdd", metaKey: true }))).toBe(true)
    expect(matches("Mod+-", key({ key: "-", code: "Minus", metaKey: true }))).toBe(true)
  })
})

describe("formatting", () => {
  it("renders macOS glyphs in Apple order (⌃⌥⇧⌘) and other-platform words", () => {
    expect(formatChord("Mod+Shift+E", true)).toBe("⇧⌘E")
    expect(formatChord("Alt+Shift+D", true)).toBe("⌥⇧D")
    expect(formatChord("Mod+Shift+E", false)).toBe("Ctrl+Shift+E")
    expect(formatChord("?", true)).toBe("?")
    expect(formatChord("Delete", true)).toBe("⌦")
    expect(formatChord("Shift+1", true)).toBe("⇧1")
  })

  it("produces aria-keyshortcuts values", () => {
    expect(chordToAria("Mod+Shift+E", true)).toBe("Meta+Shift+E")
    expect(chordToAria("Mod+S", false)).toBe("Control+S")
    expect(chordToAria("Ctrl+S", false)).toBe("Control+S")
    expect(chordToAria("Ctrl+S", true)).toBe("Control+S")
    expect(chordToAria("R", true)).toBe("R")
    expect(chordToAria("Space", true)).toBe("Space")
  })
})

describe("isTypingTarget", () => {
  it("is true for text-like inputs, textareas and contenteditable", () => {
    for (const type of ["text", "search", "number", "url", "email", "password", "tel"]) {
      expect(isTypingTarget(el("INPUT", { type }))).toBe(true)
    }
    expect(isTypingTarget(el("INPUT"))).toBe(true)
    expect(isTypingTarget(el("TEXTAREA"))).toBe(true)
    expect(isTypingTarget(el("DIV", {}, { isContentEditable: true }))).toBe(true)
    expect(isTypingTarget(el("DIV", { role: "textbox" }))).toBe(true)
  })

  it("is false for range, checkbox, radio, button, colour inputs, select and buttons", () => {
    for (const type of ["range", "checkbox", "radio", "button", "submit", "reset", "color", "file"]) {
      expect(isTypingTarget(el("INPUT", { type }))).toBe(false)
    }
    expect(isTypingTarget(el("SELECT"))).toBe(false)
    expect(isTypingTarget(el("BUTTON"))).toBe(false)
    expect(isTypingTarget(el("CANVAS"))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })

  it("accepts an event as well as a target", () => {
    expect(isTypingTarget({ target: el("TEXTAREA") })).toBe(true)
    expect(isTypingTarget({ target: el("INPUT", { type: "range" }) })).toBe(false)
  })
})

describe("isControlKeyTarget", () => {
  it("leaves Space, Enter and arrows to the focused control", () => {
    expect(isControlKeyTarget(key({ key: " ", code: "Space", target: el("BUTTON") }))).toBe(true)
    expect(isControlKeyTarget(key({ key: "Enter", code: "Enter", target: el("BUTTON") }))).toBe(true)
    expect(isControlKeyTarget(key({ key: "ArrowUp", code: "ArrowUp", target: el("SELECT") }))).toBe(true)
    expect(
      isControlKeyTarget(
        key({ key: "ArrowLeft", code: "ArrowLeft", target: el("INPUT", { type: "range" }) }),
      ),
    ).toBe(true)
    expect(
      isControlKeyTarget(key({ key: "Enter", code: "Enter", target: el("DIV", { role: "menuitem" }) })),
    ).toBe(true)
  })

  it("does not claim letters, modified keys or the canvas", () => {
    expect(isControlKeyTarget(key({ key: "r", code: "KeyR", target: el("BUTTON") }))).toBe(false)
    expect(
      isControlKeyTarget(key({ key: "Enter", code: "Enter", metaKey: true, target: el("BUTTON") })),
    ).toBe(false)
    expect(isControlKeyTarget(key({ key: " ", code: "Space", target: el("DIV") }))).toBe(false)
    expect(isControlKeyTarget(key({ key: "Enter", code: "Enter", target: el("A") }))).toBe(false)
  })
})

describe("routeKeyDown", () => {
  const table: ShortcutDef[] = [
    { id: "file.save", keys: "Mod+S" },
    { id: "edit.undo", keys: "Mod+Z" },
    { id: "tool.rectangle", keys: ["R", "2"] },
    { id: "view.zen", keys: "Alt+Z" },
    { id: "dialog.help", keys: "?", whileModal: true },
    { id: "edit.delete", keys: ["Delete", "Backspace"] },
    { id: "hand.space", keys: "Space" },
  ]
  const compiled = compileShortcuts(table)
  const textarea = el("TEXTAREA")
  const ev = (k: Partial<KeyLike> & { key: string; code: string }) => ({ ...key(k), preventDefault: vi.fn() })
  const ctx = { isMac: true, modalOpen: false }

  it("runs app commands while typing, but leaves undo and tool letters to the field", () => {
    const save = vi.fn()
    const undo = vi.fn()
    const rect = vi.fn()
    const handlers = { "file.save": save, "edit.undo": undo, "tool.rectangle": rect }
    const s = ev({ key: "s", code: "KeyS", metaKey: true, target: textarea })
    expect(routeKeyDown(s, compiled, handlers, ctx)).toEqual({ action: "handled", id: "file.save" })
    expect(s.preventDefault).toHaveBeenCalled()
    expect(
      routeKeyDown(ev({ key: "z", code: "KeyZ", metaKey: true, target: textarea }), compiled, handlers, ctx),
    ).toEqual({
      action: "pass",
    })
    expect(
      routeKeyDown(ev({ key: "r", code: "KeyR", target: textarea }), compiled, handlers, ctx).action,
    ).toBe("pass")
    expect(undo).not.toHaveBeenCalled()
    expect(rect).not.toHaveBeenCalled()
  })

  it("keeps shortcuts alive after a slider, select or tray button had focus", () => {
    const rect = vi.fn()
    for (const target of [el("INPUT", { type: "range" }), el("SELECT"), el("BUTTON")]) {
      const r = routeKeyDown(
        ev({ key: "r", code: "KeyR", target }),
        compiled,
        { "tool.rectangle": rect },
        ctx,
      )
      expect(r.action).toBe("handled")
    }
    expect(rect).toHaveBeenCalledTimes(3)
  })

  it("blocks everything but whileModal rows while a modal is open, including the fallback", () => {
    const del = vi.fn()
    const help = vi.fn()
    const fallback = vi.fn(() => true)
    const modal = { ...ctx, modalOpen: true, fallback }
    expect(
      routeKeyDown(ev({ key: "Delete", code: "Delete" }), compiled, { "edit.delete": del }, modal).action,
    ).toBe("pass")
    expect(
      routeKeyDown(ev({ key: "?", code: "Slash", shiftKey: true }), compiled, { "dialog.help": help }, modal)
        .action,
    ).toBe("handled")
    expect(del).not.toHaveBeenCalled()
    expect(fallback).not.toHaveBeenCalled()
  })

  it("lets a focused button keep Space and Enter instead of starting the hand tool", () => {
    const hand = vi.fn()
    const fallback = vi.fn(() => true)
    const r = routeKeyDown(
      ev({ key: " ", code: "Space", target: el("BUTTON") }),
      compiled,
      { "hand.space": hand },
      { ...ctx, fallback },
    )
    expect(r.action).toBe("pass")
    expect(hand).not.toHaveBeenCalled()
    expect(fallback).not.toHaveBeenCalled()
  })

  it("hands unclaimed keys to the fallback (core.keyDown) and prevents their default when consumed", () => {
    const fallback = vi.fn(() => true)
    const e = ev({ key: "ArrowLeft", code: "ArrowLeft" })
    expect(routeKeyDown(e, compiled, {}, { ...ctx, fallback })).toEqual({ action: "fallback" })
    expect(e.preventDefault).toHaveBeenCalled()
  })

  it("falls through when a handler returns false, and swallows key repeats", () => {
    const zen = vi.fn(() => false)
    const fallback = vi.fn(() => false)
    expect(
      routeKeyDown(
        ev({ key: "Ω", code: "KeyZ", altKey: true }),
        compiled,
        { "view.zen": zen },
        { ...ctx, fallback },
      ).action,
    ).toBe("pass")
    expect(zen).toHaveBeenCalledOnce()
    expect(fallback).toHaveBeenCalledOnce()

    const toggle = vi.fn()
    const repeat = ev({ key: "Ω", code: "KeyZ", altKey: true, repeat: true })
    expect(routeKeyDown(repeat, compiled, { "view.zen": toggle }, ctx).action).toBe("handled")
    expect(toggle).not.toHaveBeenCalled()
  })

  it("ignores IME composition and keys another handler already consumed", () => {
    const rect = vi.fn()
    expect(
      routeKeyDown(
        ev({ key: "r", code: "KeyR", isComposing: true }),
        compiled,
        { "tool.rectangle": rect },
        ctx,
      ).action,
    ).toBe("pass")
    expect(
      routeKeyDown(
        ev({ key: "r", code: "KeyR", defaultPrevented: true }),
        compiled,
        { "tool.rectangle": rect },
        ctx,
      ).action,
    ).toBe("pass")
    expect(rect).not.toHaveBeenCalled()
  })
})

describe("core SHORTCUTS table", () => {
  const naturalEvent = (text: string): KeyLike => {
    const c = parseChord(text)!
    const keyValue =
      c.kind === "named"
        ? c.key!
        : c.kind === "letter"
          ? c.char!
          : c.shiftImplied
            ? c.char!
            : (c.char ?? c.code)
    return key({
      key: keyValue,
      code: c.code,
      metaKey: c.mod,
      ctrlKey: c.ctrl,
      altKey: c.alt,
      shiftKey: c.shift,
    })
  }

  it("parses every chord in the table", () => {
    for (const row of SHORTCUTS)
      for (const k of row.keys) expect(parseChord(k), `${row.id} ${k}`).not.toBeNull()
  })

  it("routes each chord to the same row as core's own matcher", () => {
    const compiled = compileShortcuts(SHORTCUTS)
    for (const row of SHORTCUTS) {
      for (const k of row.keys) {
        const e = naturalEvent(k)
        const mine = findShortcut(compiled, e, true)?.def.id
        expect(mine, k).toBe(matchShortcut(e))
      }
    }
  })
})

describe("punctuation follows core's rule: typed character first, physical key last (R-UI-12b)", () => {
  const compiled = compileShortcuts(SHORTCUTS)

  it("French Mac ⌘- (on the US = key) zooms out, as core resolves it", () => {
    const e = key({ key: "-", code: "Equal", metaKey: true })
    expect(findShortcut(compiled, e, true)?.def.id).toBe("view.zoomOut")
    expect(matchShortcut(e, SHORTCUTS, true)).toBe("view.zoomOut")
    expect(matches("Mod+=", e)).toBe(false)

    const zoomIn = vi.fn()
    const zoomOut = vi.fn()
    const result = routeKeyDown(
      { ...e, preventDefault: vi.fn() } as KeyLike,
      compiled,
      { "view.zoomIn": zoomIn, "view.zoomOut": zoomOut },
      { isMac: true, modalOpen: false },
    )
    expect(result).toEqual({ action: "handled", id: "view.zoomOut" })
    expect(zoomIn).not.toHaveBeenCalled()
  })

  it("+ counts for =, from the main row and the numpad", () => {
    expect(
      findShortcut(compiled, key({ key: "+", code: "Equal", metaKey: true, shiftKey: true }), true)?.def.id,
    ).toBe("view.zoomIn")
    expect(findShortcut(compiled, key({ key: "+", code: "NumpadAdd", metaKey: true }), true)?.def.id).toBe(
      "view.zoomIn",
    )
  })

  it("a character one row names wins over another row's physical key", () => {
    const table = compileShortcuts([
      { id: "a", keys: "Mod+Shift+." },
      { id: "b", keys: "Mod+:" },
    ])
    // German ⇧. types ":"
    const e = key({ key: ":", code: "Period", metaKey: true, shiftKey: true })
    expect(findShortcut(table, e, true)?.def.id).toBe("b")
    const a = vi.fn()
    const b = vi.fn()
    routeKeyDown(
      { ...e, preventDefault: vi.fn() } as KeyLike,
      table,
      { a, b },
      { isMac: true, modalOpen: false },
    )
    expect(b).toHaveBeenCalled()
    expect(a).not.toHaveBeenCalled()
  })

  it("falls back to the physical key only for Option, Shift and non-ASCII characters", () => {
    expect(findShortcut(compiled, key({ key: "÷", code: "Slash", altKey: true }), true)?.def.id).toBe(
      "view.stats",
    )
    expect(findShortcut(compiled, key({ key: "ü", code: "BracketLeft", metaKey: true }), true)?.def.id).toBe(
      "arrange.backward",
    )
    expect(findShortcut(compiled, key({ key: "ö", code: "Semicolon", metaKey: true }), true)).toBeUndefined()
  })
})

describe("a character AltGr types is text, not a Ctrl+Alt chord", () => {
  const altGr = { ctrlKey: true, altKey: true }

  it("German AltGr+8 and AltGr+9 are not Ctrl+Alt+[ and Ctrl+Alt+]", () => {
    expect(matches("Mod+Alt+[", key({ key: "[", code: "Digit8", ...altGr }), false)).toBe(false)
    expect(matches("Mod+Alt+]", key({ key: "]", code: "Digit9", ...altGr }), false)).toBe(false)
  })

  it("Ctrl+Alt on the bracket keys still matches, and plain Alt+/ typed with Shift still opens Stats", () => {
    expect(matches("Mod+Alt+[", key({ key: "[", code: "BracketLeft", ...altGr }), false)).toBe(true)
    expect(matches("Mod+Alt+]", key({ key: "]", code: "BracketRight", ...altGr }), false)).toBe(true)
    expect(matches("Alt+/", key({ key: "/", code: "Digit7", altKey: true, shiftKey: true }), false)).toBe(
      true,
    )
  })
})

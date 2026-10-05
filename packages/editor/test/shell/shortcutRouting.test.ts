import { EditorCore, SHORTCUTS, newElement } from "@nib/core"
import { describe, expect, it, vi } from "vitest"
import { RELEASE_KEYS, compileShortcuts, isReleaseKey, routeKeyDown } from "../../src/hooks/useShortcuts"
import {
  NATIVE_CLIPBOARD_SHORTCUTS,
  SHELL_SHORTCUTS,
  type ShellCommandSet,
  buildShortcutHandlers,
} from "../../src/ui/shell/shortcutHandlers"
import { elementTarget, keydown } from "./helpers"

const compiled = compileShortcuts(SHORTCUTS)

const setup = (state: { view?: boolean; presenting?: boolean; modal?: boolean; inLayer?: boolean } = {}) => {
  const calls: string[] = []
  const commands = new Proxy({} as ShellCommandSet, {
    get: (_t, name: string) => () => calls.push(name),
  })
  const handlers = buildShortcutHandlers(() => commands, {
    viewMode: () => state.view ?? false,
    presenting: () => state.presenting ?? false,
  })
  const fallback = vi.fn((_e: KeyboardEvent) => true)
  const route = (e: ReturnType<typeof keydown>, isMac = true) =>
    routeKeyDown(e, compiled, handlers, {
      isMac,
      modalOpen: state.modal ?? false,
      inLayer: state.inLayer ?? false,
      fallback,
    })
  return { calls, fallback, route }
}

describe("the shell's shortcut rows", () => {
  it("every row names a real shortcut id", () => {
    const ids = new Set(SHORTCUTS.map((s) => s.id))
    for (const [id] of SHELL_SHORTCUTS) expect(ids.has(id)).toBe(true)
    for (const id of NATIVE_CLIPBOARD_SHORTCUTS) expect(ids.has(id)).toBe(true)
  })

  it("never claims copy, cut or paste, which the browser's own events carry", () => {
    const claimed = new Set(SHELL_SHORTCUTS.map(([id]) => id))
    for (const id of NATIVE_CLIPBOARD_SHORTCUTS) expect(claimed.has(id)).toBe(false)
  })
})

describe("routing keydowns", () => {
  it("⌘S saves and stops the browser's Save page", () => {
    const { calls, route } = setup()
    const e = keydown({ key: "s", code: "KeyS", metaKey: true })
    expect(route(e)).toEqual({ action: "handled", id: "file.save" })
    expect(calls).toEqual(["save"])
    expect(e.prevented).toBe(true)
  })

  it("⌘S still saves while typing in a label; plain letters do not reach the shell", () => {
    const { calls, fallback, route } = setup()
    const target = elementTarget("TEXTAREA")
    route(keydown({ key: "s", code: "KeyS", metaKey: true, target }))
    route(keydown({ key: "r", code: "KeyR", target }))
    expect(calls).toEqual(["save"])
    expect(fallback).not.toHaveBeenCalled()
  })

  it("plain ⌘V is never prevented, so the paste event fires", () => {
    const { route, fallback } = setup()
    fallback.mockReturnValue(false)
    const e = keydown({ key: "v", code: "KeyV", metaKey: true })
    expect(route(e).action).toBe("pass")
    expect(e.prevented).toBe(false)
  })

  it("⌘C and ⌘X go to core (which leaves them alone) instead of a shell handler", () => {
    const { calls, route, fallback } = setup()
    fallback.mockReturnValue(false)
    route(keydown({ key: "c", code: "KeyC", metaKey: true }))
    route(keydown({ key: "x", code: "KeyX", metaKey: true }))
    expect(calls).toEqual([])
    expect(fallback).toHaveBeenCalledTimes(2)
  })

  it("Option chords match on the physical key although macOS types a symbol", () => {
    const { calls, route } = setup()
    route(keydown({ key: "Ω", code: "KeyZ", altKey: true }))
    route(keydown({ key: "®", code: "KeyR", altKey: true }))
    route(keydown({ key: "†", code: "KeyT", altKey: true }))
    route(keydown({ key: "Î", code: "KeyD", altKey: true, shiftKey: true }))
    route(keydown({ key: "÷", code: "Slash", altKey: true }))
    route(keydown({ key: "Ç", code: "KeyC", altKey: true, shiftKey: true }))
    expect(calls).toEqual([
      "toggleZen",
      "toggleViewMode",
      "tidy",
      "toggleThemeMode",
      "toggleStats",
      "copyPng",
    ])
  })

  it("⇧1 and ⇧2 work on any layout", () => {
    const { calls, route } = setup()
    route(keydown({ key: "!", code: "Digit1", shiftKey: true }))
    route(keydown({ key: '"', code: "Digit2", shiftKey: true }))
    expect(calls).toEqual(["zoomFit", "zoomSelection"])
  })

  it("? opens help and ⌘/ the palette", () => {
    const { calls, route } = setup()
    route(keydown({ key: "?", code: "Slash", shiftKey: true }))
    route(keydown({ key: "/", code: "Slash", metaKey: true }))
    expect(calls).toEqual(["showHelp", "togglePalette"])
  })

  it("⌘, opens Preferences and W arms Embed through core", () => {
    const { calls, fallback, route } = setup()
    const prefs = keydown({ key: ",", code: "Comma", metaKey: true })
    route(prefs)
    expect(calls).toEqual(["openPreferences"])
    expect(prefs.prevented).toBe(true)
    route(keydown({ key: "w", code: "KeyW" }))
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it("Ctrl is the command key off macOS", () => {
    const { calls, route } = setup()
    route(keydown({ key: "s", code: "KeyS", ctrlKey: true }), false)
    route(keydown({ key: "s", code: "KeyS", ctrlKey: true }), true)
    expect(calls).toEqual(["save"])
  })

  it("7 and P arm the pen and the pencil through the shell, which knows the remembered choice", () => {
    const { calls, fallback, route } = setup()
    route(keydown({ key: "7", code: "Digit7" }))
    route(keydown({ key: "p", code: "KeyP" }))
    expect(calls).toEqual(["armPen", "armPencil"])
    expect(fallback).not.toHaveBeenCalled()
  })

  it("⌘/ and ⌥/ work where / needs Shift, as on a German layout", () => {
    const { calls, route } = setup()
    route(keydown({ key: "/", code: "Digit7", metaKey: true, shiftKey: true }))
    route(keydown({ key: "/", code: "Digit7", altKey: true, shiftKey: true }), false)
    expect(calls).toEqual(["togglePalette", "toggleStats"])
  })

  it("⇧⌘/ on a US layout types ? and is not ⌘/", () => {
    const { calls, route } = setup()
    route(keydown({ key: "?", code: "Slash", metaKey: true, shiftKey: true }))
    expect(calls).not.toContain("togglePalette")
  })

  it("leaves a key an IME is composing alone, WebKit's 229 confirm included (R-UI-13b)", () => {
    const { calls, fallback, route } = setup()
    expect(route(keydown({ key: "Enter", code: "Enter", keyCode: 229 })).action).toBe("pass")
    expect(route(keydown({ key: "s", code: "KeyS", metaKey: true, isComposing: true })).action).toBe("pass")
    expect(calls).toEqual([])
    expect(fallback).not.toHaveBeenCalled()
  })

  it("tool letters, undo and arrows fall through to core", () => {
    const { calls, fallback, route } = setup()
    route(keydown({ key: "r", code: "KeyR" }))
    route(keydown({ key: "z", code: "KeyZ", metaKey: true }))
    route(keydown({ key: "ArrowRight", code: "ArrowRight" }))
    expect(calls).toEqual([])
    expect(fallback).toHaveBeenCalledTimes(3)
  })

  it("letters on a Cyrillic layout still reach core by their physical key", () => {
    const { fallback, route } = setup()
    route(keydown({ key: "к", code: "KeyR" }))
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it("Space and Enter on a focused button activate the button, not the canvas", () => {
    const { fallback, route } = setup()
    const target = elementTarget("BUTTON")
    expect(route(keydown({ key: " ", code: "Space", target })).action).toBe("pass")
    expect(route(keydown({ key: "Enter", code: "Enter", target })).action).toBe("pass")
    expect(fallback).not.toHaveBeenCalled()
  })

  it("a slider keeps shortcuts alive after it was dragged", () => {
    const { calls, route } = setup()
    route(
      keydown({ key: "/", code: "Slash", metaKey: true, target: elementTarget("INPUT", { type: "range" }) }),
    )
    expect(calls).toEqual(["togglePalette"])
  })

  it("zoom repeats while held; other rows swallow repeats", () => {
    const { calls, route } = setup()
    route(keydown({ key: "=", code: "Equal", metaKey: true, repeat: true }))
    route(keydown({ key: "=", code: "Equal", metaKey: true, repeat: true }))
    route(keydown({ key: "s", code: "KeyS", metaKey: true, repeat: true }))
    expect(calls).toEqual(["zoomIn", "zoomIn"])
  })
})

describe("keys pressed inside an open menu or popover", () => {
  it("never delete, duplicate, group or reorder the drawing", () => {
    const { calls, fallback, route } = setup({ inLayer: true })
    for (const e of [
      keydown({ key: "Backspace", code: "Backspace" }),
      keydown({ key: "Delete", code: "Delete" }),
      keydown({ key: "d", code: "KeyD", metaKey: true }),
      keydown({ key: "g", code: "KeyG", metaKey: true }),
      keydown({ key: "[", code: "BracketLeft", metaKey: true }),
      keydown({ key: "z", code: "KeyZ", metaKey: true }),
      keydown({ key: "H", code: "KeyH", shiftKey: true }),
      keydown({ key: "k", code: "KeyK", metaKey: true }),
    ])
      expect(route(e).action).toBe("pass")
    expect(fallback).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it("keep the browser's own ⌘D and ⌘[ (Back) from running instead, but leave ⌘C to the copy event", () => {
    const { route } = setup({ inLayer: true })
    const duplicate = keydown({ key: "d", code: "KeyD", metaKey: true })
    const back = keydown({ key: "[", code: "BracketLeft", metaKey: true })
    const copy = keydown({ key: "c", code: "KeyC", metaKey: true })
    const backspace = keydown({ key: "Backspace", code: "Backspace" })
    for (const e of [duplicate, back, copy, backspace]) route(e)
    expect([duplicate.prevented, back.prevented, copy.prevented, backspace.prevented]).toEqual([
      true,
      true,
      false,
      false,
    ])
  })

  it("still let tool letters, saving and zoom through", () => {
    const { calls, fallback, route } = setup({ inLayer: true })
    route(keydown({ key: "r", code: "KeyR" }))
    route(keydown({ key: "e", code: "KeyE" }))
    route(keydown({ key: "s", code: "KeyS", metaKey: true }))
    route(keydown({ key: "=", code: "Equal", metaKey: true }))
    route(keydown({ key: "7", code: "Digit7" }))
    expect(fallback).toHaveBeenCalledTimes(2)
    expect(calls).toEqual(["save", "zoomIn", "armPen"])
  })
})

describe("releasing held keys", () => {
  it("lists Space and the three modifiers core tracks, and knows them whatever the side", () => {
    expect(RELEASE_KEYS.map((k) => k.key)).toEqual([" ", "Meta", "Control", "Alt"])
    expect(isReleaseKey({ key: "Meta", code: "MetaRight" })).toBe(true)
    expect(isReleaseKey({ key: " ", code: "Space" })).toBe(true)
    expect(isReleaseKey({ key: "a", code: "KeyA" })).toBe(false)
  })

  it("the synthetic key-ups end a Space pan that a lost window never released", () => {
    const core = new EditorCore()
    core.keyDown({ key: " ", code: "Space", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false })
    const held = () => (core as unknown as { spaceHeld: boolean }).spaceHeld
    expect(held()).toBe(true)
    for (const k of RELEASE_KEYS) core.keyUp(k)
    expect(held()).toBe(false)
  })
})

describe("gating", () => {
  it("nothing runs behind a modal dialog", () => {
    const { calls, fallback, route } = setup({ modal: true })
    route(keydown({ key: "s", code: "KeyS", metaKey: true }))
    route(keydown({ key: "Delete", code: "Delete" }))
    route(keydown({ key: "r", code: "KeyR" }))
    expect(calls).toEqual([])
    expect(fallback).not.toHaveBeenCalled()
  })

  it("view mode swallows editing rows but keeps zoom, export and theme", () => {
    const { calls, route } = setup({ view: true })
    const flip = keydown({ key: "H", code: "KeyH", shiftKey: true })
    route(flip)
    route(keydown({ key: "k", code: "KeyK", metaKey: true }))
    route(keydown({ key: "i", code: "KeyI" }))
    route(keydown({ key: "e", code: "KeyE", metaKey: true, shiftKey: true }))
    route(keydown({ key: "0", code: "Digit0", metaKey: true }))
    expect(calls).toEqual(["exportImage", "zoomReset"])
    expect(flip.prevented).toBe(true)
  })

  it("a slide show hands every key to core's slide keys", () => {
    const { calls, fallback, route } = setup({ presenting: true })
    route(keydown({ key: "?", code: "Slash", shiftKey: true }))
    route(keydown({ key: "ArrowRight", code: "ArrowRight" }))
    route(keydown({ key: "k", code: "KeyK" }))
    expect(calls).toEqual([])
    expect(fallback).toHaveBeenCalledTimes(3)
  })
})

describe("rows that edit run as keyboard steps of their own", () => {
  const undoDepth = (core: EditorCore) =>
    (core.history as unknown as { undoStack: unknown[] }).undoStack.length

  it("only rows marked edits go through keyEdit", () => {
    const ran: string[] = []
    const keyEdit = vi.fn((run: () => void) => run())
    const commands = new Proxy({} as ShellCommandSet, { get: (_t, name: string) => () => ran.push(name) })
    const handlers = buildShortcutHandlers(() => commands, {
      viewMode: () => false,
      presenting: () => false,
      keyEdit,
    })
    const route = (e: ReturnType<typeof keydown>) =>
      routeKeyDown(e, compiled, handlers, {
        isMac: true,
        modalOpen: false,
        inLayer: false,
        fallback: () => false,
      })
    route(keydown({ key: "H", code: "KeyH", shiftKey: true }))
    route(keydown({ key: "s", code: "KeyS", metaKey: true }))
    expect(ran).toEqual(["flipH", "save"])
    expect(keyEdit).toHaveBeenCalledTimes(1)
  })

  it("⇧H after an undo mid slider drag is not folded into the drag", () => {
    const core = new EditorCore()
    const a = newElement("rectangle", { x: 0, y: 0, width: 100, height: 100, backgroundColor: "#ff0000" })
    const b = newElement("rectangle", { x: 200, y: 0, width: 60, height: 60 })
    core.insertScene([a, b], {}, [0, 0])
    core.selectAll()
    const depth = undoDepth(core)
    const commands = { flipH: () => core.flip("horizontal") } as unknown as ShellCommandSet
    const handlers = buildShortcutHandlers(() => commands, {
      viewMode: () => false,
      presenting: () => false,
      keyEdit: (run) => core.runKeyCommand(run),
    })
    const route = (e: ReturnType<typeof keydown>) =>
      routeKeyDown(e, compiled, handlers, {
        isMac: true,
        modalOpen: false,
        inLayer: false,
        fallback: (ev) => core.keyDown(ev),
      })
    core.beginTransaction()
    core.updateSelectedStyle({ opacity: 90 })
    route(keydown({ key: "z", code: "KeyZ", metaKey: true }))
    route(keydown({ key: "H", code: "KeyH", shiftKey: true }))
    expect(undoDepth(core)).toBe(depth + 1)
    core.updateSelectedStyle({ opacity: 80 })
    core.commitTransaction()
    expect(undoDepth(core)).toBe(depth + 2)
  })
})

import { beforeAll, describe, expect, test } from "vitest"
import { EditorCore, KEY_ZOOM_STEP } from "../../src/editor/editorCore"
import { matchShortcut } from "../../src/editor/shortcuts"
import type { KeyInput } from "../../src/tools/types"
import { drawShape, setupMeasurer } from "./helpers"

beforeAll(setupMeasurer)

const press = (k: string, code: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  code,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  ...mods,
})
const cmd = { metaKey: true }

describe("R-UI-12b punctuation follows the layout's own character", () => {
  test("German QWERTZ: Cmd+'+' zooms in instead of bringing forward", () => {
    // "+" sits where US "]" is
    expect(matchShortcut(press("+", "BracketRight", cmd), undefined, true)).toBe("view.zoomIn")
  })

  test("German QWERTZ: Cmd+'-' zooms out instead of opening the palette", () => {
    expect(matchShortcut(press("-", "Slash", cmd), undefined, true)).toBe("view.zoomOut")
  })

  test("German QWERTZ: Cmd+'#' matches nothing", () => {
    expect(matchShortcut(press("#", "Backslash", cmd), undefined, true)).toBeNull()
  })

  test("German QWERTZ: Cmd+Shift+'<' (which types >) steps the font size", () => {
    expect(matchShortcut(press(">", "IntlBackslash", { ...cmd, shiftKey: true }), undefined, true)).toBe(
      "style.fontSizeUp",
    )
  })

  test("French AZERTY: Cmd+')' is not zoom out, and Cmd+'-' on the 6 key is", () => {
    expect(matchShortcut(press(")", "Minus", cmd), undefined, true)).toBeNull()
    expect(matchShortcut(press("-", "Digit6", cmd), undefined, true)).toBe("view.zoomOut")
    expect(matchShortcut(press("=", "Equal", cmd), undefined, true)).toBe("view.zoomIn")
  })

  test("US layout chords and Option chords keep working", () => {
    expect(matchShortcut(press("]", "BracketRight", cmd), undefined, true)).toBe("arrange.forward")
    expect(matchShortcut(press("[", "BracketLeft", cmd), undefined, true)).toBe("arrange.backward")
    // Option turns ] into a quote mark; the physical key still decides
    expect(matchShortcut(press("‘", "BracketRight", { ...cmd, altKey: true }), undefined, true)).toBe(
      "arrange.front",
    )
    expect(matchShortcut(press("÷", "Slash", { altKey: true }), undefined, true)).toBe("view.stats")
    expect(matchShortcut(press(">", "Period", { ...cmd, shiftKey: true }), undefined, true)).toBe(
      "style.fontSizeUp",
    )
    expect(matchShortcut(press("'", "Quote", cmd), undefined, true)).toBe("view.grid")
    expect(matchShortcut(press("+", "NumpadAdd", cmd), undefined, true)).toBe("view.zoomIn")
  })

  test("the editor zooms on German Cmd+'+' and leaves the z-order alone", () => {
    const ed = new EditorCore()
    ed.macKeys = true
    ed.setViewportSize(800, 600)
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [50, 50], [150, 150])
    ed.selectElements([a.id])
    expect(ed.keyDown(press("+", "BracketRight", cmd))).toBe(true)
    expect(ed.scene.getNonDeleted().map((e) => e.id)).toEqual([a.id, b.id])
    expect(ed.appState.viewport.zoom).toBeCloseTo(KEY_ZOOM_STEP)
    expect(ed.keyDown(press("-", "Slash", cmd))).toBe(true)
    expect(ed.appState.viewport.zoom).toBeCloseTo(1)
    ed.keyDown(press("+", "BracketRight", cmd))
    expect(ed.keyDown(press("0", "Digit0", cmd))).toBe(true)
    expect(ed.appState.viewport.zoom).toBe(1)
  })
})

describe("punctuation falls back to the physical key when the layout types another character", () => {
  const ctrl = { ctrlKey: true }

  test("Russian: Ctrl+х, Ctrl+ъ, Ctrl+э and Ctrl+Shift+Ю reach their rows", () => {
    expect(matchShortcut(press("х", "BracketLeft", ctrl), undefined, false)).toBe("arrange.backward")
    expect(matchShortcut(press("ъ", "BracketRight", ctrl), undefined, false)).toBe("arrange.forward")
    expect(matchShortcut(press("э", "Quote", ctrl), undefined, false)).toBe("view.grid")
    expect(matchShortcut(press("Ю", "Period", { ...ctrl, shiftKey: true }), undefined, false)).toBe(
      "style.fontSizeUp",
    )
  })

  test("German: Cmd+ü, Cmd+ä and Cmd+Shift+, / . reach their rows", () => {
    expect(matchShortcut(press("ü", "BracketLeft", cmd), undefined, true)).toBe("arrange.backward")
    expect(matchShortcut(press("ä", "Quote", cmd), undefined, true)).toBe("view.grid")
    expect(matchShortcut(press(";", "Comma", { ...cmd, shiftKey: true }), undefined, true)).toBe(
      "style.fontSizeDown",
    )
    expect(matchShortcut(press(":", "Period", { ...cmd, shiftKey: true }), undefined, true)).toBe(
      "style.fontSizeUp",
    )
    // Option keeps the same physical key, so send-to-back and send-backward agree
    expect(matchShortcut(press("•", "BracketLeft", { ...cmd, altKey: true }), undefined, true)).toBe(
      "arrange.back",
    )
  })

  test("a character one row names wins over the row on its physical key", () => {
    expect(matchShortcut(press("+", "BracketRight", cmd), undefined, true)).toBe("view.zoomIn")
    expect(matchShortcut(press(")", "Minus", cmd), undefined, true)).toBeNull()
    // French Mac puts "-" on the US "=" key
    expect(matchShortcut(press("-", "Equal", cmd), undefined, true)).toBe("view.zoomOut")
  })

  test("the editor sends a shape backward on Russian Ctrl+х", () => {
    const ed = new EditorCore()
    ed.macKeys = false
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [50, 50], [150, 150])
    ed.selectElements([b.id])
    expect(ed.keyDown(press("х", "BracketLeft", { ctrlKey: true }))).toBe(true)
    expect(ed.scene.getNonDeleted().map((e) => e.id)).toEqual([b.id, a.id])
  })
})

describe("a character typed with AltGr never runs a Ctrl+Alt row", () => {
  const altGr = { ctrlKey: true, altKey: true }

  test("German AltGr+8 and AltGr+9 type [ and ] without reordering anything", () => {
    expect(matchShortcut(press("[", "Digit8", altGr), undefined, false)).toBeNull()
    expect(matchShortcut(press("]", "Digit9", altGr), undefined, false)).toBeNull()
  })

  test("French AltGr+5 and AltGr+) and Czech AltGr+F and AltGr+G match nothing", () => {
    expect(matchShortcut(press("[", "Digit5", altGr), undefined, false)).toBeNull()
    expect(matchShortcut(press("]", "Minus", altGr), undefined, false)).toBeNull()
    expect(matchShortcut(press("[", "KeyF", altGr), undefined, false)).toBeNull()
    expect(matchShortcut(press("]", "KeyG", altGr), undefined, false)).toBeNull()
  })

  test("Ctrl+Alt on the bracket keys still sends to back and brings to front", () => {
    expect(matchShortcut(press("[", "BracketLeft", altGr), undefined, false)).toBe("arrange.back")
    expect(matchShortcut(press("]", "BracketRight", altGr), undefined, false)).toBe("arrange.front")
  })

  test("the editor keeps the order when AltGr types a bracket", () => {
    const ed = new EditorCore()
    ed.macKeys = false
    const a = drawShape(ed, "rectangle", [0, 0], [100, 100])
    const b = drawShape(ed, "rectangle", [50, 50], [150, 150])
    ed.selectElements([b.id])
    ed.keyDown(press("[", "Digit8", altGr))
    expect(ed.scene.getNonDeleted().map((e) => e.id)).toEqual([a.id, b.id])
  })
})

import { EditorCore } from "../../src/editor/editorCore"
import type { NibElement } from "../../src/model/types"
import { setTextMeasurer } from "../../src/render/textMeasure"
import type { KeyInput, PointerInput } from "../../src/tools/types"

export const setupMeasurer = () => setTextMeasurer((t) => t.length * 10)

export const ptr = (x: number, y: number, extra: Partial<PointerInput> = {}): PointerInput => ({
  scene: [x, y],
  screen: [x, y],
  buttons: 1,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  pressure: 0.5,
  detail: 1,
  ...extra,
})

export const key = (k: string, extra: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  ...extra,
})

export const drag = (
  ed: EditorCore,
  from: [number, number],
  to: [number, number],
  mods: Partial<PointerInput> = {},
) => {
  ed.pointerDown(ptr(from[0], from[1], mods))
  ed.pointerMove(ptr((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, mods))
  ed.pointerMove(ptr(to[0], to[1], mods))
  ed.pointerUp(ptr(to[0], to[1], mods))
}

export const click = (ed: EditorCore, x: number, y: number, mods: Partial<PointerInput> = {}) => {
  ed.pointerDown(ptr(x, y, mods))
  ed.pointerUp(ptr(x, y, mods))
}

export const last = (ed: EditorCore): NibElement => {
  const els = ed.scene.getNonDeleted()
  return els[els.length - 1]!
}

export const drawShape = (
  ed: EditorCore,
  tool: "rectangle" | "ellipse" | "diamond" | "frame",
  from: [number, number],
  to: [number, number],
): NibElement => {
  ed.setTool(tool)
  drag(ed, from, to)
  return ed.scene.get(Object.keys(ed.appState.selectedElementIds)[0]!)!
}

/** Draws an arrow by dragging from one point to another and returns it. */
export const drawArrow = (ed: EditorCore, from: [number, number], to: [number, number]) => {
  ed.setTool("arrow")
  drag(ed, from, to)
  const id = Object.keys(ed.appState.selectedElementIds)[0]!
  const el = ed.scene.get(id)!
  if (el.type !== "arrow") throw new Error("expected an arrow")
  return el
}

export const addLabel = (ed: EditorCore, container: NibElement, text: string) => {
  ed.startEditingLabel(ed.scene.get(container.id)!)
  const id = ed.appState.editingTextId!
  ed.commitText(id, text)
  return id
}

export const undoDepth = (ed: EditorCore): number => {
  let n = 0
  const h = ed.history as unknown as { undoStack: unknown[] }
  n = h.undoStack.length
  return n
}

export const newEditor = () => new EditorCore()

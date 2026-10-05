import type { StyleGroup } from "./model"

type Handler = (group: StyleGroup) => boolean

const handlers = new Set<Handler>()

/**
 * Opens a style-bar popover from outside the bar, for the ⇧S (stroke) and ⇧G (background) shortcuts.
 * Returns false when no bar is showing that group, so the caller can fall through.
 */
export const openStyleGroup = (group: StyleGroup): boolean => {
  for (const h of handlers) if (h(group)) return true
  return false
}

export const onStyleGroupRequest = (h: Handler): (() => void) => {
  handlers.add(h)
  return () => handlers.delete(h)
}

export type BoardPickTarget = "stroke" | "background"

type BoardPicker = (target: BoardPickTarget) => void

let boardPicker: BoardPicker | null = null

/**
 * The shell's eyedropper (I): the next click on a shape takes its stored colour. The colour panel uses
 * it in place of the browser's screen picker, which WebKit (the desktop app) lacks.
 */
export const setBoardColorPicker = (picker: BoardPicker): (() => void) => {
  boardPicker = picker
  return () => {
    if (boardPicker === picker) boardPicker = null
  }
}

export const boardColorPickerAvailable = (): boolean => boardPicker !== null

export const pickColorFromBoard = (target: BoardPickTarget): boolean => {
  if (!boardPicker) return false
  boardPicker(target)
  return true
}

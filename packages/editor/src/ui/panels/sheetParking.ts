import type { EditorCore } from "@nib/core"

type PresentingCore = Pick<EditorCore, "presentation">

/**
 * True while a sheet unmounts because a slide show started, not because it was closed: the show unmounts
 * the side sheets and mounts them again when it ends, so their state must outlive it.
 */
export const unmountedByShow = (core: PresentingCore): boolean => core.presentation !== null

const boxes = new WeakMap<object, Map<string, { current: unknown }>>()

/** A mutable box per core and key that survives the sheet's remounts. */
export const sheetBox = <T>(core: PresentingCore, key: string, init: () => T): { current: T } => {
  let map = boxes.get(core)
  if (!map) {
    map = new Map()
    boxes.set(core, map)
  }
  let box = map.get(key)
  if (!box) {
    box = { current: init() }
    map.set(key, box)
  }
  return box as { current: T }
}

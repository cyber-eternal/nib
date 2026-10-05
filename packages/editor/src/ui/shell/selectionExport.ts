import type { EditorCore, NibElement } from "@nib/core"

/**
 * The selection as a copy or an image of it holds it: a selected frame brings its contents and their
 * labels (T2-01b), in scene order so the stacking survives.
 */
export const selectionWithFrames = (core: EditorCore): NibElement[] => {
  const selected = core.selectedElements({ includeBoundText: true })
  if (selected.length === 0) return []
  const ids = core.withFrameChildren(selected)
  for (const id of [...ids]) {
    for (const bound of core.scene.get(id)?.boundElements ?? []) if (bound.type === "text") ids.add(bound.id)
  }
  return core.scene.getNonDeleted().filter((el) => ids.has(el.id))
}

import { type EditorCore, type NibElement, SHORTCUTS } from "@nib/core"
import { hasEdges, hasStrokeStyle, isFillable, isOutlined, isStroked } from "./model"

/** Which selected elements a style key may touch; core leaves the rest of the filtering to itself. */
const TARGETS: Readonly<Record<string, (el: NibElement) => boolean>> = {
  strokeColor: isStroked,
  backgroundColor: isFillable,
  fillStyle: isFillable,
  strokeWidth: isOutlined,
  strokeStyle: hasStrokeStyle,
  roughness: hasStrokeStyle,
  roundness: hasEdges,
}

/**
 * Applies a style patch as one undo step to only the selected elements it means something for, so
 * Edges never re-curves an arrow and a fill never lands on an open line or a frame.
 * The patch still becomes the default for the next element.
 */
export const applyStyle = (core: EditorCore, patch: Record<string, unknown>): void => {
  const keys = Object.keys(patch)
  const accepts = (el: NibElement) => keys.every((k) => TARGETS[k]?.(el) ?? true)
  const selected = core.selectedElements()
  const subset = selected.filter(accepts)
  if (selected.length === 0 || subset.length === selected.length) {
    core.updateSelectedStyle(patch)
    return
  }
  if (subset.length === 0) return
  const { selectedElementIds, selectedGroupIds } = core.appState
  const ids: Record<string, true> = {}
  for (const el of subset) ids[el.id] = true
  core.beginTransaction()
  try {
    // a raw id set, not selectElements: group expansion would pull the excluded members back in
    core.setAppState({ selectedElementIds: ids, selectedGroupIds: {} })
    core.updateSelectedStyle(patch)
  } finally {
    core.setAppState({ selectedElementIds, selectedGroupIds })
    core.commitTransaction()
  }
}

/** First chord of a row in the core shortcut table, for menus and tooltips. */
export const shortcutFor = (id: string): string | undefined => SHORTCUTS.find((s) => s.id === id)?.keys[0]

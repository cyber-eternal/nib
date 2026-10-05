import {
  type EditorCore,
  type LibraryItem,
  type Point,
  createLibraryItem,
  mergeLibraryItems,
} from "@nib/core"
import { insertElements } from "../../document/clipboard"

/** A tile's accessible name: the item's own name, else its place in the library. */
export const libraryItemLabel = (item: LibraryItem, index: number): string =>
  item.name?.trim() || `Library item ${index + 1}`

/** Renames one item; an empty name clears it so the tile falls back to its number. */
export const renameLibraryItem = (items: readonly LibraryItem[], id: string, name: string): LibraryItem[] => {
  const label = name.trim().slice(0, 200)
  return items.map((item) => {
    if (item.id !== id) return item
    const { name: _old, ...rest } = item
    return label ? { ...rest, name: label } : rest
  })
}

export interface RemovedItem {
  item: LibraryItem
  index: number
}

export const removeLibraryItem = (
  items: readonly LibraryItem[],
  id: string,
): { items: LibraryItem[]; removed: RemovedItem | null } => {
  const index = items.findIndex((i) => i.id === id)
  if (index < 0) return { items: [...items], removed: null }
  return { items: items.filter((_, i) => i !== index), removed: { item: items[index]!, index } }
}

/** Puts a removed item back where it was (the undo in the removal toast); a no-op if it is already there. */
export const restoreLibraryItem = (items: readonly LibraryItem[], removed: RemovedItem): LibraryItem[] => {
  if (items.some((i) => i.id === removed.item.id)) return [...items]
  const next = [...items]
  next.splice(Math.min(removed.index, next.length), 0, removed.item)
  return next
}

/** Items whose name contains the query, with their original positions (for "Library item N"). */
export const filterLibraryItems = (
  items: readonly LibraryItem[],
  query: string,
): { item: LibraryItem; index: number }[] => {
  const q = query.trim().toLocaleLowerCase()
  const all = items.map((item, index) => ({ item, index }))
  if (!q) return all
  return all.filter(({ item, index }) => libraryItemLabel(item, index).toLocaleLowerCase().includes(q))
}

/**
 * The single add path: the selection with its labels and image files, as one new item in front.
 * Returns null when nothing is selected or the same item is already in the library.
 */
export const addSelectionToLibrary = (
  core: EditorCore,
  items: readonly LibraryItem[],
  name?: string,
): LibraryItem[] | null => {
  const selection = core.selectedElements({ includeBoundText: true })
  if (selection.length === 0) return null
  const ids = core.withFrameChildren(selection)
  const elements = core.scene.getNonDeleted().filter((e) => ids.has(e.id))
  const next = mergeLibraryItems(items, [createLibraryItem(elements, core.scene.files, name)])
  return next.length === items.length ? null : next
}

/** Drops a copy of the item on the canvas, centred on `at` (default: the middle of the view). */
export const insertLibraryItem = (core: EditorCore, item: LibraryItem, at?: Point): void => {
  insertElements(core, item.elements, item.files ?? {}, at ?? core.viewportCenter())
}

/** True for a dragged file that looks like an Excalidraw library. */
export const isLibraryFileName = (name: string): boolean => /\.excalidrawlib$/i.test(name)

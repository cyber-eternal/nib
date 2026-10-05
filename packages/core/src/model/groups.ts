import type { AppState, NibElement } from "./types"

/** Outermost group of `el` that is not already being edited. */
export const outermostGroupId = (el: NibElement, editingGroupId: string | null): string | null => {
  if (el.groupIds.length === 0) return null
  if (!editingGroupId) return el.groupIds[el.groupIds.length - 1] ?? null
  const idx = el.groupIds.indexOf(editingGroupId)
  if (idx <= 0) return null
  return el.groupIds[idx - 1] ?? null
}

export const elementsInGroup = (elements: readonly NibElement[], groupId: string): NibElement[] =>
  elements.filter((e) => e.groupIds.includes(groupId))

const isBoundText = (el: NibElement): boolean => el.type === "text" && el.containerId !== null

/**
 * Expands a raw selection so that picking one member picks its whole group.
 * Locked members stay put, and labels are never selected on their own: they
 * travel with their container.
 */
export const expandSelectionToGroups = (
  elements: readonly NibElement[],
  selectedIds: Readonly<Record<string, true>>,
  editingGroupId: string | null,
): { selectedElementIds: Record<string, true>; selectedGroupIds: Record<string, true> } => {
  const selectedElementIds: Record<string, true> = {}
  const selectedGroupIds: Record<string, true> = {}
  const groupsToAdd = new Set<string>()

  for (const el of elements) {
    if (!selectedIds[el.id] || isBoundText(el)) continue
    const gid = outermostGroupId(el, editingGroupId)
    if (gid) groupsToAdd.add(gid)
    else selectedElementIds[el.id] = true
  }
  if (groupsToAdd.size === 0) return { selectedElementIds, selectedGroupIds }

  for (const gid of groupsToAdd) selectedGroupIds[gid] = true
  // one pass over the scene, not one per group: marquees over many groups stay linear
  for (const el of elements) {
    if (el.isDeleted || el.locked || isBoundText(el)) continue
    for (const g of el.groupIds) {
      if (groupsToAdd.has(g)) {
        selectedElementIds[el.id] = true
        break
      }
    }
  }
  return { selectedElementIds, selectedGroupIds }
}

export const getSelectedElements = (
  elements: readonly NibElement[],
  appState: Pick<AppState, "selectedElementIds">,
  opts: { includeBoundText?: boolean } = {},
): NibElement[] => {
  const selected = elements.filter((e) => !e.isDeleted && appState.selectedElementIds[e.id])
  if (!opts.includeBoundText) return selected
  const ids = new Set(selected.map((e) => e.id))
  let byId: Map<string, NibElement> | null = null
  for (const el of [...selected]) {
    for (const bound of el.boundElements ?? []) {
      if (!bound || bound.type !== "text" || ids.has(bound.id)) continue
      byId ??= new Map(elements.map((e) => [e.id, e]))
      const text = byId.get(bound.id)
      if (text && !text.isDeleted) {
        selected.push(text)
        ids.add(text.id)
      }
    }
  }
  return selected
}

import {
  type AppState,
  type NibElement,
  type Point,
  elementAtPoint,
  elementCenter,
  hitTestHandles,
  rotatePoint,
  selectionHandleSet,
} from "@nib/core"

export type ContextSelection = { kind: "keep" } | { kind: "clear" } | { kind: "select"; id: string }

export interface ContextTargetResult {
  /** The element under the pointer, locked ones included, or null for empty board. */
  element: NibElement | null
  selection: ContextSelection
}

/**
 * Right-click acts on what is under the pointer. An element already in the selection keeps it
 * (so a group or multi-selection menu still applies to all of it); another element becomes the selection;
 * empty board and locked elements, which cannot be selected, clear it. View mode never changes selection.
 */
export const resolveContextTarget = (
  elements: readonly NibElement[],
  p: Point,
  zoom: number,
  appState: Pick<AppState, "selectedElementIds" | "editingGroupId" | "viewMode">,
): ContextTargetResult => {
  const element = elementAtPoint(elements, p, zoom, appState, { includeLocked: true })
  const hasSelection = Object.keys(appState.selectedElementIds).length > 0
  if (appState.viewMode) return { element, selection: { kind: "keep" } }
  if (!element || element.locked)
    return { element, selection: hasSelection ? { kind: "clear" } : { kind: "keep" } }
  if (appState.selectedElementIds[element.id]) return { element, selection: { kind: "keep" } }
  return { element, selection: { kind: "select", id: element.id } }
}

/** Screen px from the element's top-right corner to the link badge the renderer draws (drawElement). */
export const LINK_BADGE_OFFSET = 16
/** Screen px around the badge centre that count as a click on it; larger than the 4.5px dot on purpose. */
export const LINK_BADGE_HIT = 10

export const linkBadgeCenter = (el: NibElement, zoom: number): Point => {
  const z = zoom > 0 ? zoom : 1
  const local: Point = [el.x + el.width + LINK_BADGE_OFFSET / z, el.y - LINK_BADGE_OFFSET / z]
  return el.angle ? rotatePoint(local, elementCenter(el), el.angle) : local
}

/** The topmost linked element whose badge is under `p`, for click-to-open. */
export const linkBadgeAt = (elements: readonly NibElement[], p: Point, zoom: number): NibElement | null => {
  const r = LINK_BADGE_HIT / (zoom > 0 ? zoom : 1)
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]!
    if (el.isDeleted || !el.link || el.type === "embeddable") continue
    const c = linkBadgeCenter(el, zoom)
    if (Math.hypot(p[0] - c[0], p[1] - c[1]) <= r) return el
  }
  return null
}

/** Whether `p` is on a resize or rotate handle of the selection, as the selection tool will grab it. */
export const pressHitsHandle = (
  selected: readonly NibElement[],
  p: Point,
  zoom: number,
  croppingElementId: string | null = null,
): boolean => {
  const set = selectionHandleSet(selected, zoom, { croppingElementId })
  return !!set && hitTestHandles(set, p, zoom) !== null
}

/**
 * The link a click at `p` should follow: a badge, or (with ⌘/Ctrl or in view mode) the element's body.
 * `selected` is the selection whose handles are live: the badge sits over the NE handle, which wins.
 */
export const linkToFollow = (
  elements: readonly NibElement[],
  p: Point,
  zoom: number,
  appState: Pick<AppState, "editingGroupId" | "viewMode"> & { croppingElementId?: string | null },
  modifier: boolean,
  selected: readonly NibElement[] = [],
): string | null => {
  if (selected.length > 0 && pressHitsHandle(selected, p, zoom, appState.croppingElementId ?? null))
    return null
  const badge = linkBadgeAt(elements, p, zoom)
  if (badge?.link) return badge.link
  if (!modifier && !appState.viewMode) return null
  const hit = elementAtPoint(elements, p, zoom, appState, { includeLocked: true })
  return hit?.link ?? null
}

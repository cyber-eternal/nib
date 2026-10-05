import type { EditorCore } from "../editor/editorCore"
import { getElementBounds } from "../geometry/elementBounds"
import { type PointsElement, absolutePointsOf, rebaseFromPoints } from "../geometry/linear"
import { computePointSnap, snapToGrid } from "../geometry/snapping"
import { boundsContainBounds } from "../math/bounds"
import { type Point, rotatePoint } from "../math/vector"
import { mutateElement } from "../model/element"
import type { LinearElement, NibElement } from "../model/types"

export { absolutePointsOf, rebaseFromPoints } from "../geometry/linear"

/** Re-anchors an element after its own points were edited in place. */
export const normalizeLinear = <T extends LinearElement>(el: T): T =>
  el.points.length === 0 ? el : rebaseFromPoints(el, absolutePointsOf(el))

export const sizeFromPoints = <T extends PointsElement>(el: T): T =>
  el.points.length === 0 ? el : rebaseFromPoints(el, absolutePointsOf(el))

/**
 * Rotates a points-based element about `centre` by baking the rotation into
 * its points, so it keeps angle 0 and every solver sees what is drawn.
 */
export const rotatePointsElement = <T extends PointsElement & { angle: number }>(
  el: T,
  centre: Point,
  delta: number,
): T => {
  const rotated = absolutePointsOf(el).map((p) => rotatePoint(p, centre, delta))
  const flat = el.angle === 0 ? el : mutateElement(el as never, { angle: 0 } as never)
  return rebaseFromPoints(flat as T, rotated)
}

export const frameAtPoint = (elements: readonly NibElement[], p: Point): NibElement | null => {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]!
    if (el.type !== "frame" || el.isDeleted) continue
    if (p[0] >= el.x && p[0] <= el.x + el.width && p[1] >= el.y && p[1] <= el.y + el.height) return el
  }
  return null
}

/** The frame a new element belongs to: the one containing its centre. */
export const frameIdFor = (elements: readonly NibElement[], el: NibElement): string | null => {
  if (el.type === "frame") return null
  const b = getElementBounds(el)
  const frame = frameAtPoint(elements, [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2])
  return frame && frame.id !== el.id ? frame.id : null
}

export const elementsInFrame = (elements: readonly NibElement[], frame: NibElement): NibElement[] => {
  const fb = getElementBounds(frame)
  return elements.filter(
    (el) => el.id !== frame.id && !el.isDeleted && boundsContainBounds(fb, getElementBounds(el)),
  )
}

export const childrenOfFrame = (elements: readonly NibElement[], frameId: string): NibElement[] =>
  elements.filter((el) => el.frameId === frameId && !el.isDeleted)

/**
 * `next` (computed from an earlier copy of the element) applied on top of the
 * current `cur`, so the version moves forward whenever the content differs
 * from what is in the scene, including a return to the earlier content.
 */
export const adoptChanges = <T extends NibElement>(cur: T, next: T): T => {
  if (cur === next) return cur
  const patch: Record<string, unknown> = {}
  const c = cur as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(next)) {
    if (key === "id" || key === "type" || key === "version" || key === "versionNonce" || key === "updated")
      continue
    if (c[key] !== value) patch[key] = value
  }
  return mutateElement(cur, patch as Partial<Omit<T, "id" | "type">>)
}

export const isBoundText = (el: NibElement): boolean => el.type === "text" && el.containerId !== null

/**
 * What a moving, resized or new element can snap to: everything except frames
 * and what travels with `moving` (their labels and the arrows bound to them).
 */
export const snapTargets = (elements: readonly NibElement[], moving: ReadonlySet<string>): NibElement[] =>
  elements.filter((e) => {
    if (e.isDeleted || moving.has(e.id) || e.type === "frame") return false
    if (e.type === "text" && e.containerId && moving.has(e.containerId)) return false
    if (
      e.type === "arrow" &&
      ((e.startBinding && moving.has(e.startBinding.elementId)) ||
        (e.endBinding && moving.has(e.endBinding.elementId)))
    )
      return false
    return true
  })

/**
 * Snaps a point being drawn or dragged (a shape's corner, a line end, a resize
 * handle) to the edges, centres and line vertices of the other elements while
 * object snapping is on, and to the grid on any axis nothing pulled. Holding
 * ⌘ or Ctrl inverts both, as it does for moves. Shows the guides it used.
 */
export const snapDrawPoint = (
  ed: EditorCore,
  at: Point,
  mods: { metaKey: boolean; ctrlKey: boolean },
  exclude: ReadonlySet<string>,
  axes: { readonly x: boolean; readonly y: boolean } = { x: true, y: true },
): Point => {
  const invert = mods.metaKey || mods.ctrlKey
  const grid = invert ? null : ed.appState.gridSize
  if (ed.appState.objectsSnapMode === invert) {
    ed.setSnapLines([])
    const g = snapToGrid(at, grid)
    return [axes.x ? g[0] : at[0], axes.y ? g[1] : at[1]]
  }
  const others = snapTargets(ed.scene.getNonDeleted(), exclude)
  const snap = computePointSnap(at, others, ed.appState.viewport.zoom, { axes, gridSize: grid })
  ed.setSnapLines(snap.lines)
  return snap.point
}

/** ⌘ or Ctrl held while placing an arrow end leaves that end unbound. */
export const suppressesBinding = (mods: { metaKey: boolean; ctrlKey: boolean }): boolean =>
  mods.metaKey || mods.ctrlKey

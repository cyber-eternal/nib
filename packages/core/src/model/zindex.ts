import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing"
import { outermostGroupId } from "./groups"
import type { NibElement } from "./types"

export const indexBetween = (a: string | null, b: string | null): string => generateKeyBetween(a, b)

export const indicesBetween = (a: string | null, b: string | null, n: number): string[] =>
  generateNKeysBetween(a, b, n)

const KEY_CHARS = /^[0-9A-Za-z]+$/

/** True when `key` is a well-formed fractional index that new keys can be generated after. */
export const isValidIndex = (key: unknown): key is string => {
  if (typeof key !== "string" || !KEY_CHARS.test(key)) return false
  try {
    generateKeyBetween(key, null)
    return true
  } catch {
    return false
  }
}

export const compareIndex = (a: NibElement, b: NibElement): number =>
  a.index < b.index ? -1 : a.index > b.index ? 1 : 0

type MoveTarget = "front" | "back" | "forward" | "backward"

const hasTies = (ordered: readonly NibElement[]): boolean =>
  ordered.some((e, i) => i > 0 && e.index <= ordered[i - 1]!.index)

/**
 * What a step hops over as one: `el`, the rest of its outermost group (inside `editingGroupId`),
 * and each container with its label, so a step never splits a group or slips a shape between a
 * container and its words. Moving elements are never part of it.
 */
const stepUnit = (
  live: readonly NibElement[],
  byId: ReadonlyMap<string, NibElement>,
  el: NibElement,
  movingIds: ReadonlySet<string>,
  editingGroupId: string | null,
): Set<string> => {
  const alive = (id: string | null | undefined): NibElement | null => {
    const found = id ? byId.get(id) : undefined
    return found && !found.isDeleted ? found : null
  }
  const unit = new Set([el.id])
  const container = el.type === "text" ? alive(el.containerId) : null
  if (container) unit.add(container.id)
  const gid = outermostGroupId(container ?? el, editingGroupId)
  if (gid) for (const other of live) if (other.groupIds.includes(gid)) unit.add(other.id)
  for (const id of [...unit]) {
    const member = byId.get(id)!
    for (const b of member.boundElements ?? []) {
      const label = b?.type === "text" ? alive(b.id) : null
      if (label && label.type === "text" && label.containerId === member.id) unit.add(label.id)
    }
    const host = member.type === "text" ? alive(member.containerId) : null
    if (host) unit.add(host.id)
  }
  for (const id of movingIds) unit.delete(id)
  return unit
}

/**
 * New indices that place `moving` (in their current relative order) at `target` within
 * `ordered`, the whole z-order with deleted elements included, so a new key never repeats a
 * deleted element's (undo would bring it back tied). A step forward or backward hops a whole
 * unit (see stepUnit). Fractional keys keep this O(moved) instead of reindexing all.
 */
export const computeMoveIndices = (
  ordered: readonly NibElement[],
  movingIds: ReadonlySet<string>,
  target: MoveTarget,
  editingGroupId: string | null = null,
): Map<string, string> => {
  const result = new Map<string, string>()
  const moving = ordered.filter((e) => movingIds.has(e.id))
  if (moving.length === 0) return result
  const rest = ordered.filter((e) => !movingIds.has(e.id))

  // `at` is where in `rest` the moving run goes
  let at: number
  if (target === "front") at = rest.length
  else if (target === "back") at = 0
  else {
    const live = ordered.filter((e) => !e.isDeleted)
    const byId = new Map(ordered.map((e) => [e.id, e]))
    const position = new Map(ordered.map((e, i) => [e.id, i]))
    if (target === "forward") {
      let top = -1
      for (let i = ordered.length - 1; i >= 0; i--) {
        if (movingIds.has(ordered[i]!.id)) {
          top = i
          break
        }
      }
      const neighbour = ordered.slice(top + 1).find((e) => !e.isDeleted && !movingIds.has(e.id))
      if (!neighbour) return result
      const unit = stepUnit(live, byId, neighbour, movingIds, editingGroupId)
      const last = Math.max(...[...unit].map((id) => position.get(id)!))
      at = rest.indexOf(ordered[last]!) + 1
    } else {
      const bottom = ordered.findIndex((e) => movingIds.has(e.id))
      const neighbour = ordered
        .slice(0, bottom)
        .reverse()
        .find((e) => !e.isDeleted && !movingIds.has(e.id))
      if (!neighbour) return result
      const unit = stepUnit(live, byId, neighbour, movingIds, editingGroupId)
      const first = Math.min(...[...unit].map((id) => position.get(id)!))
      at = rest.indexOf(ordered[first]!)
    }
  }

  // tied or unordered keys leave no gap to generate into, so rekey everything once
  if (hasTies(ordered)) {
    const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)]
    const keys = generateNKeysBetween(null, null, next.length)
    next.forEach((el, i) => {
      if (el.index !== keys[i]) result.set(el.id, keys[i]!)
    })
    return result
  }
  const keys = generateNKeysBetween(rest[at - 1]?.index ?? null, rest[at]?.index ?? null, moving.length)
  moving.forEach((el, i) => result.set(el.id, keys[i]!))
  return result
}

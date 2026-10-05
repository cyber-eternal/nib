import type { Bounds } from "../math/bounds"
import { mutateElement } from "../model/element"
import { outermostGroupId } from "../model/groups"
import type { NibElement } from "../model/types"
import { getCommonBounds } from "./elementBounds"

export type AlignKind = "left" | "right" | "top" | "bottom" | "centerX" | "centerY"
export type DistributeAxis = "horizontal" | "vertical"

interface Unit {
  members: NibElement[]
  bounds: Bounds
}

/**
 * Groups move as one block: each outermost group (relative to the one being
 * edited) is a unit, and a label passed along with its container moves with it.
 */
const unitsOf = (elements: readonly NibElement[], editingGroupId: string | null): Unit[] => {
  const keyOf = new Map<string, string>()
  for (const el of elements) {
    const gid = outermostGroupId(el, editingGroupId)
    keyOf.set(el.id, gid ? `g:${gid}` : `e:${el.id}`)
  }
  const byKey = new Map<string, NibElement[]>()
  for (const el of elements) {
    const container = el.type === "text" && el.containerId ? keyOf.get(el.containerId) : undefined
    const key = container ?? keyOf.get(el.id)!
    const list = byKey.get(key)
    if (list) list.push(el)
    else byKey.set(key, [el])
  }
  return [...byKey.values()].map((members) => ({ members, bounds: getCommonBounds(members) }))
}

const EPS = 1e-9

const shiftUnit = (unit: Unit, dx: number, dy: number): NibElement[] => {
  const mx = Math.abs(dx) < EPS ? 0 : dx
  const my = Math.abs(dy) < EPS ? 0 : dy
  return unit.members.map((el) =>
    mx === 0 && my === 0 ? el : mutateElement(el, { x: el.x + mx, y: el.y + my }),
  )
}

export const alignElements = (
  elements: readonly NibElement[],
  kind: AlignKind,
  editingGroupId: string | null = null,
): NibElement[] => {
  if (elements.length < 2) return []
  const units = unitsOf(elements, editingGroupId)
  if (units.length < 2) return []
  const target: Bounds = getCommonBounds(elements)
  return units.flatMap((unit) => {
    const b = unit.bounds
    let dx = 0
    let dy = 0
    switch (kind) {
      case "left":
        dx = target[0] - b[0]
        break
      case "right":
        dx = target[2] - b[2]
        break
      case "top":
        dy = target[1] - b[1]
        break
      case "bottom":
        dy = target[3] - b[3]
        break
      case "centerX":
        dx = (target[0] + target[2]) / 2 - (b[0] + b[2]) / 2
        break
      case "centerY":
        dy = (target[1] + target[3]) / 2 - (b[1] + b[3]) / 2
        break
    }
    return shiftUnit(unit, dx, dy)
  })
}

/**
 * Equalise the gaps between units along one axis, in centre order. When the
 * units overlap too much for a positive gap, their centres are spaced evenly
 * instead, so nothing swaps places.
 */
export const distributeElements = (
  elements: readonly NibElement[],
  axis: DistributeAxis,
  editingGroupId: string | null = null,
): NibElement[] => {
  if (elements.length < 3) return []
  const i = axis === "horizontal" ? 0 : 1
  const centre = (b: Bounds): number => (b[i]! + b[i + 2]!) / 2
  const units = unitsOf(elements, editingGroupId).sort((a, b) => centre(a.bounds) - centre(b.bounds))
  if (units.length < 3) return []

  const start = Math.min(...units.map((u) => u.bounds[i]!))
  const end = Math.max(...units.map((u) => u.bounds[i + 2]!))
  const totalSize = units.reduce((sum, u) => sum + (u.bounds[i + 2]! - u.bounds[i]!), 0)
  const gap = (end - start - totalSize) / (units.length - 1)

  const firstCentre = centre(units[0]!.bounds)
  const step = (centre(units[units.length - 1]!.bounds) - firstCentre) / (units.length - 1)
  let cursor = start
  return units.flatMap((unit, idx) => {
    const size = unit.bounds[i + 2]! - unit.bounds[i]!
    const delta = gap >= 0 ? cursor - unit.bounds[i]! : firstCentre + step * idx - centre(unit.bounds)
    cursor += size + gap
    return shiftUnit(unit, i === 0 ? delta : 0, i === 0 ? 0 : delta)
  })
}

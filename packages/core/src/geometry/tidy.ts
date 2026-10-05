import { type Point, distance, normalizeAngle } from "../math/vector"
import { mutateElement } from "../model/element"
import type { ArrowElement, LinearElement, NibElement } from "../model/types"
import { isLinearElement } from "../model/types"
import { MIN_BINDING_GAP, arrowAbsolutePoints, bindableElementAt, createBinding } from "./binding"
import { connectorBetween, connectorObstacles } from "./connector"
import { rebaseFromPoints } from "./linear"

/**
 * How far a segment may sit from an axis and still count as "meant to be
 * straight". Horizontal and vertical get a generous window because that is what
 * people are usually aiming for; diagonals only snap when they are already
 * almost exactly on 45°, so deliberate angles survive.
 */
const AXIS_TOLERANCE_DEG = 15
const DIAGONAL_TOLERANCE_DEG = 6
/** Tidy reaches further than live drawing when adopting a loose endpoint. */
const TIDY_BIND_THRESHOLD = 48

export interface TidyOptions {
  /** Scene elements, used to find what an unbound endpoint is pointing at. */
  all: readonly NibElement[]
  zoom: number
}

export interface TidyOutcome {
  elements: NibElement[]
  /** Shapes that gained a new arrow binding, so the caller can link them back. */
  newLinks: { shapeId: string; arrowId: string }[]
  changed: number
}

const withAbsolutePoints = <T extends LinearElement>(el: T, points: readonly Point[]): T =>
  rebaseFromPoints(el, points)

// re-routing an already tidy arrow lands within float noise of where it was
const EPSILON = 1e-6

const sameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= EPSILON
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]))
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
    const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
    return (
      ka.length === kb.length &&
      ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
    )
  }
  return false
}

const TIDIED_KEYS = [
  "x",
  "y",
  "width",
  "height",
  "angle",
  "points",
  "startBinding",
  "endBinding",
  "elbowed",
  "roundness",
] as const

/** Whether tidying left `next` drawn and bound exactly as `before` was. */
const unchanged = (before: LinearElement, next: LinearElement): boolean => {
  const a = before as unknown as Record<string, unknown>
  const b = next as unknown as Record<string, unknown>
  return TIDIED_KEYS.every((k) => sameValue(a[k], b[k]))
}

/**
 * Squares up segments that are already close to an axis or a clean diagonal.
 * The first point stays put; snap reversed points to keep the last one instead.
 */
const snapAngles = (points: readonly Point[]): Point[] => {
  if (points.length < 2) return [...points]
  const quarter = Math.PI / 2
  const eighth = Math.PI / 4
  const axisTolerance = (AXIS_TOLERANCE_DEG * Math.PI) / 180
  const diagonalTolerance = (DIAGONAL_TOLERANCE_DEG * Math.PI) / 180
  const out: Point[] = [points[0]!]

  const offsetFrom = (angle: number, step: number): { target: number; delta: number } => {
    const target = Math.round(angle / step) * step
    let delta = normalizeAngle(target - angle)
    if (delta > Math.PI) delta -= Math.PI * 2
    return { target, delta }
  }

  for (let i = 1; i < points.length; i++) {
    const from = out[i - 1]!
    const to = points[i]!
    const length = distance(from, to)
    if (length < 1) {
      out.push([from[0], from[1]])
      continue
    }
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0])
    const axis = offsetFrom(angle, quarter)
    const diagonal = offsetFrom(angle, eighth)
    const target =
      Math.abs(axis.delta) <= axisTolerance
        ? axis.target
        : Math.abs(diagonal.delta) <= diagonalTolerance
          ? diagonal.target
          : null

    if (target === null) {
      out.push([to[0], to[1]])
      continue
    }
    out.push([from[0] + Math.cos(target) * length, from[1] + Math.sin(target) * length])
  }
  return out
}

/**
 * Cleans up arrows and lines: attaches loose ends to the shape they point at,
 * runs connected arrows straight between facing borders, routes the rest
 * orthogonally, and squares up anything that is nearly axis-aligned already.
 */
export const tidyLinearElements = (targets: readonly NibElement[], opts: TidyOptions): TidyOutcome => {
  const byId = new Map(opts.all.map((el) => [el.id, el]))
  const elements: NibElement[] = []
  const newLinks: { shapeId: string; arrowId: string }[] = []

  for (const target of targets) {
    if (!isLinearElement(target) || target.isDeleted || target.locked) continue
    let el: LinearElement = target
    const abs = arrowAbsolutePoints(el)
    if (abs.length < 2) continue

    if (el.type === "arrow") {
      let arrow = el as ArrowElement
      const ends: ("start" | "end")[] = ["start", "end"]

      // adopt whatever each loose end is sitting on
      for (const end of ends) {
        const existing = end === "start" ? arrow.startBinding : arrow.endBinding
        if (existing && byId.has(existing.elementId)) continue
        const tip = end === "start" ? abs[0]! : abs[abs.length - 1]!
        const shape = bindableElementAt(opts.all, tip, opts.zoom, arrow.id, TIDY_BIND_THRESHOLD)
        if (!shape) continue
        // a fresh binding touches the shape; the loose end's distance was never a chosen gap
        arrow = mutateElement(arrow, {
          [end === "start" ? "startBinding" : "endBinding"]: createBinding(
            shape,
            arrow,
            end,
            MIN_BINDING_GAP,
          ),
        } as Partial<ArrowElement>)
        newLinks.push({ shapeId: shape.id, arrowId: arrow.id })
      }

      const from = arrow.startBinding ? byId.get(arrow.startBinding.elementId) : null
      const to = arrow.endBinding ? byId.get(arrow.endBinding.elementId) : null

      if (from && to && from.id !== to.id) {
        // the same shapes drawing and re-routing go around, so tidying never cuts through one
        const obstacles = connectorObstacles(
          opts.all,
          [abs[0]!, abs[abs.length - 1]!],
          new Set([arrow.id, from.id, to.id]),
        )
        const route = connectorBetween(from, to, arrow.startBinding!.gap, arrow.endBinding!.gap, obstacles)
        // a clean straight run drops any bend and the curve; anything else is an orthogonal elbow
        arrow = withAbsolutePoints(
          mutateElement(arrow, { elbowed: route.length > 2, roundness: null } as Partial<ArrowElement>),
          route,
        )
        // re-derive the focus so later moves keep this shape, but keep the gaps the run used;
        // the run now ends on the outlines, so a pinned point inside would yank it back
        const { fixedPoint: _s, ...startBinding } = arrow.startBinding!
        const { fixedPoint: _e, ...endBinding } = arrow.endBinding!
        arrow = mutateElement(arrow, {
          startBinding: { ...startBinding, ...createBinding(from, arrow, "start", startBinding.gap) },
          endBinding: { ...endBinding, ...createBinding(to, arrow, "end", endBinding.gap) },
        } as Partial<ArrowElement>)
        if (!unchanged(target, arrow)) elements.push(arrow)
        continue
      }
      el = arrow
    }

    const current = arrowAbsolutePoints(el)
    const startBound = el.type === "arrow" && !!el.startBinding && byId.has(el.startBinding.elementId)
    const endBound = el.type === "arrow" && !!el.endBinding && byId.has(el.endBinding.elementId)
    // squaring up swings every point after the anchor, so anchor on the bound end
    if (startBound && endBound) {
      if (!unchanged(target, el)) elements.push(el)
      continue
    }
    const snapped = endBound ? snapAngles([...current].reverse()).reverse() : snapAngles(current)
    const moved = snapped.some((p, i) => distance(p, current[i]!) > 0.01)
    const next = moved ? withAbsolutePoints(el, snapped) : el
    if (!unchanged(target, next)) elements.push(next)
  }

  return { elements, newLinks, changed: elements.length }
}

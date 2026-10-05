import type { EditorCore } from "../editor/editorCore"
import { bindableElementAt, createBinding, updateBoundArrow } from "../geometry/binding"
import { connectorBetween, connectorObstacles } from "../geometry/connector"
import { routeElbow } from "../geometry/elbow"
import { getElementBounds } from "../geometry/elementBounds"
import { absolutePointsOf, rebaseFromPoints } from "../geometry/linear"
import { type Point, distance } from "../math/vector"
import { mutateElement, newElement } from "../model/element"
import type { ArrowElement, LinearElement, NibElement } from "../model/types"
import { snapDrawPoint, suppressesBinding } from "./helpers"
import type { KeyInput, PointerInput, Tool } from "./types"

/** Clicking this close to the first vertex closes the polyline (screen px). */
const CLOSE_ENOUGH = 8
/** A press this close to the last vertex is the second half of a double click, not a new vertex. */
const SAME_POINT = 4
const DRAG_THRESHOLD = 4

/**
 * Two ways to draw. Dragging gives a two-point line. Clicking starts a
 * connector: the next click on a shape finishes it there, and a click on empty
 * canvas adds a bend, so a chain can route around things. Escape, Enter, a
 * double click, or a click back on the first point also finish it, keeping only
 * the clicked vertices. Elbow arrows always route orthogonally, live. Holding
 * ⌘ or Ctrl while an arrow end is placed leaves that end unbound.
 */
export class LinearTool implements Tool {
  private draftId: string | null = null
  private multiPoint = false
  private downAt: Point | null = null
  private dragged = false
  /** The shape the arrow started on; owned by this draft so a discarded one can't leak into the next. */
  private startShapeId: string | null = null
  /** Where the press began, which an elbow draft routes from. */
  private anchor: Point | null = null
  /** ⌘ or Ctrl was held at the latest pointer event, so the head must not bind. */
  private suppressEnd = false

  constructor(readonly type: "arrow" | "line") {}

  private draft(ed: EditorCore): LinearElement | null {
    if (!this.draftId) return null
    const el = ed.scene.get(this.draftId)
    return el && (el.type === "arrow" || el.type === "line") ? el : null
  }

  onPointerDown(p: PointerInput, ed: EditorCore): void {
    this.suppressEnd = suppressesBinding(p)
    const existing = this.draft(ed)
    if (existing && this.multiPoint) {
      this.downAt = ed.snapPoint(p.scene)
      this.dragged = false
      this.addVertex(existing, p, ed)
      return
    }

    const gridded = ed.snapPoint(p.scene)
    const startShape =
      this.type === "arrow" && !suppressesBinding(p)
        ? bindableElementAt(ed.scene.getNonDeleted(), gridded, ed.appState.viewport.zoom)
        : null
    // a start on a shape binds to it, so only a free start snaps to other elements
    const start = startShape ? gridded : snapDrawPoint(ed, p.scene, p, new Set())
    this.downAt = [start[0], start[1]]
    this.dragged = false

    ed.beginTransaction()
    const a = ed.appState
    const elbow = this.type === "arrow" && a.currentItemArrowType === "elbow"
    const round =
      this.type === "arrow" ? a.currentItemArrowType === "round" : a.currentItemRoundness === "round"
    const el = newElement(this.type, {
      x: start[0],
      y: start[1],
      width: 0,
      height: 0,
      index: ed.scene.nextIndex(),
      strokeColor: a.currentItemStrokeColor,
      backgroundColor: a.currentItemBackgroundColor,
      fillStyle: a.currentItemFillStyle,
      strokeWidth: a.currentItemStrokeWidth,
      strokeStyle: a.currentItemStrokeStyle,
      roughness: elbow ? 0 : a.currentItemRoughness,
      opacity: a.currentItemOpacity,
      roundness: round ? { type: 2 } : null,
      points: [
        [0, 0],
        [0, 0],
      ],
      startArrowhead: this.type === "arrow" ? a.currentItemStartArrowhead : undefined,
      endArrowhead: this.type === "arrow" ? a.currentItemEndArrowhead : undefined,
      elbowed: elbow,
    })
    this.draftId = el.id
    this.anchor = [start[0], start[1]]
    ed.scene.insert(el)
    ed.setAppState({ selectedElementIds: {}, selectedGroupIds: {} })

    this.startShapeId = null
    if (el.type === "arrow" && startShape) {
      this.startShapeId = startShape.id
      ed.scene.update(mutateElement(el, { startBinding: createBinding(startShape, el, "start") }))
    }
  }

  /** A click while a polyline is open: close it, finish on a shape, or add a bend. */
  private addVertex(existing: LinearElement, p: PointerInput, ed: EditorCore): void {
    const zoom = ed.appState.viewport.zoom
    const gridded = ed.snapPoint(p.scene)
    const target =
      existing.type === "arrow" && !suppressesBinding(p)
        ? bindableElementAt(ed.scene.getNonDeleted(), gridded, zoom, existing.id)
        : null
    const at = target ? gridded : snapDrawPoint(ed, p.scene, p, new Set([existing.id]))
    const committed = absolutePointsOf(existing).slice(0, -1)
    if (committed.length >= 2 && distance(at, committed[0]!) < CLOSE_ENOUGH / zoom) {
      this.finish(ed, { dropRubber: true, close: true })
      return
    }
    const lastCommitted = committed[committed.length - 1]
    if (lastCommitted && distance(at, lastCommitted) < SAME_POINT / zoom) return

    const elbow = existing.type === "arrow" && existing.elbowed
    if (elbow || (target && target.id !== this.startShapeId)) {
      // landing on a shape completes the connection rather than adding a bend
      this.placeHead(existing, at, ed, suppressesBinding(p))
      this.finish(ed, { dropRubber: false })
      return
    }
    ed.scene.update(
      mutateElement(rebaseFromPoints(existing, [...committed, at, at]), { lastCommittedPoint: null }),
    )
  }

  onPointerMove(p: PointerInput, ed: EditorCore): void {
    const el = this.draft(ed)
    const zoom = ed.appState.viewport.zoom
    const noBind = suppressesBinding(p)
    if (!el) {
      // armed but not drawing yet: show what a click would attach to
      if (this.type === "arrow") {
        ed.setBindingHighlight(noBind ? null : bindableElementAt(ed.scene.getNonDeleted(), p.scene, zoom))
        ed.setBindingHints([])
      }
      return
    }
    this.suppressEnd = noBind
    if (this.downAt && distance(this.downAt, p.scene) > DRAG_THRESHOLD / zoom) this.dragged = true

    let target = ed.snapPoint(p.scene)
    const abs = absolutePointsOf(el)
    const elbow = el.type === "arrow" && el.elbowed
    if (p.shiftKey && !elbow) {
      // snap the segment's angle around the vertex it starts from
      const prev = abs.length >= 2 ? abs[abs.length - 2]! : abs[0]!
      const dx = target[0] - prev[0]
      const dy = target[1] - prev[1]
      const step = Math.PI / 12
      const snapped = Math.round(Math.atan2(dy, dx) / step) * step
      const len = Math.hypot(dx, dy)
      target = [prev[0] + Math.cos(snapped) * len, prev[1] + Math.sin(snapped) * len]
      ed.setSnapLines([])
    } else if (this.type !== "arrow" || noBind || !this.headShape(ed, el, target)) {
      // a head about to bind goes where the binding puts it; anything else snaps like a shape corner
      target = snapDrawPoint(ed, p.scene, p, new Set([el.id]))
    } else {
      ed.setSnapLines([])
    }

    const placed = this.placeHead(el, target, ed, noBind)
    if (this.type === "arrow") {
      const shape = noBind ? null : this.headShape(ed, placed, target)
      ed.setBindingHighlight(shape)
      ed.setBindingHints(this.connectionDots(ed, placed, shape))
    }
  }

  /** The shape the head would bind to, ignoring the start shape so crossing it isn't a connection. */
  private headShape(ed: EditorCore, el: LinearElement, at: Point): NibElement | null {
    const shape = bindableElementAt(ed.scene.getNonDeleted(), at, ed.appState.viewport.zoom, el.id)
    return shape && shape.id !== this.startShapeId ? shape : null
  }

  /** Moves the rubber-band point to `at`, keeping the tail on its shape or routing an elbow live. */
  private placeHead(el: LinearElement, at: Point, ed: EditorCore, suppress = false): LinearElement {
    if (el.type === "arrow" && el.elbowed && this.anchor) {
      const shape = suppress ? null : this.headShape(ed, el, at)
      const straight = rebaseFromPoints(el, [this.anchor, at])
      const base = mutateElement(straight, {
        endBinding: shape ? createBinding(shape, straight, "end") : null,
      })
      return applyElbowRoute(base, ed)
    }
    const abs = absolutePointsOf(el)
    abs[abs.length - 1] = at
    let next = rebaseFromPoints(el, abs)
    // keep the tail on the shape's border while the head follows the cursor, unless the
    // head is back over that same shape, where re-aiming would fold the arrow onto itself
    const sameShape =
      this.startShapeId &&
      bindableElementAt(ed.scene.getNonDeleted(), at, ed.appState.viewport.zoom, el.id)?.id ===
        this.startShapeId
    if (next.type === "arrow" && next.startBinding && !sameShape)
      next = updateBoundArrow(next, (id) => ed.scene.get(id))
    ed.scene.update(next)
    return next
  }

  /** Dots where each end will attach, computed exactly as the commit will. */
  private connectionDots(ed: EditorCore, el: LinearElement, target: NibElement | null): Point[] {
    if (el.type !== "arrow") return []
    const dots: Point[] = []
    const abs = absolutePointsOf(el)
    if (el.startBinding) dots.push(abs[0]!)
    if (target) {
      if (el.elbowed) {
        dots.push(abs[abs.length - 1]!)
      } else {
        const bound = mutateElement(el, { endBinding: createBinding(target, el, "end") })
        const solved = absolutePointsOf(updateBoundArrow(bound, (id) => ed.scene.get(id)))
        dots.push(solved[solved.length - 1]!)
      }
    }
    return dots
  }

  onPointerUp(p: PointerInput, ed: EditorCore): void {
    const el = this.draft(ed)
    if (!el) return
    this.suppressEnd = suppressesBinding(p)

    if (!this.dragged && !this.multiPoint) {
      // a click begins multi-point mode; the next click adds the second vertex
      this.multiPoint = true
      return
    }
    if (this.multiPoint) return
    this.finish(ed, { dropRubber: false })
  }

  onDoubleClick(p: PointerInput, ed: EditorCore): void {
    if (!this.multiPoint) return
    this.suppressEnd = suppressesBinding(p)
    this.finish(ed, { dropRubber: true })
  }

  onKeyDown(e: KeyInput, ed: EditorCore): boolean {
    if (!this.multiPoint) return false
    if (e.key === "Enter" || e.key === "Escape") {
      this.finish(ed, { dropRubber: true })
      return true
    }
    return false
  }

  private finish(ed: EditorCore, opts: { dropRubber: boolean; close?: boolean }): void {
    let el = this.draft(ed)
    const multiPoint = this.multiPoint
    const startShapeId = this.startShapeId
    const bindEnd = !this.suppressEnd
    this.reset(ed)
    if (!el) return

    const zoom = ed.appState.viewport.zoom
    let pts = absolutePointsOf(el)
    if (opts.dropRubber && multiPoint) {
      // an elbow's end was never clicked; for polylines the floating cursor point is not a vertex
      if (el.type === "arrow" && el.elbowed) {
        ed.rollbackTransaction()
        return
      }
      pts = pts.slice(0, -1)
    }
    let polygon = false
    if (opts.close && el.type === "line" && pts.length >= 3) {
      pts = [...pts, pts[0]!]
      polygon = true
    }
    pts = dedupe(pts, 1 / zoom)
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    if (pts.length < 2 || extent < 1) {
      ed.rollbackTransaction()
      return
    }
    el = rebaseFromPoints(el, pts)
    el = mutateElement(el, {
      lastCommittedPoint: el.points[el.points.length - 1]!,
      ...(polygon ? { polygon: true } : {}),
    } as Partial<LinearElement>)
    ed.scene.update(el)
    // a new arrow dropped on a shape connects to its outline; pinning inside is for dragged ends
    if (el.type === "arrow") el = bindArrowEnds(el, ed, { startShapeId, bindEnd })
    ed.assignFrame(el.id)

    ed.setAppState({
      selectedElementIds: { [el.id]: true },
      selectedGroupIds: {},
      activeTool: ed.appState.toolLocked ? ed.appState.activeTool : "selection",
    })
    ed.commitTransaction()
  }

  private reset(ed: EditorCore): void {
    this.draftId = null
    this.multiPoint = false
    this.downAt = null
    this.dragged = false
    this.startShapeId = null
    this.anchor = null
    this.suppressEnd = false
    ed.setBindingHighlight(null)
    ed.setBindingHints([])
    ed.setSnapLines([])
  }

  cancel(ed: EditorCore): void {
    const drafting = this.draftId !== null
    this.reset(ed)
    if (drafting) ed.rollbackTransaction()
  }

  hasDraft(): boolean {
    return this.draftId !== null
  }

  cursor(): string {
    return "crosshair"
  }
}

const dedupe = (pts: readonly Point[], tol: number): Point[] => {
  const out: Point[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && distance(last, p) < tol) continue
    out.push(p)
  }
  return out
}

/**
 * Binds a finished arrow's ends and links the shapes back to it, then re-solves
 * it. The start binds to `startShapeId` when given (the arrow tool knows where the
 * press began), otherwise to the shape under the tail; the end binds to the shape
 * under the tip unless `bindEnd` is false. Shared by the arrow tool and the
 * pencil, so both attach alike.
 */
export const bindArrowEnds = (
  arrow: ArrowElement,
  ed: EditorCore,
  opts: { startShapeId?: string | null; bindEnd?: boolean } = {},
): ArrowElement => {
  const els = ed.scene.getNonDeleted()
  const zoom = ed.appState.viewport.zoom
  const abs = absolutePointsOf(arrow)
  const tail = abs[0]!
  const tip = abs[abs.length - 1]!

  const live = (id: string | null): NibElement | null => {
    const el = id ? ed.scene.get(id) : null
    return el && !el.isDeleted ? el : null
  }
  let startShape =
    opts.startShapeId === undefined ? bindableElementAt(els, tail, zoom, arrow.id) : live(opts.startShapeId)
  let endShape = opts.bindEnd === false ? null : bindableElementAt(els, tip, zoom, arrow.id)
  // a straight arrow drawn across one shape is not a connection to it
  if (startShape && endShape && startShape.id === endShape.id && abs.length === 2) {
    startShape = null
    endShape = null
  }

  let next = mutateElement(arrow, {
    startBinding: startShape ? createBinding(startShape, arrow, "start") : null,
    endBinding: endShape ? createBinding(endShape, arrow, "end") : null,
  })
  ed.scene.update(next)
  for (const shape of [startShape, endShape]) {
    if (!shape) continue
    const fresh = ed.scene.get(shape.id)
    if (fresh) ed.scene.update(ed.linkBoundArrow(fresh, next.id))
  }
  if (next.elbowed || startShape || endShape) next = ed.refreshArrow(next)
  return next
}

/**
 * The point an elbow leaves `shape` from: the middle of the side facing
 * `toward`, `gap` outside it. Routing from a side port keeps every segment
 * orthogonal however the shape has moved.
 */
const elbowPort = (shape: NibElement, toward: Point, gap: number): Point => {
  const b = getElementBounds(shape)
  const cx = (b[0] + b[2]) / 2
  const cy = (b[1] + b[3]) / 2
  const dx = toward[0] - cx
  const dy = toward[1] - cy
  const hw = Math.max(1, (b[2] - b[0]) / 2)
  const hh = Math.max(1, (b[3] - b[1]) / 2)
  if (Math.abs(dx / hw) >= Math.abs(dy / hh)) return dx >= 0 ? [b[2] + gap, cy] : [b[0] - gap, cy]
  return dy >= 0 ? [cx, b[3] + gap] : [cx, b[1] - gap]
}

export const applyElbowRoute = (arrow: ArrowElement, ed: EditorCore): ArrowElement => {
  const abs = absolutePointsOf(arrow)
  const live = (id: string | undefined): NibElement | null => {
    const el = id ? ed.scene.get(id) : null
    return el && !el.isDeleted ? el : null
  }
  const startShape = live(arrow.startBinding?.elementId)
  const endShape = live(arrow.endBinding?.elementId)
  const skip = new Set([arrow.id, startShape?.id, endShape?.id].filter((id): id is string => !!id))
  const obstacles = connectorObstacles(ed.scene.getNonDeleted(), [abs[0]!, abs[abs.length - 1]!], skip)
  let route: Point[]
  if (startShape && endShape && startShape.id !== endShape.id) {
    // with both ends attached the shapes themselves decide the exit sides, which
    // reads better than routing from wherever the previous bend happened to sit
    route = connectorBetween(startShape, endShape, arrow.startBinding!.gap, arrow.endBinding!.gap, obstacles)
  } else {
    let start = abs[0]!
    let end = abs[abs.length - 1]!
    if (startShape && !endShape) start = elbowPort(startShape, end, arrow.startBinding!.gap)
    if (endShape && !startShape) end = elbowPort(endShape, start, arrow.endBinding!.gap)
    if (startShape && endShape) {
      start = elbowPort(startShape, end, arrow.startBinding!.gap)
      end = elbowPort(endShape, abs[0]!, arrow.endBinding!.gap)
    }
    route = routeElbow(start, end, startShape, endShape, { obstacles })
  }
  const routed = rebaseFromPoints(arrow, route)
  ed.scene.update(routed)
  return routed
}

export const isLinearDraftElement = (el: NibElement): boolean =>
  (el.type === "line" || el.type === "arrow") && el.points.length < 2

import type { EditorCore } from "../editor/editorCore"
import { bindableElementAt, createBinding, updateBoundArrow } from "../geometry/binding"
import { getBoundText } from "../geometry/boundText"
import { cropElement } from "../geometry/crop"
import { elbowSegments, moveElbowSegment } from "../geometry/elbow"
import { getCommonBounds, getElementBounds } from "../geometry/elementBounds"
import {
  elementAtPoint,
  elementsInBounds,
  hitTestElement,
  hitTestElementBox,
  labelContainerAtPoint,
} from "../geometry/hitTest"
import { absolutePointsOf, rebaseFromPoints } from "../geometry/linear"
import { elementCenter } from "../geometry/outline"
import { resizeElement, resizeMultiple, rotateElementTo } from "../geometry/resize"
import { computeSnap, handleSnapAxes, snapToGrid } from "../geometry/snapping"
import {
  ELBOW_SEGMENT_HANDLE_MIN,
  HANDLE_SIZE,
  type HandleType,
  handleCursor,
  hitTestHandles,
} from "../geometry/transformHandles"
import { type Bounds, boundsContainPoint, boundsIntersect, normalizeRect } from "../math/bounds"
import { type Point, distance, normalizeAngle, rotatePoint } from "../math/vector"
import { mutateElement } from "../model/element"
import { expandSelectionToGroups, outermostGroupId } from "../model/groups"
import {
  type ArrowElement,
  type LinearElement,
  type NibElement,
  canHaveLabel,
  isLinearElement,
} from "../model/types"
import { frameLabelLayout } from "../render/drawElement"
import { selectionHandleSet } from "../render/interactiveScene"
import {
  adoptChanges,
  frameAtPoint,
  frameIdFor,
  isBoundText,
  rotatePointsElement,
  snapDrawPoint,
  snapTargets,
  suppressesBinding,
} from "./helpers"
import { createTextAt } from "./textTool"
import type { KeyInput, PointerInput, Tool } from "./types"

type Mode =
  | { kind: "idle" }
  | {
      kind: "pending"
      start: Point
      hitId: string | null
      originals: NibElement[]
      /** Shift-click on something already selected: deselect it on release, unless it was dragged. */
      toggleOff: boolean
      /** Plain click on part of a multi-selection: narrow to it on release, unless it was dragged. */
      narrow: boolean
    }
  | {
      kind: "move"
      start: Point
      originals: NibElement[]
      restoreIds: string[] | null
      /** Everything the drag carries (frame contents, labels) and where each was when it began. */
      moving: Set<string>
      bases: Map<string, NibElement>
    }
  | { kind: "marquee"; start: Point; base: Record<string, true>; inside: string[] }
  | {
      kind: "resize"
      handle: HandleType
      originals: NibElement[]
      labels: NibElement[]
      bounds: Bounds
      offset: Point
    }
  | { kind: "rotate"; originals: NibElement[]; center: Point }
  | { kind: "point"; elementId: string; index: number; indices: number[]; original: LinearElement }
  | { kind: "segment"; elementId: string; index: number; original: ArrowElement }
  | { kind: "pointMarquee"; start: Point; elementId: string; base: number[]; dragged: boolean }

const DRAG_THRESHOLD = 3
const POINT_HIT = 10
/** On screen, a selected element smaller than this is grabbed by its body before its handles. */
const TINY = HANDLE_SIZE * 3

export class SelectionTool implements Tool {
  readonly type = "selection"
  private mode: Mode = { kind: "idle" }

  private selected(ed: EditorCore): NibElement[] {
    return ed.selectedElements()
  }

  private single(ed: EditorCore): NibElement | null {
    const sel = this.selected(ed)
    return sel.length === 1 ? sel[0]! : null
  }

  /** A selected straight line or arrow is edited by its two ends, not by a box. */
  private isTwoPointLinear(el: NibElement | null): el is LinearElement {
    return !!el && isLinearElement(el) && el.points.length === 2
  }

  private handleAt(p: Point, ed: EditorCore): HandleType | null {
    if (ed.appState.editingLinearElementId) return null
    const sel = this.selected(ed)
    if (sel.length === 1 && this.isTwoPointLinear(sel[0]!)) return null
    const croppingElementId = ed.appState.croppingElementId
    const set = selectionHandleSet(sel, ed.appState.viewport.zoom, { croppingElementId })
    const handle = set ? hitTestHandles(set, p, ed.appState.viewport.zoom) : null
    if (!handle || handle === "rotation") return handle
    const el = sel.length === 1 ? sel[0]! : null
    // crop brackets stay grabbable on a tiny crop: there is no body to drag in crop mode
    if (el && el.id === croppingElementId) return handle
    // on a tiny element the handle squares cover its body, which must still be draggable
    const zoom = ed.appState.viewport.zoom
    if (el && Math.min(el.width, el.height) * zoom < TINY && hitTestElementBox(el, p, 2 / zoom)) return null
    return handle
  }

  /** The frame whose name, as drawn at the current zoom, is under the pointer. */
  private frameLabelAt(p: Point, ed: EditorCore): NibElement | null {
    const zoom = ed.appState.viewport.zoom
    const { editingGroupId } = ed.appState
    const els = ed.scene.getNonDeleted()
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i]!
      if (el.type !== "frame" || el.locked) continue
      if (editingGroupId && !el.groupIds.includes(editingGroupId)) continue
      const label = frameLabelLayout(el, zoom)
      if (!label) continue
      const local = rotatePoint(p, elementCenter(el), -el.angle)
      const x = local[0] - el.x
      const y = local[1] - el.y
      if (x >= label.x && x <= label.x + label.width && y >= label.y && y <= label.y + label.height) return el
    }
    return null
  }

  private editableLinear(id: string | null, ed: EditorCore): LinearElement | null {
    if (!id) return null
    const el = ed.scene.get(id)
    return el && isLinearElement(el) && !el.isDeleted && !el.locked ? el : null
  }

  private linearPointAt(p: Point, ed: EditorCore): { el: LinearElement; index: number } | null {
    const el = this.editableLinear(ed.appState.editingLinearElementId, ed)
    if (!el) return null
    const tol = POINT_HIT / ed.appState.viewport.zoom
    const abs = absolutePointsOf(el)
    for (let i = 0; i < abs.length; i++) if (distance(abs[i]!, p) <= tol) return { el, index: i }
    return null
  }

  private midpointAt(p: Point, ed: EditorCore): { el: LinearElement; index: number } | null {
    const el = this.editableLinear(ed.appState.editingLinearElementId, ed)
    if (!el) return null
    const tol = POINT_HIT / ed.appState.viewport.zoom
    const abs = absolutePointsOf(el)
    for (let i = 0; i < abs.length - 1; i++) {
      const a = abs[i]!
      const b = abs[i + 1]!
      if (distance([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], p) <= tol) return { el, index: i }
    }
    return null
  }

  /**
   * A segment handle of an elbow arrow under the pointer: the selected one, or
   * the one open in the point editor. Dragging it slides the segment sideways.
   */
  private segmentAt(p: Point, ed: EditorCore): { el: ArrowElement; index: number } | null {
    const editing = this.editableLinear(ed.appState.editingLinearElementId, ed)
    const single = this.single(ed)
    const el = editing ?? (single && isLinearElement(single) && !single.locked ? single : null)
    if (!el || el.type !== "arrow" || !el.elbowed) return null
    const zoom = ed.appState.viewport.zoom
    const tol = POINT_HIT / zoom
    for (const seg of elbowSegments(absolutePointsOf(el))) {
      // a stub too short to grab without hitting an end is left to the end handles
      if (seg.length * zoom < ELBOW_SEGMENT_HANDLE_MIN) continue
      if (distance(seg.mid, p) <= tol) return { el, index: seg.index }
    }
    return null
  }

  /** An end of the selected straight line or arrow under the pointer. */
  private endpointAt(p: Point, ed: EditorCore): { el: LinearElement; index: number } | null {
    if (ed.appState.editingLinearElementId) return null
    const el = this.single(ed)
    if (!this.isTwoPointLinear(el) || el.locked) return null
    const tol = POINT_HIT / ed.appState.viewport.zoom
    const abs = absolutePointsOf(el)
    for (const index of [abs.length - 1, 0]) if (distance(abs[index]!, p) <= tol) return { el, index }
    return null
  }

  /** Inside the selection's box: an unfilled shape can be dragged from anywhere within it. */
  private insideSelection(p: Point, ed: EditorCore): boolean {
    const sel = this.selected(ed)
    if (sel.length === 0) return false
    if (sel.length === 1) return hitTestElementBox(sel[0]!, p)
    return boundsContainPoint(getCommonBounds(sel), p)
  }

  /**
   * Point editing works on drawn points, so a rotated line gets its rotation
   * baked in first. `indices` are the vertices that move together with `index`.
   */
  private startPointEdit(
    el: LinearElement,
    index: number,
    ed: EditorCore,
    indices: number[] = [index],
  ): void {
    let cur = el
    if (cur.angle !== 0) {
      cur = rotatePointsElement(cur, elementCenter(cur), 0)
      ed.scene.update(cur)
    }
    this.mode = { kind: "point", elementId: cur.id, index, indices, original: cur }
  }

  onPointerDown(p: PointerInput, ed: EditorCore): void {
    if (ed.appState.viewMode) return
    // each branch opens its step after any selection change, so undo restores the selection it acted on
    const linearPoint = this.linearPointAt(p.scene, ed)
    if (linearPoint) {
      const { el, index } = linearPoint
      if (p.altKey && el.points.length > 2) {
        // the picked-points delete keeps a closed line closed and lets go of a removed arrow end
        ed.setAppState({ selectedPointIndices: [index] })
        ed.deleteSelected()
        this.mode = { kind: "idle" }
        return
      }
      // a picked vertex drags the whole pick; Shift toggles it in or out
      const picked = ed.appState.selectedPointIndices
      const has = picked.includes(index)
      const indices = p.shiftKey
        ? has
          ? picked.filter((i) => i !== index)
          : [...picked, index]
        : has
          ? [...picked]
          : [index]
      ed.setAppState({ selectedPointIndices: indices })
      if (!indices.includes(index)) return
      ed.beginTransaction()
      this.startPointEdit(el, index, ed, indices)
      return
    }

    const segment = this.segmentAt(p.scene, ed)
    if (segment) {
      ed.beginTransaction()
      this.mode = { kind: "segment", elementId: segment.el.id, index: segment.index, original: segment.el }
      return
    }

    // elbow routes get segment handles instead; a midpoint vertex would make them diagonal
    const editingLinear = this.editableLinear(ed.appState.editingLinearElementId, ed)
    const mid = editingLinear?.type === "arrow" && editingLinear.elbowed ? null : this.midpointAt(p.scene, ed)
    if (mid) {
      ed.setAppState({ selectedPointIndices: [mid.index + 1] })
      ed.beginTransaction()
      const el = mid.el
      const a = el.points[mid.index]!
      const b = el.points[mid.index + 1]!
      const pts: Point[] = [...el.points]
      pts.splice(mid.index + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
      const updated = mutateElement(el, { points: pts } as Partial<LinearElement>)
      ed.scene.update(updated)
      this.startPointEdit(updated, mid.index + 1, ed)
      return
    }

    const endpoint = this.endpointAt(p.scene, ed)
    if (endpoint) {
      ed.beginTransaction()
      this.startPointEdit(endpoint.el, endpoint.index, ed)
      return
    }

    const handle = this.handleAt(p.scene, ed)
    if (handle) {
      ed.beginTransaction()
      const originals = this.selected(ed)
      if (handle === "rotation") {
        const center =
          originals.length === 1
            ? elementCenter(originals[0]!)
            : ((): Point => {
                const b = getCommonBounds(originals)
                return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
              })()
        this.mode = { kind: "rotate", originals, center }
      } else {
        const bounds = getCommonBounds(originals)
        const edge = handleEdgePoint(handle, originals, bounds)
        const labels = originals.flatMap((o) => getBoundText(o, (id) => ed.scene.get(id)) ?? [])
        this.mode = {
          kind: "resize",
          handle,
          originals,
          labels,
          bounds,
          offset: [edge[0] - p.scene[0], edge[1] - p.scene[1]],
        }
      }
      return
    }

    const hit =
      elementAtPoint(ed.scene.getNonDeleted(), p.scene, ed.appState.viewport.zoom, ed.appState) ??
      this.frameLabelAt(p.scene, ed)

    const editing = this.editableLinear(ed.appState.editingLinearElementId, ed)
    if (!hit && editing) {
      // in the line editor, dragging on empty canvas picks vertices; a plain click leaves the editor
      ed.beginTransaction()
      this.mode = {
        kind: "pointMarquee",
        start: [p.scene[0], p.scene[1]],
        elementId: editing.id,
        base: p.shiftKey ? [...ed.appState.selectedPointIndices] : [],
        dragged: false,
      }
      return
    }

    if (!hit) {
      if (!p.shiftKey && this.insideSelection(p.scene, ed)) {
        ed.beginTransaction()
        this.mode = {
          kind: "pending",
          start: [p.scene[0], p.scene[1]],
          hitId: null,
          originals: this.selected(ed),
          toggleOff: false,
          narrow: false,
        }
        return
      }
      if (ed.appState.editingLinearElementId) ed.setAppState({ editingLinearElementId: null })
      if (!p.shiftKey) ed.clearSelection()
      if (ed.appState.editingGroupId) ed.setAppState({ editingGroupId: null })
      ed.beginTransaction()
      this.mode = {
        kind: "marquee",
        start: [p.scene[0], p.scene[1]],
        base: p.shiftKey ? { ...ed.appState.selectedElementIds } : {},
        inside: [],
      }
      return
    }

    if (ed.appState.editingLinearElementId && ed.appState.editingLinearElementId !== hit.id) {
      ed.setAppState({ editingLinearElementId: null })
    }

    const already = !!ed.appState.selectedElementIds[hit.id]
    let toggleOff = false
    let narrow = false
    if (p.shiftKey) {
      if (already) toggleOff = true
      else ed.applySelection({ ...ed.appState.selectedElementIds, [hit.id]: true })
    } else if (!already) {
      ed.applySelection({ [hit.id]: true })
    } else {
      narrow = true
    }

    ed.beginTransaction()
    this.mode = {
      kind: "pending",
      start: [p.scene[0], p.scene[1]],
      hitId: hit.id,
      originals: this.selected(ed),
      toggleOff,
      narrow,
    }
  }

  onPointerMove(p: PointerInput, ed: EditorCore): void {
    const m = this.mode

    if (m.kind === "pending") {
      if (distance(m.start, p.scene) <= DRAG_THRESHOLD / ed.appState.viewport.zoom) return
      let originals = m.originals
      let restoreIds: string[] | null = null
      if (p.altKey) {
        restoreIds = m.originals.map((o) => o.id)
        originals = ed.duplicateForDrag(m.originals)
        ed.selectElements(originals.map((c) => c.id))
      }
      // alt-drag copies were made after the step opened, so the drag keeps its own baseline
      const moving = ed.withFrameChildren(originals)
      const bases = new Map(ed.scene.getMany(moving).map((el) => [el.id, el]))
      this.mode = { kind: "move", start: m.start, originals, restoreIds, moving, bases }
      this.doMove(p, ed, this.mode)
      return
    }

    switch (m.kind) {
      case "move":
        this.doMove(p, ed, m)
        break
      case "marquee": {
        const box = normalizeRect(m.start, p.scene)
        ed.setMarquee(box)
        const inside = elementsInBounds(ed.scene.getNonDeleted(), box)
          .filter((el) => !isBoundText(el))
          .map((el) => el.id)
        if (inside.length === m.inside.length && inside.every((id, i) => id === m.inside[i])) break
        m.inside = inside
        const next = { ...m.base }
        for (const id of inside) next[id] = true
        ed.applySelection(next)
        break
      }
      case "resize":
        this.doResize(p, ed, m)
        break
      case "rotate":
        this.doRotate(p, ed, m)
        break
      case "point": {
        const el = ed.scene.get(m.elementId)
        if (!el || !isLinearElement(el)) return
        const isEnd = m.index === 0 || m.index === el.points.length - 1
        // an arrow end over a shape goes where the binding puts it; other vertices snap like corners
        const binds =
          el.type === "arrow" &&
          isEnd &&
          !suppressesBinding(p) &&
          !!bindableElementAt(ed.scene.getNonDeleted(), p.scene, ed.appState.viewport.zoom, el.id)
        const target = binds ? ed.snapPoint(p.scene) : snapDrawPoint(ed, p.scene, p, new Set([el.id]))
        const base = absolutePointsOf(m.original)
        const grabbed = base[m.index]!
        const dx = target[0] - grabbed[0]
        const dy = target[1] - grabbed[1]
        const pts = base.map((pt): Point => [pt[0], pt[1]])
        for (const i of withClosingTwin(m.original, m.indices)) pts[i] = [base[i]![0] + dx, base[i]![1] + dy]
        ed.scene.update(rebaseFromPoints(el, pts))
        // a labelled or closed line keeps its label and connections with it as it changes shape
        ed.settleShape(el.id)
        this.showEndpointBinding(ed, el, m.index, target, suppressesBinding(p))
        break
      }
      case "segment": {
        const el = ed.scene.get(m.elementId)
        if (!el || el.type !== "arrow") return
        const pts = moveElbowSegment(absolutePointsOf(m.original), m.index, ed.snapPoint(p.scene))
        ed.scene.update(rebaseFromPoints(el, pts))
        ed.relayoutContainer(el.id)
        break
      }
      case "pointMarquee": {
        if (!m.dragged && distance(m.start, p.scene) <= DRAG_THRESHOLD / ed.appState.viewport.zoom) break
        m.dragged = true
        const el = ed.scene.get(m.elementId)
        if (!el || !isLinearElement(el)) break
        const box = normalizeRect(m.start, p.scene)
        ed.setMarquee(box)
        const picked = new Set(m.base)
        absolutePointsOf(el).forEach((pt, i) => {
          if (boundsContainPoint(box, pt)) picked.add(i)
        })
        if (isClosedPolygon(el)) picked.delete(el.points.length - 1)
        ed.setAppState({ selectedPointIndices: [...picked].sort((a, b) => a - b) })
        break
      }
    }
  }

  private doMove(p: PointerInput, ed: EditorCore, m: Extract<Mode, { kind: "move" }>): void {
    let dx = p.scene[0] - m.start[0]
    let dy = p.scene[1] - m.start[1]
    if (p.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0
      else dx = 0
    }
    // holding Cmd/Ctrl inverts snapping for this move: grid off, object snapping toggled
    const invert = p.metaKey || p.ctrlKey
    const grid = invert ? null : ed.appState.gridSize
    if (grid) {
      const first = m.originals[0]
      if (first) {
        const snapped = snapToGrid([first.x + dx, first.y + dy], grid)
        dx = snapped[0] - first.x
        dy = snapped[1] - first.y
      }
    }

    const moving = m.moving

    if (!grid && ed.appState.objectsSnapMode !== invert) {
      const movedBounds = getCommonBounds(m.originals)
      const shifted: Bounds = [
        movedBounds[0] + dx,
        movedBounds[1] + dy,
        movedBounds[2] + dx,
        movedBounds[3] + dy,
      ]
      // what travels with the selection (its arrows, labels, frame contents) is no anchor to snap to
      const others = snapTargets(ed.scene.getNonDeleted(), moving)
      const snap = computeSnap(shifted, others, ed.appState.viewport.zoom)
      dx += snap.offset[0]
      dy += snap.offset[1]
      ed.setSnapLines(snap.lines)
    } else {
      ed.setSnapLines([])
    }

    const moved: NibElement[] = []
    for (const id of moving) {
      const cur = ed.scene.get(id)
      const base = m.bases.get(id)
      if (cur && base) moved.push(mutateElement(cur, { x: base.x + dx, y: base.y + dy }))
    }
    ed.scene.updateMany(moved)

    ed.moveBoundText(moving)
    ed.refreshBoundArrows(moving, { rigid: true })

    ed.setFrameHighlight(this.dropFrame(p, ed, m))
  }

  /** Whether a moved element follows its own frame, which travels with the selection. */
  private followsFrame(el: NibElement, m: Extract<Mode, { kind: "move" }>): boolean {
    return !!el.frameId && m.moving.has(el.frameId)
  }

  /** The frame under the pointer that some moved element would join on release, if any. */
  private dropFrame(p: PointerInput, ed: EditorCore, m: Extract<Mode, { kind: "move" }>): NibElement | null {
    const frame = frameAtPoint(ed.scene.getNonDeleted(), p.scene)
    if (!frame || m.moving.has(frame.id)) return null
    const fb = getElementBounds(frame)
    const joins = (el: NibElement | undefined): boolean =>
      !!el && el.type !== "frame" && !this.followsFrame(el, m) && boundsIntersect(getElementBounds(el), fb)
    return m.originals.some((o) => joins(ed.scene.get(o.id))) ? frame : null
  }

  private doResize(p: PointerInput, ed: EditorCore, m: Extract<Mode, { kind: "resize" }>): void {
    const opts = { keepAspect: p.shiftKey, fromCenter: p.altKey }
    // grabbing a handle off-centre must not make the edge jump to the pointer
    const raw: Point = [p.scene[0] + m.offset[0], p.scene[1] + m.offset[1]]
    const cropId = ed.appState.croppingElementId
    const cropping = !!cropId && m.originals.length === 1 && m.originals[0]!.id === cropId
    // a rotated box's handle moves off the axes that edges and centres line up on
    const turned = m.originals.length === 1 && m.originals[0]!.angle !== 0
    const pointer =
      cropping || turned
        ? ed.snapPoint(raw)
        : snapDrawPoint(ed, raw, p, ed.withFrameChildren(m.originals), handleSnapAxes(m.handle))

    if (cropping) {
      const original = m.originals[0]!
      const cur = ed.scene.get(cropId)
      if (original.type !== "image" || !cur || cur.type !== "image") return
      ed.scene.update(adoptChanges(cur, cropElement(original, m.handle, pointer)))
      return
    }

    const ids = new Set(m.originals.map((o) => o.id))
    if (m.originals.length === 1) {
      const original = m.originals[0]!
      const cur = ed.scene.get(original.id)
      if (!cur) return
      const resized = resizeElement(original, m.handle, pointer, {
        ...opts,
        keepAspect: opts.keepAspect || original.type === "image",
      })
      ed.scene.update(adoptChanges(cur, resized))
      ed.relayoutContainer(original.id, { handle: m.handle, fromCenter: opts.fromCenter })
    } else {
      // labels go first so each container lays out with its label's scaled font
      for (const u of resizeMultiple([...m.labels, ...m.originals], m.bounds, m.handle, pointer, opts)) {
        const cur = ed.scene.get(u.id)
        if (cur) ed.scene.update(adoptChanges(cur, u))
        ed.relayoutContainer(u.id, { handle: m.handle, fromCenter: opts.fromCenter })
      }
    }
    ed.detachArrowsLeftBehind(ids)
    ed.refreshBoundArrows(ids)
  }

  private doRotate(p: PointerInput, ed: EditorCore, m: Extract<Mode, { kind: "rotate" }>): void {
    const { originals, center } = m
    const ids = new Set(originals.map((o) => o.id))
    if (originals.length === 1) {
      const o = originals[0]!
      const cur = ed.scene.get(o.id)
      if (!cur || o.type === "frame") return
      const turned = rotateElementTo(o, p.scene, p.shiftKey)
      // lines and arrows take the rotation into their points, so every solver sees what is drawn
      const next = isLinearElement(o) ? rotatePointsElement(o, center, turned.angle - o.angle) : turned
      ed.scene.update(adoptChanges(cur, next))
    } else {
      let delta = Math.atan2(p.scene[1] - center[1], p.scene[0] - center[0]) + Math.PI / 2
      if (p.shiftKey) {
        const step = Math.PI / 12
        delta = Math.round(delta / step) * step
      }
      const cos = Math.cos(delta)
      const sin = Math.sin(delta)
      for (const o of originals) {
        const cur = ed.scene.get(o.id)
        if (!cur || o.type === "frame") continue
        if (isLinearElement(o)) {
          ed.scene.update(adoptChanges(cur, rotatePointsElement(o, center, delta)))
          continue
        }
        const oc = elementCenter(o)
        const dx = oc[0] - center[0]
        const dy = oc[1] - center[1]
        const nc: Point = [center[0] + dx * cos - dy * sin, center[1] + dx * sin + dy * cos]
        ed.scene.update(
          mutateElement(cur, {
            angle: normalizeAngle(o.angle + delta),
            x: nc[0] - o.width / 2,
            y: nc[1] - o.height / 2,
          }),
        )
      }
    }
    for (const id of ids) ed.relayoutContainer(id)
    ed.detachArrowsLeftBehind(ids)
    ed.refreshBoundArrows(ids, { rigid: true })
  }

  /** Highlight and dot for the shape an endpoint would attach to. */
  private showEndpointBinding(
    ed: EditorCore,
    el: LinearElement,
    index: number,
    at: Point,
    suppress: boolean,
  ): void {
    const isEnd = index === 0 || index === el.points.length - 1
    if (el.type !== "arrow" || !isEnd || suppress) {
      ed.setBindingHighlight(null)
      ed.setBindingHints([])
      return
    }
    const shape = bindableElementAt(ed.scene.getNonDeleted(), at, ed.appState.viewport.zoom, el.id)
    ed.setBindingHighlight(shape)
    if (!shape) {
      ed.setBindingHints([])
      return
    }
    const cur = ed.scene.get(el.id)
    if (!cur || cur.type !== "arrow") return
    // solve exactly as the release will, so the dot is where the end lands
    const key = index === 0 ? "startBinding" : "endBinding"
    const binding = createBinding(shape, cur, index === 0 ? "start" : "end", undefined, {
      allowFixed: !cur.elbowed,
    })
    const bound = mutateElement(cur, { [key]: binding })
    const solved = absolutePointsOf(updateBoundArrow(bound, (id) => ed.scene.get(id)))
    ed.setBindingHints([solved[index === 0 ? 0 : solved.length - 1]!])
  }

  onPointerUp(p: PointerInput, ed: EditorCore): void {
    const m = this.mode
    this.mode = { kind: "idle" }
    ed.setMarquee(null)
    ed.setBindingHighlight(null)
    ed.setBindingHints([])
    ed.setSnapLines([])
    ed.setFrameHighlight(null)

    switch (m.kind) {
      case "pending": {
        ed.rollbackTransaction()
        const hit = m.hitId ? ed.scene.get(m.hitId) : null
        if (!hit) {
          // a click (not a drag) on empty space inside the selection still means "deselect"
          if (!m.hitId) ed.clearSelection()
          break
        }
        if (m.toggleOff) {
          const gid = outermostGroupId(hit, ed.appState.editingGroupId)
          const next = { ...ed.appState.selectedElementIds }
          for (const el of ed.scene.getNonDeleted())
            if (el.id === hit.id || (gid && el.groupIds.includes(gid))) delete next[el.id]
          ed.applySelection(next)
        } else if (m.narrow) {
          const unit = expandSelectionToGroups(
            ed.scene.getNonDeleted(),
            { [hit.id]: true },
            ed.appState.editingGroupId,
          )
          if (
            Object.keys(unit.selectedElementIds).length < Object.keys(ed.appState.selectedElementIds).length
          )
            ed.setAppState(unit)
        }
        break
      }
      case "marquee":
        ed.rollbackTransaction()
        break
      case "move": {
        const all = ed.scene.getNonDeleted()
        const target = this.dropFrame(p, ed, m)
        const targetBounds = target ? getElementBounds(target) : null
        for (const o of m.originals) {
          const cur = ed.scene.get(o.id)
          if (!cur || cur.type === "frame" || this.followsFrame(cur, m)) continue
          // the frame under the pointer takes what overlaps it; everything else goes by where it now sits
          const nextFrame =
            target && targetBounds && boundsIntersect(getElementBounds(cur), targetBounds)
              ? target.id
              : frameIdFor(all, cur)
          if (cur.frameId !== nextFrame) ed.scene.update(mutateElement(cur, { frameId: nextFrame }))
        }
        ed.syncLabelFrames(m.originals.map((o) => o.id))
        ed.detachArrowsLeftBehind(m.moving)
        ed.commitTransaction()
        break
      }
      case "resize":
      case "rotate":
      case "segment":
        ed.commitTransaction()
        break
      case "point": {
        const el = ed.scene.get(m.elementId)
        if (el && el.type === "arrow") {
          const last = el.points.length - 1
          for (const i of m.indices) {
            const cur = ed.scene.get(el.id)
            if (cur?.type === "arrow" && (i === 0 || i === last))
              ed.rebindArrowEnds(cur, i, { suppress: suppressesBinding(p) })
          }
        }
        ed.commitTransaction()
        break
      }
      case "pointMarquee":
        ed.rollbackTransaction()
        if (!m.dragged) {
          ed.setAppState({ editingLinearElementId: null, editingGroupId: null })
          if (!p.shiftKey) ed.clearSelection()
        }
        break
      default:
        ed.rollbackTransaction()
    }
  }

  onDoubleClick(p: PointerInput, ed: EditorCore): void {
    const hit =
      elementAtPoint(ed.scene.getNonDeleted(), p.scene, ed.appState.viewport.zoom, ed.appState) ??
      this.frameLabelAt(p.scene, ed) ??
      labelContainerAtPoint(ed.scene.getNonDeleted(), p.scene, canHaveLabel, 10 / ed.appState.viewport.zoom)
    if (!hit) {
      ed.startEditingText(createTextAt(ed, p.scene))
      return
    }

    const groupId = outermostGroupId(hit, ed.appState.editingGroupId)
    if (groupId) {
      ed.setAppState({ editingGroupId: groupId })
      ed.applySelection({ [hit.id]: true })
      return
    }
    if (isLinearElement(hit)) {
      // the body of an arrow or closed line takes a label; vertices (and open lines) open point editing
      const tol = POINT_HIT / ed.appState.viewport.zoom
      const onVertex = absolutePointsOf(hit).some((pt) => distance(pt, p.scene) <= tol)
      if (canHaveLabel(hit) && !onVertex && ed.appState.editingLinearElementId !== hit.id) {
        ed.startEditingLabel(hit)
        return
      }
      ed.setAppState({ editingLinearElementId: hit.id, selectedElementIds: { [hit.id]: true } })
      return
    }
    if (hit.type === "image") {
      ed.requestCrop(hit.id)
      return
    }
    if (hit.type === "text") {
      ed.startEditingText(hit)
      return
    }
    if (canHaveLabel(hit)) {
      ed.startEditingLabel(hit)
      return
    }
    if (hit.type === "frame") ed.startRenamingFrame(hit)
  }

  onKeyDown(e: KeyInput, ed: EditorCore): boolean {
    if (e.key === "Enter" && !e.altKey) {
      const sel = this.selected(ed)
      if (sel.length !== 1) return false
      const el = sel[0]!
      if (el.locked) return false
      // Cmd/Ctrl+Enter edits points; plain Enter gives an arrow a label (lines have none)
      if (isLinearElement(el) && (e.metaKey || e.ctrlKey || !canHaveLabel(el))) {
        ed.setAppState({ editingLinearElementId: el.id })
        return true
      }
      if (e.metaKey || e.ctrlKey) return false
      if (el.type === "text") {
        ed.startEditingText(el)
        return true
      }
      if (canHaveLabel(el)) {
        ed.startEditingLabel(el)
        return true
      }
    }
    return false
  }

  cancel(ed: EditorCore): void {
    const m = this.mode
    this.mode = { kind: "idle" }
    if (m.kind !== "idle") ed.rollbackTransaction()
    // an abandoned alt-drag removed its copies; select the elements the drag started from
    if (m.kind === "move" && m.restoreIds) ed.selectElements(m.restoreIds)
    ed.setMarquee(null)
    ed.setSnapLines([])
    ed.setFrameHighlight(null)
    ed.setBindingHighlight(null)
    ed.setBindingHints([])
  }

  cursor(p: PointerInput, ed: EditorCore): string {
    if (ed.appState.viewMode) return "grab"
    if (this.mode.kind === "move") return "move"
    if (this.linearPointAt(p.scene, ed)) return "pointer"
    const segment = this.segmentAt(p.scene, ed)
    if (segment) {
      const pts = absolutePointsOf(segment.el)
      const horizontal = pts[segment.index]![1] === pts[segment.index + 1]![1]
      return horizontal ? "ns-resize" : "ew-resize"
    }
    if (this.endpointAt(p.scene, ed) || this.midpointAt(p.scene, ed)) return "pointer"
    const handle = this.handleAt(p.scene, ed)
    if (handle) {
      const sel = this.selected(ed)
      return handleCursor(handle, sel.length === 1 ? sel[0]!.angle : 0)
    }
    const hit = elementAtPoint(ed.scene.getNonDeleted(), p.scene, ed.appState.viewport.zoom, ed.appState)
    return hit || this.insideSelection(p.scene, ed) ? "move" : "default"
  }
}

/** The point on the selection's edge that `handle` drags, before any rotation is undone. */
const handleEdgePoint = (handle: HandleType, originals: readonly NibElement[], bounds: Bounds): Point => {
  const single = originals.length === 1 ? originals[0]! : null
  const [x1, y1, x2, y2] = single
    ? [single.x, single.y, single.x + single.width, single.y + single.height]
    : bounds
  const x = handle.includes("w") ? x1 : handle.includes("e") ? x2 : (x1 + x2) / 2
  const y = handle.includes("n") ? y1 : handle.includes("s") ? y2 : (y1 + y2) / 2
  return single && single.angle !== 0 ? rotatePoint([x, y], elementCenter(single), single.angle) : [x, y]
}

const isClosedPolygon = (el: LinearElement): boolean => {
  if (el.type !== "line" || !el.polygon || el.points.length < 4) return false
  const first = el.points[0]!
  const last = el.points[el.points.length - 1]!
  return first[0] === last[0] && first[1] === last[1]
}

/** A closed line's first and last points are one corner, so moving either moves both. */
const withClosingTwin = (el: LinearElement, indices: readonly number[]): Set<number> => {
  const out = new Set(indices)
  if (!isClosedPolygon(el)) return out
  const last = el.points.length - 1
  if (out.has(0)) out.add(last)
  if (out.has(last)) out.add(0)
  return out
}

/** Freeform lasso selection; shares selection semantics with the marquee. */
export class LassoTool implements Tool {
  readonly type = "lasso"
  private points: Point[] = []
  private active = false

  onPointerDown(p: PointerInput, ed: EditorCore): void {
    this.active = true
    this.points = [[p.scene[0], p.scene[1]]]
    if (!p.shiftKey) ed.clearSelection()
  }
  onPointerMove(p: PointerInput, ed: EditorCore): void {
    if (!this.active) return
    this.points.push([p.scene[0], p.scene[1]])
    ed.setLasso(this.points)
  }
  onPointerUp(_p: PointerInput, ed: EditorCore): void {
    if (!this.active) return
    this.active = false
    const picked = ed.elementsInLasso(this.points)
    const next: Record<string, true> = { ...ed.appState.selectedElementIds }
    for (const el of picked) next[el.id] = true
    ed.applySelection(next)
    ed.setLasso(null)
    this.points = []
    if (!ed.appState.toolLocked) ed.setTool("selection")
  }
  cancel(ed: EditorCore): void {
    this.active = false
    this.points = []
    ed.setLasso(null)
  }
  cursor(): string {
    return "crosshair"
  }
}

export const reselectGroups = expandSelectionToGroups
export const hitTest = hitTestElement
export const boundsOf = getElementBounds

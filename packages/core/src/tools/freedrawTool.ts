import type { EditorCore } from "../editor/editorCore"
import { absolutePointsOf, rebaseFromPoints } from "../geometry/linear"
import { recognizeStroke } from "../geometry/recognize"
import type { Point } from "../math/vector"
import { mutateElement, newElement } from "../model/element"
import type { FreedrawElement } from "../model/types"
import { suppressesBinding } from "./helpers"
import type { PointerInput, Tool } from "./types"

/** Below this a pointer sample adds nothing visible to the stroke. */
const MIN_SAMPLE_DISTANCE = 0.7
/** A tap becomes a dot: a stroke of two nearly coincident points, which the outline renders round. */
const DOT_OFFSET = 0.01

export interface FreedrawToolOptions {
  /** Pencil mode: a stroke the recognizer understands is replaced by the clean shape. */
  recognize?: boolean
}

/**
 * Freehand pen, and the pencil when `recognize` is on. Samples are kept in
 * scene space and the element is re-anchored from them, so a stroke drawn left
 * or up stays under the pointer. The tool stays armed after a stroke and leaves
 * nothing selected, so strokes can follow one another.
 */
export class FreedrawTool implements Tool {
  readonly type: "freedraw" | "pencil"
  private readonly recognize: boolean
  private draftId: string | null = null
  private points: Point[] = []
  private pressures: number[] = []

  constructor(opts: FreedrawToolOptions = {}) {
    this.recognize = opts.recognize ?? false
    this.type = this.recognize ? "pencil" : "freedraw"
  }

  onPointerDown(p: PointerInput, ed: EditorCore): void {
    ed.beginTransaction()
    const a = ed.appState
    const pressure = p.pressure || 0.5
    this.points = [[p.scene[0], p.scene[1]]]
    this.pressures = [pressure]
    const el = newElement("freedraw", {
      x: p.scene[0],
      y: p.scene[1],
      width: 0,
      height: 0,
      index: ed.scene.nextIndex(),
      strokeColor: a.currentItemStrokeColor,
      backgroundColor: "transparent",
      fillStyle: a.currentItemFillStyle,
      strokeWidth: a.currentItemStrokeWidth,
      strokeStyle: "solid",
      roughness: a.currentItemRoughness,
      opacity: a.currentItemOpacity,
      points: [[0, 0]],
      pressures: [pressure],
      simulatePressure: p.pressure === 0 || p.pressure === 0.5,
    })
    this.draftId = el.id
    ed.scene.insert(el)
    ed.setAppState({ selectedElementIds: {}, selectedGroupIds: {} })
  }

  private draft(ed: EditorCore): FreedrawElement | null {
    const el = this.draftId ? ed.scene.get(this.draftId) : null
    return el && el.type === "freedraw" ? el : null
  }

  onPointerMove(p: PointerInput, ed: EditorCore): void {
    const el = this.draft(ed)
    if (!el) return
    const last = this.points[this.points.length - 1]!
    if (Math.hypot(last[0] - p.scene[0], last[1] - p.scene[1]) < MIN_SAMPLE_DISTANCE) return
    this.points.push([p.scene[0], p.scene[1]])
    this.pressures.push(p.pressure || 0.5)
    ed.scene.update(rebaseFromPoints(mutateElement(el, { pressures: [...this.pressures] }), this.points))
  }

  onPointerUp(p: PointerInput, ed: EditorCore): void {
    const el = this.draft(ed)
    this.draftId = null
    if (!el) return
    const tap = this.points.length === 1
    if (tap) {
      const [x, y] = this.points[0]!
      this.points.push([x + DOT_OFFSET, y + DOT_OFFSET])
      this.pressures.push(this.pressures[0]!)
    }
    const committed = rebaseFromPoints(mutateElement(el, { pressures: [...this.pressures] }), this.points)
    ed.scene.update(
      mutateElement(committed, {
        lastCommittedPoint: committed.points[committed.points.length - 1]!,
      }),
    )
    ed.assignFrame(committed.id)
    this.points = []
    this.pressures = []
    ed.setAppState({ selectedElementIds: {}, selectedGroupIds: {} })
    ed.commitTransaction()
    // the raw stroke is its own undo step, so one undo of the correction brings it back; Alt keeps it raw
    if (this.recognize && !tap && !p.altKey) this.correct(committed.id, p, ed)
  }

  private correct(id: string, p: PointerInput, ed: EditorCore): void {
    const stroke = ed.scene.get(id)
    if (!stroke || stroke.type !== "freedraw" || stroke.isDeleted) return
    const r = recognizeStroke(absolutePointsOf(stroke), {
      zoom: ed.appState.viewport.zoom,
      shift: p.shiftKey,
    })
    if (r) ed.replaceStrokeWithShape(id, r, { bind: !suppressesBinding(p) })
  }

  cancel(ed: EditorCore): void {
    if (this.draftId) {
      this.draftId = null
      ed.rollbackTransaction()
    }
    this.points = []
    this.pressures = []
  }

  cursor(): string {
    return "crosshair"
  }
}

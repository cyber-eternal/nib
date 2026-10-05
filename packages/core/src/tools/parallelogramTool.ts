import type { EditorCore } from "../editor/editorCore"
import { rebaseFromPoints } from "../geometry/linear"
import type { Point } from "../math/vector"
import { newElement } from "../model/element"
import type { AppState, LineElement } from "../model/types"
import { snapDrawPoint } from "./helpers"
import { type Box, boxFromDrag } from "./shapeTool"
import type { PointerInput, Tool } from "./types"

/** How far the top edge shifts right, as a share of the width. */
export const PARALLELOGRAM_SKEW = 0.2

/**
 * The corners of the parallelogram that fills a box, clockwise on screen from the top-left, with the
 * top edge shifted right. The shift is at most half the height, so a flat box does not lean flat, and
 * always less than the width, so the shape never inverts.
 */
export const parallelogramVertices = (box: Box): [Point, Point, Point, Point] => {
  const { x, y, width: w, height: h } = box
  const s = Math.min(w * PARALLELOGRAM_SKEW, h / 2)
  return [
    [x + s, y],
    [x + w, y],
    [x + w - s, y + h],
    [x, y + h],
  ]
}

/** The points of a closed line through `vertices`: it ends where it starts. */
export const closedPoints = (vertices: readonly Point[]): Point[] =>
  vertices.length > 0 ? [...vertices, vertices[0]!] : []

/** Closed lines draw straight whatever their roundness; it only shows if the line is opened again. */
export const polygonRoundness = (a: AppState): LineElement["roundness"] =>
  a.currentItemRoundness === "round" ? { type: 2 } : null

const shaped = (el: LineElement, box: Box): LineElement =>
  rebaseFromPoints(el, closedPoints(parallelogramVertices(box)))

const MIN_DRAG = 2
/** A click without a drag drops an input/output box of this size. */
const DEFAULT_WIDTH = 160
const DEFAULT_HEIGHT = 80

/**
 * Drags out a flowchart input/output parallelogram. It is a closed polygon line, so it fills, takes
 * arrows and holds a label like the other closed shapes. Shift keeps the box square and Alt draws it
 * from the centre, as for the other box tools; every drag direction gives the same right-leaning shape.
 */
export class ParallelogramTool implements Tool {
  readonly type = "parallelogram"
  private draftId: string | null = null
  private origin: Point | null = null

  onPointerDown(p: PointerInput, ed: EditorCore): void {
    ed.beginTransaction()
    const a = ed.appState
    const start = snapDrawPoint(ed, p.scene, p, new Set())
    this.origin = [start[0], start[1]]
    const draft = newElement("line", {
      index: ed.scene.nextIndex(),
      strokeColor: a.currentItemStrokeColor,
      backgroundColor: a.currentItemBackgroundColor,
      fillStyle: a.currentItemFillStyle,
      strokeWidth: a.currentItemStrokeWidth,
      strokeStyle: a.currentItemStrokeStyle,
      roughness: a.currentItemRoughness,
      opacity: a.currentItemOpacity,
      roundness: polygonRoundness(a),
      polygon: true,
    })
    const el = shaped(draft, { x: start[0], y: start[1], width: 0, height: 0 })
    this.draftId = el.id
    ed.scene.insert(el)
    ed.setAppState({ selectedElementIds: {}, selectedGroupIds: {} })
  }

  onPointerMove(p: PointerInput, ed: EditorCore): void {
    if (!this.draftId || !this.origin) return
    const el = ed.scene.get(this.draftId)
    if (!el || el.type !== "line") return
    const cur = snapDrawPoint(ed, p.scene, p, new Set([el.id]))
    ed.scene.update(shaped(el, boxFromDrag(this.origin, cur, p)))
  }

  onPointerUp(_p: PointerInput, ed: EditorCore): void {
    ed.setSnapLines([])
    const id = this.draftId
    const origin = this.origin
    this.draftId = null
    this.origin = null
    if (!id) return
    let el = ed.scene.get(id)
    if (!el || el.type !== "line" || !origin) {
      ed.rollbackTransaction()
      return
    }
    if (el.width < MIN_DRAG && el.height < MIN_DRAG) {
      el = shaped(el, {
        x: origin[0] - DEFAULT_WIDTH / 2,
        y: origin[1] - DEFAULT_HEIGHT / 2,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
      })
      ed.scene.update(el)
    }
    ed.assignFrame(id)
    ed.setAppState({
      selectedElementIds: { [id]: true },
      activeTool: ed.appState.toolLocked ? ed.appState.activeTool : "selection",
    })
    ed.commitTransaction()
  }

  cancel(ed: EditorCore): void {
    ed.setSnapLines([])
    if (this.draftId) {
      this.draftId = null
      ed.rollbackTransaction()
    }
    this.origin = null
  }

  cursor(): string {
    return "crosshair"
  }
}

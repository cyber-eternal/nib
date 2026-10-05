import type { EditorCore } from "../editor/editorCore"
import { randomId } from "../math/random"
import type { Point } from "../math/vector"
import { mutateElement, newElement } from "../model/element"
import type { ElementType, NibElement } from "../model/types"
import { snapDrawPoint } from "./helpers"
import type { PointerInput, Tool } from "./types"

const MIN_DRAG = 2
/** Click without dragging drops a shape of this size, so a stray click is useful. */
const DEFAULT_SIZE = 100

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The box a drag from `origin` to `cur` spans, in any direction: Shift makes it square and Alt
 * grows it about the origin.
 */
export const boxFromDrag = (origin: Point, cur: Point, mods: { shiftKey: boolean; altKey: boolean }): Box => {
  let w = cur[0] - origin[0]
  let h = cur[1] - origin[1]
  if (mods.shiftKey) {
    const s = Math.max(Math.abs(w), Math.abs(h))
    w = (w < 0 ? -1 : 1) * s
    h = (h < 0 ? -1 : 1) * s
  }
  let x = origin[0]
  let y = origin[1]
  if (mods.altKey) {
    x -= w
    y -= h
    w *= 2
    h *= 2
  }
  return { x: Math.min(x, x + w), y: Math.min(y, y + h), width: Math.abs(w), height: Math.abs(h) }
}

/** Drags out a box-shaped element; both corners snap to other elements and the grid. */
export class ShapeTool implements Tool {
  private draftId: string | null = null
  private origin: [number, number] | null = null

  constructor(readonly type: ElementType) {}

  onPointerDown(p: PointerInput, ed: EditorCore): void {
    ed.beginTransaction()
    const a = ed.appState
    const start = snapDrawPoint(ed, p.scene, p, new Set())
    this.origin = [start[0], start[1]]
    const el = newElement(this.type, {
      x: start[0],
      y: start[1],
      width: 0,
      height: 0,
      index: ed.scene.nextIndex(),
      strokeColor: a.currentItemStrokeColor,
      backgroundColor: this.type === "frame" ? "transparent" : a.currentItemBackgroundColor,
      fillStyle: a.currentItemFillStyle,
      strokeWidth: a.currentItemStrokeWidth,
      strokeStyle: a.currentItemStrokeStyle,
      roughness: this.type === "frame" ? 0 : a.currentItemRoughness,
      opacity: a.currentItemOpacity,
      roundness:
        a.currentItemRoundness === "round" && (this.type === "rectangle" || this.type === "diamond")
          ? { type: 3 }
          : null,
      name: this.type === "frame" ? `Frame ${ed.nextFrameNumber()}` : undefined,
    })
    this.draftId = el.id
    ed.scene.insert(el)
    ed.setAppState({ selectedElementIds: {}, selectedGroupIds: {} })
  }

  onPointerMove(p: PointerInput, ed: EditorCore): void {
    if (!this.draftId || !this.origin) return
    const el = ed.scene.get(this.draftId)
    if (!el) return
    const cur = snapDrawPoint(ed, p.scene, p, new Set([el.id]))
    ed.scene.update(mutateElement(el, boxFromDrag(this.origin, cur, p)))
  }

  onPointerUp(_p: PointerInput, ed: EditorCore): void {
    ed.setSnapLines([])
    if (!this.draftId) return
    const el = ed.scene.get(this.draftId)
    this.draftId = null
    if (!el) return

    let finished: NibElement = el
    if (el.width < MIN_DRAG && el.height < MIN_DRAG) {
      const size = this.type === "frame" ? DEFAULT_SIZE * 3 : DEFAULT_SIZE
      finished = mutateElement(el, {
        x: el.x - size / 2,
        y: el.y - size / 2,
        width: size,
        height: this.type === "frame" ? size * 0.66 : size,
      })
      ed.scene.update(finished)
    }

    if (this.type === "frame") ed.captureFrameChildren(finished.id)
    else ed.assignFrame(finished.id)

    ed.setAppState({
      selectedElementIds: { [finished.id]: true },
      activeTool: ed.appState.toolLocked ? ed.appState.activeTool : "selection",
    })
    ed.commitTransaction()
    this.origin = null
    // an embed is useless without an address, so the host asks for one straight away
    const placed = ed.scene.get(finished.id)
    if (placed?.type === "embeddable" && !placed.link) ed.host.onEditEmbed?.(placed)
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

export const newGroupId = (): string => randomId()

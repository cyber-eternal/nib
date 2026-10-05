import type { EditorCore } from "../editor/editorCore"
import { segmentHitsElement } from "../geometry/hitTest"
import type { Point } from "../math/vector"
import { outermostGroupId } from "../model/groups"
import type { NibElement } from "../model/types"
import { panBy } from "../render/viewport"
import { isBoundText } from "./helpers"
import type { PointerInput, Tool } from "./types"

export class HandTool implements Tool {
  readonly type = "hand"
  private last: Point | null = null

  onPointerDown(p: PointerInput): void {
    this.last = [p.screen[0], p.screen[1]]
  }
  onPointerMove(p: PointerInput, ed: EditorCore): void {
    if (!this.last) return
    ed.setAppState({
      viewport: panBy(ed.appState.viewport, p.screen[0] - this.last[0], p.screen[1] - this.last[1]),
    })
    this.last = [p.screen[0], p.screen[1]]
  }
  onPointerUp(): void {
    this.last = null
  }
  cancel(): void {
    this.last = null
  }
  cursor(): string {
    return this.last ? "grabbing" : "grab"
  }
}

const ERASER_TOLERANCE = 10

/**
 * Marks everything the pointer passes over, testing the whole segment between
 * samples so a fast stroke misses nothing, and deletes the marked elements on
 * release; until then the host draws them faded (EditorCore.pendingEraseIds).
 * Grouped elements go as a group, a label as its container. Holding Alt while
 * passing over a marked element un-marks just that element (or its group).
 */
export class EraserTool implements Tool {
  readonly type = "eraser"
  private active = false
  private last: Point | null = null
  private pending = new Set<string>()

  onPointerDown(p: PointerInput, ed: EditorCore): void {
    ed.beginTransaction()
    this.active = true
    this.pending = new Set()
    this.last = [p.scene[0], p.scene[1]]
    this.sweep(this.last, this.last, p, ed)
  }

  onPointerMove(p: PointerInput, ed: EditorCore): void {
    if (!this.active || !this.last) return
    const from = this.last
    this.last = [p.scene[0], p.scene[1]]
    this.sweep(from, this.last, p, ed)
  }

  private sweep(from: Point, to: Point, p: PointerInput, ed: EditorCore): void {
    const hits = this.hitsAlong(from, to, ed)
    let changed = false
    for (const id of hits) {
      if (p.altKey ? this.pending.delete(id) : !this.pending.has(id)) changed = true
      if (!p.altKey) this.pending.add(id)
    }
    if (changed) ed.setPendingErase([...this.pending])
  }

  /** Ids of what the segment from-to passes over, with labels as their containers and groups whole. */
  private hitsAlong(from: Point, to: Point, ed: EditorCore): string[] {
    const tol = ERASER_TOLERANCE / ed.appState.viewport.zoom
    const editing = ed.appState.editingGroupId
    const els = ed.scene.getNonDeleted()
    const hits: NibElement[] = []
    for (const el of els) {
      if (el.locked) continue
      if (editing && !el.groupIds.includes(editing)) continue
      if (!segmentHitsElement(from, to, el, tol)) continue
      // the words belong to their container
      if (el.type === "text" && el.containerId) {
        const container = ed.scene.get(el.containerId)
        if (container && !container.isDeleted && !container.locked) hits.push(container)
        continue
      }
      hits.push(el)
    }
    if (hits.length === 0) return []
    const groups = new Set<string>()
    for (const el of hits) {
      const gid = outermostGroupId(el, editing)
      if (gid) groups.add(gid)
    }
    if (groups.size > 0)
      for (const el of els)
        if (!el.locked && !isBoundText(el) && el.groupIds.some((g) => groups.has(g)) && !hits.includes(el))
          hits.push(el)
    return [...new Set(hits.map((el) => el.id))]
  }

  onPointerUp(_p: PointerInput, ed: EditorCore): void {
    if (!this.active) return
    const marked = ed.scene.getMany(this.pending).filter((el) => !el.isDeleted)
    this.reset(ed)
    if (marked.length > 0) ed.deleteElements(marked)
    ed.commitTransaction()
  }

  cancel(ed: EditorCore): void {
    const active = this.active
    this.reset(ed)
    if (active) ed.rollbackTransaction()
  }

  private reset(ed: EditorCore): void {
    this.active = false
    this.last = null
    this.pending = new Set()
    ed.setPendingErase([])
  }

  cursor(): string {
    return "cell"
  }
}

export class LaserTool implements Tool {
  readonly type = "laser"
  private active = false

  onPointerDown(p: PointerInput, ed: EditorCore): void {
    this.active = true
    ed.pushLaserPoint(p.scene)
  }
  onPointerMove(p: PointerInput, ed: EditorCore): void {
    if (this.active) ed.pushLaserPoint(p.scene)
  }
  onPointerUp(): void {
    this.active = false
  }
  cancel(): void {
    this.active = false
  }
  cursor(): string {
    return "crosshair"
  }
}

/** The picker opens when the tool is chosen; a click on the canvas asks again, placing the image there. */
export class ImageTool implements Tool {
  readonly type = "image"
  onPointerDown(p: PointerInput, ed: EditorCore): void {
    ed.requestImageInsert(p.scene)
  }
  onPointerMove(): void {}
  onPointerUp(): void {}
  cancel(): void {}
  cursor(): string {
    return "crosshair"
  }
}

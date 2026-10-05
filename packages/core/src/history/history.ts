import { ElementsChange } from "../change/elementsChange"
import type { Scene } from "../model/scene"
import type { NibElement } from "../model/types"

const MAX_ENTRIES = 500
/**
 * Estimated bytes the undo and redo stacks may hold together. One entry can carry thousands of
 * point arrays (a flip of 300 freehand strokes is several MB), so a count alone allows gigabytes.
 */
export const HISTORY_BYTE_BUDGET = 64 * 1024 * 1024

// rough heap costs: an element version with its fields, one [x, y] point, one character of text
const ELEMENT_BYTES = 400
const POINT_BYTES = 40
const PRESSURE_BYTES = 8
const CHAR_BYTES = 2

const elementBytes = (el: NibElement | null): number => {
  if (!el) return 0
  let bytes = ELEMENT_BYTES
  if ("points" in el && Array.isArray(el.points)) bytes += el.points.length * POINT_BYTES
  if (el.type === "freedraw" && Array.isArray(el.pressures)) bytes += el.pressures.length * PRESSURE_BYTES
  if (el.type === "text") bytes += ((el.text?.length ?? 0) + (el.originalText?.length ?? 0)) * CHAR_BYTES
  return bytes
}

/**
 * What an entry keeps alive on its own. Its `before` versions are the previous entry's `after`
 * (or the scene's), so each entry is charged for its `after` side, or `before` when that is larger.
 */
export const estimateChangeBytes = (change: ElementsChange): number => {
  let after = 0
  let before = 0
  for (const el of change.after.values()) after += elementBytes(el)
  for (const el of change.before.values()) before += elementBytes(el)
  return Math.max(after, before)
}

export class History {
  private undoStack: ElementsChange[] = []
  private redoStack: ElementsChange[] = []
  private sizes = new WeakMap<ElementsChange, number>()
  private bytes = 0
  private listeners = new Set<() => void>()

  /** Estimated bytes the undo and redo stacks hold now. */
  get size(): number {
    return this.bytes
  }

  record(change: ElementsChange): void {
    if (ElementsChange.isEmpty(change)) return
    for (const dropped of this.redoStack) this.bytes -= this.sizeOf(dropped)
    this.redoStack = []
    const size = estimateChangeBytes(change)
    this.sizes.set(change, size)
    this.bytes += size
    this.undoStack.push(change)
    // the newest step always stays, however large; the oldest go first
    while (
      this.undoStack.length > 1 &&
      (this.undoStack.length > MAX_ENTRIES || this.bytes > HISTORY_BYTE_BUDGET)
    )
      this.bytes -= this.sizeOf(this.undoStack.shift()!)
    this.emit()
  }

  undo(scene: Scene): ElementsChange | null {
    const change = this.undoStack.pop()
    if (!change) return null
    scene.applyChanges(ElementsChange.inverse(change))
    this.redoStack.push(change)
    this.emit()
    return change
  }

  redo(scene: Scene): ElementsChange | null {
    const change = this.redoStack.pop()
    if (!change) return null
    scene.applyChanges(change)
    this.undoStack.push(change)
    this.emit()
    return change
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }
  canRedo(): boolean {
    return this.redoStack.length > 0
  }
  clear(): void {
    this.undoStack = []
    this.redoStack = []
    this.bytes = 0
    this.emit()
  }
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  private sizeOf(change: ElementsChange): number {
    return this.sizes.get(change) ?? 0
  }
  private emit(): void {
    for (const l of this.listeners) l()
  }
}

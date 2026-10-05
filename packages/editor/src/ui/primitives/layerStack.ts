export type DismissReason = "escape" | "outside"

export interface LayerEntry {
  id: string
  /** The layer this one was opened from (React nesting), so a parent and child mounting together stack in order. */
  parentId?: string | null
  modal: boolean
  dismissOnEscape: boolean
  dismissOnOutside: boolean
}

/** Where a pointer press landed relative to one layer: in it, on something it ignores (its anchor), or elsewhere. */
export type LayerHit = "inside" | "ignored" | "outside"

/** The single, DOM-free stack of dismissable layers; the top entry owns Escape. */
export class LayerStack {
  private entries: LayerEntry[] = []
  private listeners = new Set<() => void>()
  private rev = 0

  get layers(): readonly LayerEntry[] {
    return this.entries
  }

  get version(): number {
    return this.rev
  }

  push(entry: LayerEntry): void {
    const existing = this.entries.findIndex((e) => e.id === entry.id)
    if (existing >= 0) {
      this.entries[existing] = entry
      this.emit()
      return
    }
    const firstDescendant = this.entries.findIndex((e) => this.isDescendant(e, entry.id))
    if (firstDescendant >= 0) this.entries.splice(firstDescendant, 0, entry)
    else this.entries.push(entry)
    this.emit()
  }

  remove(id: string): boolean {
    const i = this.entries.findIndex((e) => e.id === id)
    if (i < 0) return false
    this.entries.splice(i, 1)
    this.emit()
    return true
  }

  indexOf(id: string): number {
    return this.entries.findIndex((e) => e.id === id)
  }

  top(): LayerEntry | undefined {
    return this.entries[this.entries.length - 1]
  }

  isTop(id: string): boolean {
    return this.top()?.id === id
  }

  topModalIndex(): number {
    for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i]!.modal) return i
    return -1
  }

  isModalOpen(): boolean {
    return this.topModalIndex() >= 0
  }

  /** The layer an Escape press belongs to. Escape never reaches anything below the top layer. */
  escapeTarget(): LayerEntry | undefined {
    return this.top()
  }

  /**
   * Ids to dismiss for a pointer press, top first. Walks down from the top and stops at the layer that
   * contains the press, at one that ignores it, at one that stays open, or at a modal layer.
   */
  outsideDismissals(hit: (entry: LayerEntry) => LayerHit): string[] {
    const out: string[] = []
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i]!
      if (hit(entry) !== "outside") break
      if (!entry.dismissOnOutside) break
      out.push(entry.id)
      if (entry.modal) break
    }
    return out
  }

  /** Focus may sit in layer `index` (-1 = outside every layer) only at or above the topmost modal layer. */
  allowsFocusIn(index: number): boolean {
    const modal = this.topModalIndex()
    return modal < 0 || index >= modal
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private isDescendant(entry: LayerEntry, ancestorId: string): boolean {
    const seen = new Set<string>()
    let parent = entry.parentId
    while (parent && !seen.has(parent)) {
      if (parent === ancestorId) return true
      seen.add(parent)
      parent = this.entries.find((e) => e.id === parent)?.parentId
    }
    return false
  }

  private emit(): void {
    this.rev++
    for (const l of [...this.listeners]) l()
  }
}

/**
 * Where Tab should move inside a focus-trapping layer, or null to let the browser move focus normally.
 * `current` is the index of the focused element among the layer's tabbables, -1 when focus is outside them.
 */
export const trapTabIndex = (count: number, current: number, backwards: boolean): number | null => {
  if (count === 0) return -1
  if (current < 0) return backwards ? count - 1 : 0
  if (!backwards && current === count - 1) return 0
  if (backwards && current === 0) return count - 1
  return null
}

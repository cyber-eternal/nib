import type { NibElement } from "@nib/core"

export interface ElementPick {
  onPick(el: NibElement): void
  /** Elements that cannot be picked, such as the one a link is being set on. */
  accepts?(el: NibElement): boolean
}

/**
 * "Click an element" mode shared by the canvas and whoever asked (the link popup's link-to-element). While
 * a pick is active the canvas hands the next press on an element here instead of to the tool.
 */
class ElementPicker {
  private current: ElementPick | null = null
  private hoveredId: string | null = null
  private surfaceEl: HTMLElement | null = null
  private readonly listeners = new Set<() => void>()

  /** Starts a pick; returns its cancel. A newer pick replaces an older one. */
  start(pick: ElementPick): () => void {
    this.current = pick
    this.hoveredId = null
    this.emit()
    return () => {
      if (this.current === pick) this.cancel()
    }
  }

  get active(): ElementPick | null {
    return this.current
  }

  get hovered(): string | null {
    return this.hoveredId
  }

  /** The canvas element a pick is made on; presses on it must not dismiss the asking layer. */
  get surface(): HTMLElement | null {
    return this.surfaceEl
  }

  setSurface(el: HTMLElement | null): void {
    this.surfaceEl = el
  }

  accepts(el: NibElement | null): el is NibElement {
    return !!el && !el.isDeleted && (this.current?.accepts?.(el) ?? true)
  }

  hover(el: NibElement | null): void {
    const id = this.accepts(el) ? el.id : null
    if (id === this.hoveredId) return
    this.hoveredId = id
    this.emit()
  }

  /** Called by the canvas; true when the press was taken by the pick. */
  pick(el: NibElement | null): boolean {
    const pick = this.current
    if (!pick) return false
    if (!this.accepts(el)) return true
    this.current = null
    this.hoveredId = null
    this.emit()
    pick.onPick(el)
    return true
  }

  cancel(): void {
    if (!this.current && this.hoveredId === null) return
    this.current = null
    this.hoveredId = null
    this.emit()
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(): void {
    for (const cb of this.listeners) cb()
  }
}

export const elementPicker = new ElementPicker()

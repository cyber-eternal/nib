/**
 * Which embed takes pointer input (a click on an already-selected embed hands the pointer to the page in
 * it), and which one has its address field open.
 */
class EmbedState {
  private activeId: string | null = null
  private editingId: string | null = null
  private focusPending = false
  private readonly listeners = new Set<() => void>()

  get active(): string | null {
    return this.activeId
  }

  /** The embed whose address field was asked for (new embed, or "Change embed address"). */
  get editing(): string | null {
    return this.editingId
  }

  get wantsFocus(): boolean {
    return this.focusPending
  }

  activate(id: string | null): void {
    if (id === this.activeId) return
    this.activeId = id
    this.emit()
  }

  requestEdit(id: string): void {
    this.editingId = id
    this.focusPending = true
    this.emit()
  }

  /** The field took focus; later renders must not pull it back. */
  focused(): void {
    if (!this.focusPending) return
    this.focusPending = false
    this.emit()
  }

  endEdit(id?: string): void {
    if (this.editingId === null || (id !== undefined && this.editingId !== id)) return
    this.editingId = null
    this.focusPending = false
    this.emit()
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(): void {
    for (const cb of this.listeners) cb()
  }
}

export const embedState = new EmbedState()

/** For core.host.onEditEmbed and "Change embed address": opens and focuses the embed's address field. */
export const requestEmbedAddress = (id: string): void => embedState.requestEdit(id)

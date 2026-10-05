/** Whether a pointer is down on the board driving a tool, for chrome that should step aside mid-drag. */
class CanvasGesture {
  private down = false
  private readonly listeners = new Set<() => void>()

  get pressing(): boolean {
    return this.down
  }

  set(pressing: boolean): void {
    if (pressing === this.down) return
    this.down = pressing
    for (const cb of this.listeners) cb()
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
}

export const canvasGesture = new CanvasGesture()

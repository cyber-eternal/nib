import { type Point, type Viewport, panBy, zoomAt } from "@nib/core"

export interface PinchState {
  centroid: Point
  distance: number
}

export const pinchState = (a: Point, b: Point): PinchState => ({
  centroid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
  distance: Math.hypot(a[0] - b[0], a[1] - b[1]),
})

/**
 * Two-finger pan and zoom: the board point under the old centroid follows the fingers to the new
 * centroid, and the spread between them scales the zoom about that point.
 */
export const pinchViewport = (vp: Viewport, from: PinchState, to: PinchState): Viewport => {
  const panned = panBy(vp, to.centroid[0] - from.centroid[0], to.centroid[1] - from.centroid[1])
  const factor = from.distance > 0 && to.distance > 0 ? to.distance / from.distance : 1
  return factor === 1 ? panned : zoomAt(panned, to.centroid, factor)
}

/** WebKit's GestureEvent reports a cumulative scale; each change zooms by its ratio to the last one. */
export const gestureViewport = (vp: Viewport, anchor: Point, prevScale: number, scale: number): Viewport => {
  if (!(prevScale > 0) || !(scale > 0) || !Number.isFinite(prevScale) || !Number.isFinite(scale)) return vp
  return zoomAt(vp, anchor, scale / prevScale)
}

export type PointerKind = "mouse" | "pen" | "touch"

export type DownResult =
  | { action: "tool" }
  | { action: "pinch-start"; cancelTool: boolean }
  | { action: "ignore" }

export type MoveResult =
  | { action: "tool" }
  | { action: "pinch"; from: PinchState; to: PinchState }
  /** The tool pointer moved with no button held: its release was lost, and its gesture is over. */
  | { action: "released" }
  | { action: "ignore" }

/**
 * Routes pointers between the active tool and a touch pinch. Only the first pointer drives a
 * tool; a second finger cancels that gesture and pinches. After a pinch nothing drives a tool until every
 * finger has lifted, so the finger left behind cannot start a stray stroke.
 */
export class PointerRouter {
  private readonly touches = new Map<number, Point>()
  private toolPointer: number | null = null
  private toolKind: PointerKind | null = null
  private pinch: { ids: [number, number]; state: PinchState } | null = null
  private locked = false

  get toolPointerId(): number | null {
    return this.toolPointer
  }

  get pinching(): boolean {
    return this.pinch !== null
  }

  /**
   * The tool pointer a press shows to be dead, which the caller must end before routing the press: the
   * same pointer cannot go down twice without a release, and one the canvas no longer captures has lost
   * its release. Returns its id after forgetting it, or null.
   */
  takeStale(id: number, toolCaptured: boolean): number | null {
    const held = this.toolPointer
    if (held === null || (held !== id && toolCaptured)) return null
    this.up(held)
    return held
  }

  down(id: number, p: Point, kind: PointerKind, primary: boolean): DownResult {
    if (kind !== "touch") {
      if (!primary || this.toolPointer !== null || this.pinch) return { action: "ignore" }
      this.toolPointer = id
      this.toolKind = kind
      return { action: "tool" }
    }
    this.touches.set(id, p)
    if (this.touches.size === 1 && !this.locked && this.toolPointer === null) {
      this.toolPointer = id
      this.toolKind = kind
      return { action: "tool" }
    }
    if (this.touches.size === 2 && !this.pinch) {
      const ids = [...this.touches.keys()] as [number, number]
      const cancelTool = this.toolPointer !== null
      this.toolPointer = null
      this.locked = true
      this.pinch = { ids, state: pinchState(this.touches.get(ids[0])!, this.touches.get(ids[1])!) }
      return { action: "pinch-start", cancelTool }
    }
    return { action: "ignore" }
  }

  /** `buttons` is the move's button state; a mouse or pen tool pointer moving with none held was released. */
  move(id: number, p: Point, buttons?: number): MoveResult {
    if (this.touches.has(id)) this.touches.set(id, p)
    if (this.toolPointer === id) {
      if (buttons === 0 && this.toolKind !== "touch") {
        this.up(id)
        return { action: "released" }
      }
      return { action: "tool" }
    }
    const pinch = this.pinch
    if (pinch?.ids.includes(id)) {
      const a = this.touches.get(pinch.ids[0])
      const b = this.touches.get(pinch.ids[1])
      if (!a || !b) return { action: "ignore" }
      const from = pinch.state
      const to = pinchState(a, b)
      pinch.state = to
      return { action: "pinch", from, to }
    }
    return { action: "ignore" }
  }

  /** Release or cancel. "tool" means the tool's gesture should end with this pointer. */
  up(id: number): { action: "tool" } | { action: "ignore" } {
    this.touches.delete(id)
    const wasTool = this.toolPointer === id
    if (wasTool) {
      this.toolPointer = null
      this.toolKind = null
    }
    if (this.pinch?.ids.includes(id)) this.pinch = null
    if (this.touches.size === 0) this.locked = false
    return wasTool ? { action: "tool" } : { action: "ignore" }
  }

  reset(): void {
    this.touches.clear()
    this.toolPointer = null
    this.toolKind = null
    this.pinch = null
    this.locked = false
  }
}

const MIDDLE_BUTTON = 4

/**
 * Panning with the middle button held. It ends as soon as any event shows that button up: a release, a
 * cancel, a lost capture, or a move without it (a release while another button is held arrives as a move),
 * so an ordinary hover never pans the board.
 */
export class MiddlePan {
  private at: { id: number; x: number; y: number } | null = null

  get active(): boolean {
    return this.at !== null
  }

  start(id: number, x: number, y: number): void {
    this.at = { id, x, y }
  }

  /** The pan step for this move, or null when it is not panning (and the pan ends if the button is up). */
  move(id: number, x: number, y: number, buttons: number): [number, number] | null {
    const at = this.at
    if (!at || at.id !== id) return null
    if ((buttons & MIDDLE_BUTTON) === 0) {
      this.at = null
      return null
    }
    this.at = { id, x, y }
    return [x - at.x, y - at.y]
  }

  /** Ends the pan for this pointer; true when it was panning. */
  end(id: number): boolean {
    if (this.at?.id !== id) return false
    this.at = null
    return true
  }
}

import { type NibElement, type ToolType, isPolygonLine } from "@nib/core"
import type { PlatformPrefs } from "@nib/platform"

export const EMPTY_HINT =
  "Pick a marker below, or press R for a box, A for an arrow, P for the pencil that tidies your shapes."

/** How many times each one-time hint (and the pencil snap toast) shows before it stays quiet. */
export const HINT_MAX_SHOWS = 3

export const HINT_PREF_PREFIX = "nib.hint."

export const PENCIL_SNAP_HINT_ID = "pencilSnap"

export interface EmptyHintInput {
  elementCount: number
  /** False after the first element, even if it is deleted again: the hint never returns for that document. */
  canUndo: boolean
  viewMode: boolean
  presenting: boolean
  editingText: boolean
}

/** The teaching line above the tray on a fresh, empty board. */
export const showEmptyHint = (s: EmptyHintInput): boolean =>
  s.elementCount === 0 && !s.canUndo && !s.viewMode && !s.presenting && !s.editingText

export interface HintContext {
  activeTool: ToolType
  selection: readonly NibElement[]
  editingLinear: boolean
  editingText: boolean
  viewMode: boolean
  mac: boolean
}

export interface Hint {
  id: string
  text: string
}

const LABELLABLE = new Set(["rectangle", "diamond", "ellipse", "arrow"])

/** One line of guidance for what the user is doing right now, or null when nothing needs saying. */
export const contextualHint = (c: HintContext): Hint | null => {
  if (c.editingText || c.viewMode) return null
  const alt = c.mac ? "⌥" : "Alt"
  if (c.editingLinear)
    return { id: "linePoints", text: "Drag points to reshape. Delete removes picked points; Esc finishes." }
  switch (c.activeTool) {
    case "arrow":
      return { id: "arrow", text: "Drag from a shape to connect it. Click to add bends; Enter finishes." }
    case "line":
      return { id: "line", text: "Drag to draw a line. Click to add points; Enter finishes." }
    case "pencil":
      return { id: "pencil", text: `Draw a shape; it snaps clean. Hold ${alt} as you let go to keep it raw.` }
    case "eraser":
      return { id: "eraser", text: `Drag across shapes to erase them. Hold ${alt} to spare one.` }
    case "text":
      return { id: "text", text: "Click to place text. Double-click a shape to label it." }
    case "frame":
      return { id: "frame", text: "Drag to draw a frame. Shapes inside it move with it." }
    case "lasso":
      return { id: "lasso", text: "Draw around shapes to select them." }
    case "laser":
      return { id: "laser", text: "Drag to point. The trail fades by itself; Esc puts the laser down." }
    case "selection": {
      const only = c.selection.length === 1 ? c.selection[0]! : null
      const labelled = only?.boundElements?.some((b) => b.type === "text") ?? false
      if (only && !labelled && (LABELLABLE.has(only.type) || isPolygonLine(only)))
        return { id: "label", text: "Press Enter to add a label." }
      return null
    }
    default:
      return null
  }
}

/** Counts how often each one-time hint has been shown, in prefs, so it stops after HINT_MAX_SHOWS. */
export class HintCounter {
  constructor(
    private readonly prefs: PlatformPrefs,
    private readonly max = HINT_MAX_SHOWS,
  ) {}

  count(id: string): number {
    const n = Number.parseInt(this.prefs.get(HINT_PREF_PREFIX + id) ?? "0", 10)
    return Number.isFinite(n) && n > 0 ? n : 0
  }

  canShow(id: string): boolean {
    return this.count(id) < this.max
  }

  /** Records one showing; false (and no record) once the hint has used up its showings. */
  use(id: string): boolean {
    const n = this.count(id)
    if (n >= this.max) return false
    this.prefs.set(HINT_PREF_PREFIX + id, String(n + 1))
    return true
  }
}

const NEAR_SQUARE = 0.12

const near = (a: number, b: number): boolean => Math.abs(a - b) <= NEAR_SQUARE * Math.max(a, b, 1)

const PARALLEL = 0.02

/** Four corners (the fifth point closes the line) whose opposite sides run parallel. */
const isParallelogram = (pts: readonly (readonly [number, number])[]): boolean => {
  if (pts.length !== 5) return false
  const side = (i: number) => [pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1]] as const
  const parallel = (a: readonly [number, number], b: readonly [number, number]) =>
    Math.abs(a[0] * b[1] - a[1] * b[0]) <= PARALLEL * Math.hypot(...a) * Math.hypot(...b)
  return parallel(side(0), side(2)) && parallel(side(1), side(3))
}

/** What the pencil turned a stroke into, in words: "circle", "square", "triangle". */
export const correctionKind = (el: NibElement | undefined): string | null => {
  if (!el) return null
  const w = Math.abs(el.width)
  const h = Math.abs(el.height)
  switch (el.type) {
    case "ellipse":
      return near(w, h) ? "circle" : "ellipse"
    case "rectangle":
      return near(w, h) ? "square" : "rectangle"
    case "diamond":
      return "diamond"
    case "arrow":
      return "arrow"
    case "line":
      if (!el.polygon) return "line"
      if (el.points.length <= 4) return "triangle"
      return isParallelogram(el.points) ? "parallelogram" : "shape"
    default:
      return null
  }
}

export const correctionMessage = (kind: string, mac: boolean): string =>
  `Snapped to ${kind} · ${mac ? "⌘Z" : "Ctrl+Z"} keeps your stroke`

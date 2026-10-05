import type { EditorCore } from "../../src/editor/editorCore"
import { distanceToPolyline } from "../../src/geometry/hitTest"
import { elementOutline } from "../../src/geometry/outline"
import type { Point } from "../../src/math/vector"
import type { NibElement } from "../../src/model/types"
import { selectionHandleSet } from "../../src/render/interactiveScene"
import type { PointerInput } from "../../src/tools/types"

export const ptr = (x: number, y: number, mods: Partial<PointerInput> = {}): PointerInput => ({
  scene: [x, y],
  screen: [x, y],
  buttons: 1,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  pressure: 0.5,
  detail: 1,
  ...mods,
})

export const drag = (ed: EditorCore, a: Point, b: Point, mods: Partial<PointerInput> = {}): void => {
  ed.pointerDown(ptr(a[0], a[1], mods))
  ed.pointerMove(ptr((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, mods))
  ed.pointerMove(ptr(b[0], b[1], mods))
  ed.pointerUp(ptr(b[0], b[1], mods))
}

export const draw = (
  ed: EditorCore,
  tool: "rectangle" | "ellipse" | "diamond" | "arrow" | "line",
  a: Point,
  b: Point,
) => {
  ed.setTool(tool)
  drag(ed, a, b)
  const els = ed.scene.getNonDeleted()
  return els[els.length - 1]!
}

/** Scene-space points exactly as the renderer paints them (rotation applied, no curve sampling). */
export const renderedPoints = (el: NibElement): Point[] =>
  elementOutline({ ...el, roundness: null } as NibElement)

export const distToOutline = (p: Point, el: NibElement): number =>
  distanceToPolyline(p, elementOutline(el), true)

/** Rotate the current selection with the rotation handle so the handle ends up at `toward`. */
export const rotateSelection = (ed: EditorCore, toward: (center: Point) => Point): void => {
  const set = selectionHandleSet(ed.selectedElements(), ed.appState.viewport.zoom)!
  const h = set.handles.rotation!
  ed.setTool("selection")
  const target = toward(set.center)
  ed.pointerDown(ptr(h[0], h[1]))
  ed.pointerMove(ptr(target[0], target[1]))
  ed.pointerUp(ptr(target[0], target[1]))
}

export const isOrthogonal = (pts: readonly Point[], tol = 0.6): boolean =>
  pts.every((p, i) => {
    if (i === 0) return true
    const q = pts[i - 1]!
    return Math.abs(q[0] - p[0]) < tol || Math.abs(q[1] - p[1]) < tol
  })

/** True when the axis-aligned segment p-q passes through the open interior of `el`'s box. */
export const segmentCrossesBox = (p: Point, q: Point, el: NibElement, eps = 1): boolean => {
  const x1 = el.x + eps
  const y1 = el.y + eps
  const x2 = el.x + el.width - eps
  const y2 = el.y + el.height - eps
  if (Math.abs(p[1] - q[1]) < 0.01) {
    if (p[1] <= y1 || p[1] >= y2) return false
    return Math.max(p[0], q[0]) > x1 && Math.min(p[0], q[0]) < x2
  }
  if (Math.abs(p[0] - q[0]) < 0.01) {
    if (p[0] <= x1 || p[0] >= x2) return false
    return Math.max(p[1], q[1]) > y1 && Math.min(p[1], q[1]) < y2
  }
  // diagonal: sample it
  for (let t = 0; t <= 1; t += 0.01) {
    const x = p[0] + (q[0] - p[0]) * t
    const y = p[1] + (q[1] - p[1]) * t
    if (x > x1 && x < x2 && y > y1 && y < y2) return true
  }
  return false
}

export const absPoints = (el: { x: number; y: number; points: readonly Point[] }): Point[] =>
  el.points.map((p): Point => [el.x + p[0], el.y + p[1]])

import type { EditorCore } from "../editor/editorCore"
import type { Point } from "../math/vector"

export interface PointerInput {
  /** Scene coordinates, already unprojected from the viewport. */
  scene: Point
  screen: Point
  buttons: number
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  pressure: number
  detail: number
}

export interface KeyInput {
  key: string
  code?: string
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}

export interface Tool {
  readonly type: string
  onPointerDown(p: PointerInput, ed: EditorCore): void
  onPointerMove(p: PointerInput, ed: EditorCore): void
  onPointerUp(p: PointerInput, ed: EditorCore): void
  onDoubleClick?(p: PointerInput, ed: EditorCore): void
  onKeyDown?(e: KeyInput, ed: EditorCore): boolean
  cancel(ed: EditorCore): void
  cursor(p: PointerInput, ed: EditorCore): string
  /** True while a draft outlives the pointer gesture (a polyline between clicks) and owns the open transaction. */
  hasDraft?(): boolean
}

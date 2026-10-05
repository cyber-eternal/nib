import type { EditorCore } from "../editor/editorCore"
import { getBoundTextId } from "../geometry/boundText"
import { elementAtPoint, labelContainerAtPoint } from "../geometry/hitTest"
import type { Point } from "../math/vector"
import { newElement } from "../model/element"
import { type NibElement, type TextElement, canHaveLabel } from "../model/types"
import { indexBetween } from "../model/zindex"
import { lineHeightPx } from "../render/textMeasure"
import type { PointerInput, Tool } from "./types"

/**
 * Click empty canvas for free text; click a shape to label it. Editing opens
 * on release, after the press has finished moving focus, so the editor that
 * opens keeps it.
 */
export class TextTool implements Tool {
  readonly type = "text"
  private downAt: Point | null = null

  onPointerDown(p: PointerInput): void {
    this.downAt = [p.scene[0], p.scene[1]]
  }

  onPointerMove(): void {}

  onPointerUp(_p: PointerInput, ed: EditorCore): void {
    const at = this.downAt
    this.downAt = null
    if (!at) return
    const els = ed.scene.getNonDeleted()
    const hit =
      elementAtPoint(els, at, ed.appState.viewport.zoom, ed.appState) ??
      labelContainerAtPoint(els, at, canHaveLabel, 10 / ed.appState.viewport.zoom)
    if (hit && canHaveLabel(hit)) {
      ed.startEditingLabel(hit)
      return
    }
    if (hit && hit.type === "text") {
      ed.startEditingText(hit)
      return
    }
    ed.startEditingText(createTextAt(ed, at))
  }

  cancel(): void {
    this.downAt = null
  }
  cursor(): string {
    return "text"
  }
}

export const createTextAt = (ed: EditorCore, at: Point): TextElement => {
  const a = ed.appState
  const height = lineHeightPx(a.currentItemFontSize)
  return newElement("text", {
    x: at[0],
    y: at[1] - height / 2,
    width: 0,
    height,
    index: ed.scene.nextIndex(),
    strokeColor: a.currentItemStrokeColor,
    backgroundColor: "transparent",
    opacity: a.currentItemOpacity,
    fontSize: a.currentItemFontSize,
    fontFamily: a.currentItemFontFamily,
    textAlign: a.currentItemTextAlign,
    verticalAlign: "top",
    text: "",
    originalText: "",
  })
}

/** A label shares its container's groups and frame, so it moves, groups and clips with it. */
export const createLabelFor = (ed: EditorCore, container: NibElement): TextElement => {
  const a = ed.appState
  return newElement("text", {
    x: container.x + container.width / 2,
    y: container.y + container.height / 2,
    width: 0,
    height: lineHeightPx(a.currentItemFontSize),
    index: indexJustAbove(ed, container),
    strokeColor: a.currentItemStrokeColor,
    backgroundColor: "transparent",
    opacity: container.opacity,
    fontSize: a.currentItemFontSize,
    fontFamily: a.currentItemFontFamily,
    textAlign: "center",
    verticalAlign: "middle",
    angle: container.type === "arrow" ? 0 : container.angle,
    groupIds: [...container.groupIds],
    frameId: container.frameId,
    containerId: container.id,
    text: "",
    originalText: "",
  })
}

export const indexJustAbove = (ed: EditorCore, el: NibElement): string => {
  const ordered = ed.scene.getElements()
  const next = ordered[ordered.findIndex((e) => e.id === el.id) + 1]
  try {
    return indexBetween(el.index, next && next.id !== el.id ? next.index : null)
  } catch {
    return ed.scene.nextIndex()
  }
}

/** The container's live label; a deleted one doesn't count, so re-labelling creates a fresh, visible label. */
export const existingLabel = (
  container: NibElement,
  get: (id: string) => NibElement | undefined,
): TextElement | null => {
  const id = getBoundTextId(container)
  if (!id) return null
  const el = get(id)
  return el && el.type === "text" && !el.isDeleted ? el : null
}

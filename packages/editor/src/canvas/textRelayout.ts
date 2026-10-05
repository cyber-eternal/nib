import { type NibElement, type TextElement, layoutBoundText, layoutStandaloneText } from "@nib/core"

const EPSILON = 0.01

const moved = (a: TextElement, b: TextElement): boolean =>
  a.text !== b.text ||
  Math.abs(a.width - b.width) > EPSILON ||
  Math.abs(a.height - b.height) > EPSILON ||
  Math.abs(a.x - b.x) > EPSILON ||
  Math.abs(a.y - b.y) > EPSILON

/**
 * Ids to hand to core.relayoutContainer after fonts load: free text whose measured size changed, and
 * containers whose label would wrap or sit differently. Text being edited is left to its editor.
 */
export const textNeedingRelayout = (
  elements: readonly NibElement[],
  get: (id: string) => NibElement | undefined,
  editingTextId: string | null = null,
): string[] => {
  const out: string[] = []
  for (const el of elements) {
    if (el.isDeleted || el.type !== "text" || el.id === editingTextId) continue
    if (el.containerId) {
      const container = get(el.containerId)
      if (!container || container.isDeleted) continue
      const laid = layoutBoundText(container, el)
      if (moved(el, laid.text) || laid.container.height !== container.height) out.push(container.id)
    } else if (moved(el, layoutStandaloneText(el))) {
      out.push(el.id)
    }
  }
  return out
}

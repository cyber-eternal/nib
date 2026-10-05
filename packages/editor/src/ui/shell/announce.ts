import type { NibElement } from "@nib/core"
import { describeElement } from "../../canvas/links"

/** What a screen reader hears when the selection settles: "Rectangle “Idea” selected", "3 items selected". */
export const selectionAnnouncement = (
  selected: readonly NibElement[],
  get: (id: string) => NibElement | undefined,
): string => {
  if (selected.length === 0) return ""
  if (selected.length === 1) return `${describeElement(selected[0]!, get)} selected`
  return `${selected.length} items selected`
}

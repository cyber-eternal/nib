import {
  type EditorCore,
  type NibElement,
  elementIdFromLink,
  frameName,
  getBoundText,
  isSafeLink,
} from "@nib/core"

export type FollowResult = "jumped" | "opened" | "refused"

/**
 * Follows a link the way core does: element links jump on this board, safe web and mail links
 * go to the host, anything else is refused. `open` is used only when the core has no host opener.
 */
export const followLink = (core: EditorCore, link: string, open?: (url: string) => void): FollowResult => {
  if (elementIdFromLink(link)) return core.followLink(link) ? "jumped" : "refused"
  if (typeof link !== "string" || !isSafeLink(link)) return "refused"
  if (core.host.onOpenLink) return core.followLink(link) ? "opened" : "refused"
  if (!open) return "refused"
  open(link.trim())
  return "opened"
}

const TYPE_NAMES: Record<string, string> = {
  rectangle: "Rectangle",
  diamond: "Diamond",
  ellipse: "Ellipse",
  arrow: "Arrow",
  line: "Line",
  freedraw: "Drawing",
  text: "Text",
  image: "Image",
  frame: "Frame",
  embeddable: "Embed",
}

const clip = (s: string, max = 32): string => {
  const one = s.replace(/\s+/g, " ").trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

/** A short human name for an element: its frame name, its text or label, or its kind. */
export const describeElement = (el: NibElement, get: (id: string) => NibElement | undefined): string => {
  if (el.type === "frame") return clip(frameName(el))
  if (el.type === "text" && el.originalText.trim()) return `“${clip(el.originalText)}”`
  const label = getBoundText(el, get)
  if (label?.originalText.trim())
    return `${TYPE_NAMES[el.type] ?? "Element"} “${clip(label.originalText, 24)}”`
  return TYPE_NAMES[el.type] ?? "Element"
}

export interface LinkSummary {
  kind: "element" | "web"
  /** What the chip shows: the target's name, or the address without its scheme. */
  label: string
  /** False for an element link whose target was deleted. */
  live: boolean
}

export const summarizeLink = (link: string, get: (id: string) => NibElement | undefined): LinkSummary => {
  const id = elementIdFromLink(link)
  if (id) {
    const el = get(id)
    if (!el || el.isDeleted) return { kind: "element", label: "Missing element", live: false }
    return { kind: "element", label: describeElement(el, get), live: true }
  }
  const bare = link
    .trim()
    .replace(/^(https?:\/\/|mailto:)/i, "")
    .replace(/\/$/, "")
  return { kind: "web", label: bare || link, live: true }
}

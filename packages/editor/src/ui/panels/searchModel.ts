import type { NibElement } from "@nib/core"

export type SearchMatchKind = "text" | "label" | "frame"

export interface SearchMatch {
  /** The element whose words matched: a text element, or a frame by its name. */
  id: string
  /** What to select and scroll to: a label's container, otherwise the element itself. */
  targetId: string
  kind: SearchMatchKind
  /** The searchable text, whitespace collapsed. */
  text: string
  /** Where the first hit starts in `text`. */
  at: number
  length: number
}

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim()

/** What the canvas draws as a frame's label; an unnamed frame reads "Frame". */
export const frameDisplayName = (frame: { name?: string | null }): string =>
  typeof frame.name === "string" && frame.name.trim() ? frame.name.trim() : "Frame"

/**
 * Every text, label and frame name containing `query` (case-insensitive, whitespace-insensitive), in
 * reading order: top to bottom, then left to right, by the element that gets selected.
 */
export const findMatches = (elements: readonly NibElement[], query: string): SearchMatch[] => {
  const q = collapse(query).toLocaleLowerCase()
  if (!q) return []
  const live = elements.filter((e) => !e.isDeleted)
  const byId = new Map(live.map((e) => [e.id, e]))
  const out: { m: SearchMatch; x: number; y: number }[] = []
  for (const el of live) {
    let text: string | null = null
    let kind: SearchMatchKind = "text"
    let targetId = el.id
    if (el.type === "text") {
      text = collapse(el.originalText)
      if (el.containerId && byId.has(el.containerId)) {
        kind = "label"
        targetId = el.containerId
      }
    } else if (el.type === "frame") {
      text = frameDisplayName(el)
      kind = "frame"
    }
    if (!text) continue
    const at = text.toLocaleLowerCase().indexOf(q)
    if (at < 0) continue
    const target = byId.get(targetId) ?? el
    out.push({ m: { id: el.id, targetId, kind, text, at, length: q.length }, x: target.x, y: target.y })
  }
  out.sort((a, b) => a.y - b.y || a.x - b.x)
  return out.map((o) => o.m)
}

/** Ids for the canvas to highlight (CanvasHost.searchMatches). */
export const matchIds = (matches: readonly SearchMatch[]): string[] => matches.map((m) => m.id)

/**
 * The next result index. From -1 (nothing visited yet) the first step forward lands on the first match
 * and the first step back on the last.
 */
export const stepMatch = (current: number, count: number, direction: 1 | -1): number => {
  if (count <= 0) return -1
  if (current < 0 || current >= count) return direction > 0 ? 0 : count - 1
  return (current + direction + count) % count
}

export interface Snippet {
  before: string
  match: string
  after: string
}

/** The hit with up to `radius` characters of context each side, cut at word gaps where possible. */
export const snippetOf = (m: Pick<SearchMatch, "text" | "at" | "length">, radius = 28): Snippet => {
  const { text, at, length } = m
  let start = Math.max(0, at - radius)
  let end = Math.min(text.length, at + length + radius)
  if (start > 0) {
    const gap = text.indexOf(" ", start)
    if (gap >= 0 && gap < at) start = gap + 1
  }
  if (end < text.length) {
    const gap = text.lastIndexOf(" ", end)
    if (gap > at + length) end = gap
  }
  return {
    before: `${start > 0 ? "…" : ""}${text.slice(start, at)}`,
    match: text.slice(at, at + length),
    after: `${text.slice(at + length, end)}${end < text.length ? "…" : ""}`,
  }
}

/** "3 of 12", "12 matches", "1 match" or "No matches". */
export const matchCountLabel = (active: number, count: number): string => {
  if (count === 0) return "No matches"
  if (active >= 0 && active < count) return `${active + 1} of ${count}`
  return count === 1 ? "1 match" : `${count} matches`
}

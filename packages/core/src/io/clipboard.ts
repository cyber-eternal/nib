import type { BinaryFiles, NibElement } from "../model/types"
import { isEmbeddableLink, normalizeLink } from "./links"
import { parseMermaid } from "./mermaid"
import { statementsOf } from "./mermaidSyntax"
import { normalizeElements, normalizeFiles } from "./nibFile"

export const CLIPBOARD_MIME = "application/vnd.nib+json"

export interface ClipboardPayload {
  type: "nib/clipboard"
  elements: NibElement[]
  files: BinaryFiles
}

export const serializeClipboard = (elements: readonly NibElement[], files: BinaryFiles): string =>
  JSON.stringify({
    type: "nib/clipboard",
    elements: elements.filter((e) => !e.isDeleted),
    files,
  } satisfies ClipboardPayload)

const ACCEPTED_TYPES = new Set(["nib/clipboard", "excalidraw/clipboard", "nib", "excalidraw"])

/** Reads Nib or Excalidraw clipboard JSON (or a whole .nibd or .excalidraw document). */
export const parseClipboard = (text: string): ClipboardPayload | null => {
  try {
    const data = JSON.parse(text) as Record<string, unknown>
    if (!data || typeof data !== "object" || !ACCEPTED_TYPES.has(data.type as string)) return null
    if (!Array.isArray(data.elements)) return null
    return {
      type: "nib/clipboard",
      elements: normalizeElements(data.elements),
      files: normalizeFiles(data.files),
    }
  } catch {
    return null
  }
}

/** A plain-text stand-in for copied elements: their text, top to bottom and left to right. */
export const clipboardSummary = (elements: readonly NibElement[]): string => {
  const texts = elements
    .filter((e): e is NibElement & { type: "text"; text: string } => e.type === "text" && !e.isDeleted)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((e) => e.text.trim())
    .filter(Boolean)
  return texts.join("\n")
}

export type PasteContent =
  | { kind: "scene"; payload: ClipboardPayload }
  | { kind: "url"; url: string; embeddable: boolean }
  | { kind: "svg"; svg: string }
  | { kind: "mermaid"; source: string }
  | { kind: "table"; rows: string[][] }
  | { kind: "text"; text: string }
  | { kind: "empty" }

const SVG_MARKUP =
  /^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE\s+svg[^>]*>\s*)?<svg[\s>][\s\S]*<\/svg>$/i
const URL_LIKE = /^(?:https?:\/\/|www\.)\S+$/i
const MERMAID_START =
  /^(?:(?:flowchart|graph)(?:\s+(?:TD|TB|BT|LR|RL))?|sequenceDiagram|classDiagram(?:-v2)?)\s*$/i
const FENCE = /^```\s*mermaid\s*\n([\s\S]*?)\n```$/i
const MAX_TABLE_CELLS = 400

/** Mermaid source in `text`, unwrapped from a ```mermaid fence, or null. */
export const mermaidSource = (text: string): string | null => {
  const trimmed = text.trim()
  const source = FENCE.exec(trimmed)?.[1] ?? trimmed
  // the whole first statement must be the diagram type, so prose that starts with "graph" stays text
  const first = statementsOf(source)[0]?.text ?? ""
  if (!MERMAID_START.test(first)) return null
  return parseMermaid(source).ok ? source : null
}

const NUMBER = /^[-+]?[$€£¥]?\s*\d[\d,\s]*(?:\.\d+)?\s*%?$/

const splitCsvLine = (line: string): string[] => {
  const cells: string[] = []
  let current = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"'
        i++
      } else if (ch === '"') quoted = false
      else current += ch
    } else if (ch === '"' && current.trim() === "") {
      quoted = true
      current = ""
    } else if (ch === ",") {
      cells.push(current.trim())
      current = ""
    } else current += ch
  }
  cells.push(current.trim())
  return cells
}

const rectangular = (rows: string[][]): boolean => {
  const cols = rows[0]?.length ?? 0
  if (cols < 2 || rows.length * cols > MAX_TABLE_CELLS) return false
  if (!rows.every((r) => r.length === cols)) return false
  // a column that is empty all the way down is indentation, not data
  for (let c = 0; c < cols; c++) if (rows.every((r) => r[c] === "")) return false
  return true
}

/**
 * Cells of a pasted table: tab-separated rows (what spreadsheets copy), or comma-separated rows
 * with at least one numeric column, so ordinary prose with commas stays text.
 */
export const parseTable = (text: string): string[][] | null => {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n")
  if (lines.length === 0 || lines.every((l) => l.trim() === "")) return null
  if (lines.every((l) => l.includes("\t"))) {
    const rows = lines.map((l) => l.split("\t").map((c) => c.trim()))
    if (rectangular(rows)) return rows
  }
  if (lines.length >= 2 && lines.every((l) => l.includes(","))) {
    const rows = lines.map(splitCsvLine)
    if (!rectangular(rows)) return null
    const body = rows.slice(1)
    const numeric = rows[0]!.some((_, c) => body.every((r) => NUMBER.test(r[c]!)))
    if (numeric) return rows
  }
  return null
}

/** Decides what pasted text should become on the canvas. */
export const classifyPaste = (text: string): PasteContent => {
  const trimmed = text.trim()
  if (!trimmed) return { kind: "empty" }
  if (trimmed.startsWith("{")) {
    const payload = parseClipboard(trimmed)
    if (payload && payload.elements.length > 0) return { kind: "scene", payload }
  }
  if (SVG_MARKUP.test(trimmed)) return { kind: "svg", svg: trimmed }
  if (URL_LIKE.test(trimmed)) {
    const url = normalizeLink(trimmed)
    if (url) return { kind: "url", url, embeddable: isEmbeddableLink(url) }
  }
  const mermaid = mermaidSource(trimmed)
  if (mermaid) return { kind: "mermaid", source: mermaid }
  const rows = parseTable(text)
  if (rows) return { kind: "table", rows }
  return { kind: "text", text: trimmed }
}

export interface ElementStyle {
  strokeColor: string
  backgroundColor: string
  fillStyle: string
  strokeWidth: number
  strokeStyle: string
  roughness: number
  opacity: number
  roundness: unknown
  fontFamily?: string
  fontSize?: number
  textAlign?: string
  verticalAlign?: string
  lineHeight?: number
  startArrowhead?: string | null
  endArrowhead?: string | null
  elbowed?: boolean
}

/**
 * The style to paste onto other elements. Text properties come from `el` itself or, for a shape,
 * from its label, so copying a labelled box also carries its font.
 */
export const copyStyleFrom = (el: NibElement, label?: NibElement | null): ElementStyle => {
  const style: ElementStyle = {
    strokeColor: el.strokeColor,
    backgroundColor: el.backgroundColor,
    fillStyle: el.fillStyle,
    strokeWidth: el.strokeWidth,
    strokeStyle: el.strokeStyle,
    roughness: el.roughness,
    opacity: el.opacity,
    roundness: el.roundness,
  }
  const text = el.type === "text" ? el : label?.type === "text" ? label : null
  if (text) {
    style.fontFamily = text.fontFamily
    style.fontSize = text.fontSize
    style.textAlign = text.textAlign
    style.verticalAlign = text.verticalAlign
    style.lineHeight = text.lineHeight
  }
  if (el.type === "arrow") {
    style.startArrowhead = el.startArrowhead
    style.endArrowhead = el.endArrowhead
    style.elbowed = el.elbowed
  }
  return style
}

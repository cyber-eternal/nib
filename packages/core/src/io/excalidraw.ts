import { randomId } from "../math/random"
import type { AppState, BinaryFiles, NibElement } from "../model/types"
import { fontFamilyToExcalidraw } from "./fonts"
import {
  type ParseResult,
  normalizeElements,
  normalizeFiles,
  parseNib,
  sanitizeAppState,
  usedFiles,
} from "./nibFile"

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const NIB_CUSTOM_KEYS = ["excalidrawType", "excalidrawFontFamily"]

/** One element as Excalidraw writes it: numeric font codes, original iframe/magicframe types. */
export const toExcalidrawElement = (el: NibElement): Record<string, unknown> => {
  const { customData, ...fields } = el as NibElement & { customData?: unknown }
  const out: Record<string, unknown> = { ...fields }
  const custom = isRecord(customData) ? customData : {}
  const originalType = custom.excalidrawType
  if (
    (originalType === "iframe" && el.type === "embeddable") ||
    (originalType === "magicframe" && el.type === "frame")
  )
    out.type = originalType
  if (el.type === "text") out.fontFamily = fontFamilyToExcalidraw(el.fontFamily, custom.excalidrawFontFamily)
  // Excalidraw curves lines and arrows only with proportional roundness
  if ((el.type === "arrow" || el.type === "line") && el.roundness) out.roundness = { type: 2 }
  // Nib draws closed lines with straight edges whatever their roundness; Excalidraw would curve them
  if (el.type === "line" && el.polygon) out.roundness = null
  const foreign = Object.entries(custom).filter(([key]) => !NIB_CUSTOM_KEYS.includes(key))
  if (foreign.length > 0) out.customData = Object.fromEntries(foreign)
  return out
}

/**
 * Excalidraw cannot bind arrows to lines or put labels on them, so relations with
 * Nib's closed polygon lines are cut: their arrows end free and their labels
 * become free text where they are.
 */
const withoutPolygonRelations = (elements: readonly NibElement[]): NibElement[] => {
  const polygons = new Set(elements.filter((e) => e.type === "line" && e.polygon).map((e) => e.id))
  if (polygons.size === 0) return [...elements]
  return elements.map((el) => {
    if (polygons.has(el.id) && el.boundElements?.length) return { ...el, boundElements: null }
    if (el.type === "text" && el.containerId && polygons.has(el.containerId))
      return { ...el, containerId: null }
    if (el.type === "arrow") {
      const start = el.startBinding && polygons.has(el.startBinding.elementId)
      const end = el.endBinding && polygons.has(el.endBinding.elementId)
      if (start || end)
        return {
          ...el,
          startBinding: start ? null : el.startBinding,
          endBinding: end ? null : el.endBinding,
        }
    }
    return el
  })
}

/** Elements as Excalidraw reads them: live ones only, with relations it cannot represent cut. */
const excalidrawElements = (elements: readonly NibElement[]): Record<string, unknown>[] =>
  withoutPolygonRelations(elements.filter((e) => !e.isDeleted)).map(toExcalidrawElement)

/**
 * Excalidraw's schema is close enough that only a handful of fields differ.
 * Anything we do not map is passed through untouched so round trips are lossless.
 */
export const toExcalidraw = (
  elements: readonly NibElement[],
  appState: AppState,
  files: BinaryFiles = {},
): string => {
  const live = elements.filter((e) => !e.isDeleted)
  return JSON.stringify(
    {
      type: "excalidraw",
      version: 2,
      source: "nib",
      elements: excalidrawElements(live),
      appState: {
        gridSize: appState.gridSize,
        viewBackgroundColor: appState.viewBackgroundColor,
      },
      files: usedFiles(live, files),
    },
    null,
    2,
  )
}

export const parseExcalidraw = (text: string): ParseResult => {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${(e as Error).message}` }
  }
  try {
    if (!isRecord(json) || !Array.isArray(json.elements)) return { ok: false, error: "No elements in file" }
    return {
      ok: true,
      elements: normalizeElements(json.elements),
      appState: sanitizeAppState(json.appState),
      files: normalizeFiles(json.files),
      format: "excalidraw",
    }
  } catch (e) {
    return { ok: false, error: `Could not read the drawing: ${(e as Error).message}` }
  }
}

/** Reads a .nibd or .excalidraw document (or other Excalidraw-shaped JSON); `format` says which. */
export const parseScene = (text: string): ParseResult => {
  const nib = parseNib(text)
  if (nib.ok) return nib
  const excalidraw = parseExcalidraw(text)
  return excalidraw.ok ? excalidraw : nib
}

/** Drag payload for library tiles; it carries a Nib-flavoured .excalidrawlib document. */
export const LIBRARY_MIME = "application/vnd.nib.library+json"

export interface LibraryItem {
  id: string
  status: "published" | "unpublished"
  elements: NibElement[]
  created: number
  name?: string
  /** Image bitmaps the item's elements use; Nib's addition to the excalidrawlib v2 shape. */
  files?: BinaryFiles
}

/** A library item for `elements`, carrying the image files they reference so inserted copies aren't broken. */
export const createLibraryItem = (
  elements: readonly NibElement[],
  files: BinaryFiles,
  name?: string,
): LibraryItem => {
  const live = elements.filter((e) => !e.isDeleted)
  const item: LibraryItem = {
    id: `lib-${randomId()}`,
    status: "unpublished",
    elements: [...live],
    created: Date.now(),
    files: usedFiles(live, files),
  }
  const label = cleanName(name)
  if (label) item.name = label
  return item
}

const cleanName = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined
  const name = v.trim().slice(0, 200)
  return name || undefined
}

export type LibraryParseResult = { ok: true; items: LibraryItem[] } | { ok: false; error: string }

/** Reads an .excalidrawlib in either shape: v1 (`library`: element arrays) or v2 (`libraryItems`). */
export const parseLibraryFile = (text: string): LibraryParseResult => {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${(e as Error).message}` }
  }
  try {
    if (!isRecord(data)) return { ok: false, error: "That file has no library items." }
    if (data.type !== undefined && data.type !== "excalidrawlib")
      return { ok: false, error: "That file isn't an Excalidraw library." }
    const raw = data.libraryItems ?? data.library
    if (!Array.isArray(raw)) return { ok: false, error: "That file has no library items." }
    const seen = new Set<string>()
    const items = raw.map((entry, i): LibraryItem => {
      const obj = isRecord(entry) ? entry : {}
      const elements = normalizeElements(Array.isArray(entry) ? entry : obj.elements)
      let id = typeof obj.id === "string" && obj.id ? obj.id : `lib-${randomId()}-${i}`
      if (seen.has(id)) id = `lib-${randomId()}-${i}`
      seen.add(id)
      const item: LibraryItem = {
        id,
        status: obj.status === "published" ? "published" : "unpublished",
        elements,
        created: typeof obj.created === "number" && Number.isFinite(obj.created) ? obj.created : Date.now(),
      }
      const name = cleanName(obj.name)
      if (name) item.name = name
      const files = usedFiles(elements, normalizeFiles(obj.files))
      if (Object.keys(files).length > 0) item.files = files
      return item
    })
    return { ok: true, items }
  } catch (e) {
    return { ok: false, error: `Could not read the library: ${(e as Error).message}` }
  }
}

export const parseLibrary = (text: string): LibraryItem[] => {
  const result = parseLibraryFile(text)
  return result.ok ? result.items : []
}

export interface LibrarySerializeOptions {
  /** 2 (default) writes `libraryItems` with names; 1 writes the older bare `library` element arrays. */
  version?: 1 | 2
  /**
   * "excalidraw" (default) writes elements Excalidraw can read (numeric font codes, original types);
   * "nib" keeps Nib's own fields exactly, for Nib's own storage and drag payloads.
   */
  target?: "excalidraw" | "nib"
}

export const serializeLibrary = (
  items: readonly LibraryItem[],
  opts: LibrarySerializeOptions = {},
): string => {
  const mapElements = (elements: readonly NibElement[]) => {
    return opts.target === "nib" ? elements.filter((e) => !e.isDeleted) : excalidrawElements(elements)
  }
  const head = { type: "excalidrawlib", version: opts.version ?? 2, source: "nib" }
  if (opts.version === 1) {
    return JSON.stringify({ ...head, library: items.map((item) => mapElements(item.elements)) }, null, 2)
  }
  const libraryItems = items.map((item) => {
    const out: Record<string, unknown> = {
      id: item.id,
      status: item.status,
      elements: mapElements(item.elements),
      created: item.created,
    }
    if (item.name) out.name = item.name
    const files = usedFiles(item.elements, item.files ?? {})
    if (Object.keys(files).length > 0) out.files = files
    return out
  })
  return JSON.stringify({ ...head, libraryItems }, null, 2)
}

// what an item looks like, independent of ids, seeds and where it was drawn
const itemSignature = (item: LibraryItem): string => {
  const live = item.elements.filter((e) => !e.isDeleted)
  const minX = Math.min(...live.map((e) => e.x))
  const minY = Math.min(...live.map((e) => e.y))
  return JSON.stringify(
    live.map((e) => {
      const el = e as NibElement & { text?: string; points?: unknown; fontFamily?: unknown }
      return [
        el.type,
        Math.round(el.x - minX),
        Math.round(el.y - minY),
        Math.round(el.width),
        Math.round(el.height),
        el.angle,
        el.strokeColor,
        el.backgroundColor,
        el.fillStyle,
        el.strokeWidth,
        el.strokeStyle,
        el.text ?? null,
        el.fontFamily ?? null,
        el.points ?? null,
      ]
    }),
  )
}

/**
 * Adds `incoming` in front of `existing` (newest first, as Excalidraw does), skipping items that are
 * already there by id or by content. An incoming item whose id is taken by different content gets a new id.
 */
export const mergeLibraryItems = (
  existing: readonly LibraryItem[],
  incoming: readonly LibraryItem[],
): LibraryItem[] => {
  const ids = new Set(existing.map((i) => i.id))
  const signatures = new Set(existing.map(itemSignature))
  const fresh: LibraryItem[] = []
  for (const item of incoming) {
    const signature = itemSignature(item)
    if (signatures.has(signature)) continue
    signatures.add(signature)
    const id = ids.has(item.id) ? `lib-${randomId()}` : item.id
    ids.add(id)
    fresh.push(id === item.id ? item : { ...item, id })
  }
  return [...fresh, ...existing]
}

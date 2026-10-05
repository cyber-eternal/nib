import { generateKeyBetween } from "fractional-indexing"
import { boundsFromPoints } from "../math/bounds"
import { type Point, rotatePoint } from "../math/vector"
import type { AppState, BinaryFile, BinaryFiles, ElementType, NibElement, Viewport } from "../model/types"
import { DEFAULT_APP_STATE } from "../model/types"
import { MAX_ZOOM, MIN_ZOOM } from "../render/viewport"
import { fontFamilyFromExcalidraw } from "./fonts"
import { isSafeLink, normalizeLink } from "./links"

export const NIB_FILE_TYPE = "nib"
export const NIB_FILE_VERSION = 1

export interface NibFile {
  type: string
  version: number
  source: string
  elements: NibElement[]
  appState: Partial<AppState>
  files: BinaryFiles
}

/**
 * appState keys that belong to the drawing, so changing one is an edit to the
 * document. The UI theme and the current-item tool defaults are the user's.
 */
export const DOCUMENT_STATE_KEYS = ["viewBackgroundColor", "gridSize", "objectsSnapMode"] as const

export const serializeNib = (
  elements: readonly NibElement[],
  appState: AppState,
  files: BinaryFiles = {},
): string => {
  const live = elements.filter((e) => !e.isDeleted)
  const persisted: Record<string, unknown> = {}
  for (const key of DOCUMENT_STATE_KEYS) persisted[key] = appState[key]
  persisted.name = appState.name
  persisted.viewport = appState.viewport
  return JSON.stringify(
    {
      type: NIB_FILE_TYPE,
      version: NIB_FILE_VERSION,
      source: "nib",
      elements: live,
      appState: persisted,
      files: usedFiles(live, files),
    },
    null,
    2,
  )
}

/** Files referenced by live image elements; a deleted image's bitmap is never written out. */
export const usedFiles = (elements: readonly NibElement[], files: BinaryFiles): BinaryFiles => {
  const out: BinaryFiles = {}
  for (const el of elements) {
    if (el.isDeleted || el.type !== "image" || !el.fileId || !isSafeKey(el.fileId)) continue
    const file = files[el.fileId]
    if (file) out[el.fileId] = file
  }
  return out
}

export type ParseResult =
  | {
      ok: true
      elements: NibElement[]
      appState: Partial<AppState>
      files: BinaryFiles
      format?: "nib" | "excalidraw"
      /** Things the reader could not fully honour, such as a file from a newer version of Nib. */
      warnings?: string[]
      /** Set when the file declares a format version newer than NIB_FILE_VERSION. */
      newerVersion?: number
    }
  | { ok: false; error: string }

/** Upgrades a raw Nib document by one format version. */
export type NibMigration = (doc: Record<string, unknown>) => Record<string, unknown>

/**
 * Upgrade steps keyed by the version they upgrade from: `migrations[n]` turns a version-n document into
 * version n+1. A version without a step needs no change (the bump only added optional fields).
 */
export const NIB_MIGRATIONS: Readonly<Record<number, NibMigration>> = {}

export interface NibReadOptions {
  migrations?: Readonly<Record<number, NibMigration>>
  /** The version this build writes; tests lower or raise it to exercise migrations. */
  currentVersion?: number
}

export const newerVersionWarning = (fileVersion: number, currentVersion = NIB_FILE_VERSION): string =>
  `This drawing was saved by a newer version of Nib (file format ${fileVersion}; this version reads up to ${currentVersion}). Parts of it may be missing here, and saving over it could lose them, so saving makes a copy.`

/**
 * Brings a raw document up to `currentVersion`, one step at a time. A file that names no version is
 * read as the current one; a newer file is returned untouched with `newer` set.
 */
export const migrateNib = (
  doc: Record<string, unknown>,
  opts: NibReadOptions = {},
): { doc: Record<string, unknown>; from: number; newer: boolean } => {
  const current = opts.currentVersion ?? NIB_FILE_VERSION
  const migrations = opts.migrations ?? NIB_MIGRATIONS
  const declared =
    typeof doc.version === "number" && Number.isFinite(doc.version) && doc.version >= 0
      ? Math.floor(doc.version)
      : current
  if (declared > current) return { doc, from: declared, newer: true }
  let out = doc
  for (let v = declared; v < current; v++) {
    const step = migrations[v]
    out = { ...(step ? step(out) : out), version: v + 1 }
  }
  return { doc: out, from: declared, newer: false }
}

const REQUIRED_KEYS = ["id", "type", "x", "y", "width", "height"] as const

const ELEMENT_TYPES: ReadonlySet<string> = new Set<ElementType>([
  "rectangle",
  "diamond",
  "ellipse",
  "text",
  "line",
  "arrow",
  "freedraw",
  "image",
  "frame",
  "embeddable",
])

// Excalidraw types Nib has no renderer for, mapped to the closest one it has
const FOREIGN_TYPES: Record<string, ElementType> = { iframe: "embeddable", magicframe: "frame" }

// Excalidraw's isUsingAdaptiveRadius: these get type 3 when only `strokeSharpness: "round"` is known
const ADAPTIVE_RADIUS_TYPES = new Set(["rectangle", "embeddable", "iframe", "image"])

const FILL_STYLES = ["hachure", "cross-hatch", "solid", "zigzag"] as const
const STROKE_STYLES = ["solid", "dashed", "dotted"] as const
const TEXT_ALIGNS = ["left", "center", "right"] as const
const VERTICAL_ALIGNS = ["top", "middle", "bottom"] as const
const IMAGE_STATUSES = ["pending", "saved", "error"] as const
const FONT_FAMILIES = ["hand", "normal", "code", "serif", "mono"] as const

/**
 * Tolerant reader: unknown fields survive a round trip, missing ones get
 * defaults, and every field Nib reads is type-checked, because files,
 * clipboards and libraries can come from anywhere.
 */
export const normalizeElements = (raw: unknown): NibElement[] => {
  if (!Array.isArray(raw)) return []
  const out: NibElement[] = []
  let lastIndex: string | null = null
  for (const item of raw) {
    if (!isRecord(item)) continue
    const el = item
    if (!REQUIRED_KEYS.every((k) => k in el)) continue
    if (typeof el.id !== "string" || el.id === "" || typeof el.type !== "string") continue
    const rawType = el.type
    const type = FOREIGN_TYPES[rawType] ?? rawType
    if (!ELEMENT_TYPES.has(type)) continue

    const index: string = isValidIndex(el.index) ? el.index : generateKeyBetween(lastIndex, null)
    lastIndex = index
    const { customData: rawCustom, strokeSharpness, ...fields } = el
    const customData: Record<string, unknown> = isRecord(rawCustom) ? { ...rawCustom } : {}
    if (type !== rawType) customData.excalidrawType = rawType

    const normalized: Record<string, unknown> = {
      ...fields,
      type,
      x: num(el.x, 0),
      y: num(el.y, 0),
      width: num(el.width, 0),
      height: num(el.height, 0),
      angle: num(el.angle, 0),
      strokeColor: color(el.strokeColor, "#1e1e1e"),
      backgroundColor: color(el.backgroundColor, "transparent"),
      fillStyle: oneOf(el.fillStyle, FILL_STYLES, "solid"),
      strokeWidth: clamp(num(el.strokeWidth, 2), 0, 100),
      strokeStyle: oneOf(el.strokeStyle, STROKE_STYLES, "solid"),
      roughness: clamp(num(el.roughness, 1), 0, 2),
      opacity: clamp(num(el.opacity, 100), 0, 100),
      seed: seedFor(el.seed, el.id),
      version: Math.max(1, Math.floor(num(el.version, 1))),
      versionNonce: Math.floor(num(el.versionNonce, Math.floor(Math.random() * 2 ** 31))),
      isDeleted: el.isDeleted === true,
      groupIds: Array.isArray(el.groupIds)
        ? el.groupIds.filter((g): g is string => typeof g === "string")
        : [],
      frameId: typeof el.frameId === "string" ? el.frameId : null,
      boundElements: normalizeBoundElements(el.boundElements),
      link: safeLink(el.link),
      locked: el.locked === true,
      index,
      updated: num(el.updated, Date.now()),
      roundness: normalizeRoundness(el.roundness, strokeSharpness, rawType),
    }

    if (type === "text") {
      const text = str(el.text, "")
      normalized.text = text
      normalized.originalText = str(el.originalText, text)
      normalized.fontSize = positive(el.fontSize, 20)
      normalized.fontFamily = normalizeFontFamily(el.fontFamily)
      if (typeof el.fontFamily === "number") customData.excalidrawFontFamily = el.fontFamily
      normalized.textAlign = oneOf(el.textAlign, TEXT_ALIGNS, "left")
      normalized.verticalAlign = oneOf(el.verticalAlign, VERTICAL_ALIGNS, "top")
      normalized.containerId = typeof el.containerId === "string" ? el.containerId : null
      normalized.lineHeight = positive(el.lineHeight, 1.25)
      normalized.autoResize = el.autoResize !== false
    }
    if (type === "line" || type === "arrow") {
      normalized.points = normalizePoints(el.points, 2)
      normalized.lastCommittedPoint = pointOrNull(el.lastCommittedPoint)
      if (type === "line") normalized.polygon = el.polygon === true
      if (type === "arrow") {
        normalized.startBinding = normalizeBinding(el.startBinding)
        normalized.endBinding = normalizeBinding(el.endBinding)
        normalized.startArrowhead = normalizeArrowhead(el.startArrowhead)
        normalized.endArrowhead = normalizeArrowhead(el.endArrowhead)
        normalized.elbowed = el.elbowed === true
      }
      rebaseOnPoints(normalized, true)
    }
    if (type === "freedraw") {
      normalized.points = normalizePoints(el.points, 1)
      normalized.pressures = Array.isArray(el.pressures)
        ? el.pressures.map((p) => clamp(num(p, 0.5), 0, 1))
        : []
      normalized.simulatePressure = el.simulatePressure !== false
      normalized.lastCommittedPoint = pointOrNull(el.lastCommittedPoint)
      rebaseOnPoints(normalized, false)
    }
    if (type === "image") {
      normalized.fileId = typeof el.fileId === "string" && isSafeKey(el.fileId) ? el.fileId : null
      normalized.status = oneOf(el.status, IMAGE_STATUSES, "saved")
      normalized.scale = normalizeScale(el.scale)
      normalized.crop = normalizeCrop(el.crop)
    }
    if (type === "frame") {
      normalized.name = typeof el.name === "string" ? el.name : null
    }
    if (Object.keys(customData).length > 0) normalized.customData = customData
    out.push(normalized as unknown as NibElement)
  }
  return out
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

// a key like "__proto__" would reach Object.prototype when used as a map key
const isSafeKey = (key: string): boolean =>
  key !== "__proto__" && key !== "constructor" && key !== "prototype"

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback
const positive = (v: unknown, fallback: number): number => {
  const n = num(v, fallback)
  return n > 0 ? n : fallback
}
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))
const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback)
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback

// colours reach canvas styles and SVG attributes; this keeps any CSS colour and nothing that can escape
const COLOR_CHARS = /^[#a-z0-9(),.%/\s-]{1,64}$/i
const color = (v: unknown, fallback: string): string =>
  typeof v === "string" && COLOR_CHARS.test(v.trim()) ? v.trim() : fallback

const safeLink = (v: unknown): string | null => {
  if (typeof v !== "string" || v.trim() === "") return null
  return isSafeLink(v) ? v.trim() : normalizeLink(v)
}

const isValidIndex = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^[0-9A-Za-z]+$/.test(v)) return false
  try {
    generateKeyBetween(v, null)
    generateKeyBetween(null, v)
    return true
  } catch {
    return false
  }
}

// seed 0 means "random" to roughjs, so a missing or bad seed becomes a stable hash of the id
const seedFor = (v: unknown, id: string): number => {
  if (typeof v === "number" && Number.isInteger(v) && v !== 0 && Math.abs(v) < 2 ** 31) return v
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193)
  return ((h >>> 0) % (2 ** 31 - 1)) + 1
}

const pointOrNull = (v: unknown): Point | null =>
  Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1])
    ? [v[0] as number, v[1] as number]
    : null

const normalizePoints = (v: unknown, min: number): Point[] => {
  const pts = Array.isArray(v)
    ? v
        .filter((p): p is unknown[] => Array.isArray(p) && p.length >= 2)
        .map((p): Point => [num(p[0], 0), num(p[1], 0)])
    : []
  if (pts.length >= min) return pts
  return min === 1
    ? [[0, 0]]
    : [
        [0, 0],
        [0, 0],
      ]
}

// Excalidraw anchors x/y at the first point, so a leftward arrow would get a mirrored box; Nib's
// tools keep x/y at the top-left of the points. `bakeAngle` also folds a line's rotation into them.
const rebaseOnPoints = (n: Record<string, unknown>, bakeAngle: boolean): void => {
  const x = n.x as number
  const y = n.y as number
  let rel = n.points as Point[]
  let committed = n.lastCommittedPoint as Point | null
  const angle = n.angle as number
  if (bakeAngle && angle !== 0) {
    // Excalidraw and Nib both rotate a linear element about its points' bbox centre
    const b = boundsFromPoints(rel)
    const c: Point = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
    rel = rel.map((p) => rotatePoint(p, c, angle))
    committed = committed ? rotatePoint(committed, c, angle) : null
    n.angle = 0
  }
  const b = boundsFromPoints(rel)
  n.x = x + b[0]
  n.y = y + b[1]
  n.width = b[2] - b[0]
  n.height = b[3] - b[1]
  n.points = rel.map((p): Point => [p[0] - b[0], p[1] - b[1]])
  n.lastCommittedPoint = committed ? [committed[0] - b[0], committed[1] - b[1]] : null
}

const normalizeBoundElements = (v: unknown): { id: string; type: "arrow" | "text" }[] | null => {
  if (!Array.isArray(v)) return null
  return v
    .filter(
      (b): b is { id: string; type: "arrow" | "text" } =>
        isRecord(b) && typeof b.id === "string" && (b.type === "arrow" || b.type === "text"),
    )
    .map((b) => ({ id: b.id, type: b.type }))
}

const normalizeScale = (v: unknown): [number, number] => {
  if (!Array.isArray(v) || v.length !== 2) return [1, 1]
  return [num(v[0], 1) < 0 ? -1 : 1, num(v[1], 1) < 0 ? -1 : 1]
}

const normalizeCrop = (v: unknown): Record<string, number> | null => {
  if (!isRecord(v)) return null
  const keys = ["x", "y", "width", "height", "naturalWidth", "naturalHeight"] as const
  const crop: Record<string, number> = {}
  for (const key of keys) {
    const value = v[key]
    if (typeof value !== "number" || !Number.isFinite(value)) return null
    crop[key] = value
  }
  if (crop.width! <= 0 || crop.height! <= 0 || crop.naturalWidth! <= 0 || crop.naturalHeight! <= 0)
    return null
  return crop
}

// Excalidraw roundness: 1 legacy and 2 proportional (a share of the short side), 3 adaptive (fixed or `value`)
const normalizeRoundness = (
  v: unknown,
  sharpness: unknown,
  rawType: string,
): { type: 2 | 3; value?: number } | null => {
  const fallbackType = ADAPTIVE_RADIUS_TYPES.has(rawType) ? 3 : 2
  if (isRecord(v)) {
    const type = v.type === 1 || v.type === 2 ? 2 : v.type === 3 ? 3 : fallbackType
    return typeof v.value === "number" && Number.isFinite(v.value) && v.value >= 0
      ? { type, value: v.value }
      : { type }
  }
  if (v === undefined && sharpness === "round") return { type: fallbackType }
  return null
}

const normalizeBinding = (v: unknown): Record<string, unknown> | null => {
  if (!isRecord(v) || typeof v.elementId !== "string") return null
  const { fixedPoint: fp, ...fields } = v
  const binding: Record<string, unknown> = {
    ...fields,
    elementId: v.elementId,
    focus: clamp(num(v.focus, 0), -1, 1),
    gap: Math.max(0, num(v.gap, 4)),
  }
  if (Array.isArray(fp) && fp.length === 2 && Number.isFinite(fp[0]) && Number.isFinite(fp[1]))
    binding.fixedPoint = [fp[0], fp[1]]
  return binding
}

const ARROWHEADS = new Set([
  "arrow",
  "bar",
  "dot",
  "circle",
  "circle_outline",
  "triangle",
  "triangle_outline",
  "diamond",
  "diamond_outline",
  "crowfoot_one",
  "crowfoot_many",
  "crowfoot_one_or_many",
])
const normalizeArrowhead = (v: unknown): string | null =>
  typeof v === "string" && ARROWHEADS.has(v) ? v : null

const normalizeFontFamily = (v: unknown): string => {
  if (typeof v === "number") return fontFamilyFromExcalidraw(v)
  return oneOf(v, FONT_FAMILIES, "hand")
}

const DATA_IMAGE_URL = /^data:(image\/[a-z0-9.+-]+);base64,[a-z0-9+/]*={0,2}$/i

/**
 * Keeps only inline base64 images. A remote URL would be fetched as soon as
 * the file opens (leaking that it was opened) and taints the export canvas.
 */
export const normalizeFiles = (raw: unknown): BinaryFiles => {
  const out: Record<string, BinaryFile> = {}
  if (!isRecord(raw)) return out
  for (const [key, value] of Object.entries(raw)) {
    if (!isSafeKey(key) || !isRecord(value) || typeof value.dataURL !== "string") continue
    const match = DATA_IMAGE_URL.exec(value.dataURL)
    if (!match) continue
    const mimeType =
      typeof value.mimeType === "string" && /^image\/[a-z0-9.+-]+$/i.test(value.mimeType)
        ? value.mimeType
        : match[1]!
    const file: BinaryFile = {
      id: key,
      mimeType,
      dataURL: value.dataURL,
      created: num(value.created, Date.now()),
    }
    out[key] =
      typeof value.lastRetrieved === "number" && Number.isFinite(value.lastRetrieved)
        ? { ...file, lastRetrieved: value.lastRetrieved }
        : file
  }
  return out
}

/**
 * Reads the document state a file carries, type-checked key by key. The theme
 * and current-item defaults in a file are ignored: they are the user's choice.
 */
export const sanitizeAppState = (raw: unknown): Partial<AppState> => {
  const a = isRecord(raw) ? raw : {}
  const out: { -readonly [K in keyof AppState]?: AppState[K] } = {
    viewBackgroundColor: color(a.viewBackgroundColor, DEFAULT_APP_STATE.viewBackgroundColor),
  }
  // Excalidraw 0.18 always writes gridSize and says whether the grid is on separately
  if (a.gridModeEnabled === false || a.gridSize === null) out.gridSize = null
  else if (typeof a.gridSize === "number" && Number.isFinite(a.gridSize) && a.gridSize >= 1)
    out.gridSize = Math.min(a.gridSize, 1000)
  const snap = a.objectsSnapMode ?? a.objectsSnapModeEnabled
  if (typeof snap === "boolean") out.objectsSnapMode = snap
  if (typeof a.name === "string") out.name = a.name
  const viewport = readViewport(a)
  if (viewport) out.viewport = viewport
  return out
}

const readViewport = (a: Record<string, unknown>): Viewport | null => {
  if (isRecord(a.viewport)) {
    const v = a.viewport
    return { scrollX: num(v.scrollX, 0), scrollY: num(v.scrollY, 0), zoom: zoomOr(v.zoom) }
  }
  if ("scrollX" in a || "scrollY" in a || "zoom" in a) {
    const zoom = isRecord(a.zoom) ? a.zoom.value : a.zoom
    return { scrollX: num(a.scrollX, 0), scrollY: num(a.scrollY, 0), zoom: zoomOr(zoom) }
  }
  return null
}

const zoomOr = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? clamp(v, MIN_ZOOM, MAX_ZOOM) : 1

export const parseNib = (text: string, opts: NibReadOptions = {}): ParseResult => {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${(e as Error).message}` }
  }
  try {
    if (!isRecord(json)) return { ok: false, error: "File is empty" }
    if (json.type !== NIB_FILE_TYPE && json.type !== "excalidraw")
      return { ok: false, error: `Unsupported file type: ${String(json.type)}` }
    if (json.type === "excalidraw") {
      if (!Array.isArray(json.elements)) return { ok: false, error: "File has no elements array" }
      return {
        ok: true,
        elements: normalizeElements(json.elements),
        appState: sanitizeAppState(json.appState),
        files: normalizeFiles(json.files),
        format: "excalidraw",
      }
    }
    const migrated = migrateNib(json, opts)
    const doc = migrated.doc
    if (!Array.isArray(doc.elements)) return { ok: false, error: "File has no elements array" }
    const result: ParseResult = {
      ok: true,
      elements: normalizeElements(doc.elements),
      appState: sanitizeAppState(doc.appState),
      files: normalizeFiles(doc.files),
      format: "nib",
    }
    if (migrated.newer) {
      result.newerVersion = migrated.from
      result.warnings = [newerVersionWarning(migrated.from, opts.currentVersion)]
    }
    return result
  } catch (e) {
    return { ok: false, error: `Could not read the drawing: ${(e as Error).message}` }
  }
}

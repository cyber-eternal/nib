import { type NibElement, frameExport, getCommonRenderBounds, getElementBounds } from "@nib/core"
import { EXPORT_PADDING, type ExportOptions, effectiveExportScale } from "../../export/exportImage"
import { frameDisplayName } from "./searchModel"

export type ExportFormat = "png" | "svg"
export type ExportScope = "canvas" | "selection" | "frame"
export type ExportScale = 1 | 2 | 3

/** The frame picker's "every frame, one file each" entry. */
export const ALL_FRAMES = "*"

/** Options the dialog remembers between opens; scope is decided by what is selected each time. */
export interface ExportPrefs {
  format: ExportFormat
  scale: ExportScale
  background: boolean
  /** null follows the canvas (dark export for a dark theme). */
  dark: boolean | null
  embedScene: boolean
  embedFonts: boolean
}

export const EXPORT_PREF_KEY = "nib.export"

export const DEFAULT_EXPORT_PREFS: ExportPrefs = {
  format: "png",
  scale: 2,
  background: true,
  dark: null,
  embedScene: false,
  embedFonts: true,
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null

/** Stored options, with anything missing or malformed falling back to the defaults. */
export const parseExportPrefs = (text: string | null | undefined): ExportPrefs => {
  if (!text) return { ...DEFAULT_EXPORT_PREFS }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ...DEFAULT_EXPORT_PREFS }
  }
  if (!isRecord(raw)) return { ...DEFAULT_EXPORT_PREFS }
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d)
  return {
    format: raw.format === "svg" ? "svg" : "png",
    scale: raw.scale === 1 || raw.scale === 3 ? raw.scale : 2,
    background: bool(raw.background, DEFAULT_EXPORT_PREFS.background),
    dark: typeof raw.dark === "boolean" ? raw.dark : null,
    embedScene: bool(raw.embedScene, DEFAULT_EXPORT_PREFS.embedScene),
    embedFonts: bool(raw.embedFonts, DEFAULT_EXPORT_PREFS.embedFonts),
  }
}

export const serializeExportPrefs = (p: ExportPrefs): string => JSON.stringify(p)

/** The live frames in z-order. */
export const framesOf = (elements: readonly NibElement[]): NibElement[] =>
  elements.filter((e) => e.type === "frame" && !e.isDeleted)

/** Frame names as the picker lists them: unnamed and repeated names are numbered so each is distinct. */
export const frameTitles = (frames: readonly NibElement[]): string[] => {
  const names = frames.map((f) => frameDisplayName(f as { name?: string | null }))
  const totals = new Map<string, number>()
  for (const n of names) totals.set(n, (totals.get(n) ?? 0) + 1)
  const seen = new Map<string, number>()
  return names.map((n) => {
    if ((totals.get(n) ?? 0) < 2) return n
    const k = (seen.get(n) ?? 0) + 1
    seen.set(n, k)
    return `${n} ${k}`
  })
}

/** Where the dialog starts: the one selected frame, else the selection, else the whole canvas. */
export const initialScope = (
  selection: readonly NibElement[],
): { scope: ExportScope; frameId: string | null } => {
  const picked = selection.filter((e) => !(e.type === "text" && e.containerId))
  if (picked.length === 1 && picked[0]!.type === "frame") return { scope: "frame", frameId: picked[0]!.id }
  if (picked.length > 0) return { scope: "selection", frameId: null }
  return { scope: "canvas", frameId: null }
}

/** A file name stem safe on macOS, Windows and in a browser download. */
export const fileStem = (name: string, fallback = "drawing"): string => {
  const cleaned = name
    .replace(/\.(nibd|excalidraw|json|png|svg)$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.-]+|[.-]+$/g, "")
  return cleaned.slice(0, 120) || fallback
}

/** One stem per frame for an every-frame export, unique within the batch. */
export const frameFileStems = (base: string, titles: readonly string[]): string[] => {
  const used = new Set<string>()
  return titles.map((title) => {
    const stem = fileStem(`${fileStem(base)} - ${fileStem(title, "Frame")}`)
    let unique = stem
    for (let k = 2; used.has(unique.toLocaleLowerCase()); k++) unique = `${stem} ${k}`
    used.add(unique.toLocaleLowerCase())
    return unique
  })
}

export interface ExportSize {
  /** Output size in pixels at `scale`. */
  width: number
  height: number
  /** The scale the export really uses (PNG exports shrink to fit the browser's canvas limits). */
  scale: number
  requested: number
  /** True when the PNG had to be exported at a lower scale than asked for. */
  reduced: boolean
}

/** The output size, laid out exactly as export/exportImage lays it out. */
export const exportSize = (opts: ExportOptions, format: ExportFormat): ExportSize => {
  const framed = opts.frameId ? frameExport(opts.elements, opts.frameId) : null
  const visible = framed ? framed.elements : opts.elements.filter((e) => !e.isDeleted)
  const padding = opts.padding ?? (framed ? 0 : EXPORT_PADDING)
  const bounds = framed
    ? getElementBounds(framed.frame)
    : visible.length
      ? getCommonRenderBounds(visible)
      : ([0, 0, 100, 100] as const)
  const w = Math.max(1, bounds[2] - bounds[0] + padding * 2)
  const h = Math.max(1, bounds[3] - bounds[1] + padding * 2)
  const requested = Number.isFinite(opts.scale) && opts.scale > 0 ? opts.scale : 1
  const scale = format === "png" ? effectiveExportScale(opts) : requested
  return {
    width: Math.max(1, Math.floor(w * scale)),
    height: Math.max(1, Math.floor(h * scale)),
    scale,
    requested,
    reduced: scale < requested - 1e-6,
  }
}

/** "1840 × 1220 px", with the actual scale when the browser's limits forced a smaller one. */
export const sizeLabel = (size: ExportSize): string => `${size.width} × ${size.height} px`

export const scaleLabel = (scale: number): string => `${Math.round(scale * 100) / 100}×`

/** Readable message for anything an export or a save throws; null for a cancelled save picker. */
export const exportErrorMessage = (e: unknown): string | null => {
  if (e instanceof Error && e.name === "AbortError") return null
  const detail = e instanceof Error ? e.message : String(e)
  return detail ? `Export failed: ${detail}` : "Export failed. Try a smaller scale or fewer elements."
}

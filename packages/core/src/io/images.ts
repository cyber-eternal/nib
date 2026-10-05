/** Imported bitmaps are scaled down to fit this many pixels on their longest side. */
export const MAX_IMAGE_SIDE = 2560
/** Smaller files are kept byte for byte unless they also need scaling down. */
export const RECOMPRESS_BYTES = 1024 * 1024

export type ImageEncoding = "image/png" | "image/jpeg" | "image/webp"

export interface ImageImportInfo {
  mimeType: string
  width: number
  height: number
  /** Size of the original file in bytes. */
  bytes: number
}

export interface ImageImportOptions {
  maxSide?: number
  /** Keep the original file even when it is large. */
  keepOriginal?: boolean
}

export type ImageImportPlan =
  | { action: "keep"; reason: "vector" | "animated" | "small" | "requested" }
  | {
      action: "reencode"
      width: number
      height: number
      /** Candidates in order of preference; the smallest one that encodes wins. */
      formats: ImageEncoding[]
      /** Lossy formats are only allowed when the image turns out to have no transparency. */
      lossyOnlyIfOpaque: boolean
      quality: number
    }

// lossy camera formats with no transparency
const PHOTO_TYPES = new Set(["image/jpeg", "image/jpg", "image/heic", "image/heif"])
// formats every engine Nib runs in can draw, so a small one is safe to store as it is
const WEB_SAFE = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"])

/** `width` x `height` scaled to fit `maxSide` on the longest side, rounded to whole pixels. */
export const fitImageSize = (
  width: number,
  height: number,
  maxSide = MAX_IMAGE_SIDE,
): { width: number; height: number; scaled: boolean } => {
  const w = Number.isFinite(width) && width > 0 ? width : 1
  const h = Number.isFinite(height) && height > 0 ? height : 1
  const ratio = Math.min(1, maxSide / Math.max(w, h))
  if (ratio >= 1) return { width: Math.round(w), height: Math.round(h), scaled: false }
  return {
    width: Math.max(1, Math.round(w * ratio)),
    height: Math.max(1, Math.round(h * ratio)),
    scaled: true,
  }
}

/**
 * What to do with an image on import. Large bitmaps are scaled down to `maxSide` and re-encoded:
 * photos as WebP or JPEG, anything that may be transparent as PNG (or lossy only when it proves opaque).
 * SVG stays vector and GIF keeps its animation.
 */
export const planImageImport = (info: ImageImportInfo, opts: ImageImportOptions = {}): ImageImportPlan => {
  const type = info.mimeType.toLowerCase()
  if (type === "image/svg+xml") return { action: "keep", reason: "vector" }
  if (type === "image/gif") return { action: "keep", reason: "animated" }
  if (opts.keepOriginal) return { action: "keep", reason: "requested" }
  const size = fitImageSize(info.width, info.height, opts.maxSide ?? MAX_IMAGE_SIDE)
  if (!size.scaled && info.bytes <= RECOMPRESS_BYTES && WEB_SAFE.has(type))
    return { action: "keep", reason: "small" }
  return PHOTO_TYPES.has(type)
    ? {
        action: "reencode",
        width: size.width,
        height: size.height,
        formats: ["image/webp", "image/jpeg"],
        lossyOnlyIfOpaque: false,
        quality: 0.85,
      }
    : {
        action: "reencode",
        width: size.width,
        height: size.height,
        formats: ["image/png", "image/webp", "image/jpeg"],
        lossyOnlyIfOpaque: true,
        quality: 0.9,
      }
}

/** True for formats every engine Nib runs in can draw, so a file of that type is safe to store as is. */
export const isWebSafeImageType = (type: string): boolean => WEB_SAFE.has(type.toLowerCase())

/** True for formats that throw detail away, which a transparent image must never be encoded to. */
export const isLossyEncoding = (type: string): boolean => type === "image/jpeg" || type === "image/webp"

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag)
  return m ? (m[1] ?? m[2] ?? null) : null
}

const length = (value: string | null): number | null => {
  if (!value) return null
  const m = /^\s*([\d.]+)\s*(px)?\s*$/i.exec(value)
  const n = m ? Number(m[1]) : Number.NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * The size an SVG asks to be drawn at, from its root width/height or viewBox. Browsers report 0 or
 * 300x150 for an SVG without one, so the importer needs this to size the image element.
 */
export const svgIntrinsicSize = (svg: string): { width: number; height: number } | null => {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0]
  if (!tag) return null
  const width = length(attr(tag, "width"))
  const height = length(attr(tag, "height"))
  const box = attr(tag, "viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  const vw = box && box.length === 4 && box[2]! > 0 ? box[2]! : null
  const vh = box && box.length === 4 && box[3]! > 0 ? box[3]! : null
  if (width && height) return { width, height }
  if (width && vw && vh) return { width, height: (width * vh) / vw }
  if (height && vw && vh) return { width: (height * vw) / vh, height }
  if (vw && vh) return { width: vw, height: vh }
  return null
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

/** base64 of `bytes`; core has no btoa, Buffer or FileReader to lean on. */
export const bytesToBase64 = (bytes: Uint8Array): string => {
  const out: string[] = []
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    out.push(
      B64[b0 >> 2]!,
      B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]!,
      b1 === undefined ? "=" : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]!,
      b2 === undefined ? "=" : B64[b2 & 63]!,
    )
  }
  return out.join("")
}

export const dataUrlOf = (mimeType: string, bytes: Uint8Array): string =>
  `data:${mimeType};base64,${bytesToBase64(bytes)}`

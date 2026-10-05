import {
  type ImageEncoding,
  type ImageImportOptions,
  dataUrlOf,
  isLossyEncoding,
  isWebSafeImageType,
  planImageImport,
  svgIntrinsicSize,
} from "@nib/core"

export interface PreparedImage {
  dataURL: string
  mimeType: string
  width: number
  height: number
  /** True when the bitmap was scaled down or re-encoded rather than stored as it came. */
  converted: boolean
}

/** A decoded image that can be redrawn at another size. */
export interface DecodedImage {
  width: number
  height: number
  /** Draws the image at width x height and encodes it; null when the browser can't write `type`. */
  encode(width: number, height: number, type: ImageEncoding, quality: number): Promise<Blob | null>
  /** True when the image drawn at width x height has a pixel that is not fully opaque. */
  hasAlpha(width: number, height: number): boolean
  close(): void
}

/** Decodes `blob`, rejecting when it isn't an image this host can show. Tests inject their own. */
export type ImageDecoder = (blob: Blob, mimeType: string) => Promise<DecodedImage>

export interface PrepareImageOptions extends ImageImportOptions {
  decode?: ImageDecoder
}

export const NOT_AN_IMAGE = "It isn't an image Nib can show."

const makeCanvas = (width: number, height: number) => {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("The browser couldn't make room to resize this image.")
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  return { canvas, ctx }
}

/** The browser's decoder: an <img> for reading (it handles SVG, which createImageBitmap does not) and a canvas for resizing. */
export const domImageDecoder: ImageDecoder = async (blob) => {
  const url = URL.createObjectURL(blob)
  const img = new Image()
  // load events rather than img.decode(), which some engines reject for an SVG without a size
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error(NOT_AN_IMAGE))
      img.src = url
    })
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
  let cached: { width: number; height: number; canvas: HTMLCanvasElement } | null = null
  const drawn = (width: number, height: number): HTMLCanvasElement => {
    if (cached && cached.width === width && cached.height === height) return cached.canvas
    let source: CanvasImageSource = img
    let sw = img.naturalWidth
    let sh = img.naturalHeight
    // halving in steps keeps a large reduction from aliasing, which one big drawImage does
    while (sw / 2 >= width && sh / 2 >= height) {
      const step = makeCanvas(Math.round(sw / 2), Math.round(sh / 2))
      step.ctx.drawImage(source, 0, 0, step.canvas.width, step.canvas.height)
      source = step.canvas
      sw = step.canvas.width
      sh = step.canvas.height
    }
    const out = makeCanvas(width, height)
    out.ctx.drawImage(source, 0, 0, width, height)
    cached = { width, height, canvas: out.canvas }
    return out.canvas
  }
  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    encode: (width, height, type, quality) =>
      new Promise((resolve) => drawn(width, height).toBlob((b) => resolve(b), type, quality)),
    hasAlpha(width, height) {
      const data = drawn(width, height).getContext("2d")!.getImageData(0, 0, width, height).data
      for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) return true
      return false
    },
    close() {
      cached = null
      URL.revokeObjectURL(url)
    },
  }
}

const original = (type: string, bytes: Uint8Array, width: number, height: number): PreparedImage => ({
  dataURL: dataUrlOf(type, bytes),
  mimeType: type,
  width,
  height,
  converted: false,
})

/**
 * Reads an image file for insertion: scaled down to at most 2560px on its longest side and
 * re-encoded when that or a smaller file helps (core's planImageImport decides), kept as it is otherwise.
 */
export const prepareImage = async (
  blob: Blob,
  mimeType: string,
  opts: PrepareImageOptions = {},
): Promise<PreparedImage> => {
  const decode = opts.decode ?? domImageDecoder
  const type = mimeType.toLowerCase()
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let decoded: DecodedImage
  try {
    decoded = await decode(new Blob([bytes as BlobPart], { type }), type)
  } catch {
    throw new Error(NOT_AN_IMAGE)
  }
  try {
    if (type === "image/svg+xml") {
      // an SVG without its own size decodes as 0x0 or 300x150 depending on the engine
      const size = svgIntrinsicSize(new TextDecoder().decode(bytes)) ?? {
        width: decoded.width || 300,
        height: decoded.height || 150,
      }
      return original(type, bytes, size.width, size.height)
    }
    if (!decoded.width || !decoded.height) throw new Error(NOT_AN_IMAGE)
    const plan = planImageImport(
      { mimeType: type, width: decoded.width, height: decoded.height, bytes: bytes.length },
      opts,
    )
    if (plan.action === "keep") return original(type, bytes, decoded.width, decoded.height)

    const opaque = !plan.lossyOnlyIfOpaque || !decoded.hasAlpha(plan.width, plan.height)
    let best: Blob | null = null
    for (const format of plan.formats) {
      if (!opaque && isLossyEncoding(format)) continue
      const encoded = await decoded.encode(plan.width, plan.height, format, plan.quality)
      // a browser that can't write the format silently hands back a PNG instead
      if (!encoded || encoded.type !== format) continue
      if (!best || encoded.size < best.size) best = encoded
    }
    const scaled = plan.width !== decoded.width || plan.height !== decoded.height
    const keepOriginal = isWebSafeImageType(type) && (!best || (!scaled && best.size >= bytes.length))
    if (keepOriginal || !best) {
      if (!isWebSafeImageType(type)) throw new Error(NOT_AN_IMAGE)
      return original(type, bytes, decoded.width, decoded.height)
    }
    return {
      dataURL: dataUrlOf(best.type, new Uint8Array(await best.arrayBuffer())),
      mimeType: best.type,
      width: plan.width,
      height: plan.height,
      converted: true,
    }
  } finally {
    decoded.close()
  }
}

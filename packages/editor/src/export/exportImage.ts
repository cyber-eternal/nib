import {
  type AppState,
  type BinaryFiles,
  type CanvasPalette,
  type NibElement,
  ShapeCache,
  type Theme,
  asCanvas2D,
  canvasBackground,
  exportToSvg,
  frameExport,
  getCommonRenderBounds,
  getElementBounds,
  renderElementsTo,
  usedFiles,
} from "@nib/core"
import { ImageCache } from "../canvas/imageCache"
import { type EmbedFontOptions, buildEmbeddedFontCss, waitForFonts } from "./embedFonts"

export interface ExportOptions {
  elements: readonly NibElement[]
  appState: AppState
  files: BinaryFiles
  scale: number
  exportBackground: boolean
  theme: Theme
  padding?: number
  embedScene?: string | null
  /** SVG files only (exportToSvgFile): inline the bundled fonts the text uses, as @font-face data URLs. */
  embedFonts?: boolean
  /** The active theme's canvas palette: its board is the background and the dark remap's pivot. */
  palette?: CanvasPalette
  /** Export just this frame: its contents clipped to it, sized to it, without its border or name. */
  frameId?: string | null
}

export const EXPORT_PADDING = 16
/** WebKit and Chromium refuse canvases past these limits, and an oversized one fails without a message. */
export const MAX_EXPORT_SIDE = 16384
export const MAX_EXPORT_AREA = 16384 * 4096

const decodeImages = (files: BinaryFiles, ids: readonly string[]): Promise<ImageCache> =>
  new Promise((resolve) => {
    const cache = new ImageCache()
    if (ids.length === 0) {
      resolve(cache)
      return
    }
    let pending = ids.length
    const done = () => {
      pending -= 1
      if (pending <= 0) resolve(cache)
    }
    for (const id of ids) {
      const img = new Image()
      img.onload = () => {
        cache.put(id, { image: img, width: img.naturalWidth, height: img.naturalHeight })
        done()
      }
      img.onerror = done
      img.src = files[id]!.dataURL
    }
  })

const exportLayout = (opts: ExportOptions) => {
  const framed = opts.frameId ? frameExport(opts.elements, opts.frameId) : null
  const visible = framed ? framed.elements : opts.elements.filter((e) => !e.isDeleted)
  // a frame exports at exactly its own size, like a slide
  const padding = opts.padding ?? (framed ? 0 : EXPORT_PADDING)
  // render bounds include what is drawn outside outlines: arrowhead wings, ink, rough jitter, frame names
  const bounds = framed
    ? getElementBounds(framed.frame)
    : visible.length
      ? getCommonRenderBounds(visible)
      : ([0, 0, 100, 100] as const)
  const width = Math.max(1, bounds[2] - bounds[0] + padding * 2)
  const height = Math.max(1, bounds[3] - bounds[1] + padding * 2)
  return { visible, padding, bounds, width, height, hidden: framed ? new Set([framed.frame.id]) : undefined }
}

/** The scale a PNG export really uses: the requested one, reduced until the canvas fits the browser's limits. */
export const effectiveExportScale = (opts: ExportOptions): number => {
  const { width, height } = exportLayout(opts)
  const requested = Number.isFinite(opts.scale) && opts.scale > 0 ? opts.scale : 1
  return Math.min(
    requested,
    MAX_EXPORT_SIDE / width,
    MAX_EXPORT_SIDE / height,
    Math.sqrt(MAX_EXPORT_AREA / (width * height)),
  )
}

/** Renders the given elements onto a fresh canvas sized to their bounds, at effectiveExportScale. */
export const exportToCanvas = async (opts: ExportOptions): Promise<HTMLCanvasElement> => {
  const { visible, padding, bounds, width, height, hidden } = exportLayout(opts)
  const scale = effectiveExportScale(opts)

  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.floor(width * scale))
  canvas.height = Math.max(1, Math.floor(height * scale))
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("The browser couldn't create a canvas this large. Try a smaller scale.")

  if (opts.exportBackground) {
    ctx.fillStyle = canvasBackground(opts.appState.viewBackgroundColor, opts.theme, opts.palette)
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  const used = Object.keys(usedFiles(visible, opts.files))
  // text drawn before its face has loaded is rasterised in a fallback font
  const [images] = await Promise.all([decodeImages(opts.files, used), waitForFonts(visible)])
  ctx.save()
  ctx.scale(scale, scale)
  ctx.translate(padding - bounds[0], padding - bounds[1])
  renderElementsTo(asCanvas2D(ctx), visible, {
    theme: opts.theme,
    cache: new ShapeCache(),
    resolveImage: (id) => images.get(id),
    palette: opts.palette,
    // the frame still clips its contents; only its border and name stay out
    hiddenElementIds: hidden,
  })
  ctx.restore()
  return canvas
}

export const exportToPngBlob = async (opts: ExportOptions): Promise<Blob> => {
  const canvas = await exportToCanvas(opts)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
  if (!blob) throw new Error("Couldn't encode the PNG. Try a smaller scale.")
  if (!opts.embedScene) return blob
  return embedSceneInPng(blob, opts.embedScene)
}

/** The SVG markup, synchronously and without embedded fonts (previews); exportToSvgFile is for files. */
export const exportToSvgString = (opts: ExportOptions, embedFontCss?: string): string =>
  exportToSvg({
    elements: opts.elements,
    appState: opts.appState,
    files: opts.files,
    exportBackground: opts.exportBackground,
    exportPadding: exportLayout(opts).padding,
    scale: opts.scale,
    theme: opts.theme,
    embedScene: opts.embedScene ?? null,
    embedFontCss: embedFontCss || undefined,
    palette: opts.palette,
    frameId: opts.frameId ?? null,
  })

/** The SVG to save or copy: with `embedFonts`, the bundled faces its text uses are inlined. */
export const exportToSvgFile = async (opts: ExportOptions, fonts: EmbedFontOptions = {}): Promise<string> => {
  const css = opts.embedFonts ? await buildEmbeddedFontCss(exportLayout(opts).visible, fonts) : ""
  return exportToSvgString(opts, css)
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const SCENE_KEYWORD = "nib"
const EXCALIDRAW_KEYWORD = "application/vnd.excalidraw+json"

const latin1 = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
  return out
}

const fromLatin1 = (bytes: Uint8Array): string => {
  let out = ""
  for (let i = 0; i < bytes.length; i += 0x8000)
    out += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 0x8000)))
  return out
}

const pipe = async (bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> =>
  new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer())

// zlib-wrapped deflate is what PNG compressed text chunks and Excalidraw's pako both use
const deflate = (bytes: Uint8Array): Promise<Uint8Array> | null =>
  typeof CompressionStream === "undefined" ? null : pipe(bytes, new CompressionStream("deflate"))
const inflate = (bytes: Uint8Array): Promise<Uint8Array> => {
  if (typeof DecompressionStream === "undefined")
    throw new Error("This browser can't read compressed PNG text")
  return pipe(bytes, new DecompressionStream("deflate"))
}

const buildChunk = (type: string, data: Uint8Array): Uint8Array => {
  const typeBytes = latin1(type)
  const chunk = new Uint8Array(12 + data.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.length)
  chunk.set(typeBytes, 4)
  chunk.set(data, 8)
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)))
  return chunk
}

/**
 * Stores the scene JSON in a compressed iTXt chunk (UTF-8, unlike tEXt which
 * is Latin-1), so an exported image can be dropped back onto the canvas.
 */
export const embedSceneInPng = async (blob: Blob, scene: string): Promise<Blob> => {
  const original = new Uint8Array(await blob.arrayBuffer())
  const text = new TextEncoder().encode(scene)
  const compressed = await deflate(text)
  const keyword = latin1(SCENE_KEYWORD)
  // keyword NUL, compression flag and method, then empty language tag and translated keyword
  const header = new Uint8Array([...keyword, 0, compressed ? 1 : 0, 0, 0, 0])
  const payload = compressed ?? text
  const data = new Uint8Array(header.length + payload.length)
  data.set(header, 0)
  data.set(payload, header.length)
  const chunk = buildChunk("iTXt", data)

  // insert just after the IHDR chunk, which always starts at byte 8
  const ihdrLength = new DataView(original.buffer, original.byteOffset).getUint32(8)
  const insertAt = 8 + 12 + ihdrLength
  const out = new Uint8Array(original.length + chunk.length)
  out.set(original.subarray(0, insertAt), 0)
  out.set(chunk, insertAt)
  out.set(original.subarray(insertAt), insertAt + chunk.length)
  return new Blob([out as BlobPart], { type: "image/png" })
}

// Excalidraw wraps its scene as {encoding: "bstring", compressed, encoded}: a byte string of (deflated) UTF-8
const decodeExcalidrawPayload = async (text: string): Promise<string | null> => {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!data || typeof data !== "object") return null
  const envelope = data as { encoded?: unknown; compressed?: unknown; type?: unknown }
  if (typeof envelope.encoded !== "string") return envelope.type === "excalidraw" ? text : null
  const bytes = latin1(envelope.encoded)
  return new TextDecoder().decode(envelope.compressed === true ? await inflate(bytes) : bytes)
}

const readTextChunk = async (
  type: string,
  data: Uint8Array,
): Promise<{ keyword: string; text: string } | null> => {
  const nul = data.indexOf(0)
  if (nul <= 0) return null
  const keyword = fromLatin1(data.subarray(0, nul))
  if (type === "tEXt") {
    const body = data.subarray(nul + 1)
    // builds before iTXt wrote the scene as UTF-8 into tEXt, so keep reading that the same way
    const ours = keyword === SCENE_KEYWORD
    return { keyword, text: ours ? new TextDecoder().decode(body) : fromLatin1(body) }
  }
  const compressed = data[nul + 1] === 1
  let at = nul + 3
  const langEnd = data.indexOf(0, at)
  if (langEnd < 0) return null
  const translatedEnd = data.indexOf(0, langEnd + 1)
  if (translatedEnd < 0) return null
  at = translatedEnd + 1
  const body = data.subarray(at)
  return { keyword, text: new TextDecoder().decode(compressed ? await inflate(body) : body) }
}

/** The scene JSON embedded in a PNG exported by Nib or by Excalidraw, or null. */
export const extractSceneFromPng = async (blob: Blob): Promise<string | null> => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset)
    const type = fromLatin1(bytes.subarray(offset + 4, offset + 8))
    if (type === "tEXt" || type === "iTXt") {
      try {
        const chunk = await readTextChunk(type, bytes.subarray(offset + 8, offset + 8 + length))
        if (chunk?.keyword === SCENE_KEYWORD) return chunk.text
        if (chunk?.keyword === EXCALIDRAW_KEYWORD) {
          const scene = await decodeExcalidrawPayload(chunk.text)
          if (scene) return scene
        }
      } catch {
        // a damaged text chunk is just not a scene
      }
    }
    if (type === "IEND") break
    offset += 12 + length
  }
  return null
}

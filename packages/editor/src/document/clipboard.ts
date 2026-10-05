import {
  type AppState,
  type BinaryFiles,
  type EditorCore,
  type ElementStyle,
  type NibElement,
  type Point,
  type TextElement,
  classifyPaste,
  clipboardSummary,
  copyStyleFrom,
  extractSceneFromSvg,
  getBoundText,
  indicesBetween,
  layoutBoundText,
  measureMultiline,
  mermaidToElements,
  newElement,
  parseClipboard,
  parseMermaid,
  parseScene,
  randomId,
  serializeClipboard,
  usedFiles,
} from "@nib/core"
import type { Platform } from "@nib/platform"
import { exportToPngBlob, exportToSvgString, extractSceneFromPng } from "../export/exportImage"
import { NOT_A_DRAWING } from "./documentController"
import { type ImageDecoder, type PrepareImageOptions, prepareImage } from "./imageImport"

/** Last internal copy, used only when the system clipboard can't be read at all. */
let internalBuffer: string | null = null
let styleBuffer: ElementStyle | null = null

export interface CopyOptions {
  /** Renders the PNG flavour; the default draws the selection at 2x on a canvas. */
  renderPng?: (elements: readonly NibElement[], files: BinaryFiles, appState: AppState) => Promise<Uint8Array>
  /**
   * The cut or copy event already put the Nib JSON on the system clipboard (`e.clipboardData`), so a
   * cut may delete even when the later multi-format write is refused.
   */
  eventWritten?: boolean
}

const COPY_PNG_SCALE = 2

const defaultRenderPng: NonNullable<CopyOptions["renderPng"]> = async (elements, files, appState) => {
  const blob = await exportToPngBlob({
    elements,
    appState,
    files,
    scale: COPY_PNG_SCALE,
    exportBackground: true,
    theme: appState.theme,
  })
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * What a copy or cut of the selection takes, in stacking order: the selection, the contents of any
 * frame in it, and the labels of all of those.
 */
export const clipboardElements = (core: EditorCore): NibElement[] => {
  const ids = core.withFrameChildren(core.selectedElements({ includeBoundText: true }))
  for (const id of [...ids]) {
    for (const b of core.scene.get(id)?.boundElements ?? []) if (b?.type === "text") ids.add(b.id)
  }
  return core.scene.getNonDeleted().filter((el) => ids.has(el.id))
}

/** Puts `elements` on the clipboard. Resolves true when the system clipboard took them. */
const writeClipboard = async (
  core: EditorCore,
  platform: Platform,
  elements: readonly NibElement[],
  opts: CopyOptions,
): Promise<boolean> => {
  const files = usedFiles(elements, core.scene.files)
  const json = serializeClipboard(elements, files)
  internalBuffer = json
  const write = platform.clipboard.write
  if (write) {
    // started before any await: WebKit only lets the copying gesture itself put an image on the clipboard
    const png = (opts.renderPng ?? defaultRenderPng)(elements, files, core.appState)
    png.catch(() => {})
    let svg: string | undefined
    try {
      svg = exportToSvgString({
        elements,
        appState: core.appState,
        files,
        scale: 1,
        exportBackground: false,
        theme: core.appState.theme,
      })
    } catch {
      svg = undefined
    }
    try {
      await write.call(platform.clipboard, { json, text: clipboardSummary(elements) || undefined, svg, png })
      return true
    } catch {
      // fall back to the JSON alone, which Nib can always paste back
    }
  }
  try {
    await platform.clipboard.writeText(json)
    return true
  } catch {
    // system clipboard can be denied; the internal buffer still pastes inside this tab
    return false
  }
}

/**
 * Copies the selection, with the contents of selected frames. Where the host can write several flavours
 * at once it adds a PNG, an SVG and a plain-text summary next to the Nib JSON, so pasting into Slack,
 * Keynote or Mail gives a picture instead of raw JSON; otherwise the JSON goes in as text. Resolves true
 * when there was something to copy, even if only the in-app copy has it.
 */
export const copySelection = async (
  core: EditorCore,
  platform: Platform,
  opts: CopyOptions = {},
): Promise<boolean> => {
  const elements = clipboardElements(core)
  if (elements.length === 0) return false
  await writeClipboard(core, platform, elements, opts)
  return true
}

/**
 * Copies the selection and then deletes exactly what was copied, as one undoable step, whatever is
 * selected by the time the clipboard write finishes. Nothing is deleted when the copy reached neither
 * the system clipboard nor the cut event. Resolves true when it deleted.
 */
export const cutSelection = async (
  core: EditorCore,
  platform: Platform,
  opts: CopyOptions = {},
): Promise<boolean> => {
  if (core.appState.viewMode) return false
  const elements = clipboardElements(core)
  if (elements.length === 0) return false
  const copied = await writeClipboard(core, platform, elements, opts)
  if (!copied && !opts.eventWritten) return false
  if (core.appState.viewMode) return false
  let deleted = new Set<string>()
  // the frames' contents were captured with them; anything moved into a frame since is let go, not lost
  core.transact(() => {
    deleted = core.deleteElements(elements, { frameChildren: "release" })
  })
  if (deleted.size === 0) return false
  forgetDeleted(core, deleted)
  return true
}

/** Takes what a cut removed out of the selection and the editing modes, leaving the rest selected. */
const forgetDeleted = (core: EditorCore, deleted: ReadonlySet<string>): void => {
  const a = core.appState
  const groups = new Set(core.scene.getNonDeleted().flatMap((el) => el.groupIds))
  const ids = Object.keys(a.selectedElementIds)
  const keptIds = ids.filter((id) => !deleted.has(id))
  const groupIds = Object.keys(a.selectedGroupIds)
  const keptGroups = groupIds.filter((g) => groups.has(g))
  const patch: { -readonly [K in keyof AppState]?: AppState[K] } = {}
  if (keptIds.length !== ids.length)
    patch.selectedElementIds = Object.fromEntries(keptIds.map((id) => [id, true as const]))
  if (keptGroups.length !== groupIds.length)
    patch.selectedGroupIds = Object.fromEntries(keptGroups.map((g) => [g, true as const]))
  if (a.editingLinearElementId && deleted.has(a.editingLinearElementId)) patch.editingLinearElementId = null
  if (a.croppingElementId && deleted.has(a.croppingElementId)) patch.croppingElementId = null
  if (a.editingGroupId && !groups.has(a.editingGroupId)) patch.editingGroupId = null
  if (Object.keys(patch).length > 0) core.setAppState(patch)
}

/** What a DOM paste event carried, read from `e.clipboardData`. */
export interface PasteData {
  text?: string
  html?: string
  /** `e.clipboardData.files`; images among them are inserted unless the text is a Nib copy or a table. */
  files?: readonly File[]
}

export interface PasteOptions {
  /** Gets Mermaid text first, e.g. to open the Mermaid dialog prefilled; return true when handled. */
  onMermaid?: (source: string) => boolean
  decodeImage?: ImageDecoder
}

export type PasteKind = "elements" | "image" | "embed" | "link" | "mermaid" | "table" | "text" | "none"

export interface PasteOutcome {
  kind: PasteKind
  /** Lines of a Mermaid diagram that were skipped. */
  warnings: string[]
  errors: string[]
}

const htmlText = (html: string): string => {
  if (typeof DOMParser === "undefined") return ""
  return new DOMParser().parseFromString(html, "text/html").body.textContent ?? ""
}

const outcome = (kind: PasteKind, extra: Partial<PasteOutcome> = {}): PasteOutcome => ({
  kind,
  warnings: [],
  errors: [],
  ...extra,
})

const readSystemText = async (platform: Platform): Promise<{ text: string; failed: boolean }> => {
  try {
    return { text: await platform.clipboard.readText(), failed: false }
  } catch {
    return { text: "", failed: true }
  }
}

const readSystemImage = async (platform: Platform): Promise<File | null> => {
  try {
    const png = await platform.clipboard.readImage?.()
    return png && png.length > 0
      ? new File([png as BlobPart], "Pasted image.png", { type: "image/png" })
      : null
  } catch {
    return null
  }
}

/**
 * Pastes whatever the clipboard holds: Nib or Excalidraw elements, images, a link (an embed
 * for YouTube, Figma and the like), SVG markup as an image, Mermaid as a diagram, a spreadsheet
 * selection as a grid of cells, or plain text as a new text element. Pass `data` from a paste
 * event; without it (menu and context-menu paste) the system clipboard is read, and the internal
 * copy is the last resort.
 */
export const pasteContent = async (
  core: EditorCore,
  platform: Platform,
  at: Point,
  data?: PasteData,
  opts: PasteOptions = {},
): Promise<PasteOutcome> => {
  let text = ""
  let images: File[] = []
  let systemFailed = false
  if (data) {
    text = data.text || (data.html ? htmlText(data.html) : "")
    images = (data.files ?? []).filter((f) => imageTypeOf(f) !== null)
  } else {
    const read = await readSystemText(platform)
    text = read.text
    systemFailed = read.failed
  }

  const content = classifyPaste(text)
  if (content.kind === "scene") {
    insertElements(core, content.payload.elements, content.payload.files, at)
    return outcome("elements")
  }
  if (content.kind !== "table") {
    // a desktop WebView hands over an empty paste event for a screenshot; the menu has no event at all
    const wantsSystemImage = !data || (!text && images.length === 0 && platform.name !== "browser")
    if (images.length === 0 && wantsSystemImage) {
      const image = await readSystemImage(platform)
      if (image) images = [image]
    }
    if (images.length > 0) {
      const result = await ingestFiles(core, images, at, {
        mode: "insert-image",
        decodeImage: opts.decodeImage,
      })
      return outcome(result.images > 0 ? "image" : "none", { errors: result.errors })
    }
  }
  if (content.kind === "empty" && systemFailed && internalBuffer) {
    const payload = parseClipboard(internalBuffer)
    if (payload && payload.elements.length > 0) {
      insertElements(core, payload.elements, payload.files, at)
      return outcome("elements")
    }
  }

  switch (content.kind) {
    case "url":
      core.insertScene([content.embeddable ? embedFor(content.url) : linkTextFor(core, content.url)], {}, at)
      return outcome(content.embeddable ? "embed" : "link")
    case "svg": {
      const scene = extractSceneFromSvg(content.svg)
      const parsed = scene ? parseScene(scene) : null
      if (parsed?.ok && parsed.elements.length > 0) {
        insertElements(core, parsed.elements, parsed.files, at)
        return outcome("elements")
      }
      const file = new File([content.svg], "Pasted image.svg", { type: "image/svg+xml" })
      const result = await ingestFiles(core, [file], at, {
        mode: "insert-image",
        decodeImage: opts.decodeImage,
      })
      return outcome(result.images > 0 ? "image" : "none", { errors: result.errors })
    }
    case "mermaid": {
      if (opts.onMermaid?.(content.source)) return outcome("mermaid")
      const parsed = parseMermaid(content.source)
      const elements = mermaidToElements(parsed, {
        appState: core.appState,
        origin: [0, 0],
        nextIndex: () => core.scene.nextIndex(),
      })
      core.insertScene(elements, {}, at)
      return outcome("mermaid", { warnings: parsed.warnings })
    }
    case "table":
      core.insertScene(tableElements(core.appState, content.rows), {}, at)
      return outcome("table")
    case "text":
      core.startEditingText(createPastedText(core, content.text, at))
      return outcome("text")
    default:
      return outcome("none")
  }
}

/** pasteContent, resolving true when anything was pasted. */
export const pasteAt = async (
  core: EditorCore,
  platform: Platform,
  at: Point,
  data?: PasteData,
  opts?: PasteOptions,
): Promise<boolean> => (await pasteContent(core, platform, at, data, opts)).kind !== "none"

/** Adds copies of `elements` centred on `at`, with fresh ids and z-indices, as one undoable step. */
export const insertElements = (
  core: EditorCore,
  elements: readonly NibElement[],
  files: BinaryFiles,
  at: Point,
): void => {
  core.insertScene(elements, files, at)
}

const EMBED_WIDTH = 560
const EMBED_HEIGHT = 315

const embedFor = (url: string): NibElement =>
  newElement("embeddable", { x: 0, y: 0, width: EMBED_WIDTH, height: EMBED_HEIGHT, link: url })

const linkTextFor = (core: EditorCore, url: string): NibElement => {
  const a = core.appState
  const m = measureMultiline(url, a.currentItemFontSize, a.currentItemFontFamily)
  return newElement("text", {
    x: 0,
    y: 0,
    width: m.width,
    height: m.height,
    strokeColor: a.currentItemStrokeColor,
    fontSize: a.currentItemFontSize,
    fontFamily: a.currentItemFontFamily,
    textAlign: "left",
    text: url,
    originalText: url,
    link: url,
  })
}

const CELL_PAD_X = 12
const CELL_PAD_Y = 8
const CELL_MIN_W = 60
const CELL_FONT = 16
const NUMERIC = /^[-+]?[$€£¥]?\s*\d[\d,\s]*(?:\.\d+)?\s*%?$/

/** A pasted spreadsheet range as one group of bordered cells, numbers right-aligned. */
const tableElements = (appState: AppState, rows: readonly string[][]): NibElement[] => {
  const family = appState.currentItemFontFamily
  const cols = rows[0]?.length ?? 0
  const measure = (text: string) => measureMultiline(text || " ", CELL_FONT, family)
  const widths = Array.from({ length: cols }, (_, c) =>
    Math.max(CELL_MIN_W, ...rows.map((r) => measure(r[c] ?? "").width + CELL_PAD_X * 2)),
  )
  const heights = rows.map((r) => Math.max(...r.map((cell) => measure(cell).height)) + CELL_PAD_Y * 2)
  const groupIds = [randomId()]
  const out: NibElement[] = []
  let y = 0
  rows.forEach((row, r) => {
    let x = 0
    row.forEach((cell, c) => {
      const rect = newElement("rectangle", {
        x,
        y,
        width: widths[c]!,
        height: heights[r]!,
        groupIds,
        strokeColor: appState.currentItemStrokeColor,
        backgroundColor: "transparent",
        strokeWidth: 1,
        roughness: appState.currentItemRoughness,
      })
      if (cell) {
        const label = newElement("text", {
          x,
          y,
          width: 0,
          height: CELL_FONT * 1.25,
          groupIds,
          strokeColor: appState.currentItemStrokeColor,
          fontSize: CELL_FONT,
          fontFamily: family,
          textAlign: NUMERIC.test(cell) ? "right" : "left",
          verticalAlign: "middle",
          containerId: rect.id,
          text: cell,
          originalText: cell,
        }) as TextElement
        const laid = layoutBoundText({ ...rect, boundElements: [{ id: label.id, type: "text" }] }, label)
        out.push(laid.container, laid.text)
      } else out.push(rect)
      x += widths[c]!
    })
    y += heights[r]!
  })
  const keys = indicesBetween(null, null, out.length)
  return out.map((el, i) => ({ ...el, index: keys[i]! }))
}

const createPastedText = (core: EditorCore, text: string, at: Point) => {
  const a = core.appState
  return newElement("text", {
    x: at[0],
    y: at[1],
    width: 0,
    height: a.currentItemFontSize * 1.25,
    index: core.scene.nextIndex(),
    strokeColor: a.currentItemStrokeColor,
    fontSize: a.currentItemFontSize,
    fontFamily: a.currentItemFontFamily,
    textAlign: a.currentItemTextAlign,
    text,
    originalText: text,
  })
}

/** Remembers the first selected element's look, including its label's font and its arrowheads. */
export const copyStyle = (core: EditorCore): boolean => {
  const selection = core.selectedElements()
  const first = selection[0]
  if (!first) return false
  styleBuffer = copyStyleFrom(
    first,
    getBoundText(first, (id) => core.scene.get(id)),
  )
  return true
}

export const pasteStyle = (core: EditorCore): boolean => {
  if (!styleBuffer) return false
  core.pasteStyles({ ...styleBuffer })
  return true
}

/** A drawing found in a dropped or pasted file, parsed but not yet inserted or opened. */
export interface DroppedScene {
  /** The file name, minus a .png or .svg wrapper extension. */
  name: string
  /** The scene JSON, for DocumentController.openText. */
  text: string
  elements: NibElement[]
  appState: Partial<AppState>
  files: BinaryFiles
  /** For instance that the drawing comes from a newer version of Nib. */
  warnings: string[]
}

export interface IngestResult {
  /** Drawings to offer as Insert / Open; nothing has been changed for them yet. */
  scenes: DroppedScene[]
  /** Images inserted onto the canvas. */
  images: number
  errors: string[]
}

export interface IngestOptions {
  /** "insert-image" (the Image tool, image paste) never treats a PNG or SVG as a drawing. */
  mode?: "auto" | "insert-image"
  /** Store large images as they are instead of scaling them down. */
  keepOriginal?: boolean
  decodeImage?: ImageDecoder
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
}

const extensionOf = (name: string): string => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? ""

const imageTypeOf = (file: File): string | null => {
  if (file.type.startsWith("image/")) return file.type
  return IMAGE_TYPES[extensionOf(file.name)] ?? null
}

const sceneFrom = (text: string, name: string): DroppedScene | null => {
  const parsed = parseScene(text)
  if (!parsed.ok) return null
  return {
    name,
    text,
    elements: parsed.elements,
    appState: parsed.appState,
    files: parsed.files,
    warnings: parsed.warnings ?? [],
  }
}

/** Reads, downsizes and inserts one image file at `at`, as one undoable step. */
export const insertImageFile = async (
  core: EditorCore,
  file: Blob,
  mimeType: string,
  at: Point,
  opts: PrepareImageOptions = {},
): Promise<NibElement> => {
  const prepared = await prepareImage(file, mimeType, opts)
  return core.insertImage(
    {
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      mimeType: prepared.mimeType,
      dataURL: prepared.dataURL,
    },
    prepared.width,
    prepared.height,
    at,
  )
}

/**
 * Sorts dropped or pasted files: images are inserted at `at` straight away,
 * drawings (.nibd, .excalidraw, scene PNG or SVG) are returned for the
 * caller to insert or open, so nothing is replaced without asking.
 */
export function ingestFiles(
  core: EditorCore,
  files: readonly File[],
  at: Point,
  opts?: IngestOptions,
): Promise<IngestResult>
/** @deprecated Replaces the document without asking; pass IngestOptions and offer Insert / Open instead. */
export function ingestFiles(
  core: EditorCore,
  files: readonly File[],
  at: Point,
  loadText: (contents: string, name: string) => string | null,
): Promise<string | null>
export async function ingestFiles(
  core: EditorCore,
  files: readonly File[],
  at: Point,
  opts: IngestOptions | ((contents: string, name: string) => string | null) = {},
): Promise<IngestResult | string | null> {
  if (typeof opts === "function") {
    const result = await readFiles(core, files, at, {})
    const errors = [...result.errors, ...result.scenes.map((s) => opts(s.text, s.name)).filter(Boolean)]
    return errors[0] ?? null
  }
  return readFiles(core, files, at, opts)
}

const readFiles = async (
  core: EditorCore,
  files: readonly File[],
  at: Point,
  opts: IngestOptions,
): Promise<IngestResult> => {
  const result: IngestResult = { scenes: [], images: 0, errors: [] }
  const findScenes = opts.mode !== "insert-image"
  for (const file of files) {
    try {
      const imageType = imageTypeOf(file)
      if (imageType) {
        if (findScenes && imageType === "image/svg+xml") {
          const embedded = extractSceneFromSvg(await file.text())
          const scene = embedded ? sceneFrom(embedded, file.name.replace(/\.svg$/i, "")) : null
          if (scene) {
            result.scenes.push(scene)
            continue
          }
        }
        if (findScenes && imageType === "image/png") {
          const embedded = await extractSceneFromPng(file)
          const scene = embedded ? sceneFrom(embedded, file.name.replace(/\.png$/i, "")) : null
          if (scene) {
            result.scenes.push(scene)
            continue
          }
        }
        // the data URL takes the detected type, so a reopened file accepts it
        await insertImageFile(core, file, imageType, at, {
          decode: opts.decodeImage,
          keepOriginal: opts.keepOriginal,
        })
        result.images++
        continue
      }
      const scene = sceneFrom(await file.text(), file.name)
      if (scene) result.scenes.push(scene)
      else result.errors.push(`${file.name}: ${NOT_A_DRAWING}`)
    } catch (e) {
      result.errors.push(`${file.name}: ${(e as Error).message}`)
    }
  }
  return result
}

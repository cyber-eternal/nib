import type { Drawable, OpSet } from "roughjs/bin/core"
import { getElementBounds } from "../geometry/elementBounds"
import { catmullRomToBezier } from "../math/curve"
import type { Point } from "../math/vector"
import type { AppState, BinaryFiles, ImageElement, NibElement, Theme } from "../model/types"
import { type ArrowheadPrimitive, arrowElementHeads } from "../render/arrowheads"
import { getCommonRenderBounds } from "../render/bounds"
import {
  EMBEDDABLE_FILL,
  EMBEDDABLE_LABEL_FONT,
  FRAME_LABEL_FONT,
  FRAME_LABEL_GAP,
  FRAME_LABEL_INSET,
  displayTextColor,
  ellipsize,
  fillRuleFor,
  frameLabelLayout,
  surfaceBehind,
} from "../render/drawElement"
import { clippingFrameOf, frameClipPolygon, frameExport, liveFrames } from "../render/frameClip"
import { type ArrowLabelMask, arrowLabelMask } from "../render/labelMask"
import { type BoxPlaceholder, RENDER_ERROR_PLACEHOLDER, imagePlaceholder } from "../render/placeholder"
import { freedrawOutline, generateShape } from "../render/shapes"
import { type SurfaceLookup, surfaceLookup } from "../render/surfaces"
import { fontString, lineHeightPx, measureWithFont } from "../render/textMeasure"
import { type CanvasPalette, canvasBackground, defaultCanvasPalette, themeColor } from "../render/theme"

export interface SvgExportOptions {
  elements: readonly NibElement[]
  appState: AppState
  files?: BinaryFiles
  exportBackground: boolean
  exportPadding: number
  scale: number
  theme: Theme
  embedScene?: string | null
  /** Chrome colours and the board the dark remap inverts around; defaults to defaultCanvasPalette(theme). */
  palette?: CanvasPalette
  /** @font-face rules, written into a <style> in <defs> so text keeps its face outside the app. */
  embedFontCss?: string
  /**
   * Export only this frame: its contents clipped to it, the image sized to the frame, and the
   * frame's own border and name left out.
   */
  frameId?: string | null
}

const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")

const SAFE_COLOR = /^(#[0-9a-f]{3,8}|transparent|none|rgba?\([0-9.,%\s]+\)|hsla?\([0-9.,%\sdegrad]+\))$/i

/**
 * Scene files can come from anywhere, so every value that lands in the markup is either a
 * finite number, a whitelisted colour, an inert data URL or escaped text.
 */
const color = (value: string | undefined | null, fallback = "none"): string => {
  if (typeof value !== "string" || !value) return fallback
  const trimmed = value.trim()
  return SAFE_COLOR.test(trimmed) ? trimmed : fallback
}

const safeDataUrl = (value: unknown): string | null =>
  typeof value === "string" &&
  /^data:image\/(png|jpeg|jpg|gif|webp|bmp|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(value.trim())
    ? value.trim()
    : null

const finite = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback

const n = (value: unknown): string => String(finite(value))

const finitePoints = (pts: unknown): Point[] =>
  Array.isArray(pts) ? pts.map((p): Point => (Array.isArray(p) ? [finite(p[0]), finite(p[1])] : [0, 0])) : []

/** A copy of `el` whose geometry is all finite numbers, whatever the file said. */
const sanitize = (el: NibElement): NibElement => {
  const base = {
    ...el,
    x: finite(el.x),
    y: finite(el.y),
    width: finite(el.width),
    height: finite(el.height),
    angle: finite(el.angle),
    strokeWidth: finite(el.strokeWidth, 1),
    opacity: Math.max(0, Math.min(100, finite(el.opacity, 100))),
    seed: finite(el.seed, 1),
    roughness: finite(el.roughness, 1),
  }
  switch (el.type) {
    case "line":
    case "arrow":
      return { ...base, points: finitePoints(el.points) } as NibElement
    case "freedraw":
      return {
        ...base,
        points: finitePoints(el.points),
        pressures: Array.isArray(el.pressures) ? el.pressures.map((p) => finite(p, 0.5)) : [],
      } as NibElement
    case "text":
      return {
        ...base,
        text: typeof el.text === "string" ? el.text : "",
        fontSize: finite(el.fontSize, 20),
        lineHeight: finite(el.lineHeight, 1.25),
      } as NibElement
    case "image": {
      const scale = Array.isArray(el.scale) ? el.scale : [1, 1]
      const c = el.crop
      return {
        ...base,
        scale: [finite(scale[0], 1) < 0 ? -1 : 1, finite(scale[1], 1) < 0 ? -1 : 1],
        crop:
          c && typeof c === "object"
            ? {
                x: finite(c.x),
                y: finite(c.y),
                width: finite(c.width),
                height: finite(c.height),
                naturalWidth: finite(c.naturalWidth),
                naturalHeight: finite(c.naturalHeight),
              }
            : null,
      } as NibElement
    }
    default:
      return base as NibElement
  }
}

interface SvgContext {
  theme: Theme
  palette: CanvasPalette
  files: BinaryFiles
  /** The exported background, which strokes and text are kept legible against; null when transparent. */
  surface: string | null
  surfaceUnder: SurfaceLookup
  getElement: (id: string) => NibElement | undefined
}

const ink = (el: NibElement, ctx: SvgContext): string =>
  color(themeColor(el.strokeColor, ctx.theme, ctx.palette.board, "stroke", surfaceBehind(el, ctx)))

const opsPath = (set: OpSet): string => {
  let d = ""
  for (const op of set.ops) {
    const v = op.data
    if (op.op === "move") d += `M${n(v[0])} ${n(v[1])} `
    else if (op.op === "lineTo") d += `L${n(v[0])} ${n(v[1])} `
    else if (op.op === "bcurveTo")
      d += `C${n(v[0])} ${n(v[1])}, ${n(v[2])} ${n(v[3])}, ${n(v[4])} ${n(v[5])} `
  }
  return d.trim()
}

/** Mirrors drawDrawable set by set, so only outlines carry the dash pattern. */
const drawableToSvg = (shape: Drawable): string => {
  const o = shape.options
  let out = ""
  for (const set of shape.sets) {
    const d = opsPath(set)
    if (!d) continue
    if (set.type === "path") {
      const dash = o.strokeLineDash ? ` stroke-dasharray="${o.strokeLineDash.map(n).join(" ")}"` : ""
      out += `<path d="${d}" stroke="${color(o.stroke)}" stroke-width="${n(o.strokeWidth)}" fill="none"${dash} stroke-linecap="round" stroke-linejoin="round"/>`
    } else if (set.type === "fillPath") {
      out += `<path d="${d}" stroke="none" fill="${color(o.fill)}" fill-rule="${fillRuleFor(shape)}"/>`
    } else if (set.type === "fillSketch") {
      const weight = o.fillWeight && o.fillWeight > 0 ? o.fillWeight : finite(o.strokeWidth, 1) / 2
      out += `<path d="${d}" stroke="${color(o.fill)}" stroke-width="${n(weight)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    }
  }
  return out
}

const roughToSvg = (el: NibElement, ctx: SvgContext): string =>
  generateShape(el, ctx.theme, ctx.palette.board, surfaceBehind(el, ctx)).map(drawableToSvg).join("")

const freedrawToSvg = (el: NibElement & { type: "freedraw" }, ctx: SvgContext): string => {
  if (el.points.length === 0) return ""
  const outline = freedrawOutline(el)
  if (outline.length < 2) return ""
  let d = `M ${n(outline[0]![0])} ${n(outline[0]![1])}`
  for (let i = 1; i < outline.length; i++) {
    const a = outline[i]!
    const b = outline[(i + 1) % outline.length]!
    d += ` Q ${n(a[0])} ${n(a[1])}, ${n((a[0]! + b[0]!) / 2)} ${n((a[1]! + b[1]!) / 2)}`
  }
  d += " Z"
  return `<path d="${d}" fill="${ink(el, ctx)}"/>`
}

const textToSvg = (el: NibElement & { type: "text" }, ctx: SvgContext): string => {
  const lh = lineHeightPx(el.fontSize, el.lineHeight)
  const anchor = el.textAlign === "center" ? "middle" : el.textAlign === "right" ? "end" : "start"
  const x = el.textAlign === "center" ? el.width / 2 : el.textAlign === "right" ? el.width : 0
  const font = esc(fontString(el.fontSize, el.fontFamily))
  const spans = el.text
    .split("\n")
    .map((line, i) => `<tspan x="${n(x)}" y="${n(i * lh + lh * 0.82)}">${esc(line)}</tspan>`)
    .join("")
  // canvas fillText keeps every space, so SVG must not collapse them
  return `<text xml:space="preserve" style="font: ${font}; white-space: pre" fill="${color(displayTextColor(el, ctx))}" text-anchor="${anchor}">${spans}</text>`
}

const placeholderToSvg = (w: number, h: number, spec: BoxPlaceholder, strokeWidth = 1): string => {
  const box = `<rect width="${n(w)}" height="${n(h)}" fill="${spec.fill ? color(spec.fill) : "none"}" stroke="${color(spec.stroke)}" stroke-width="${n(strokeWidth)}" stroke-dasharray="${spec.dash.map(n).join(" ")}"/>`
  if (!spec.cross) return box
  return `${box}<path d="M 0 0 L ${n(w)} ${n(h)} M ${n(w)} 0 L 0 ${n(h)}" fill="none" stroke="${color(spec.stroke)}" stroke-width="${n(strokeWidth)}" stroke-dasharray="${spec.dash.map(n).join(" ")}"/>`
}

const imageToSvg = (el: ImageElement, ctx: SvgContext): string => {
  const file = el.fileId && Object.hasOwn(ctx.files, el.fileId) ? ctx.files[el.fileId] : null
  const href = file ? safeDataUrl(file.dataURL) : null
  if (!href) return placeholderToSvg(el.width, el.height, imagePlaceholder(el))
  const c = el.crop
  // the crop is in bitmap pixels, so lay the whole bitmap out at natural size and window it
  const inner =
    c && c.width > 0 && c.height > 0
      ? `<svg width="${n(el.width)}" height="${n(el.height)}" viewBox="${n(c.x)} ${n(c.y)} ${n(c.width)} ${n(c.height)}" preserveAspectRatio="none"><image href="${href}" width="${n(c.naturalWidth || c.x + c.width)}" height="${n(c.naturalHeight || c.y + c.height)}" preserveAspectRatio="none"/></svg>`
      : `<image href="${href}" width="${n(el.width)}" height="${n(el.height)}" preserveAspectRatio="none"/>`
  const flipX = el.scale[0] < 0
  const flipY = el.scale[1] < 0
  if (!flipX && !flipY) return inner
  return `<g transform="translate(${n(flipX ? el.width : 0)} ${n(flipY ? el.height : 0)}) scale(${flipX ? -1 : 1} ${flipY ? -1 : 1})">${inner}</g>`
}

const frameToSvg = (el: NibElement & { type: "frame" }, ctx: SvgContext): string => {
  const label = frameLabelLayout(el, 1)
  const rect = `<rect width="${n(el.width)}" height="${n(el.height)}" fill="none" stroke="${color(ctx.palette.frameBorder)}" stroke-width="2"/>`
  if (!label) return rect
  return `${rect}<text x="${FRAME_LABEL_INSET}" y="${-FRAME_LABEL_GAP}" xml:space="preserve" style="font: ${esc(FRAME_LABEL_FONT)}; white-space: pre" fill="${color(ctx.palette.frameLabel)}">${esc(label.text)}</text>`
}

const embeddableToSvg = (el: NibElement, ctx: SvgContext): string => {
  const link = typeof el.link === "string" ? el.link : "Embed"
  const label = ellipsize(link, el.width - 16, (s) => measureWithFont(s, EMBEDDABLE_LABEL_FONT))
  // a nested viewport clips the label to the box, as the canvas does by ellipsizing
  const text = label
    ? `<svg width="${n(el.width)}" height="${n(el.height)}"><text x="${n(el.width / 2)}" y="${n(el.height / 2)}" text-anchor="middle" dominant-baseline="middle" xml:space="preserve" style="font: ${esc(EMBEDDABLE_LABEL_FONT)}; white-space: pre" fill="${color(ctx.palette.frameLabel)}">${esc(label)}</text></svg>`
    : ""
  return `<rect width="${n(el.width)}" height="${n(el.height)}" fill="${color(themeColor(EMBEDDABLE_FILL, ctx.theme, ctx.palette.board, "fill"))}"/>${text}${roughToSvg(el, ctx)}`
}

const headsToSvg = (heads: readonly ArrowheadPrimitive[], stroke: string, strokeWidth: number): string =>
  heads
    .map((p) => {
      const paint = `stroke="${stroke}" stroke-width="${n(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"`
      if (p.type === "circle")
        return `<circle cx="${n(p.center[0])}" cy="${n(p.center[1])}" r="${n(p.radius)}" fill="${p.fill ? color(p.fill) : "none"}" ${paint}/>`
      const d =
        p.points.map((q, i) => `${i === 0 ? "M" : "L"} ${n(q[0])} ${n(q[1])}`).join(" ") +
        (p.type === "polygon" ? " Z" : "")
      const fill = p.type === "polygon" && p.fill ? color(p.fill) : "none"
      return `<path d="${d}" fill="${fill}" ${paint}/>`
    })
    .join("")

const transformFor = (el: NibElement): string => {
  const cx = el.x + el.width / 2
  const cy = el.y + el.height / 2
  return el.angle === 0
    ? `translate(${n(el.x)} ${n(el.y)})`
    : `translate(${n(cx)} ${n(cy)}) rotate(${n((el.angle * 180) / Math.PI)}) translate(${n(-el.width / 2)} ${n(-el.height / 2)})`
}

const bodyToSvg = (el: NibElement, ctx: SvgContext): string => {
  switch (el.type) {
    case "freedraw":
      return freedrawToSvg(el, ctx)
    case "text":
      return textToSvg(el, ctx)
    case "image":
      return imageToSvg(el, ctx)
    case "frame":
      return frameToSvg(el, ctx)
    case "embeddable":
      return embeddableToSvg(el, ctx)
    case "arrow": {
      if (el.points.length < 2) return roughToSvg(el, ctx)
      const stroke = themeColor(
        el.strokeColor,
        ctx.theme,
        ctx.palette.board,
        "stroke",
        surfaceBehind(el, ctx),
      )
      const bg =
        el.backgroundColor === "transparent"
          ? "transparent"
          : themeColor(el.backgroundColor, ctx.theme, ctx.palette.board, "fill")
      return (
        roughToSvg(el, ctx) + headsToSvg(arrowElementHeads(el, stroke, bg), color(stroke), el.strokeWidth)
      )
    }
    case "rectangle":
    case "diamond":
    case "ellipse":
    case "line":
      return roughToSvg(el, ctx)
    default:
      throw new Error(`Cannot export element type "${String((el as { type: unknown }).type)}"`)
  }
}

const elementToSvg = (raw: NibElement, ctx: SvgContext): string => {
  let el: NibElement
  try {
    el = sanitize(raw)
  } catch {
    return ""
  }
  try {
    const body = bodyToSvg(el, ctx)
    if (!body) return ""
    const opacity = el.opacity === 100 ? "" : ` opacity="${n(el.opacity / 100)}"`
    return `<g transform="${transformFor(el)}"${opacity}>${body}</g>`
  } catch {
    // the failure box is drawn at full strength, as on canvas
    return `<g transform="${transformFor(el)}">${placeholderToSvg(el.width, el.height, RENDER_ERROR_PLACEHOLDER, 1.5)}</g>`
  }
}

const hashId = (s: string): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}

/** One clipPath per frame that clips something, in scene space, defined on first use. */
class FrameClipPaths {
  defs = ""
  private readonly ids = new Map<string, string | null>()

  idFor(frame: NibElement): string | null {
    const known = this.ids.get(frame.id)
    if (known !== undefined) return known
    const polygon = frameClipPolygon(sanitize(frame))
    const clipId = polygon ? `nib-frame-${this.ids.size + 1}-${hashId(`${frame.id}:${frame.version}`)}` : null
    this.ids.set(frame.id, clipId)
    if (polygon && clipId) {
      const d = polygon.map((p, i) => `${i === 0 ? "M" : "L"} ${n(p[0])} ${n(p[1])}`).join(" ")
      this.defs += `<clipPath id="${clipId}"><path d="${d} Z"/></clipPath>`
    }
    return clipId
  }
}

/** A luminance mask that hides the arrow inside its padded label box, in scene space. */
const labelMaskDef = (id: string, bounds: readonly number[], hole: readonly Point[]): string => {
  const [x1, y1, x2, y2] = bounds.map(finite) as [number, number, number, number]
  const box = `x="${n(x1)}" y="${n(y1)}" width="${n(x2 - x1)}" height="${n(y2 - y1)}"`
  const d = hole.map((p, i) => `${i === 0 ? "M" : "L"} ${n(p[0])} ${n(p[1])}`).join(" ")
  return `<mask id="${id}" maskUnits="userSpaceOnUse" ${box}><rect ${box} fill="#ffffff"/><path d="${d} Z" fill="#000000"/></mask>`
}

const labelMaskOf = (
  arrow: NibElement,
  get: (id: string) => NibElement | undefined,
): ArrowLabelMask | null => {
  try {
    return arrowLabelMask(sanitize(arrow), get)
  } catch {
    return null
  }
}

export const exportToSvg = (opts: SvgExportOptions): string => {
  const framed = opts.frameId ? frameExport(opts.elements, opts.frameId) : null
  const visible = framed ? framed.elements : opts.elements.filter((e) => !e.isDeleted)
  const fontCss = opts.embedFontCss ? `<style>${esc(opts.embedFontCss)}</style>` : ""
  const metadata = opts.embedScene ? `<!-- nib-scene:${btoaSafe(opts.embedScene)} -->` : ""
  if (visible.length === 0) {
    const defs = fontCss ? `<defs>${fontCss}</defs>` : ""
    return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${metadata}${defs}</svg>`
  }
  const palette = opts.palette ?? defaultCanvasPalette(opts.theme)
  const backdrop = canvasBackground(opts.appState.viewBackgroundColor, opts.theme, palette)
  const byId = new Map(visible.map((e) => [e.id, e]))
  // a transparent export lands on a background nobody knows, so its ink stays as authored
  const surface = opts.exportBackground ? backdrop : null
  const ctx: SvgContext = {
    theme: opts.theme,
    palette,
    files: opts.files ?? {},
    surface,
    surfaceUnder: surfaceLookup(visible, opts.theme, palette.board, surface),
    getElement: (id) => byId.get(id),
  }
  const b = framed ? getElementBounds(framed.frame) : getCommonRenderBounds(visible)
  const pad = Math.max(0, finite(opts.exportPadding))
  const scale = finite(opts.scale, 1) > 0 ? finite(opts.scale, 1) : 1
  const width = Math.max(1, b[2] - b[0] + pad * 2)
  const height = Math.max(1, b[3] - b[1] + pad * 2)

  const background = opts.exportBackground
    ? `<rect x="0" y="0" width="${n(width)}" height="${n(height)}" fill="${color(backdrop, "#ffffff")}"/>`
    : ""

  const frames = liveFrames(visible)
  const sanitizedById = (id: string): NibElement | undefined => {
    const el = byId.get(id)
    return el ? sanitize(el) : undefined
  }
  const clips = new FrameClipPaths()
  let masks = ""
  let maskCount = 0
  const content = visible
    .map((el) => {
      if (el === framed?.frame) return ""
      let g = elementToSvg(el, ctx)
      if (!g) return g
      const mask = el.type === "arrow" ? labelMaskOf(el, sanitizedById) : null
      if (mask) {
        const maskId = `nib-label-mask-${++maskCount}-${hashId(String(el.id))}`
        masks += labelMaskDef(maskId, mask.bounds, mask.hole)
        g = `<g mask="url(#${maskId})">${g}</g>`
      }
      const frame = frames.size > 0 ? clippingFrameOf(el, frames, (id) => byId.get(id)) : null
      const clipId = frame ? clips.idFor(frame) : null
      return clipId ? `<g clip-path="url(#${clipId})">${g}</g>` : g
    })
    .join("")
  const defs = fontCss || clips.defs || masks ? `<defs>${fontCss}${clips.defs}${masks}</defs>` : ""

  const open = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n(width * scale)}" height="${n(height * scale)}" viewBox="0 0 ${n(width)} ${n(height)}">`
  return `${open}${metadata}${defs}${background}<g transform="translate(${n(pad - b[0])} ${n(pad - b[1])})">${content}</g></svg>`
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

/** UTF-8 aware base64, written out so core stays free of DOM and Node globals. */
const btoaSafe = (s: string): string => {
  const bytes = utf8Encode(s)
  let out = ""
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    out += B64[b0 >> 2]
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]
    out += b1 === undefined ? "=" : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]
    out += b2 === undefined ? "=" : B64[b2 & 63]
  }
  return out
}

const utf8Encode = (s: string): number[] => {
  const out: number[] = []
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return out
}

const utf8Decode = (bytes: number[]): string => {
  let out = ""
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!
    if (b < 0x80) {
      out += String.fromCodePoint(b)
      i += 1
    } else if (b < 0xe0) {
      out += String.fromCodePoint(((b & 31) << 6) | (bytes[i + 1]! & 63))
      i += 2
    } else if (b < 0xf0) {
      out += String.fromCodePoint(((b & 15) << 12) | ((bytes[i + 1]! & 63) << 6) | (bytes[i + 2]! & 63))
      i += 3
    } else {
      out += String.fromCodePoint(
        ((b & 7) << 18) | ((bytes[i + 1]! & 63) << 12) | ((bytes[i + 2]! & 63) << 6) | (bytes[i + 3]! & 63),
      )
      i += 4
    }
  }
  return out
}

export const extractSceneFromSvg = (svg: string): string | null => {
  const m = /<!--\s*nib-scene:([A-Za-z0-9+/=]+)\s*-->/.exec(svg)
  if (!m) return null
  try {
    const src = m[1]!.replace(/=+$/, "")
    const bytes: number[] = []
    let buffer = 0
    let bits = 0
    for (const ch of src) {
      const v = B64.indexOf(ch)
      if (v < 0) continue
      buffer = (buffer << 6) | v
      bits += 6
      if (bits >= 8) {
        bits -= 8
        bytes.push((buffer >> bits) & 0xff)
      }
    }
    return utf8Decode(bytes)
  } catch {
    return null
  }
}

export { catmullRomToBezier }

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** How a colour was written, so a remapped colour can be written back the same way. */
export type ColorNotation = "hex" | "hex-alpha" | "function"

export interface ParsedColor extends Rgba {
  notation: ColorNotation
}

const NAMED =
  "aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc," +
  "bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a," +
  "burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50," +
  "cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,darkcyan:008b8b," +
  "darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b," +
  "darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000," +
  "darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f," +
  "darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff," +
  "dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0," +
  "forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520," +
  "gray:808080,green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4," +
  "indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5," +
  "lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff," +
  "lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1," +
  "lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899," +
  "lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32," +
  "linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd," +
  "mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee," +
  "mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970," +
  "mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6," +
  "olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa," +
  "palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9," +
  "peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399," +
  "red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460," +
  "seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd," +
  "slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c," +
  "teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3," +
  "white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32"

let namedColors: Map<string, string> | null = null
const named = (name: string): string | undefined => {
  if (!namedColors) namedColors = new Map(NAMED.split(",").map((pair) => pair.split(":") as [string, string]))
  return namedColors.get(name)
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

const parseHex = (hex: string): ParsedColor | null => {
  if (!/^[0-9a-f]+$/.test(hex)) return null
  let h = hex
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("")
  if (h.length !== 6 && h.length !== 8) return null
  return {
    r: Number.parseInt(h.slice(0, 2), 16),
    g: Number.parseInt(h.slice(2, 4), 16),
    b: Number.parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? Number.parseInt(h.slice(6, 8), 16) / 255 : 1,
    notation: hex.length === 4 || hex.length === 8 ? "hex-alpha" : "hex",
  }
}

const parseNumber = (token: string, percentOf: number): number | null => {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%?)$/.exec(token)
  if (!m) return null
  const v = Number(m[1])
  if (!Number.isFinite(v)) return null
  return m[2] ? (v / 100) * percentOf : v
}

const parseHue = (token: string): number | null => {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|rad|grad|turn)?$/.exec(token)
  if (!m) return null
  const v = Number(m[1])
  if (!Number.isFinite(v)) return null
  const unit = m[2] ?? "deg"
  const deg = unit === "rad" ? (v * 180) / Math.PI : unit === "grad" ? v * 0.9 : unit === "turn" ? v * 360 : v
  return (((deg % 360) + 360) % 360) / 360
}

const parseFunction = (fn: string, body: string): ParsedColor | null => {
  const [main, slashAlpha] = body.split("/").map((s) => s.trim())
  const parts = main!.includes(",") ? main!.split(",").map((s) => s.trim()) : main!.split(/\s+/)
  let alphaToken: string | undefined = slashAlpha
  if (parts.length === 4 && alphaToken === undefined) alphaToken = parts.pop()
  if (parts.length !== 3) return null
  const a = alphaToken === undefined ? 1 : parseNumber(alphaToken, 1)
  if (a === null) return null
  if (fn === "rgb" || fn === "rgba") {
    const [r, g, b] = parts.map((p) => parseNumber(p, 255))
    if (r == null || g == null || b == null) return null
    return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: clamp01(a), notation: "function" }
  }
  const h = parseHue(parts[0]!)
  const s = parseNumber(parts[1]!, 1)
  const l = parseNumber(parts[2]!, 1)
  if (h === null || s === null || l === null) return null
  const [r, g, b] = hslToRgb(h, clamp01(s), clamp01(l))
  return { r, g, b, a: clamp01(a), notation: "function" }
}

const clamp255 = (v: number): number => Math.max(0, Math.min(255, v))

/** Parses any CSS colour form (hex 3/4/6/8, rgb(), rgba(), hsl(), hsla(), named); null otherwise. */
export const parseColor = (input: string): ParsedColor | null => {
  const s = input.trim().toLowerCase()
  if (s.startsWith("#")) return parseHex(s.slice(1))
  const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(s)
  if (fn) return parseFunction(fn[1]!, fn[2]!)
  const hex = named(s)
  if (hex) return { ...parseHex(hex)!, notation: "function" }
  return null
}

const hex2 = (v: number): string => Math.round(clamp255(v)).toString(16).padStart(2, "0")

export const formatColor = (c: Rgba, notation: ColorNotation = "hex"): string => {
  if (notation === "hex-alpha") return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${hex2(c.a * 255)}`
  if (c.a < 1) {
    const alpha = Math.round(clamp01(c.a) * 1000) / 1000
    return `rgba(${Math.round(clamp255(c.r))}, ${Math.round(clamp255(c.g))}, ${Math.round(clamp255(c.b))}, ${alpha})`
  }
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`
}

/** h, s, l in 0..1 */
export const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0)
  else if (max === gg) h = (bb - rr) / d + 2
  else h = (rr - gg) / d + 4
  return [h / 6, s, l]
}

/** Returns r, g, b in 0..255 (unrounded). */
export const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number): number => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  return [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255]
}

/** `color` with its alpha multiplied by `alpha`; unparseable colours come back unchanged. */
export const withAlpha = (color: string, alpha: number): string => {
  const c = parseColor(color)
  if (!c) return color
  return formatColor({ ...c, a: c.a * alpha }, "function")
}

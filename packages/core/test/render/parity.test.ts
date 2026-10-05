import { describe, expect, test } from "vitest"
import { exportToSvg } from "../../src/io/exportSvg"
import { newElement } from "../../src/model/element"
import { type BinaryFiles, DEFAULT_APP_STATE, type NibElement, type Theme } from "../../src/model/types"
import { getCommonRenderBounds } from "../../src/render/bounds"
import { ShapeCache } from "../../src/render/shapes"
import { renderElementsTo } from "../../src/render/staticScene"
import { type CanvasPalette, defaultCanvasPalette, deriveCanvasPalette } from "../../src/render/theme"
import { type Call, recordingCanvas } from "./mockCanvas"

/**
 * Canvas and SVG are two renderers of one scene. Both are reduced to the same list of painted
 * primitives in export space (paint kind, colour, alpha, stroke width, dash, fill rule, the
 * path's points, text runs and bitmap placement) and compared in paint order.
 */

type Matrix = [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]

const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
]

const scaleOf = (m: Matrix): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))

interface Prim {
  kind: "stroke" | "fill" | "text" | "image"
  color?: string
  alpha: number
  width?: number
  dash?: string
  rule?: string
  radius?: number
  pts: number[]
  text?: string
  font?: string
  align?: string
  baseline?: string
}

const NATURAL = { w: 200, h: 100 }

const canvasPrims = (calls: readonly Call[]): Prim[] => {
  const out: Prim[] = []
  let path: number[] = []
  let radius: number | undefined
  for (const c of calls) {
    const m = ((c as Call & { matrix?: Matrix }).matrix ?? IDENTITY) as Matrix
    const a = c.args as number[]
    const push = (x: number, y: number) => path.push(...apply(m, x, y))
    const box = (x: number, y: number, w: number, h: number): number[] => [
      ...apply(m, x, y),
      ...apply(m, x + w, y),
      ...apply(m, x + w, y + h),
      ...apply(m, x, y + h),
    ]
    switch (c.op) {
      case "beginPath":
        path = []
        radius = undefined
        break
      case "moveTo":
      case "lineTo":
        push(a[0]!, a[1]!)
        break
      case "bezierCurveTo":
        for (let i = 0; i < 6; i += 2) push(a[i]!, a[i + 1]!)
        break
      case "quadraticCurveTo":
        for (let i = 0; i < 4; i += 2) push(a[i]!, a[i + 1]!)
        break
      case "arc":
        push(a[0]!, a[1]!)
        radius = a[2]! * scaleOf(m)
        break
      case "rect":
        path.push(...box(a[0]!, a[1]!, a[2]!, a[3]!))
        break
      case "stroke":
        out.push({
          kind: "stroke",
          color: c.strokeStyle,
          alpha: c.alpha,
          width: c.lineWidth * scaleOf(m),
          dash: c.dash.join(" "),
          radius,
          pts: [...path],
        })
        break
      case "fill":
        out.push({
          kind: "fill",
          color: c.fillStyle,
          alpha: c.alpha,
          rule: (c.args[0] as string | undefined) ?? "nonzero",
          radius,
          pts: [...path],
        })
        break
      case "fillRect":
        out.push({
          kind: "fill",
          color: c.fillStyle,
          alpha: c.alpha,
          rule: "nonzero",
          pts: box(a[0]!, a[1]!, a[2]!, a[3]!),
        })
        break
      case "strokeRect":
        out.push({
          kind: "stroke",
          color: c.strokeStyle,
          alpha: c.alpha,
          width: c.lineWidth * scaleOf(m),
          dash: c.dash.join(" "),
          pts: box(a[0]!, a[1]!, a[2]!, a[3]!),
        })
        break
      case "fillText":
        out.push({
          kind: "text",
          text: c.args[0] as string,
          color: c.fillStyle,
          alpha: c.alpha,
          font: c.font,
          align: c.textAlign === "center" ? "middle" : c.textAlign === "right" ? "end" : "start",
          baseline: c.textBaseline === "middle" ? "middle" : "alphabetic",
          pts: apply(m, a[1]!, a[2]!),
        })
        break
      case "drawImage": {
        // where the bitmap's own corners land, whichever drawImage overload placed it
        let map: (sx: number, sy: number) => [number, number]
        if (c.args.length === 9) {
          const [, sx, sy, sw, sh, dx, dy, dw, dh] = c.args as number[]
          map = (x, y) => apply(m, dx! + ((x - sx!) * dw!) / sw!, dy! + ((y - sy!) * dh!) / sh!)
        } else {
          const [, dx, dy, dw, dh] = c.args as number[]
          map = (x, y) => apply(m, dx! + (x * dw!) / NATURAL.w, dy! + (y * dh!) / NATURAL.h)
        }
        out.push({ kind: "image", alpha: c.alpha, pts: [...map(0, 0), ...map(NATURAL.w, NATURAL.h)] })
        break
      }
    }
  }
  return out
}

const unescapeXml = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")

const attrsOf = (raw: string): Record<string, string> =>
  Object.fromEntries([...raw.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1]!, unescapeXml(m[2]!)]))

const parseTransform = (t: string | undefined): Matrix => {
  let m = IDENTITY
  if (!t) return m
  for (const [, fn, args] of t.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const v = args!
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number)
    if (fn === "translate") m = mul(m, [1, 0, 0, 1, v[0]!, v[1] ?? 0])
    else if (fn === "scale") m = mul(m, [v[0]!, 0, 0, v[1] ?? v[0]!, 0, 0])
    else if (fn === "rotate") {
      const r = (v[0]! * Math.PI) / 180
      m = mul(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0])
    }
  }
  return m
}

const pathPoints = (d: string): number[] => (d.match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).map(Number)

interface Frame {
  tag: string
  m: Matrix
  alpha: number
  skip: boolean
  attrs: Record<string, string>
}

const svgPrims = (svg: string): Prim[] => {
  const out: Prim[] = []
  const stack: Frame[] = [{ tag: "root", m: IDENTITY, alpha: 1, skip: false, attrs: {} }]
  const SKIP = new Set(["defs", "clipPath", "mask", "style"])
  let textFrame: Frame | null = null
  let tspan: Record<string, string> | null = null

  const paint = (f: Frame, a: Record<string, string>, pts: number[], radius?: number) => {
    if (a.fill && a.fill !== "none")
      out.push({
        kind: "fill",
        color: a.fill,
        alpha: f.alpha,
        rule: a["fill-rule"] ?? "nonzero",
        radius,
        pts,
      })
    if (a.stroke && a.stroke !== "none")
      out.push({
        kind: "stroke",
        color: a.stroke,
        alpha: f.alpha,
        width: Number(a["stroke-width"] ?? 1) * scaleOf(f.m),
        dash: (a["stroke-dasharray"] ?? "")
          .split(/[\s,]+/)
          .filter(Boolean)
          .join(" "),
        radius,
        pts,
      })
  }

  for (const tok of svg.matchAll(
    /<!--[\s\S]*?-->|<(\/?)([\w:-]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g,
  )) {
    const [whole, closing, tag, rawAttrs, selfClosing, text] = tok
    if (whole.startsWith("<!--")) continue
    const top = stack[stack.length - 1]!
    if (text !== undefined) {
      if (top.skip || !textFrame) continue
      const a = { ...textFrame.attrs, ...(tspan ?? {}) }
      const font = /font:\s*([^;]+)/.exec(a.style ?? "")?.[1]?.trim()
      out.push({
        kind: "text",
        text: unescapeXml(text),
        color: a.fill,
        alpha: textFrame.alpha,
        font,
        align: a["text-anchor"] ?? "start",
        baseline: a["dominant-baseline"] === "middle" ? "middle" : "alphabetic",
        pts: apply(textFrame.m, Number(a.x ?? 0), Number(a.y ?? 0)),
      })
      continue
    }
    if (closing) {
      const f = stack.pop()!
      if (f.tag === "text") textFrame = null
      if (f.tag === "tspan") tspan = null
      continue
    }
    const a = attrsOf(rawAttrs ?? "")
    let m = top.m
    let alpha = top.alpha
    if (tag === "g") {
      m = mul(m, parseTransform(a.transform))
      if (a.opacity) alpha *= Number(a.opacity)
    } else if (tag === "svg" && stack.length > 1 && a.viewBox) {
      const [vx, vy, vw, vh] = a.viewBox.split(/\s+/).map(Number)
      m = mul(m, [Number(a.width) / vw!, 0, 0, Number(a.height) / vh!, 0, 0])
      m = mul(m, [1, 0, 0, 1, -vx!, -vy!])
    }
    const frame: Frame = { tag: tag!, m, alpha, skip: top.skip || SKIP.has(tag!), attrs: a }
    if (!frame.skip) {
      if (tag === "path")
        paint(
          frame,
          a,
          (() => {
            const nums = pathPoints(a.d ?? "")
            const pts: number[] = []
            for (let i = 0; i + 1 < nums.length; i += 2) pts.push(...apply(m, nums[i]!, nums[i + 1]!))
            return pts
          })(),
        )
      else if (tag === "rect") {
        const x = Number(a.x ?? 0)
        const y = Number(a.y ?? 0)
        const w = Number(a.width)
        const h = Number(a.height)
        paint(frame, a, [
          ...apply(m, x, y),
          ...apply(m, x + w, y),
          ...apply(m, x + w, y + h),
          ...apply(m, x, y + h),
        ])
      } else if (tag === "circle") {
        paint(frame, a, apply(m, Number(a.cx), Number(a.cy)), Number(a.r) * scaleOf(m))
      } else if (tag === "image") {
        const w = Number(a.width)
        const h = Number(a.height)
        out.push({ kind: "image", alpha, pts: [...apply(m, 0, 0), ...apply(m, w, h)] })
      } else if (tag === "text") textFrame = frame
      else if (tag === "tspan") tspan = a
    }
    if (!selfClosing) stack.push(frame)
  }
  return out
}

const close = (a: number, b: number, tol = 1e-4) =>
  Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))

const describePrim = (p: Prim | undefined): string =>
  p
    ? `${p.kind} ${p.color ?? ""} a=${p.alpha} w=${p.width ?? ""} dash=${p.dash ?? ""} n=${p.pts.length} ${p.text ?? ""}`
    : "none"

const expectParity = (canvas: Prim[], svg: Prim[]): void => {
  const n = Math.max(canvas.length, svg.length)
  for (let i = 0; i < n; i++) {
    const c = canvas[i]
    const s = svg[i]
    const where = `primitive ${i}: canvas ${describePrim(c)} | svg ${describePrim(s)}`
    expect(c && s, where).toBeTruthy()
    expect(s!.kind, where).toBe(c!.kind)
    expect(s!.color, where).toBe(c!.color)
    expect(close(s!.alpha, c!.alpha), where).toBe(true)
    if (c!.kind === "stroke") {
      expect(close(s!.width!, c!.width!), where).toBe(true)
      expect(s!.dash, where).toBe(c!.dash)
    }
    if (c!.kind === "fill") expect(s!.rule, where).toBe(c!.rule)
    if (c!.radius !== undefined || s!.radius !== undefined)
      expect(close(s!.radius!, c!.radius!), where).toBe(true)
    if (c!.kind === "text") {
      expect(s!.text, where).toBe(c!.text)
      expect(s!.font, where).toBe(c!.font)
      expect(s!.align, where).toBe(c!.align)
      expect(s!.baseline, where).toBe(c!.baseline)
    }
    expect(s!.pts.length, where).toBe(c!.pts.length)
    for (let k = 0; k < c!.pts.length; k++)
      expect(close(s!.pts[k]!, c!.pts[k]!, 1e-3), `${where} coord ${k}`).toBe(true)
  }
}

const FILES: BinaryFiles = {
  bmp: { id: "bmp", mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", created: 1 },
}

const render = (elements: NibElement[], theme: Theme, palette: CanvasPalette) => {
  const b = getCommonRenderBounds(elements)
  const r = recordingCanvas()
  // the SVG lays everything out from the common bounds' corner, so the canvas starts there too
  r.ctx.translate(-b[0], -b[1])
  renderElementsTo(r.ctx, elements, {
    theme,
    palette,
    cache: new ShapeCache(),
    resolveImage: (id) => (id === "bmp" ? { image: {}, width: NATURAL.w, height: NATURAL.h } : null),
  })
  const svg = exportToSvg({
    elements,
    appState: DEFAULT_APP_STATE,
    files: FILES,
    exportBackground: false,
    exportPadding: 0,
    scale: 1,
    theme,
    palette,
  })
  return { canvas: canvasPrims(r.calls), svg: svgPrims(svg) }
}

const seeded = { seed: 4242, versionNonce: 1 }

const CASES: Record<string, () => NibElement[]> = {
  rectangle: () => [
    newElement("rectangle", {
      ...seeded,
      x: 10,
      y: 20,
      width: 140,
      height: 90,
      backgroundColor: "#a5d8ff",
      fillStyle: "hachure",
      angle: 0.3,
      opacity: 70,
    }),
    newElement("rectangle", {
      ...seeded,
      x: 200,
      y: 20,
      width: 100,
      height: 60,
      roundness: { type: 3 },
      strokeStyle: "dashed",
      backgroundColor: "#ffc9c9",
    }),
  ],
  diamond: () => [
    newElement("diamond", {
      ...seeded,
      x: 0,
      y: 0,
      width: 120,
      height: 80,
      backgroundColor: "#b2f2bb",
      fillStyle: "cross-hatch",
    }),
    newElement("diamond", {
      ...seeded,
      x: 150,
      y: 0,
      width: 80,
      height: 80,
      roundness: { type: 2 },
      strokeStyle: "dotted",
      angle: -0.5,
    }),
  ],
  ellipse: () => [
    newElement("ellipse", {
      ...seeded,
      x: 0,
      y: 0,
      width: 160,
      height: 90,
      backgroundColor: "#ffec99",
      fillStyle: "solid",
      opacity: 40,
    }),
  ],
  line: () => [
    newElement("line", {
      ...seeded,
      x: 0,
      y: 0,
      width: 120,
      height: 60,
      points: [
        [0, 0],
        [60, 60],
        [120, 0],
      ],
      roundness: { type: 2 },
    }),
    newElement("line", {
      ...seeded,
      x: 0,
      y: 100,
      width: 100,
      height: 80,
      polygon: true,
      backgroundColor: "#d0bfff",
      points: [
        [0, 0],
        [100, 40],
        [20, 80],
        [0, 0],
      ],
    }),
  ],
  arrow: () => [
    newElement("arrow", {
      ...seeded,
      x: 0,
      y: 0,
      width: 200,
      height: 40,
      points: [
        [0, 0],
        [200, 40],
      ],
      startArrowhead: "triangle_outline",
      endArrowhead: "circle",
      backgroundColor: "#ffd8a8",
    }),
    newElement("arrow", {
      ...seeded,
      x: 0,
      y: 100,
      width: 150,
      height: 80,
      angle: 0.4,
      points: [
        [0, 0],
        [70, 80],
        [150, 0],
      ],
      roundness: { type: 2 },
      startArrowhead: "crowfoot_one_or_many",
      endArrowhead: "diamond_outline",
    }),
    newElement("arrow", {
      ...seeded,
      x: 0,
      y: 250,
      width: 120,
      height: 60,
      elbowed: true,
      points: [
        [0, 0],
        [60, 0],
        [60, 60],
        [120, 60],
      ],
      startArrowhead: "bar",
      endArrowhead: "triangle",
    }),
  ],
  freedraw: () => {
    const points: [number, number][] = []
    for (let i = 0; i < 30; i++) points.push([i * 4, Math.sin(i / 3) * 15 + 15])
    return [
      newElement("freedraw", {
        ...seeded,
        x: 5,
        y: 5,
        width: 116,
        height: 30,
        points,
        pressures: points.map(() => 0.5),
        lastCommittedPoint: points[29]!,
        angle: 0.2,
        opacity: 80,
      }),
    ]
  },
  text: () => [
    newElement("text", {
      ...seeded,
      x: 0,
      y: 0,
      width: 180,
      height: 50,
      text: "two   spaced\n  lines",
      textAlign: "center",
      fontFamily: "normal",
      angle: 0.25,
    }),
    newElement("text", {
      ...seeded,
      x: 0,
      y: 80,
      width: 120,
      height: 25,
      text: 'right <&> "q"',
      textAlign: "right",
      fontFamily: "code",
      fontSize: 16,
      opacity: 50,
    }),
  ],
  "bound label": () => {
    const box = newElement("rectangle", {
      ...seeded,
      id: "box",
      x: 0,
      y: 0,
      width: 160,
      height: 80,
      boundElements: [{ type: "text", id: "lbl" }],
    })
    const lbl = newElement("text", {
      ...seeded,
      id: "lbl",
      x: 30,
      y: 27,
      width: 100,
      height: 25,
      text: "label",
      textAlign: "center",
      verticalAlign: "middle",
      containerId: "box",
    })
    return [box, lbl]
  },
  image: () => [
    newElement("image", {
      ...seeded,
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      fileId: "bmp",
      status: "saved",
      angle: 0.1,
    }),
    newElement("image", {
      ...seeded,
      x: 250,
      y: 0,
      width: 100,
      height: 50,
      fileId: "bmp",
      status: "saved",
      scale: [-1, 1],
      crop: { x: 50, y: 25, width: 100, height: 50, naturalWidth: NATURAL.w, naturalHeight: NATURAL.h },
      opacity: 60,
    }),
  ],
  "image placeholders": () => [
    newElement("image", {
      ...seeded,
      x: 0,
      y: 0,
      width: 100,
      height: 60,
      fileId: "missing",
      status: "pending",
      opacity: 50,
    }),
    newElement("image", {
      ...seeded,
      x: 150,
      y: 0,
      width: 100,
      height: 60,
      fileId: "missing",
      status: "error",
      angle: 0.5,
    }),
  ],
  frame: () => [
    newElement("frame", {
      ...seeded,
      id: "fr",
      x: 0,
      y: 0,
      width: 200,
      height: 150,
      name: "Checkout flow",
      index: "a0",
    }),
    newElement("ellipse", { ...seeded, x: 150, y: 100, width: 120, height: 90, frameId: "fr", index: "a1" }),
    newElement("frame", {
      ...seeded,
      x: 300,
      y: 0,
      width: 50,
      height: 50,
      name: "A much longer frame name",
      index: "a2",
    }),
  ],
  embeddable: () => [
    newElement("embeddable", {
      ...seeded,
      x: 0,
      y: 0,
      width: 240,
      height: 135,
      link: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      angle: -0.2,
    }),
  ],
  "labelled arrow": () => [
    newElement("arrow", {
      ...seeded,
      id: "ar",
      x: 0,
      y: 0,
      width: 200,
      height: 0,
      points: [
        [0, 0],
        [200, 0],
      ],
      boundElements: [{ type: "text", id: "al" }],
    }),
    newElement("text", {
      ...seeded,
      id: "al",
      x: 80,
      y: -12,
      width: 40,
      height: 25,
      text: "yes",
      textAlign: "center",
      containerId: "ar",
    }),
  ],
}

const THEMES: [string, Theme, CanvasPalette][] = [
  ["light", "light", defaultCanvasPalette("light")],
  ["dark", "dark", defaultCanvasPalette("dark")],
  [
    "custom dark board",
    "dark",
    deriveCanvasPalette({ mode: "dark", board: "#1f2d27", ink: "#edefe6", course: "#f4d35e" }),
  ],
]

describe("canvas and SVG paint the same primitives for every element type", () => {
  for (const [themeName, theme, palette] of THEMES) {
    for (const [name, build] of Object.entries(CASES)) {
      test(`${name} (${themeName})`, () => {
        const { canvas, svg } = render(build(), theme, palette)
        expect(canvas.length).toBeGreaterThan(0)
        expectParity(canvas, svg)
      })
    }
  }

  test("every element type is covered", () => {
    const types = new Set(Object.values(CASES).flatMap((build) => build().map((e) => e.type)))
    for (const t of [
      "rectangle",
      "diamond",
      "ellipse",
      "line",
      "arrow",
      "freedraw",
      "text",
      "image",
      "frame",
      "embeddable",
    ])
      expect(types).toContain(t)
  })
})

describe("canvas clips cut the same regions as the SVG's clip paths and masks", () => {
  type Region = { rule: string; pts: number[] }
  const key = (r: Region) => `${r.rule}:${r.pts.map((v) => v.toFixed(3)).join(",")}`

  const canvasClips = (calls: readonly Call[]): Region[] => {
    const out: Region[] = []
    let pts: number[] = []
    for (const c of calls) {
      const m = ((c as Call & { matrix?: Matrix }).matrix ?? IDENTITY) as Matrix
      const a = c.args as number[]
      if (c.op === "beginPath") pts = []
      else if (c.op === "moveTo" || c.op === "lineTo") pts.push(...apply(m, a[0]!, a[1]!))
      else if (c.op === "rect")
        pts.push(
          ...apply(m, a[0]!, a[1]!),
          ...apply(m, a[0]! + a[2]!, a[1]!),
          ...apply(m, a[0]! + a[2]!, a[1]! + a[3]!),
          ...apply(m, a[0]!, a[1]! + a[3]!),
        )
      else if (c.op === "clip") out.push({ rule: (c.args[0] as string | undefined) ?? "nonzero", pts })
    }
    return out
  }

  const svgClips = (svg: string, offset: [number, number]): Region[] => {
    const shift = (nums: number[]) => nums.map((v, i) => v + offset[i % 2]!)
    const out: Region[] = []
    for (const [, d] of svg.matchAll(/<clipPath id="[^"]+"><path d="([^"]+)"\/><\/clipPath>/g))
      out.push({ rule: "nonzero", pts: shift(pathPoints(d!)) })
    for (const [, body] of svg.matchAll(/<mask [^>]*>(.*?)<\/mask>/g)) {
      const rect = attrsOf(/<rect([^>]*)\/>/.exec(body!)![1]!)
      const [x, y, w, h] = ["x", "y", "width", "height"].map((k) => Number(rect[k]))
      const hole = pathPoints(/<path d="([^"]+)"/.exec(body!)![1]!)
      out.push({ rule: "evenodd", pts: shift([x!, y!, x! + w!, y!, x! + w!, y! + h!, x!, y! + h!, ...hole]) })
    }
    return out
  }

  const framedLabelledArrow = (): NibElement[] => [
    newElement("frame", { ...seeded, id: "fr2", x: -20, y: -60, width: 180, height: 120, angle: 0.3 }),
    ...CASES["labelled arrow"]!().map((el) => ({ ...el, frameId: el.type === "arrow" ? "fr2" : null })),
  ]

  for (const [name, build] of [
    ["frame", CASES.frame!],
    ["labelled arrow", CASES["labelled arrow"]!],
    ["labelled arrow inside a rotated frame", framedLabelledArrow],
  ] as const) {
    test(name, () => {
      const elements = build()
      const b = getCommonRenderBounds(elements)
      const r = recordingCanvas()
      r.ctx.translate(-b[0], -b[1])
      renderElementsTo(r.ctx, elements, { theme: "light", cache: new ShapeCache() })
      const svg = exportToSvg({
        elements,
        appState: DEFAULT_APP_STATE,
        exportBackground: false,
        exportPadding: 0,
        scale: 1,
        theme: "light",
      })
      const canvas = new Set(canvasClips(r.calls).map(key))
      const exported = new Set(svgClips(svg, [-b[0], -b[1]]).map(key))
      expect(canvas.size).toBeGreaterThan(0)
      expect([...canvas].sort()).toEqual([...exported].sort())
    })
  }
})

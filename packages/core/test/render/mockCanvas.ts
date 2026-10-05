import type { Canvas2D } from "../../src/render/canvasTypes"

export interface Call {
  op: string
  args: unknown[]
  depth: number
  alpha: number
  dash: number[]
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  font: string
  textAlign: string
  textBaseline: string
}

type Matrix = [number, number, number, number, number, number]

const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]

/**
 * Recording Canvas2D with a tracked transform, so tests can ask where on the
 * page a point was actually drawn and whether save/restore stayed balanced.
 */
export const recordingCanvas = (opts: { throwOn?: string } = {}) => {
  const calls: Call[] = []
  const stack: { m: Matrix; dash: number[]; s: Record<string, unknown> }[] = []
  let m: Matrix = [1, 0, 0, 1, 0, 0]
  let dash: number[] = []
  let depth = 0
  const STATE = ["strokeStyle", "fillStyle", "lineWidth", "globalAlpha", "font", "textAlign", "textBaseline"]

  const ctx: Record<string, unknown> = {
    canvas: { width: 800, height: 600 },
    strokeStyle: "#000",
    fillStyle: "#000",
    lineWidth: 1,
    globalAlpha: 1,
    lineCap: "butt",
    lineJoin: "miter",
    font: "10px sans-serif",
    textAlign: "left",
    textBaseline: "alphabetic",
    globalCompositeOperation: "source-over",
  }
  const record = (op: string, args: unknown[]) => {
    if (opts.throwOn === op) throw new Error(`mock ${op} failure`)
    calls.push({
      op,
      args,
      depth,
      alpha: ctx.globalAlpha as number,
      dash: [...dash],
      fillStyle: ctx.fillStyle as string,
      strokeStyle: ctx.strokeStyle as string,
      lineWidth: ctx.lineWidth as number,
      font: ctx.font as string,
      textAlign: ctx.textAlign as string,
      textBaseline: ctx.textBaseline as string,
    })
  }
  ctx.save = () => {
    const s: Record<string, unknown> = {}
    for (const k of STATE) s[k] = ctx[k]
    stack.push({ m, dash, s })
    depth++
    record("save", [])
  }
  ctx.restore = () => {
    const top = stack.pop()
    if (top) {
      m = top.m
      dash = top.dash
      for (const k of STATE) ctx[k] = top.s[k]
    }
    depth--
    record("restore", [])
  }
  ctx.setLineDash = (d: number[]) => {
    dash = [...d]
  }
  ctx.translate = (x: number, y: number) => {
    m = mul(m, [1, 0, 0, 1, x, y])
    record("translate", [x, y])
  }
  ctx.scale = (x: number, y: number) => {
    m = mul(m, [x, 0, 0, y, 0, 0])
    record("scale", [x, y])
  }
  ctx.rotate = (a: number) => {
    const c = Math.cos(a)
    const s = Math.sin(a)
    m = mul(m, [c, s, -s, c, 0, 0])
    record("rotate", [a])
  }
  ctx.measureText = (t: string) => ({ width: t.length * 8 })
  for (const op of [
    "beginPath",
    "closePath",
    "moveTo",
    "lineTo",
    "bezierCurveTo",
    "quadraticCurveTo",
    "arc",
    "ellipse",
    "rect",
    "clip",
    "stroke",
    "fill",
    "clearRect",
    "fillRect",
    "strokeRect",
    "fillText",
    "drawImage",
  ]) {
    ctx[op] = (...args: unknown[]) => record(op, args)
  }

  /** Maps a point in the current local space of a recorded call to page space. */
  const toPage = (call: Call & { matrix?: Matrix }, x: number, y: number): [number, number] => {
    const t = call.matrix ?? m
    return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]]
  }

  // keep a snapshot of the transform with each call
  const origRecord = record
  const withMatrix = (op: string, args: unknown[]) => {
    origRecord(op, args)
    ;(calls[calls.length - 1] as Call & { matrix?: Matrix }).matrix = [...m] as Matrix
  }
  for (const op of [
    "moveTo",
    "lineTo",
    "bezierCurveTo",
    "quadraticCurveTo",
    "arc",
    "rect",
    "strokeRect",
    "fillRect",
    "drawImage",
    "fillText",
    "clip",
  ]) {
    ctx[op] = (...args: unknown[]) => withMatrix(op, args)
  }

  return {
    ctx: ctx as unknown as Canvas2D,
    calls,
    depth: () => depth,
    toPage,
  }
}

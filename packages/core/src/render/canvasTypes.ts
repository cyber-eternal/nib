/**
 * Structural subset of CanvasRenderingContext2D that core needs. Declared here
 * so core compiles without the DOM lib and can render in Node for exports.
 */
export interface Canvas2D {
  canvas: { width: number; height: number }
  strokeStyle: string
  fillStyle: string
  lineWidth: number
  globalAlpha: number
  lineCap: "butt" | "round" | "square"
  lineJoin: "round" | "bevel" | "miter"
  font: string
  textAlign: "left" | "right" | "center" | "start" | "end"
  textBaseline: "top" | "hanging" | "middle" | "alphabetic" | "ideographic" | "bottom"
  globalCompositeOperation: string
  save(): void
  restore(): void
  translate(x: number, y: number): void
  scale(x: number, y: number): void
  rotate(a: number): void
  beginPath(): void
  closePath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void
  quadraticCurveTo(a: number, b: number, c: number, d: number): void
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean): void
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number): void
  rect(x: number, y: number, w: number, h: number): void
  roundRect?(x: number, y: number, w: number, h: number, radii: number | number[]): void
  clip(rule?: "nonzero" | "evenodd"): void
  stroke(): void
  fill(rule?: "nonzero" | "evenodd"): void
  clearRect(x: number, y: number, w: number, h: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  strokeRect(x: number, y: number, w: number, h: number): void
  setLineDash(d: number[]): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { width: number }
  drawImage(img: any, dx: number, dy: number, dw?: number, dh?: number): void
  drawImage(
    img: any,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void
}

/**
 * A real CanvasRenderingContext2D satisfies this shape at runtime, but its
 * fillStyle/strokeStyle also accept gradients, which TypeScript sees as a
 * mismatch. Hosts pass their context through here.
 */
export const asCanvas2D = (ctx: unknown): Canvas2D => ctx as Canvas2D

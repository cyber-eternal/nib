import { getElementBounds } from "../geometry/elementBounds"
import { pointInPolygon } from "../geometry/hitTest"
import { elementOutline } from "../geometry/outline"
import { type Bounds, boundsContainBounds } from "../math/bounds"
import type { Point } from "../math/vector"
import { type NibElement, type Theme, isPolygonLine } from "../model/types"
import { formatColor, parseColor } from "./color"
import { themeColor } from "./theme"

/** What an element is read against, given the colour behind everything else (null when unknown). */
export type SurfaceLookup = (el: NibElement) => string | null

/** Whether other ink can sit on this element's fill: a closed shape with an opaque-style solid fill. */
const holdsInk = (el: NibElement): boolean =>
  !el.isDeleted &&
  el.fillStyle === "solid" &&
  el.backgroundColor !== "transparent" &&
  (el.type === "rectangle" || el.type === "diamond" || el.type === "ellipse" || isPolygonLine(el))

/** `el`'s solid fill as painted over `under`, with the fill's alpha and the element's opacity. */
export const fillOver = (
  el: NibElement,
  theme: Theme,
  board: string,
  under: string | null,
): string | null => {
  const fill = parseColor(themeColor(el.backgroundColor, theme, board, "fill"))
  if (!fill) return under
  const alpha = Math.max(0, Math.min(1, fill.a * ((el.opacity ?? 100) / 100)))
  const below = under === null ? null : parseColor(under)
  if (!below) return alpha >= 1 ? formatColor({ ...fill, a: 1 }) : under
  const mix = (top: number, bottom: number) => top * alpha + bottom * (1 - alpha)
  return formatColor({ r: mix(fill.r, below.r), g: mix(fill.g, below.g), b: mix(fill.b, below.b), a: 1 })
}

interface Holder {
  readonly el: NibElement
  readonly at: number
  readonly bounds: Bounds
  outline?: Point[]
}

const cache = new WeakMap<readonly NibElement[], { key: string; lookup: SurfaceLookup }>()

// fills are bucketed by the grid cells they cover, so a lookup only tries the fills at its centre
const CELL = 256
const MAX_CELLS = 256

const cellKey = (cx: number, cy: number): string => `${cx},${cy}`

/** The topmost fill in `list` (z-ordered) below z-position `at` that holds box `b` and point `p`. */
const topHolder = (list: readonly Holder[] | undefined, at: number, b: Bounds, p: Point): Holder | null => {
  if (!list) return null
  for (let i = list.length - 1; i >= 0; i--) {
    const h = list[i]!
    if (h.at >= at || !boundsContainBounds(h.bounds, b)) continue
    h.outline ??= elementOutline(h.el)
    if (pointInPolygon(p, h.outline)) return h
  }
  return null
}

/**
 * For each element of the z-ordered `elements`, the colour painted behind it: the topmost solid
 * fill drawn before it whose outline holds its centre and whose box holds its box, laid over what
 * is behind that fill in turn, or else `base`. Ink is kept legible against this rather than the
 * board, so light ink on a dark box is not pushed toward the board's opposite. An element not in
 * the list (one still being drawn or typed) is treated as the topmost.
 */
export const surfaceLookup = (
  elements: readonly NibElement[],
  theme: Theme,
  board: string,
  base: string | null,
): SurfaceLookup => {
  const key = `${theme}|${board}|${base ?? ""}`
  const hit = cache.get(elements)
  if (hit && hit.key === key) return hit.lookup
  const order = new Map<string, number>()
  const grid = new Map<string, Holder[]>()
  const wide: Holder[] = []
  elements.forEach((el, at) => {
    order.set(el.id, at)
    if (!holdsInk(el)) return
    const h: Holder = { el, at, bounds: getElementBounds(el) }
    const [x0, y0, x1, y1] = h.bounds.map((v) => Math.floor(v / CELL)) as [number, number, number, number]
    if (!((x1 - x0 + 1) * (y1 - y0 + 1) <= MAX_CELLS)) {
      wide.push(h)
      return
    }
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const k = cellKey(cx, cy)
        const list = grid.get(k)
        if (list) list.push(h)
        else grid.set(k, [h])
      }
  })
  const known = new WeakMap<NibElement, string | null>()
  const lookup: SurfaceLookup = (el) => {
    if (grid.size === 0 && wide.length === 0) return base
    const memo = known.get(el)
    if (memo !== undefined) return memo
    const at = order.get(el.id) ?? Number.POSITIVE_INFINITY
    const b = getElementBounds(el)
    const centre: Point = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
    const near = topHolder(
      grid.get(cellKey(Math.floor(centre[0] / CELL), Math.floor(centre[1] / CELL))),
      at,
      b,
      centre,
    )
    const far = topHolder(wide, at, b, centre)
    const top = near && far ? (near.at > far.at ? near : far) : (near ?? far)
    const out = top ? fillOver(top.el, theme, board, lookup(top.el)) : base
    known.set(el, out)
    return out
  }
  cache.set(elements, { key, lookup })
  return lookup
}

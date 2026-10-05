export type Side = "top" | "bottom" | "left" | "right"
export type Align = "start" | "center" | "end"

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface PlacementInput {
  anchor: Rect
  size: { width: number; height: number }
  viewport: { width: number; height: number }
  side?: Side
  align?: Align
  offset?: number
  padding?: number
  /**
   * For a box opened at a point (context menus): instead of flipping, slide it along the preferred axis
   * until it fits, so it scrolls only when it is taller (or wider) than the window.
   */
  slide?: boolean
}

export interface Placement {
  x: number
  y: number
  side: Side
  /** Room on the chosen side, for a scrolling body when the content is taller or wider than that. */
  maxWidth: number
  maxHeight: number
}

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" }

const clamp = (v: number, lo: number, hi: number): number => (hi < lo ? lo : Math.min(Math.max(v, lo), hi))

/** Places a floating box against an anchor: preferred side, flipped when it does not fit, kept on-screen. */
export const computePlacement = (input: PlacementInput): Placement => {
  const { anchor, size, viewport } = input
  const offset = input.offset ?? 8
  const pad = input.padding ?? 8
  const align = input.align ?? "center"
  const preferred = input.side ?? "top"
  if (input.slide) return slidePlacement(input, preferred, align, offset, pad)

  const room: Record<Side, number> = {
    top: anchor.y - offset - pad,
    bottom: viewport.height - (anchor.y + anchor.height) - offset - pad,
    left: anchor.x - offset - pad,
    right: viewport.width - (anchor.x + anchor.width) - offset - pad,
  }
  const need = (s: Side) => (s === "top" || s === "bottom" ? size.height : size.width)

  let side = preferred
  if (room[side] < need(side)) {
    const other = OPPOSITE[side]
    if (room[other] >= need(other) || room[other] > room[side]) side = other
  }

  const vertical = side === "top" || side === "bottom"
  const maxWidth = Math.max(0, vertical ? viewport.width - pad * 2 : room[side])
  const maxHeight = Math.max(0, vertical ? room[side] : viewport.height - pad * 2)
  const w = Math.min(size.width, maxWidth)
  const h = Math.min(size.height, maxHeight)
  let x: number
  let y: number
  if (vertical) {
    y = side === "top" ? anchor.y - offset - h : anchor.y + anchor.height + offset
    x =
      align === "start"
        ? anchor.x
        : align === "end"
          ? anchor.x + anchor.width - w
          : anchor.x + (anchor.width - w) / 2
  } else {
    x = side === "left" ? anchor.x - offset - w : anchor.x + anchor.width + offset
    y =
      align === "start"
        ? anchor.y
        : align === "end"
          ? anchor.y + anchor.height - h
          : anchor.y + (anchor.height - h) / 2
  }

  x = clamp(x, pad, viewport.width - pad - w)
  y = clamp(y, pad, viewport.height - pad - h)

  return {
    x: Math.round(x),
    y: Math.round(y),
    side,
    maxWidth,
    maxHeight,
  }
}

const slidePlacement = (
  input: PlacementInput,
  side: Side,
  align: Align,
  offset: number,
  pad: number,
): Placement => {
  const { anchor, size, viewport } = input
  const maxWidth = Math.max(0, viewport.width - pad * 2)
  const maxHeight = Math.max(0, viewport.height - pad * 2)
  const w = Math.min(size.width, maxWidth)
  const h = Math.min(size.height, maxHeight)
  // across the slide, a box that would run off the far edge opens the other way around the point first
  const along = (start: number, length: number, extent: number, span: number) => {
    if (align === "center") return start + (length - extent) / 2
    const forward = align === "start" ? start : start + length - extent
    const back = align === "start" ? start + length - extent : start
    const fits = (v: number) => v >= pad && v + extent <= span - pad
    return fits(forward) || !fits(back) ? forward : back
  }
  let x: number
  let y: number
  if (side === "top" || side === "bottom") {
    y = side === "top" ? anchor.y - offset - h : anchor.y + anchor.height + offset
    x = along(anchor.x, anchor.width, w, viewport.width)
  } else {
    x = side === "left" ? anchor.x - offset - w : anchor.x + anchor.width + offset
    y = along(anchor.y, anchor.height, h, viewport.height)
  }
  return {
    x: Math.round(clamp(x, pad, viewport.width - pad - w)),
    y: Math.round(clamp(y, pad, viewport.height - pad - h)),
    side,
    maxWidth,
    maxHeight,
  }
}

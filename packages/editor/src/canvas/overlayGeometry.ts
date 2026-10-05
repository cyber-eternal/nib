import {
  FRAME_LABEL_GAP,
  FRAME_LABEL_INSET,
  FRAME_LABEL_SIZE,
  type NibElement,
  type Point,
  type TextElement,
  type Viewport,
  containerMaxTextWidth,
  frameLabelLayout,
  sceneToScreen,
} from "@nib/core"

/**
 * A box in canvas pixels plus the rotation the renderer applies. `originX/Y` is the renderer's pivot
 * (the element's centre) measured from the box's top-left corner, for CSS transform-origin.
 */
export interface OverlayBox {
  left: number
  top: number
  width: number
  height: number
  originX: number
  originY: number
  angle: number
}

export interface TextOverlayBox extends OverlayBox {
  /** Soft-wrap at `width`: labels and fixed-width text wrap, auto-sized text grows instead. */
  wrap: boolean
}

const boxFor = (
  x: number,
  y: number,
  width: number,
  height: number,
  pivot: Point,
  angle: number,
  vp: Viewport,
): OverlayBox => {
  const [left, top] = sceneToScreen([x, y], vp)
  return {
    left,
    top,
    width: width * vp.zoom,
    height: height * vp.zoom,
    originX: (pivot[0] - x) * vp.zoom,
    originY: (pivot[1] - y) * vp.zoom,
    angle,
  }
}

/**
 * The editor sits exactly over the text as the renderer draws it. `text` is the laid-out element
 * (core.previewText keeps it current while typing). The box is the wrap width when the text wraps, lined
 * up with the drawn lines by the text's alignment, and it rotates about the drawn text's own centre.
 */
export const textOverlayBox = (
  text: TextElement,
  container: NibElement | null,
  vp: Viewport,
): TextOverlayBox => {
  const wrapWidth = container ? containerMaxTextWidth(container) : text.autoResize ? null : text.width
  const width = Math.max(0, wrapWidth ?? text.width)
  const x =
    text.textAlign === "center"
      ? text.x + (text.width - width) / 2
      : text.textAlign === "right"
        ? text.x + text.width - width
        : text.x
  const pivot: Point = [text.x + text.width / 2, text.y + text.height / 2]
  return { ...boxFor(x, text.y, width, text.height, pivot, text.angle, vp), wrap: wrapWidth !== null }
}

/** Screen px the rename field keeps however far the board is zoomed out. */
export const FRAME_NAME_MIN_WIDTH = 120

/**
 * The inline frame-rename field: where the renderer draws the name (frameLabelLayout, frame-local and
 * unrotated), as wide as the frame on screen, turned with the frame about the frame's centre.
 */
export const frameNameBox = (
  frame: NibElement & { type: "frame" },
  vp: Viewport,
  measure?: (s: string) => number,
): OverlayBox => {
  const z = vp.zoom > 0 ? vp.zoom : 1
  const label = frameLabelLayout(frame, z, measure)
  const lx = label?.x ?? FRAME_LABEL_INSET / z
  const ly = label?.y ?? -(FRAME_LABEL_GAP + FRAME_LABEL_SIZE) / z
  const height = label?.height ?? (FRAME_LABEL_SIZE + 4) / z
  const width = Math.max(frame.width - (FRAME_LABEL_INSET * 2) / z, FRAME_NAME_MIN_WIDTH / z)
  const pivot: Point = [frame.x + frame.width / 2, frame.y + frame.height / 2]
  return boxFor(frame.x + lx, frame.y + ly, width, height, pivot, frame.angle, vp)
}

/** Grows a box by `px` screen pixels on every side, keeping its pivot where it was. */
export const inflateBox = <T extends OverlayBox>(box: T, px: number): T => ({
  ...box,
  left: box.left - px,
  top: box.top - px,
  width: box.width + px * 2,
  height: box.height + px * 2,
  originX: box.originX + px,
  originY: box.originY + px,
})

/** CSS for a box: position, size and the renderer's rotation. */
export const overlayBoxStyle = (box: OverlayBox): Record<string, string | number> => ({
  left: box.left,
  top: box.top,
  width: box.width,
  height: box.height,
  transformOrigin: `${box.originX}px ${box.originY}px`,
  ...(box.angle ? { transform: `rotate(${box.angle}rad)` } : {}),
})

export interface ClientRect {
  x: number
  y: number
  width: number
  height: number
}

/** A scene-space box as a window rect: through the viewport, offset by the canvas origin, padded on every side. */
export const sceneRectToClient = (
  bounds: readonly [number, number, number, number],
  vp: Viewport,
  origin: Point = [0, 0],
  pad = 0,
): ClientRect => {
  const [x1, y1] = sceneToScreen([bounds[0], bounds[1]], vp)
  const [x2, y2] = sceneToScreen([bounds[2], bounds[3]], vp)
  return {
    x: origin[0] + Math.min(x1, x2) - pad,
    y: origin[1] + Math.min(y1, y2) - pad,
    width: Math.abs(x2 - x1) + pad * 2,
    height: Math.abs(y2 - y1) + pad * 2,
  }
}

/**
 * An embedded page laid out at the element's own size and scaled to the zoom, so it looks like the rest of
 * the board instead of reflowing to a phone layout when zoomed out. Rotation turns it about its centre.
 */
export const embedFrameStyle = (el: NibElement, vp: Viewport): Record<string, string | number> => {
  const [left, top] = sceneToScreen([el.x, el.y], vp)
  const w = el.width
  const h = el.height
  const turn = el.angle
    ? ` translate(${w / 2}px, ${h / 2}px) rotate(${el.angle}rad) translate(${-w / 2}px, ${-h / 2}px)`
    : ""
  return {
    left,
    top,
    width: w,
    height: h,
    transformOrigin: "0 0",
    transform: `scale(${vp.zoom})${turn}`,
  }
}

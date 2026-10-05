import type { Arrowhead } from "@nib/core"
import type { ReactNode } from "react"

// one stroke weight on a 20px grid, so the glyphs match the tray markers
const icon = (children: ReactNode, extra?: { fill?: string }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill={extra?.fill ?? "none"}
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
)

const box = <rect x="3.5" y="3.5" width="13" height="13" rx="2.5" />

export const StyleIcons = {
  hachure: icon(
    <>
      {box}
      <path d="M3.8 11.2l7.4-7.4M5.6 15.6l10-10M10.6 16.2l5.6-5.6" />
    </>,
  ),
  crossHatch: icon(
    <>
      {box}
      <path d="M3.8 11.2l7.4-7.4M5.6 15.6l10-10M10.6 16.2l5.6-5.6M8.8 3.8l7.4 7.4M4.4 5.6l10 10M3.8 10.6l5.6 5.6" />
    </>,
  ),
  solid: icon(<rect x="3.5" y="3.5" width="13" height="13" rx="2.5" fill="currentColor" />),
  zigzag: icon(
    <>
      {box}
      <path d="M5.5 13l2-6 2 6 2-6 2 6 1-3" />
    </>,
  ),
  strokeSolid: icon(<path d="M3 10h14" />),
  strokeDashed: icon(<path d="M3 10h14" strokeDasharray="3.5 3" />),
  strokeDotted: icon(<path d="M3 10h14" strokeDasharray="0.1 3.3" strokeWidth="2.2" />),
  architect: icon(<path d="M3 13c3-4 10-4 14-1" />),
  artist: icon(<path d="M3 13.5c3-5 9-4.5 14-1.5M3.6 12.2c3.4-4 8.8-3.4 12.8-.6" />),
  cartoonist: icon(
    <path d="M3 14c2.6-6.4 8.6-4.6 14-1.2M3.8 12c3-4.4 8.4-3.6 12.6-.2M2.8 10.8c3.6-3.6 9.4-2.6 13.4 1.6" />,
  ),
  sharp: icon(<path d="M4 16V4h12" />),
  round: icon(<path d="M4 16V10a6 6 0 0 1 6-6h6" />),
  arrowStraight: icon(
    <>
      <path d="M4 16L16 4" />
      <path d="M9.5 4H16v6.5" />
    </>,
  ),
  arrowCurved: icon(
    <>
      <path d="M4 16c0-7 4-11 12-12" />
      <path d="M11 2.6l5 1.4-2.2 4.8" />
    </>,
  ),
  arrowElbow: icon(
    <>
      <path d="M3 16h7V4h6" />
      <path d="M13 1.5L16 4l-3 2.5" />
    </>,
  ),
  textLeft: icon(<path d="M3.5 5h13M3.5 10h8M3.5 15h11" />),
  textCenter: icon(<path d="M3.5 5h13M6 10h8M4.5 15h11" />),
  textRight: icon(<path d="M3.5 5h13M8.5 10h8M5.5 15h11" />),
  valignTop: icon(
    <>
      <path d="M3.5 3.5h13" />
      <path d="M7 7.5h6M8 11h4" />
    </>,
  ),
  valignMiddle: icon(
    <>
      <path d="M3.5 3.5h13M3.5 16.5h13" />
      <path d="M7 8.2h6M8 11.8h4" />
    </>,
  ),
  valignBottom: icon(
    <>
      <path d="M3.5 16.5h13" />
      <path d="M7 9h6M8 12.5h4" />
    </>,
  ),
  opacity: icon(
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 3.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" />
    </>,
  ),
  arrange: icon(
    <>
      <path d="M10 3.5l6.5 3.25L10 10 3.5 6.75z" />
      <path d="M3.5 10.25L10 13.5l6.5-3.25" />
      <path d="M3.5 13.75L10 17l6.5-3.25" />
    </>,
  ),
  more: icon(
    <>
      <circle cx="4.5" cy="10" r="1.1" fill="currentColor" />
      <circle cx="10" cy="10" r="1.1" fill="currentColor" />
      <circle cx="15.5" cy="10" r="1.1" fill="currentColor" />
    </>,
  ),
  closedShape: icon(<path d="M10 3.5l7 12.5H3z" />),
  duplicate: icon(
    <>
      <rect x="7" y="7" width="9.5" height="9.5" rx="2" />
      <path d="M13 4.5V4a.5.5 0 0 0-.5-.5H5.5a2 2 0 0 0-2 2v7a.5.5 0 0 0 .5.5h.5" />
    </>,
  ),
  group: icon(
    <>
      <path d="M3 6V3h3M14 3h3v3M17 14v3h-3M6 17H3v-3" />
      <rect x="6" y="6" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </>,
  ),
  ungroup: icon(
    <>
      <rect x="3.5" y="3.5" width="6" height="6" rx="1" />
      <rect x="10.5" y="10.5" width="6" height="6" rx="1" />
      <path d="M13 4h3v3M4 13v3h3" />
    </>,
  ),
  flipH: icon(
    <>
      <path d="M10 2.5v15" strokeDasharray="2 2.5" />
      <path d="M7.5 5.5L3 14.5h4.5zM12.5 5.5l4.5 9h-4.5z" />
    </>,
  ),
  flipV: icon(
    <>
      <path d="M2.5 10h15" strokeDasharray="2 2.5" />
      <path d="M5.5 7.5L14.5 3v4.5zM5.5 12.5l9 4.5v-4.5z" />
    </>,
  ),
  link: icon(
    <>
      <path d="M8.5 11.5a3 3 0 0 0 4.24 0l2.5-2.5a3 3 0 0 0-4.24-4.24l-.75.75" />
      <path d="M11.5 8.5a3 3 0 0 0-4.24 0l-2.5 2.5a3 3 0 0 0 4.24 4.24l.75-.75" />
    </>,
  ),
  lock: icon(
    <>
      <rect x="4.5" y="9" width="11" height="8" rx="2" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
    </>,
  ),
  unlock: icon(
    <>
      <rect x="4.5" y="9" width="11" height="8" rx="2" />
      <path d="M7 9V6.5a3 3 0 0 1 5.8-1.1" />
    </>,
  ),
  tidy: icon(
    <>
      <path d="M3 15.5l4-6 3 3 3-5.5 4 2" strokeDasharray="1.6 2.2" />
      <path d="M3 5h14" />
    </>,
  ),
  copyStyle: icon(
    <>
      <path d="M4 3.5h9.5a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1z" />
      <path d="M14.5 5.5h1.5a1 1 0 0 1 1 1v2.5a1 1 0 0 1-1 1h-6v2" />
      <rect x="8.5" y="12" width="3" height="5" rx="1" />
    </>,
  ),
  pasteStyle: icon(
    <>
      <path d="M7 4H5.5a2 2 0 0 0-2 2v9.5a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H13" />
      <rect x="7" y="2.5" width="6" height="3" rx="1" />
      <path d="M7 10.5h6M7 13.5h4" />
    </>,
  ),
  bindText: icon(
    <>
      <rect x="2.5" y="4" width="15" height="12" rx="2" />
      <path d="M7 8h6M10 8v5" />
    </>,
  ),
  unbindText: icon(
    <>
      <path d="M6 4H4.5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2H6M14 4h1.5a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H14" />
      <path d="M7 8h6M10 8v5" />
    </>,
  ),
  wrapRectangle: icon(
    <>
      <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
      <path d="M7.5 8h5M10 8v4.5" />
    </>,
  ),
  wrapDiamond: icon(
    <>
      <path d="M10 2.5l7.5 7.5-7.5 7.5L2.5 10z" />
      <path d="M8 8.2h4M10 8.2v4" />
    </>,
  ),
  wrapEllipse: icon(
    <>
      <ellipse cx="10" cy="10" rx="7.5" ry="6" />
      <path d="M7.8 8.2h4.4M10 8.2v4" />
    </>,
  ),
  trash: icon(
    <>
      <path d="M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" />
      <path d="M5 5.5l.8 10.1a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4L15 5.5" />
    </>,
  ),
  toFront: icon(
    <>
      <rect x="7" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
      <path d="M3 7v8.5A1.5 1.5 0 0 0 4.5 17H13" />
    </>,
  ),
  forward: icon(<path d="M10 16.5V4M5.5 8.5L10 4l4.5 4.5" />),
  backward: icon(<path d="M10 3.5V16M5.5 11.5L10 16l4.5-4.5" />),
  toBack: icon(
    <>
      <rect x="3" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
      <path d="M7 3h8.5A1.5 1.5 0 0 1 17 4.5V13" />
    </>,
  ),
  alignLeft: icon(<path d="M3.5 3v14M7 6.5h9M7 13.5h5.5" />),
  alignCenterX: icon(<path d="M10 3v14M5.5 6.5h9M7.25 13.5h5.5" />),
  alignRight: icon(<path d="M16.5 3v14M13 6.5H4M13 13.5H7.5" />),
  alignTop: icon(<path d="M3 3.5h14M6.5 7v9M13.5 7v5.5" />),
  alignCenterY: icon(<path d="M3 10h14M6.5 5.5v9M13.5 7.25v5.5" />),
  alignBottom: icon(<path d="M3 16.5h14M6.5 13V4M13.5 13V7.5" />),
  distributeH: icon(<path d="M3.5 3v14M16.5 3v14M8.5 6.5v7M11.5 6.5v7" />),
  distributeV: icon(<path d="M3 3.5h14M3 16.5h14M6.5 8.5h7M6.5 11.5h7" />),
  eyedropper: icon(
    <>
      <path d="M12.2 4.3l3.5 3.5" />
      <path d="M14 2.8a1.8 1.8 0 0 1 2.6 0l.6.6a1.8 1.8 0 0 1 0 2.6l-2 2-3.2-3.2z" />
      <path d="M11 6.9l-6.6 6.6-.9 3 3-.9L13.1 9" />
    </>,
  ),
  check: icon(<path d="M4.5 10.5l3.5 3.5 7.5-8" />),
}

const HEAD_PATHS: Record<Arrowhead, ReactNode> = {
  arrow: <path d="M12 6l4.5 4-4.5 4" />,
  bar: <path d="M16 5.5v9" />,
  dot: <circle cx="15" cy="10" r="1.6" fill="currentColor" />,
  circle: <circle cx="14.5" cy="10" r="2.6" fill="currentColor" />,
  circle_outline: <circle cx="14.5" cy="10" r="2.6" />,
  triangle: <path d="M17 10l-5-3.5v7z" fill="currentColor" />,
  triangle_outline: <path d="M17 10l-5-3.5v7z" />,
  diamond: <path d="M17.5 10l-2.75-3-2.75 3 2.75 3z" fill="currentColor" />,
  diamond_outline: <path d="M17.5 10l-2.75-3-2.75 3 2.75 3z" />,
  crowfoot_one: <path d="M13.5 5.5v9" />,
  crowfoot_many: <path d="M11.5 10l5.5-4.5M11.5 10l5.5 4.5" />,
  crowfoot_one_or_many: <path d="M11.5 10l5.5-4.5M11.5 10l5.5 4.5M10 5.5v9" />,
}

const SHAFT_END: Partial<Record<Arrowhead, number>> = {
  arrow: 16,
  bar: 16,
  dot: 13.4,
  circle: 11.9,
  circle_outline: 11.9,
  crowfoot_one: 17,
  crowfoot_many: 17,
  crowfoot_one_or_many: 17,
}

/** A shaft with the head at its right end; `start` mirrors it so the head sits where the line begins. */
export const arrowheadIcon = (kind: Arrowhead | null, start = false) => {
  const shaftEnd = kind === null ? 17 : (SHAFT_END[kind] ?? 12)
  return icon(
    <g transform={start ? "matrix(-1 0 0 1 20 0)" : undefined}>
      <path d={`M3 10H${shaftEnd}`} />
      {kind ? HEAD_PATHS[kind] : null}
    </g>,
  )
}

/** Stroke-width previews draw the real weight, so these lines vary on purpose. */
export const widthIcon = (w: number) => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path d="M3 10h14" stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
  </svg>
)

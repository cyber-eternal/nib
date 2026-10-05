import type { ReactNode } from "react"

/** 2.1 units on the 24-unit grid draws 1.75px at the 20px icon size (the brief's one stroke weight). */
export const ICON_STROKE = 2.1

const svg = (children: ReactNode, viewBox = "0 0 24 24") => (
  <svg
    width="20"
    height="20"
    viewBox={viewBox}
    fill="none"
    stroke="currentColor"
    strokeWidth={ICON_STROKE}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
)

export const Icons = {
  selection: svg(<path d="M5.5 3.5l13 7.4-5.6 1.6-3 5.6z" />),
  lasso: svg(
    <>
      <path d="M4 11.5c0-3.9 3.6-6.5 8-6.5s8 2.6 8 6.5-3.6 6.5-8 6.5c-1.3 0-2.6-.2-3.7-.6" />
      <path d="M8.3 17.4c-1.2.5-1.8 1.3-1.8 2.1 0 .9.8 1.5 2 1.5" />
    </>,
  ),
  hand: svg(
    <>
      <path d="M7.5 12.5V7a1.75 1.75 0 013.5 0v4.5" />
      <path d="M11 11V4.75a1.75 1.75 0 013.5 0V11" />
      <path d="M14.5 11V6.5a1.75 1.75 0 013.5 0V14a7 7 0 01-7 7h-.6a6 6 0 01-4.6-2.2L3.6 15.9a1.75 1.75 0 012.6-2.3l1.3 1.4" />
    </>,
  ),
  rectangle: svg(<rect x="3.5" y="5" width="17" height="14" rx="2" />),
  diamond: svg(<path d="M12 3.5l8.5 8.5L12 20.5 3.5 12z" />),
  /** The flowchart input/output box: the rectangle's frame with its top edge shifted right. */
  parallelogram: svg(<path d="M8 5h12.5L16 19H3.5z" />),
  ellipse: svg(<ellipse cx="12" cy="12" rx="8.5" ry="7" />),
  arrow: svg(
    <>
      <path d="M3.5 12h16" />
      <path d="M14 6.5l5.5 5.5-5.5 5.5" />
    </>,
  ),
  line: svg(<path d="M4 20L20 4" />),
  freedraw: svg(<path d="M3 17.5c3-1 4-8 7-8s2 6 5 6 3-7 6-9" />),
  /** Raw freehand: a fine-liner with its trace. */
  pen: svg(
    <>
      <path d="M16.6 3.9a2 2 0 012.9 2.9L9.2 17.1l-4.2 1.3 1.3-4.2z" />
      <path d="M14.3 6.2l3 3" />
      <path d="M3.5 21.5c2-1 3.5-1 5 0s3 1 5 0" />
    </>,
  ),
  /** Freehand that snaps to shapes: a pencil with a spark beside its tip. */
  pencil: svg(
    <>
      <path d="M14.9 3.6l4.5 4.5L9 18.5l-5.5 1 1-5.5z" />
      <path d="M12.5 6l4.5 4.5" />
      <path d="M18.5 14.5v5M16 17h5" />
    </>,
  ),
  text: svg(
    <>
      <path d="M5 7V5h14v2" />
      <path d="M12 5v14" />
      <path d="M9 19h6" />
    </>,
  ),
  image: svg(
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="9.5" r="1.25" />
      <path d="M4 17.5l4.8-4.5 3.7 3.2 2.8-2.4 4.7 4" />
    </>,
  ),
  eraser: svg(
    <>
      <path d="M9 20h11" />
      <path d="M14.4 4.6l5 5L10.9 18H6.6l-2.4-2.4a2 2 0 010-2.8z" />
      <path d="M9 10l5 5" />
    </>,
  ),
  frame: svg(<path d="M7.5 3.5v17M16.5 3.5v17M3.5 7.5h17M3.5 16.5h17" />),
  laser: svg(
    <>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </>,
  ),
  embed: svg(
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M9.5 9.5L7 12l2.5 2.5M14.5 9.5L17 12l-2.5 2.5" />
    </>,
  ),
  /** Mermaid to diagram: two nodes and a connector. */
  mermaid: svg(
    <>
      <rect x="3.5" y="3.5" width="7.5" height="6" rx="1.5" />
      <rect x="13" y="14.5" width="7.5" height="6" rx="1.5" />
      <path d="M7.25 9.5v5a3 3 0 003 3H13" />
    </>,
  ),
  lock: svg(
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 018 0v3" />
    </>,
  ),
  unlock: svg(
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 017.4-2.1" />
    </>,
  ),
  more: svg(
    <>
      <circle cx="5.5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="18.5" cy="12" r="1.3" />
    </>,
  ),
  /** Theme deck: a fan of swatch cards (the shell set's theme icon on this grid). */
  theme: svg(
    <>
      <path d="M10.2 17.4a3.6 3.6 0 01-7.2 0v-12A1.8 1.8 0 014.8 3.6h3.6a1.8 1.8 0 011.8 1.8z" />
      <path d="M10.2 8.7l2.28-2.28a1.8 1.8 0 012.54 0l2.56 2.56a1.8 1.8 0 010 2.54L9.6 19.5" />
      <path d="M15.9 13.8h3.3a1.8 1.8 0 011.8 1.8v3.6a1.8 1.8 0 01-1.8 1.8H6.6" />
      <circle cx="6.6" cy="17.4" r="1.2" fill="currentColor" stroke="none" />
    </>,
  ),
  presentation: svg(
    <>
      <rect x="3.5" y="4" width="17" height="11.5" rx="1.5" />
      <path d="M10.5 7.5l4 2.25-4 2.25z" />
      <path d="M12 15.5v3.5M8.5 20.5h7" />
    </>,
  ),
  eyedropper: svg(
    <>
      <path d="M14.5 5.5l4 4" />
      <path d="M16 4a2.1 2.1 0 013 3l-1.5 1.5-3-3z" />
      <path d="M15.5 8.5L7 17l-3 1 1-3 8.5-8.5" />
    </>,
  ),
  undo: svg(
    <>
      <path d="M4.5 9h10a5 5 0 010 10h-5" />
      <path d="M8.5 5l-4 4 4 4" />
    </>,
  ),
  redo: svg(
    <>
      <path d="M19.5 9h-10a5 5 0 000 10h5" />
      <path d="M15.5 5l4 4-4 4" />
    </>,
  ),
  plus: svg(<path d="M12 5v14M5 12h14" />),
  minus: svg(<path d="M5 12h14" />),
  menu: svg(<path d="M4 6.5h16M4 12h16M4 17.5h16" />),
  close: svg(<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />),
  fit: svg(<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" />),
  search: svg(
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5l4.5 4.5" />
    </>,
  ),
  library: svg(
    <>
      <rect x="3.5" y="4.5" width="4.5" height="15" rx="1" />
      <rect x="10.5" y="4.5" width="4.5" height="15" rx="1" />
      <path d="M17.2 5.2l3.6 13.6" />
    </>,
  ),
  sun: svg(
    <>
      <circle cx="12" cy="12" r="3.75" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
    </>,
  ),
  moon: svg(<path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />),
  grid: svg(<path d="M4 9h16M4 15h16M9 4v16M15 4v16" />),
  magnet: svg(
    <>
      <path d="M6 4v8a6 6 0 0012 0V4" />
      <path d="M6 8.5h3.5M14.5 8.5H18" />
    </>,
  ),
  trash: svg(
    <>
      <path d="M4 7h16" />
      <path d="M9.5 7V4.5h5V7" />
      <path d="M6 7l1 13h10l1-13" />
    </>,
  ),
  duplicate: svg(
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 8.5V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7.5a2 2 0 002 2h2.5" />
    </>,
  ),
  group: svg(
    <>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
      <path d="M11 7h4a2 2 0 012 2v4" />
    </>,
  ),
  copy: svg(
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 9V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7a2 2 0 002 2h3" />
    </>,
  ),
  export: svg(
    <>
      <path d="M12 15V4.5M7.5 8.5L12 4l4.5 4.5" />
      <path d="M4.5 14.5V18a2 2 0 002 2h11a2 2 0 002-2v-3.5" />
    </>,
  ),
  open: svg(<path d="M4 7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2z" />),
  save: svg(
    <>
      <path d="M5 4.5h11l3.5 3.5v11a1 1 0 01-1 1H5a1 1 0 01-1-1v-13.5a1 1 0 011-1z" />
      <path d="M8 4.5v4.5h7V4.5M8 20v-5.5h8V20" />
    </>,
  ),
  file: svg(
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
    </>,
  ),
  zen: svg(<path d="M4 9.5V4h5.5M20 9.5V4h-5.5M4 14.5V20h5.5M20 14.5V20h-5.5" />),
  eye: svg(
    <>
      <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.75" />
    </>,
  ),
  stats: svg(<path d="M5 19.5V11M10 19.5V5M15 19.5v-6M20 19.5V9" />),
  help: svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.7-1.5 1.2-1.5 2.5" />
      <path d="M12 17.5v.01" />
    </>,
  ),
  link: svg(
    <>
      <path d="M10 13.5a4 4 0 005.7.3l3-3A4 4 0 0013 5.1l-1.4 1.4" />
      <path d="M14 10.5a4 4 0 00-5.7-.3l-3 3a4 4 0 005.7 5.7l1.4-1.4" />
    </>,
  ),
  front: svg(
    <>
      <rect x="4" y="4" width="11" height="11" rx="1.5" />
      <path d="M9 20h11V9" />
    </>,
  ),
  back: svg(
    <>
      <rect x="9" y="9" width="11" height="11" rx="1.5" />
      <path d="M15 4H4v11" />
    </>,
  ),
  alignLeft: svg(<path d="M4 4v16M8.5 8.5h9M8.5 15.5h5" />),
  alignCenterX: svg(<path d="M12 4v16M7.5 8.5h9M9.5 15.5h5" />),
  alignRight: svg(<path d="M20 4v16M15.5 8.5h-9M15.5 15.5h-5" />),
  alignTop: svg(<path d="M4 4h16M8.5 8.5v9M15.5 8.5v5" />),
  alignCenterY: svg(<path d="M4 12h16M8.5 7.5v9M15.5 9.5v5" />),
  alignBottom: svg(<path d="M4 20h16M8.5 15.5v-9M15.5 15.5v-5" />),
  distributeH: svg(<path d="M4 4v16M20 4v16M9.5 8v8M14.5 8v8" />),
  distributeV: svg(<path d="M4 4h16M4 20h16M8 9.5h8M8 14.5h8" />),
  flipH: svg(<path d="M12 3v18M8.5 7.5L4 12l4.5 4.5zM15.5 7.5L20 12l-4.5 4.5z" />),
  flipV: svg(<path d="M3 12h18M7.5 8.5L12 4l4.5 4.5zM7.5 15.5L12 20l4.5-4.5z" />),
  check: svg(<path d="M5 12.5l4.5 4.5L19 7" />),
  chevronDown: svg(<path d="M6.5 9.5L12 15l5.5-5.5" />),
  chevronUp: svg(<path d="M6.5 14.5L12 9l5.5 5.5" />),
  tidy: svg(
    <>
      <path d="M4 7h7a2 2 0 012 2v8" />
      <path d="M17 14l3 3-3 3" />
      <path d="M4 4.5v5M20 6h-4" />
    </>,
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof Icons

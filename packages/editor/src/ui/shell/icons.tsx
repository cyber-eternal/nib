import type { ReactNode } from "react"

/** Shell icons, drawn on a 20px grid with the set's one 1.75 stroke so they render 1:1 at 20px. */
const icon = (children: ReactNode) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
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

const dot = (cx: number, cy: number) => <circle cx={cx} cy={cy} r="1.15" fill="currentColor" stroke="none" />

export const ShellIcons = {
  menu: icon(<path d="M3.5 5.75h13M3.5 10h13M3.5 14.25h13" />),
  search: icon(
    <>
      <circle cx="8.75" cy="8.75" r="5.25" />
      <path d="M12.75 12.75l3.75 3.75" />
    </>,
  ),
  library: icon(<path d="M4.25 4v12M7.75 4v12M10.9 4.6l3.85 11.1M3 16h14" />),
  /** A fan of swatch cards, like the theme deck; the half-disc stays Opacity's. */
  theme: icon(
    <>
      <path d="M8.5 14.5a3 3 0 01-6 0v-10A1.5 1.5 0 014 3h3a1.5 1.5 0 011.5 1.5z" />
      <path d="M8.5 7.25l1.9-1.9a1.5 1.5 0 012.12 0l2.13 2.13a1.5 1.5 0 010 2.12L8 16.25" />
      <path d="M13.25 11.5H16a1.5 1.5 0 011.5 1.5v3A1.5 1.5 0 0116 17.5H5.5" />
      {dot(5.5, 14.5)}
    </>,
  ),
  export: icon(
    <path d="M10 12V3.5M6.75 6.75L10 3.5l3.25 3.25M4 11v3.75c0 .97.78 1.75 1.75 1.75h8.5c.97 0 1.75-.78 1.75-1.75V11" />,
  ),
  undo: icon(<path d="M7.25 4.5L3.75 8l3.5 3.5M4.25 8h7.5a4.25 4.25 0 010 8.5H9.5" />),
  redo: icon(<path d="M12.75 4.5L16.25 8l-3.5 3.5M15.75 8h-7.5a4.25 4.25 0 000 8.5h2.25" />),
  minus: icon(<path d="M5 10h10" />),
  plus: icon(<path d="M10 5v10M5 10h10" />),
  fit: icon(
    <path d="M3.5 7.5v-3a1 1 0 011-1h3M12.5 3.5h3a1 1 0 011 1v3M16.5 12.5v3a1 1 0 01-1 1h-3M7.5 16.5h-3a1 1 0 01-1-1v-3" />,
  ),
  help: icon(
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M7.9 7.75a2.15 2.15 0 014.2.6c0 1.4-2.1 1.85-2.1 3.15" />
      {dot(10, 14.4)}
    </>,
  ),
  more: icon(
    <>
      {dot(4.75, 10)}
      {dot(10, 10)}
      {dot(15.25, 10)}
    </>,
  ),
  close: icon(<path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />),
  chevronLeft: icon(<path d="M12 4.75L6.75 10 12 15.25" />),
  chevronRight: icon(<path d="M8 4.75L13.25 10 8 15.25" />),
  locate: icon(
    <>
      <circle cx="10" cy="10" r="4.25" />
      <path d="M10 2.5v2.75M10 14.75v2.75M2.5 10h2.75M14.75 10h2.75" />
    </>,
  ),
  present: icon(
    <>
      <rect x="2.75" y="3.25" width="14.5" height="10" rx="1.5" />
      <path d="M10 13.25v3.25M7 16.5h6M8.75 6.4v3.7l3-1.85z" />
    </>,
  ),
  stop: icon(<rect x="5.5" y="5.5" width="9" height="9" rx="1.5" />),
  laser: icon(
    <>
      <circle cx="10" cy="10" r="2.25" />
      <path d="M10 2.75v2.5M10 14.75v2.5M2.75 10h2.5M14.75 10h2.5M4.9 4.9l1.75 1.75M13.35 13.35l1.75 1.75" />
    </>,
  ),
  eye: icon(
    <>
      <path d="M2.75 10S5.5 4.75 10 4.75 17.25 10 17.25 10 14.5 15.25 10 15.25 2.75 10 2.75 10z" />
      <circle cx="10" cy="10" r="2.25" />
    </>,
  ),
  recent: icon(
    <>
      <circle cx="10" cy="10" r="6.75" />
      <path d="M10 6.25V10l2.5 1.6" />
    </>,
  ),
  trash: icon(
    <path d="M4 6h12M8 6V4.25h4V6M5.5 6l.7 9.6c.06.8.72 1.4 1.5 1.4h4.6c.78 0 1.44-.6 1.5-1.4L14.5 6" />,
  ),
  file: icon(
    <path d="M11.5 3H6a1.5 1.5 0 00-1.5 1.5v11A1.5 1.5 0 006 17h8a1.5 1.5 0 001.5-1.5V7zM11.5 3v4h4" />,
  ),
  folder: icon(
    <path d="M3 6.5V5a1.5 1.5 0 011.5-1.5h3l1.5 2h6.5A1.5 1.5 0 0117 7v7.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 14.5z" />,
  ),
  save: icon(
    <path d="M10 3.5V12M6.75 8.75L10 12l3.25-3.25M4 13.25v1.5c0 .97.78 1.75 1.75 1.75h8.5c.97 0 1.75-.78 1.75-1.75v-1.5" />,
  ),
  importFile: icon(
    <path d="M11.5 3.5H6.25c-.97 0-1.75.78-1.75 1.75v9.5c0 .97.78 1.75 1.75 1.75h7.5c.97 0 1.75-.78 1.75-1.75V7.5M2.5 11.25h7.25M7 8.5l2.75 2.75L7 14" />,
  ),
  exportFile: icon(
    <path d="M10.5 3.5H6.25c-.97 0-1.75.78-1.75 1.75v9.5c0 .97.78 1.75 1.75 1.75h7.5c.97 0 1.75-.78 1.75-1.75V12M9 9.5l8-6M12.5 3.5h4.5V8" />,
  ),
  image: icon(
    <>
      <rect x="3" y="4" width="14" height="12" rx="1.5" />
      <circle cx="7.5" cy="8.25" r="1.25" />
      <path d="M3.5 14.25l3.75-3.75 3 3 2-2 4.25 4.25" />
    </>,
  ),
  diagram: icon(
    <>
      <rect x="2.75" y="3.25" width="6" height="4.5" rx="1" />
      <rect x="11.25" y="12.25" width="6" height="4.5" rx="1" />
      <path d="M5.75 7.75v5c0 .55.45 1 1 1h4.5" />
    </>,
  ),
  grid: icon(<path d="M3.5 7.25h13M3.5 12.75h13M7.25 3.5v13M12.75 3.5v13" />),
  magnet: icon(<path d="M5 3.75h3V10a2 2 0 004 0V3.75h3V10a5 5 0 01-10 0zM5 7h3M12 7h3" />),
  stats: icon(<path d="M4.5 15.5v-5M8.5 15.5v-9M12.5 15.5V9M16 15.5v-3.5" />),
  terminal: icon(
    <>
      <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="1.5" />
      <path d="M6 8l2.25 2L6 12M10.5 12.25h3.5" />
    </>,
  ),
  keyboard: icon(
    <>
      <rect x="2.5" y="5.25" width="15" height="9.5" rx="1.5" />
      {dot(6, 8.5)}
      {dot(9, 8.5)}
      {dot(12, 8.5)}
      {dot(15, 8.5)}
      <path d="M7 11.75h6" />
    </>,
  ),
  sliders: icon(
    <>
      <path d="M3.5 6h7M14.5 6h2M3.5 14h2M9.5 14h7" />
      <circle cx="12.5" cy="6" r="1.75" />
      <circle cx="7.5" cy="14" r="1.75" />
    </>,
  ),
  zen: icon(
    <>
      <circle cx="10" cy="10" r="6.75" />
      <path d="M6.75 11.5c1.6 1.6 4.9 1.6 6.5 0" />
    </>,
  ),
  swatch: icon(
    <>
      <rect x="3.25" y="3.25" width="13.5" height="13.5" rx="2" />
      <path d="M3.5 12.5l9-9" />
    </>,
  ),
  check: icon(<path d="M5 10.5l3 3 7-7" />),
} as const

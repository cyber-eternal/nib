import type { ReactNode } from "react"

const svg = (children: ReactNode) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
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

/** The panels' own glyphs, drawn to the shell's one stroke weight (1.75 at 20px). */
export const PanelIcons = {
  close: svg(<path d="M6 6l12 12M18 6L6 18" />),
  search: svg(
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>,
  ),
  up: svg(<path d="M6 15l6-6 6 6" />),
  down: svg(<path d="M6 9l6 6 6-6" />),
  chevron: svg(<path d="M7 10l5 5 5-5" />),
  plus: svg(<path d="M12 5v14M5 12h14" />),
  more: svg(
    <>
      <circle cx="6" cy="12" r="0.9" />
      <circle cx="12" cy="12" r="0.9" />
      <circle cx="18" cy="12" r="0.9" />
    </>,
  ),
  trash: svg(<path d="M4 7h16M10 7V5h4v2M6.5 7l1 12.5h9L17.5 7M10 11v5M14 11v5" />),
  rename: svg(<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />),
  download: svg(<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />),
  upload: svg(<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14" />),
  copy: svg(
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 5.5V5a1.5 1.5 0 00-1.5-1.5H6A1.5 1.5 0 004.5 5v8A1.5 1.5 0 006 14.5h.5" />
    </>,
  ),
  frame: svg(<path d="M7.5 3.5v17M16.5 3.5v17M3.5 7.5h17M3.5 16.5h17" />),
  text: svg(<path d="M5 6.5V5h14v1.5M12 5v14M9.5 19h5" />),
  label: svg(
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M8.5 12h7" />
    </>,
  ),
  alert: svg(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5.5M12 16.4v.1" />
    </>,
  ),
  pencil: svg(
    <>
      <path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 013 3L8 18.5z" />
      <path d="M17.5 14.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z" />
    </>,
  ),
  library: svg(
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <path d="M16.75 13.5v6.5M13.5 16.75H20" />
    </>,
  ),
}

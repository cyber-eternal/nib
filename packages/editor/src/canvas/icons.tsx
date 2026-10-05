import type { ReactNode } from "react"

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
  >
    {children}
  </svg>
)

/** Glyphs for the link popup, drawn on the shell's 20px grid at the one stroke weight. */
export const LinkIcons = {
  link: icon(
    <>
      <path d="M8.5 11.5a3 3 0 0 0 4.24 0l2.83-2.83a3 3 0 0 0-4.24-4.24l-.7.7" />
      <path d="M11.5 8.5a3 3 0 0 0-4.24 0l-2.83 2.83a3 3 0 0 0 4.24 4.24l.7-.7" />
    </>,
  ),
  open: icon(
    <>
      <path d="M11 4h5v5" />
      <path d="M16 4l-7 7" />
      <path d="M14 12v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3" />
    </>,
  ),
  edit: icon(
    <>
      <path d="M12.5 4.5l3 3L8 15H5v-3z" />
      <path d="M11 6l3 3" />
    </>,
  ),
  unlink: icon(
    <>
      <path d="M8.5 11.5a3 3 0 0 0 4.24 0l1.4-1.4" />
      <path d="M11.5 8.5a3 3 0 0 0-4.24 0l-1.4 1.4" />
      <path d="M15.6 8.7a3 3 0 0 0-4.3-4.3" />
      <path d="M4.4 11.3a3 3 0 0 0 4.3 4.3" />
      <path d="M4 4l12 12" />
    </>,
  ),
  target: icon(
    <>
      <circle cx="10" cy="10" r="5.5" />
      <circle cx="10" cy="10" r="1.75" />
      <path d="M10 2v2.5M10 15.5V18M2 10h2.5M15.5 10H18" />
    </>,
  ),
  check: icon(<path d="M4.5 10.5l3.5 3.5 7.5-8" />),
  close: icon(<path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />),
  element: icon(
    <>
      <rect x="3.5" y="5" width="9" height="7" rx="1.5" />
      <path d="M12.5 8.5h2.5a1.5 1.5 0 0 1 1.5 1.5v4.5a1.5 1.5 0 0 1-1.5 1.5H9a1.5 1.5 0 0 1-1.5-1.5V12" />
    </>,
  ),
}

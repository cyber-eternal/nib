import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from "react"
import { Icons } from "../Icons"
import { Tooltip } from "../primitives/Tooltip"

export interface TrayMarkerProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> {
  /** Accessible name. */
  label: string
  /** Tooltip text when it should differ from the accessible name. */
  tooltip?: string
  icon: ReactNode
  /** Tool markers announce aria-pressed; disclosure buttons (More) leave it undefined. */
  pressed?: boolean
  /** Raised out of the tray without being a pressed toggle (More holding a drawer tool). */
  lifted?: boolean
  shortcut?: string
  ariaKeys?: string
  /** A small badge on the held marker, such as the pen's options caret. */
  flag?: ReactNode
  /** "Keep tool active" is on: a lock sits on the held marker, since the drawer that set it is closed. */
  kept?: boolean
}

/** One 40px marker: course-ink fill and a 6px rise while held, its name and key in a tooltip above. */
export const TrayMarker = forwardRef<HTMLButtonElement, TrayMarkerProps>(function TrayMarker(
  {
    label,
    tooltip,
    icon,
    pressed,
    lifted,
    shortcut,
    ariaKeys,
    flag,
    kept,
    className,
    type = "button",
    ...rest
  },
  ref,
) {
  const up = pressed === true || lifted === true
  return (
    <span className="tray-slot" data-lifted={up || undefined}>
      <Tooltip label={tooltip ?? label} shortcut={shortcut}>
        <button
          ref={ref}
          type={type}
          className={["tray-marker", className ?? ""].filter(Boolean).join(" ")}
          aria-label={label}
          aria-pressed={pressed}
          aria-keyshortcuts={ariaKeys}
          data-lifted={lifted || undefined}
          {...rest}
        >
          {icon}
          {flag ? (
            <span className="tray-marker-flag" aria-hidden="true">
              {flag}
            </span>
          ) : null}
          {kept ? (
            <span className="tray-marker-kept" aria-hidden="true">
              {Icons.lock}
            </span>
          ) : null}
        </button>
      </Tooltip>
    </span>
  )
})

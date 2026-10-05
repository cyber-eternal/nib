import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from "react"
import { chordToAria, isMacPlatform } from "../../hooks/useShortcuts"
import { Tooltip } from "./Tooltip"
import type { Side } from "./position"

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed" | "children"> {
  /** Accessible name, also the tooltip text. */
  label: string
  icon: ReactNode
  /** Toggle state (aria-pressed); leave undefined for a plain action button. */
  pressed?: boolean
  shortcut?: string
  /** Defaults to true: name and shortcut appear on hover and keyboard focus. */
  tooltip?: boolean
  tooltipSide?: Side
  /** Raises the pressed button out of the tray (the "lifted marker"). */
  lift?: boolean
  size?: "m" | "s"
  variant?: "quiet" | "primary" | "danger"
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    icon,
    pressed,
    shortcut,
    tooltip = true,
    tooltipSide = "top",
    lift,
    size = "m",
    variant = "quiet",
    className,
    type = "button",
    ...rest
  },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type}
      className={["sc-icon-button", className ?? ""].filter(Boolean).join(" ")}
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut ? chordToAria(shortcut, isMacPlatform()) : undefined}
      data-size={size}
      data-variant={variant}
      data-lift={lift || undefined}
      {...rest}
    >
      {icon}
    </button>
  )
  if (!tooltip) return button
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      {button}
    </Tooltip>
  )
})

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "quiet" | "danger"
  icon?: ReactNode
}

/** Labelled button; "primary" is the one course-ink action per surface (Export). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "quiet", icon, className, type = "button", children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={["sc-button", className ?? ""].filter(Boolean).join(" ")}
      data-variant={variant}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
})

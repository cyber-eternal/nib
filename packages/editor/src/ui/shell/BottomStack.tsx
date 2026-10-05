import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react"
import { useLayer } from "../../hooks/useLayer"
import { useMeasuredVar } from "./useMeasuredVar"
import { type ScreenRect, rectsOverlap } from "./viewport"
import "./shell.css"

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

export interface BottomStackProps {
  /** Interactive bars (crop, eyedropper), above the status line. */
  children?: ReactNode
  /** The guidance line; its region stays mounted so screen readers announce each new hint. */
  status?: string | null
  /** What the line must not cover, in window pixels: the selection it may be talking about. */
  avoid?: ScreenRect | null
}

/**
 * The one bottom-centre column above the tray: hints and mode bars stack here with a gap,
 * and its measured height lifts the toast region above it so nothing overlaps.
 */
export function BottomStack({ children, status, avoid }: BottomStackProps) {
  const ref = useRef<HTMLDivElement>(null)
  const statusRef = useRef<HTMLDivElement>(null)
  useMeasuredVar(ref, "--hint-stack-h", "height")

  useIsoLayoutEffect(() => {
    const el = statusRef.current
    if (!el) return
    const hint = el.firstElementChild?.getBoundingClientRect()
    const covered = !!avoid && !!hint && rectsOverlap(avoid, hint)
    el.toggleAttribute("data-covered", covered)
  }, [avoid, status])

  return (
    <div ref={ref} className="shell-stack" data-zone="bottom">
      {children}
      <div ref={statusRef} role="status" aria-live="polite" className="shell-stack-status">
        {status ? <p className="shell-hint">{status}</p> : null}
      </div>
    </div>
  )
}

export interface StackBarProps {
  text: string
  children?: ReactNode
  /**
   * Makes the bar a layer Escape dismisses (the eyedropper). The layer lives here, not in the shell,
   * so opening any other popover re-renders only this bar.
   */
  onDismiss?: () => void
}

/** A bar in the bottom stack with a message and its actions (Crop: Reset, Done). */
export function StackBar({ text, children, onDismiss }: StackBarProps) {
  const ref = useRef<HTMLDivElement>(null)
  useLayer({
    open: onDismiss !== undefined,
    ref,
    onDismiss: () => onDismiss?.(),
    dismissOnOutside: false,
    initialFocus: "none",
    restoreFocus: false,
  })
  return (
    <div ref={ref} className="shell-bar" tabIndex={-1}>
      <span className="shell-bar-text">{text}</span>
      {children}
    </div>
  )
}
